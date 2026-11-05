import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';

const ADMIN_USER = 'admin-user-1';

function envWithAi(aiRun) {
  return {
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'service-secret',
    SUMMARY_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI: { run: aiRun }
  };
}

function adminHeaders() {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer <redacted>' };
}

// Mock fetch for the server-chat-log tests. `transcriptRows` is returned
// for GET lil_transcripts, `queueRows` for GET lil_muse_queue, and
// `seen` collects POST bodies so tests can assert what was stored.
function mockLogFetch({ transcriptRows = [], queueRows = [] } = {}) {
  const originalFetch = globalThis.fetch;
  const seen = { transcriptsPost: null, rpc: null };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: ADMIN_USER, email: 'admin@example.com' });
    }
    if (url.pathname === '/rest/v1/profiles') {
      return Response.json([{ is_admin: true }]);
    }
    if (url.pathname === '/rest/v1/lil_memories') {
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/lil_transcripts') {
      if (options.method === 'POST') {
        seen.transcriptsPost = JSON.parse(options.body);
        return new Response(null, { status: 201 });
      }
      const sessionFilter = url.searchParams.get('session_id');
      const rows = sessionFilter && sessionFilter.startsWith('eq.')
        ? transcriptRows.filter((row) => row.session_id === sessionFilter.slice(3))
        : transcriptRows;
      return Response.json(rows);
    }
    if (url.pathname === '/rest/v1/lil_muse_queue') {
      return Response.json(queueRows);
    }
    if (url.pathname === '/rest/v1/rpc/increment_lil_usage') {
      seen.rpc = JSON.parse(options.body);
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  return { originalFetch, seen };
}

const transcriptRows = [
  { session_id: 's1', source: 'lil-chat', role: 'user', model: null, content: 'First question', message_timestamp: '2026-11-04T20:00:00Z', source_key: 's1:1:user' },
  { session_id: 's1', source: 'lil-chat', role: 'assistant', model: 'llama', content: 'First answer', message_timestamp: '2026-11-04T20:00:01Z', source_key: 's1:1:assistant' },
  { session_id: 's1', source: 'lil-chat', role: 'system', model: null, content: 'system note', message_timestamp: '2026-11-04T20:00:02Z', source_key: 's1:1:system' },
  { session_id: 's2', source: 'lil-chat', role: 'user', model: null, content: 'Second chat opener', message_timestamp: '2026-11-04T21:00:00Z', source_key: 's2:1:user' }
];

test('GET /api/lil/transcripts returns user and assistant bubbles only, in order', async () => {
  const { originalFetch } = mockLogFetch({ transcriptRows });
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/transcripts?session_id=s1', { headers: adminHeaders() }),
      envWithAi(async () => ({ choices: [{ message: { content: 'x' } }] })),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.session_id, 's1');
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/transcripts without a session id is 400, without auth is 401', async () => {
  const { originalFetch } = mockLogFetch({ transcriptRows });
  try {
    const noSession = await worker.fetch(
      new Request('https://worker.example/api/lil/transcripts', { headers: adminHeaders() }),
      envWithAi(async () => ({})),
      {}
    );
    assert.equal(noSession.status, 400);
    const noAuth = await worker.fetch(
      new Request('https://worker.example/api/lil/transcripts?session_id=s1'),
      envWithAi(async () => ({})),
      {}
    );
    assert.equal(noAuth.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/transcripts/sessions groups by session with first-user titles, newest first', async () => {
  const { originalFetch } = mockLogFetch({ transcriptRows });
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/transcripts/sessions', { headers: adminHeaders() }),
      envWithAi(async () => ({})),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sessions.length, 2);
    assert.equal(body.sessions[0].session_id, 's2');
    assert.equal(body.sessions[0].title, 'Second chat opener');
    assert.equal(body.sessions[1].session_id, 's1');
    assert.equal(body.sessions[1].title, 'First question');
    assert.equal(body.sessions[1].messageCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/lil/muse-queue/by-session returns pending queue ids for that session', async () => {
  const queueRows = [{ id: 'q-pending-1', created_at: '2026-11-04T20:10:00Z' }];
  const { originalFetch } = mockLogFetch({ queueRows });
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/muse-queue/by-session?session_id=s1', { headers: adminHeaders() }),
      envWithAi(async () => ({})),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.pending, [{ queue_id: 'q-pending-1', created_at: '2026-11-04T20:10:00Z' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/chat logs the Workers AI turn pair to transcripts and still answers', async () => {
  const { originalFetch, seen } = mockLogFetch({});
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/chat', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Why is the sky blue?' }], sessionId: 's9', mode: 'chat' })
      }),
      envWithAi(async () => ({ choices: [{ message: { content: 'Because of sunlight.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })),
      {}
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.answer, 'Because of sunlight.');
    assert.ok(Array.isArray(seen.transcriptsPost));
    assert.equal(seen.transcriptsPost.length, 2);
    assert.equal(seen.transcriptsPost[0].session_id, 's9');
    assert.equal(seen.transcriptsPost[0].source, 'lil-chat');
    assert.equal(seen.transcriptsPost[0].role, 'user');
    assert.equal(seen.transcriptsPost[0].content, 'Why is the sky blue?');
    assert.equal(seen.transcriptsPost[1].role, 'assistant');
    assert.equal(seen.transcriptsPost[1].content, 'Because of sunlight.');
    assert.match(seen.transcriptsPost[0].source_key, /^s9:.+:user$/);
    assert.match(seen.transcriptsPost[1].source_key, /^s9:.+:assistant$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/lil/chat in code mode does not log a chat turn pair', async () => {
  const { originalFetch, seen } = mockLogFetch({});
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/lil/chat', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Make a button' }], sessionId: 's9', mode: 'code' })
      }),
      envWithAi(async () => ({ choices: [{ message: { content: '<html></html>' } }], usage: {} })),
      {}
    );
    assert.equal(response.status, 200);
    assert.equal(seen.transcriptsPost, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
