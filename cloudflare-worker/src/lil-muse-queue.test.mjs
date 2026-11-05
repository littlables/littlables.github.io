import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';

const BRIDGE_SECRET = 'bridge-secret-for-tests';
const ADMIN_USER = 'admin-user-1';
const QUEUE_ID = 'queue-1';

function envWithBridge(extra = {}) {
  return {
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'service-secret',
    LIL_BRIDGE_SECRET: BRIDGE_SECRET,
    SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...extra
  };
}

function adminHeaders() {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' };
}

function bridgeHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${BRIDGE_SECRET}` };
}

// Mock fetch shared by the queue tests. `queueRow` is the row returned
// for GET lil_muse_queue (null = no row), and `seen` collects the
// bodies of writes so tests can assert what was stored.
function mockQueueFetch(queueRow) {
  const originalFetch = globalThis.fetch;
  const seen = { queueInsert: null, queueUpdate: null, transcripts: null, rpc: null };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: ADMIN_USER, email: 'admin@example.com' });
    }
    if (url.pathname === '/rest/v1/profiles') {
      if (url.searchParams.get('is_admin') === 'eq.true') return Response.json([{ id: ADMIN_USER }]);
      return Response.json([{ is_admin: true }]);
    }
    if (url.pathname === '/rest/v1/lil_muse_queue') {
      if (options.method === 'POST') {
        seen.queueInsert = JSON.parse(options.body);
        return Response.json([{ id: QUEUE_ID }]);
      }
      if (options.method === 'PATCH') {
        seen.queueUpdate = JSON.parse(options.body);
        return new Response(null, { status: 200 });
      }
      if (queueRow && (url.searchParams.get('id') === `eq.${QUEUE_ID}` || url.searchParams.get('status') === 'eq.pending')) {
        return Response.json([queueRow]);
      }
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/lil_transcripts' && options.method === 'POST') {
      seen.transcripts = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/rpc/increment_lil_usage') {
      seen.rpc = JSON.parse(options.body);
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  return { originalFetch, seen };
}

const chatMessages = [
  { role: 'user', content: 'Hello, Muse, are you there?' }
];

async function postChat(model, mode = 'chat') {
  return worker.fetch(
    new Request('https://worker.example/api/lil/chat', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ messages: chatMessages, sessionId: 'lil-session-1', mode, model })
    }),
    envWithBridge(),
    {}
  );
}

test('GET /api/lil/models lists Muse alongside Llama, default still Llama', async () => {
  const originalFetch = mockQueueFetch(null).originalFetch;
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/models', { headers: { Authorization: 'Bearer admin-token' } }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.models, [
      { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B' },
      { id: 'muse', name: 'Muse' }
    ]);
    assert.equal(body.defaultModel, '@cf/meta/llama-3.2-3b-instruct');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/chat model=muse queues instead of answering inline', async () => {
  const { originalFetch, seen } = mockQueueFetch(null);
  try {
    const response = await postChat('muse');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.queued, true);
    assert.equal(body.queue_id, QUEUE_ID);
    assert.equal(body.provider, 'muse-bridge');
    assert.equal(body.model, 'muse');
    assert.equal(seen.queueInsert.user_id, ADMIN_USER);
    assert.equal(seen.queueInsert.status, 'pending');
    assert.equal(seen.queueInsert.session_id, 'lil-session-1');
    assert.deepEqual(seen.queueInsert.messages, chatMessages);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/chat model=muse with a non-chat mode is 400', async () => {
  const { originalFetch } = mockQueueFetch(null);
  try {
    const response = await postChat('muse', 'code');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /chat only/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/search model=muse is 400', async () => {
  const { originalFetch } = mockQueueFetch(null);
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/search', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ query: 'hello', model: 'muse' })
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /chat only/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/muse-queue returns a done reply, and 404 for an unknown id', async () => {
  const doneRow = { id: QUEUE_ID, status: 'done', reply: 'Hello from Muse.', error: null, created_at: '2026-11-04T00:00:00Z', completed_at: '2026-11-04T00:01:00Z' };
  const { originalFetch } = mockQueueFetch(doneRow);
  try {
    const response = await worker.fetch(
      new Request(`https://worker.example/api/lil/muse-queue?id=${QUEUE_ID}`, { headers: { Authorization: 'Bearer admin-token' } }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'done');
    assert.equal(body.reply, 'Hello from Muse.');
    const missing = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue?id=queue-unknown', { headers: { Authorization: 'Bearer admin-token' } }),
      envWithBridge(),
      {}
    );
    assert.equal(missing.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/muse-queue/pending accepts the bridge secret', async () => {
  const pendingRow = { id: QUEUE_ID, user_id: ADMIN_USER, session_id: 'lil-session-1', messages: chatMessages, created_at: '2026-11-04T00:00:00Z' };
  const { originalFetch } = mockQueueFetch(pendingRow);
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue/pending', { headers: { Authorization: `Bearer ${BRIDGE_SECRET}` } }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.pending.length, 1);
    assert.equal(body.pending[0].id, QUEUE_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/muse-queue/reply with the bridge secret marks done, logs transcripts and usage', async () => {
  const pendingRow = {
    id: QUEUE_ID,
    user_id: ADMIN_USER,
    session_id: 'lil-session-1',
    messages: chatMessages,
    status: 'pending'
  };
  const { originalFetch, seen } = mockQueueFetch(pendingRow);
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue/reply', {
        method: 'POST',
        headers: bridgeHeaders(),
        body: JSON.stringify({ queue_id: QUEUE_ID, reply: 'Hello from Muse.' })
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, queue_id: QUEUE_ID, status: 'done' });
    assert.equal(seen.queueUpdate.status, 'done');
    assert.equal(seen.queueUpdate.reply, 'Hello from Muse.');
    assert.equal(seen.transcripts.length, 2);
    assert.equal(seen.transcripts[0].role, 'user');
    assert.equal(seen.transcripts[0].source, 'muse-queue');
    assert.equal(seen.transcripts[0].source_key, `${QUEUE_ID}:user`);
    assert.equal(seen.transcripts[1].role, 'assistant');
    assert.equal(seen.transcripts[1].source_key, `${QUEUE_ID}:assistant`);
    assert.equal(seen.rpc.p_user_id, ADMIN_USER);
    assert.equal(seen.rpc.p_usage_type, 'chat');
    assert.equal(seen.rpc.p_calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/muse-queue/reply on a non-pending row is 409 and writes nothing', async () => {
  const doneRow = { id: QUEUE_ID, user_id: ADMIN_USER, session_id: 'lil-session-1', messages: chatMessages, status: 'done' };
  const { originalFetch, seen } = mockQueueFetch(doneRow);
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue/reply', {
        method: 'POST',
        headers: bridgeHeaders(),
        body: JSON.stringify({ queue_id: QUEUE_ID, reply: 'Too late.' })
      }),
      envWithBridge(),
      {}
    );
    assert.equal(response.status, 409);
    assert.equal(seen.queueUpdate, null);
    assert.equal(seen.transcripts, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/muse-queue/reply without auth is 401', async () => {
  const pendingRow = { id: QUEUE_ID, user_id: ADMIN_USER, session_id: 'lil-session-1', messages: chatMessages, status: 'pending' };
  const { originalFetch } = mockQueueFetch(pendingRow);
  // No bridge secret in env, no Authorization header: bridge auth
  // returns null and the admin check must fail, so stub /auth/v1/user
  // to 401 to prove the 401 path.
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return new Response(null, { status: 401 });
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: QUEUE_ID, reply: 'Hello.' })
      }),
      { SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 'service-secret', SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) } },
      {}
    );
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
