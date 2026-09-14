import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CredentialStorage, readCredentials, removeCredentials, writeCredentials } from '@/services/credential-store';
import { updateConversationSelection } from '@/services/context-selection';
import { getHandoffState } from '@/services/handoff-state';
import { buildConversationQuery, LnkzApiClient, messageForApiFailure, normalizeBaseUrl } from '@/services/lnkz-api';
import { requestBrowserPreviewSession } from '@/services/config';
import { redactSensitiveText } from '@/services/redaction';

const originalFetch = globalThis.fetch;

function readMobileSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const headerSource = readMobileSource('components/ui.tsx');
const uiSource = headerSource;
const librarySource = readMobileSource('app/(tabs)/index.tsx');

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input, init) => handler(String(input), init)) as typeof fetch;
}

type OfflineScreenFixture = {
  name: string;
  source: string;
  statusCopy: string[];
  anchors: string[];
};

const offlineScreenFixtures: OfflineScreenFixture[] = [
  {
    name: 'import preview',
    source: 'app/import.tsx',
    statusCopy: ['CONVERSATION', 'FOUND', 'Save to library'],
    anchors: ['testID="transcript-input"', 'testID="share-url-input"', 'label="Preview import"'],
  },
  {
    name: 'packet output',
    source: 'app/(tabs)/build.tsx',
    statusCopy: ['READY TO MOVE', 'Copy packet', 'Share'],
    anchors: ['testID="packet-query-input"', 'label="Build context packet"', 'Could not build packet.'],
  },
  {
    name: 'handoff issuance',
    source: 'app/handoff/new.tsx',
    statusCopy: ['Link is live.', 'PRIVATE EXPIRING LINK', 'Copy link', 'REDACTION ON'],
    anchors: ['label="Create secure handoff"', 'label="Close"'],
  },
  {
    name: 'conversation detail',
    source: 'app/conversations/[id].tsx',
    statusCopy: ['TRANSCRIPT', 'Create handoff', 'Build packet'],
    anchors: ['label="Close conversation"', 'This conversation will be included in the next context packet.'],
  },
  {
    name: 'empty library',
    source: 'app/(tabs)/index.tsx',
    statusCopy: ['INDEX_EMPTY', 'Import a transcript to initialize local index.', 'IMPORT_TRANSCRIPT'],
    anchors: ['testID="conversation-search-input"', 'EmptyState', 'router.push(\'/import\')'],
  },
  {
    name: 'request errors',
    source: 'app/(tabs)/handoffs.tsx',
    statusCopy: ['Could not load handoffs.', 'Could not revoke this handoff.'],
    anchors: ['ErrorNotice', 'onRetry={() => handoffsQuery.refetch()}'],
  },
];

class MemoryStorage implements CredentialStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  async deleteItem(key: string) {
    this.values.delete(key);
  }
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

test('conversation search sends a bounded authenticated request', async () => {
  mockFetch((url, init) => {
    assert.equal(url, 'https://relay.example.com/api/conversations/search');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer key');
    assert.deepEqual(JSON.parse(String(init?.body)), { query: 'launch notes', limit: 50 });
    return Response.json({ matches: [] });
  });
  const client = new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' });
  assert.deepEqual((await client.searchConversations('launch notes')).matches, []);
});

test('connection validation reaches an authenticated endpoint before credentials are accepted', async () => {
  const paths: string[] = [];
  mockFetch((url, init) => {
    paths.push(new URL(url).pathname);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer key');
    if (url.endsWith('/health')) return Response.json({ ok: true, service: 'llmm', version: '0.2.0' });
    if (url.endsWith('/api/workspace')) return Response.json({
      workspace: { id: 'workspace-1', name: 'Personal', mode: 'personal', useCase: 'Context', datasets: { enabled: true } },
      access: { actorId: 'actor-1', scopes: ['read'] },
    });
    return Response.json({ stats: { conversations: 0, messages: 0, providers: [], activeHandoffs: 0, events: 0 } });
  });
  const client = new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' });
  assert.equal((await client.validateConnection()).ok, true);
  assert.deepEqual(paths, ['/health', '/api/stats', '/api/workspace']);
});

test('workspace identity requests the authenticated workspace contract', async () => {
  mockFetch((url, init) => {
    assert.equal(url, 'https://relay.example.com/api/workspace');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer key');
    return Response.json({
      workspace: { id: 'workspace-1', name: 'Research Team', mode: 'team', useCase: 'Shared context', datasets: { enabled: false } },
      access: { actorId: 'member-1', scopes: ['mcp', 'read'] },
    });
  });
  const identity = await new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' }).workspace();
  assert.equal(identity.workspace.name, 'Research Team');
  assert.deepEqual(identity.access.scopes, ['mcp', 'read']);
});

test('browser preview session requests an origin-bound token without bundling an API key', async () => {
  mockFetch((url, init) => {
    assert.equal(url, 'https://relay.example.com/api/preview/session');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({
      token: 'ephemeral-preview-token',
      serverUrl: 'https://relay.example.com',
      expiresAt: '2026-09-09T12:00:00.000Z',
    });
  });
  assert.deepEqual(await requestBrowserPreviewSession('relay.example.com'), {
    serverUrl: 'https://relay.example.com',
    apiKey: 'ephemeral-preview-token',
  });
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

test('credential values restore normalized data and are fully removed on disconnect', async () => {
  const storage = new MemoryStorage();
  await writeCredentials(storage, { serverUrl: 'relay.example.com///', apiKey: '  private-key  ' });
  assert.deepEqual(await readCredentials(storage), {
    serverUrl: 'https://relay.example.com',
    apiKey: 'private-key',
  });
  await removeCredentials(storage);
  assert.equal(await readCredentials(storage), null);
  assert.equal(storage.values.size, 0);
});

test('context selection is stable, deduplicated, and removable', () => {
  const first = updateConversationSelection([], 'conversation-1', true);
  assert.deepEqual(first, ['conversation-1']);
  assert.equal(updateConversationSelection(first, 'conversation-1', true), first);
  assert.deepEqual(updateConversationSelection(first, 'conversation-1', false), []);
});

test('shared handoff header keeps its accessibility labels and action roles', () => {
  for (const label of ['THE THREAD', 'THE PACKET', 'THE DESTINATION', 'THE HANDOFF']) {
    assert.ok(headerSource.includes(`label: '${label}'`), `missing shared navigation label: ${label}`);
  }
  assert.match(headerSource, /accessibilityRole="button"/);
  assert.match(headerSource, /accessibilityLabel=\{item\.label\}/);
  assert.match(headerSource, /accessibilityLabel="Send context"/);
});

test('library and secondary-route headers preserve their navigation destinations', () => {
  const routeBindings = [
    ['onThread', '/(tabs)'],
    ['onPacket', '/build'],
    ['onHandoff', '/handoffs'],
    ['onSettings', '/settings'],
    ['onSend', '/import'],
  ] as const;

  for (const [callback, route] of routeBindings) {
    const binding = `${callback}={() => router.push('${route}')}`;
    assert.ok(headerSource.includes(binding), `secondary-route header lost ${callback} route ${route}`);
    assert.ok(librarySource.includes(binding), `library header lost ${callback} route ${route}`);
  }
});

test('secondary mobile routes continue to use the shared navigation header', () => {
  const secondaryRoutes = [
    'app/import.tsx',
    'app/handoff/new.tsx',
    'app/conversations/[id].tsx',
    'app/(tabs)/build.tsx',
    'app/(tabs)/handoffs.tsx',
    'app/(tabs)/settings.tsx',
  ];

  for (const route of secondaryRoutes) {
    assert.match(readMobileSource(route), /<ScreenHeader(?:\s|>)/, `${route} must render ScreenHeader`);
  }
});

test('offline screen fixtures preserve visible states and accessibility anchors', () => {
  for (const fixture of offlineScreenFixtures) {
    const source = readMobileSource(fixture.source);
    for (const copy of fixture.statusCopy) {
      assert.ok(source.includes(copy), `${fixture.name} fixture lost visible copy: ${copy}`);
    }
    for (const anchor of fixture.anchors) {
      assert.ok(source.includes(anchor), `${fixture.name} fixture lost screen anchor: ${anchor}`);
    }
  }

  // PrimaryButton and IconButton turn their labels into stable testIDs while
  // exposing the same labels to assistive technology.
  assert.match(uiSource, /testID=\{`button-\$\{label\.toLowerCase\(\)\.replace/);
  assert.match(uiSource, /testID=\{`icon-\$\{label\.toLowerCase\(\)\.replace/);
  assert.match(uiSource, /accessibilityLabel=\{label\}/);
  assert.match(uiSource, /accessibilityLabel="Send context"/);
});

test('handoff state distinguishes active, expired, exhausted, and revoked links', () => {
  const base = {
    id: 'handoff-1',
    conversationId: 'conversation-1',
    createdAt: '2026-09-08T00:00:00.000Z',
    expiresAt: '2026-09-08T02:00:00.000Z',
    maxUses: 2,
    uses: 0,
    redact: true,
    active: true,
  };
  const now = new Date('2026-09-08T01:00:00.000Z').getTime();
  assert.equal(getHandoffState(base, now), 'active');
  assert.equal(getHandoffState({ ...base, expiresAt: '2026-09-08T00:30:00.000Z', active: false }, now), 'expired');
  assert.equal(getHandoffState({ ...base, uses: 2, active: false }, now), 'exhausted');
  assert.equal(getHandoffState({ ...base, revokedAt: '2026-09-08T00:15:00.000Z', active: false }, now), 'revoked');
});

test('authorization, rate-limit, server, and malformed responses become short safe messages', async () => {
  assert.equal(messageForApiFailure(401), 'Your API key was rejected. Update it in Settings.');
  assert.equal(messageForApiFailure(429), 'Too many requests. Wait a moment and try again.');
  assert.equal(messageForApiFailure(503), 'The relay is temporarily unavailable. Try again shortly.');
  assert.equal(
    messageForApiFailure(400, { error: '<html><body>proxy failure</body></html>' }),
    'Check the entered details and try again.',
  );
});

test('offline failures never expose the fetch implementation error', async () => {
  mockFetch(() => {
    throw new Error('getaddrinfo ENOTFOUND internal-host');
  });
  const client = new LnkzApiClient({ serverUrl: 'relay.example.com', apiKey: 'key' });
  await assert.rejects(
    () => client.stats(),
    (error: unknown) => error instanceof Error
      && error.message === 'Unable to reach the relay. Check your connection and server URL.',
  );
});

test('redacts token-like content before error or warning text reaches the UI', () => {
  assert.equal(
    redactSensitiveText('authorization: Bearer abcdefghijklmnop and api_key=sk_live_1234567890'),
    '[redacted] and [redacted]',
  );
});