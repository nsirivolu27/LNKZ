import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationQuery, LnkzApiClient, normalizeBaseUrl } from '@/services/lnkz-api';
import { redactSensitiveText } from '@/services/redaction';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input, init) => handler(String(input), init)) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('normalizes relay URLs and query filters without leaking duplicate slashes', () => {
  assert.equal(normalizeBaseUrl('relay.example.com///'), 'https://relay.example.com');
  assert.equal(
    buildConversationQuery({ provider: 'claude', tag: 'launch notes' }),
    'limit=100&provider=claude&tag=launch+notes',
  );
});

test('library requests include the bearer header and typed conversation response', async () => {
  mockFetch((url, init) => {
    assert.equal(url, 'https://relay.example.com/api/conversations?limit=100&provider=claude');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
    return Response.json({
      conversations: [{
        id: 'conversation-1',
        title: 'Decision log',
        source: { provider: 'claude' },
        participants: [],
        tags: [],
        messageCount: 3,
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
      }],
    });
  });
  const response = await new LnkzApiClient({ serverUrl: 'https://relay.example.com', apiKey: 'test-key' }).listConversations({ provider: 'claude' });
  assert.equal(response.conversations[0]?.title, 'Decision log');
});

test('import preview posts dry-run intent and preserves warnings for the UI', async () => {
  mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.dryRun, true);
    assert.equal(body.format, 'claude');
    assert.equal(body.payload, 'transcript');
    return Response.json({
      format: 'claude',
      warnings: ['One message had no timestamp.'],
      preview: [{ title: 'A thread', provider: 'claude', messages: 4 }],
    });
  });
  const response = await new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' }).importPayload('transcript', 'claude', true);
  assert.equal((response as { preview: { messages: number }[] }).preview[0]?.messages, 4);
});

test('packet generation sends bounded budget and returns markdown for copy/share', async () => {
  mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { query: 'launch decision', budgetTokens: 2000, includeExternal: true, maxConversations: 8 });
    return Response.json({
      packet: {
        query: 'launch decision',
        generatedAt: '2026-09-08T00:00:00.000Z',
        budgetTokens: 2000,
        usedTokens: 120,
        conversations: [],
        external: [],
        conflicts: [],
        markdown: '# Launch decision',
      },
    });
  });
  const response = await new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' }).buildPacket({ query: 'launch decision', budgetTokens: 2000 });
  assert.equal(response.packet.markdown, '# Launch decision');
});

test('handoff creation and revoke use the authenticated relay contract', async () => {
  const requests: { url: string; method: string; body?: unknown }[] = [];
  mockFetch((url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (init?.method === 'POST') {
      return Response.json({
        id: 'handoff-1',
        token: 'private-token',
        expiresAt: '2026-09-08T01:00:00.000Z',
        maxUses: 2,
        redact: true,
        shareUrl: 'https://relay.example.com/h/hand-off',
      });
    }
    return Response.json({});
  });
  const client = new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' });
  const issue = await client.createHandoff('conversation-1', {
    ttlMinutes: 60,
    maxUses: 2,
    audience: 'preview',
    note: 'Carry the decision forward',
    redact: true,
  });
  await client.revokeHandoff(issue.id);

  assert.equal(requests[0]?.url, 'https://relay.example.com/api/conversations/conversation-1/handoffs');
  assert.equal(requests[0]?.method, 'POST');
  assert.deepEqual(requests[0]?.body, {
    conversationId: 'conversation-1',
    ttlMinutes: 60,
    maxUses: 2,
    audience: 'preview',
    note: 'Carry the decision forward',
    redact: true,
  });
  assert.equal(requests[1]?.url, 'https://relay.example.com/api/handoffs/handoff-1');
  assert.equal(requests[1]?.method, 'DELETE');
});

test('stats and connector status stay behind the authenticated API client', async () => {
  let call = 0;
  mockFetch((url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer key');
    call += 1;
    if (url.endsWith('/api/stats')) {
      return Response.json({ stats: { conversations: 2, messages: 8, providers: [{ provider: 'claude', count: 2 }], activeHandoffs: 1, events: 4 } });
    }
    assert.equal(url, 'https://relay.example.com/api/connectors');
    return Response.json({ connectors: [{ id: 'lnkz', label: 'LNKZ', configured: true, detail: 'Local relay' }] });
  });
  const client = new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' });
  assert.equal((await client.stats()).stats.activeHandoffs, 1);
  assert.equal((await client.connectors()).connectors[0]?.configured, true);
  assert.equal(call, 2);
});

test('redacts token-like content before error or warning text reaches the UI', () => {
  assert.equal(
    redactSensitiveText('authorization: Bearer abcdefghijklmnop and api_key=sk_live_1234567890'),
    '[redacted] and [redacted]',
  );
});