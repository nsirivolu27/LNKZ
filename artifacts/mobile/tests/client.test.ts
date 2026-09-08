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

test('redacts token-like content before error or warning text reaches the UI', () => {
  assert.equal(
    redactSensitiveText('authorization: Bearer abcdefghijklmnop and api_key=sk_live_1234567890'),
    '[redacted] and [redacted]',
  );
});