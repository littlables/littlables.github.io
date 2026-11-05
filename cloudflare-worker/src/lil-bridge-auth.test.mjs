import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';
import { verifyLilBridgeAuth, verifyLilBridgeOrAdmin } from './news-storage.mjs';

const BRIDGE_SECRET = 'bridge-secret-for-tests';
const ADMIN_USER = 'admin-user-1';

function bridgeRequest(token = BRIDGE_SECRET) {
  return new Request('https://worker.example/api/lil/memories', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

function envWithBridge(extra = {}) {
  return {
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'service-secret',
    LIL_BRIDGE_SECRET: BRIDGE_SECRET,
    SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...extra
  };
}

// Mock fetch for the profile lookup only. `profiles` is an array of
// { id } rows for is_admin=true, or null to simulate a failed lookup.
function mockProfilesFetch(profiles) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/profiles') {
      if (profiles === null) return new Response(null, { status: 502 });
      return Response.json(profiles);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  return { originalFetch, calls };
}

test('verifyLilBridgeAuth returns null when no bridge secret is configured, without fetching', async () => {
  const { originalFetch, calls } = mockProfilesFetch([{ id: ADMIN_USER }]);
  try {
    const result = await verifyLilBridgeAuth(
      { SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 'service-secret' },
      bridgeRequest()
    );
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyLilBridgeAuth returns null for a wrong token or a missing token', async () => {
  const { originalFetch, calls } = mockProfilesFetch([{ id: ADMIN_USER }]);
  try {
    assert.equal(await verifyLilBridgeAuth(envWithBridge(), bridgeRequest('wrong-secret')), null);
    assert.equal(await verifyLilBridgeAuth(envWithBridge(), bridgeRequest('')), null);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyLilBridgeAuth resolves the single admin profile when the secret matches', async () => {
  const { originalFetch, calls } = mockProfilesFetch([{ id: ADMIN_USER }]);
  try {
    const result = await verifyLilBridgeAuth(envWithBridge(), bridgeRequest());
    assert.deepEqual(result, { userId: ADMIN_USER });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /is_admin=eq\.true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyLilBridgeAuth fails closed when attribution is ambiguous or the lookup fails', async () => {
  for (const profiles of [[], [{ id: 'a' }, { id: 'b' }], null]) {
    const { originalFetch } = mockProfilesFetch(profiles);
    try {
      const result = await verifyLilBridgeAuth(envWithBridge(), bridgeRequest());
      assert.equal(result.status, 502);
      assert.match(result.error, /bridge admin/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('verifyLilBridgeOrAdmin prefers bridge auth and falls back to admin auth', async () => {
  const { originalFetch } = mockProfilesFetch([{ id: ADMIN_USER }]);
  try {
    // Bridge secret matches: no admin token needed, no /auth/v1/user call.
    assert.deepEqual(await verifyLilBridgeOrAdmin(envWithBridge(), bridgeRequest()), { userId: ADMIN_USER });
  } finally {
    globalThis.fetch = originalFetch;
  }
  // No bridge secret presented: falls back to the admin check, which
  // fails 401 here because the mock has no /auth/v1/user route.
  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('admin check fetch should have been attempted');
  };
  try {
    const result = await verifyLilBridgeOrAdmin(envWithBridge(), bridgeRequest('wrong-secret'));
    assert.equal(result.status, 502);
  } finally {
    globalThis.fetch = originalFetch2;
  }
});

// Route-level tests: the bridge secret must work exactly where the
// design says, and nowhere else.

function mockWorkerFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/profiles') {
      if (url.searchParams.get('is_admin') === 'eq.true') return Response.json([{ id: ADMIN_USER }]);
      return Response.json([{ is_admin: true }]);
    }
    if (url.pathname === '/auth/v1/user') {
      return new Response(null, { status: 401 });
    }
    if (url.pathname === '/rest/v1/lil_memories') {
      return Response.json([{ id: 'mem-1', kind: 'style', content: 'Lil voice note.', user_id: ADMIN_USER }]);
    }
    if (url.pathname === '/rest/v1/lil_transcripts') {
      if (options.method === 'POST') return new Response(null, { status: 201 });
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  return originalFetch;
}

test('GET /api/lil/memories accepts the bridge secret and scopes to the admin', async () => {
  const originalFetch = mockWorkerFetch();
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/memories', {
        headers: { Authorization: `Bearer ${BRIDGE_SECRET}` }
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memories[0].content, 'Lil voice note.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/transcripts/import accepts the bridge secret', async () => {
  const originalFetch = mockWorkerFetch();
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/transcripts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BRIDGE_SECRET}` },
        body: JSON.stringify({
          transcripts: [{ role: 'user', content: 'hello', session_id: 'chat-1', source: 'muse-bridge', source_key: 'req-1:user' }]
        })
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { imported: 1, skipped: 0, invalid: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/memories with only the bridge secret is still 401', async () => {
  const originalFetch = mockWorkerFetch();
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BRIDGE_SECRET}` },
        body: JSON.stringify({ kind: 'fact', content: 'must not be created by the bridge' })
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/distill-global with only the bridge secret is still 401', async () => {
  const originalFetch = mockWorkerFetch();
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/distill-global', {
        method: 'POST',
        headers: { Authorization: `Bearer ${BRIDGE_SECRET}` }
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/memories with a wrong bridge secret is still 401', async () => {
  const originalFetch = mockWorkerFetch();
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/memories', {
        headers: { Authorization: 'Bearer not-the-bridge-secret' }
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
