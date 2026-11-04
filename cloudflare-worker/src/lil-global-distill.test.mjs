import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGlobalDistillPrompt,
  parseGlobalDistillTraits,
  sampleAssistantMessages,
  runGlobalDistill
} from './lil-global-distill.mjs';
import { LIL_GLOBAL_DRAFT_SOURCE } from './lil-memory-recall.mjs';

test('buildGlobalDistillPrompt forbids quotes, names, places, and personal facts', () => {
  const prompt = buildGlobalDistillPrompt([{ content: 'Hello, curious friend!' }]);
  assert.match(prompt, /Never quote or paraphrase any sample/);
  assert.match(prompt, /Never include a name, a place, a date, or any personal detail/);
  assert.match(prompt, /style and tone ONLY/);
});

test('parseGlobalDistillTraits accepts a clean JSON array and drops bad items', () => {
  assert.deepEqual(
    parseGlobalDistillTraits('["Keep answers short and playful.", "Explain simply."]'),
    ['Keep answers short and playful.', 'Explain simply.']
  );
  assert.deepEqual(parseGlobalDistillTraits('not json at all'), []);
  assert.deepEqual(parseGlobalDistillTraits('{"trait": "not an array"}'), []);
  const long = 'x'.repeat(201);
  assert.deepEqual(parseGlobalDistillTraits(JSON.stringify(['Good trait.', '', long, 'Good trait.'])), ['Good trait.']);
});

test('sampleAssistantMessages uses assistant turns only and truncates long ones', () => {
  const samples = sampleAssistantMessages([
    { role: 'user', content: 'A member question that must never be sampled.' },
    { role: 'assistant', content: 'A Lil answer.' },
    { role: 'assistant', content: 'y'.repeat(900) }
  ]);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].content, 'A Lil answer.');
  assert.equal(samples[1].content.length, 500);
  assert.doesNotMatch(samples.map((s) => s.content).join(' '), /member question/);
});

test('runGlobalDistill inserts traits as drafts and reports counts only', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ pathname: url.pathname, method: options.method || 'GET', body: options.body });
    if (url.pathname === '/rest/v1/lil_transcripts') {
      assert.equal(url.searchParams.get('role'), 'eq.assistant');
      return Response.json([
        { user_id: 'user-a', role: 'assistant', content: 'Short and playful answer one.', message_timestamp: '2026-11-04T00:00:00Z' },
        { user_id: 'user-b', role: 'assistant', content: 'Short and playful answer two.', message_timestamp: '2026-11-03T00:00:00Z' }
      ]);
    }
    if (url.pathname === '/rest/v1/lil_memories' && options.method === 'POST') {
      const inserted = JSON.parse(options.body);
      assert.equal(inserted.length, 2);
      for (const row of inserted) {
        assert.equal(row.user_id, null);
        assert.equal(row.kind, 'style');
        assert.equal(row.source, LIL_GLOBAL_DRAFT_SOURCE);
      }
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };
  try {
    const result = await runGlobalDistill({
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SECRET_KEY: 'service-secret',
      AI: {
        run: async () => ({ response: '["Keep answers short and playful.", "Explain unfamiliar ideas simply."]' })
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.draftsCreated, 2);
    assert.equal(result.sampleMessages, 2);
    assert.equal(result.sampleUsers, 2);
    assert.ok(!('user-a' in result) && !('user-b' in result));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runGlobalDistill fails closed when Supabase or Workers AI is missing', async () => {
  assert.equal((await runGlobalDistill({})).ok, false);
  assert.equal((await runGlobalDistill({
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 's'
  })).ok, false);
});
