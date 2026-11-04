import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateTokens,
  extractLilTokenUsage,
  recordLilUsage
} from './lil-usage-log.mjs';

test('estimateTokens rounds characters up to tokens at four chars each', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('a'), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('extractLilTokenUsage prefers provider usage over estimates', () => {
  const result = extractLilTokenUsage(
    { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 30, completion_tokens: 5 } },
    'a long prompt',
    'hi'
  );
  assert.deepEqual(result, { promptTokens: 30, completionTokens: 5, estimated: false });
});

test('extractLilTokenUsage accepts input/output token names', () => {
  const result = extractLilTokenUsage(
    { usage: { input_tokens: 10, output_tokens: 3 } },
    'prompt',
    'answer'
  );
  assert.deepEqual(result, { promptTokens: 10, completionTokens: 3, estimated: false });
});

test('extractLilTokenUsage estimates both counts when provider usage is partial or absent', () => {
  assert.deepEqual(
    extractLilTokenUsage({ usage: { prompt_tokens: 10 } }, '12345678', 'abc'),
    { promptTokens: 2, completionTokens: 1, estimated: true }
  );
  assert.deepEqual(
    extractLilTokenUsage({ response: 'hi' }, '12345678', 'hi'),
    { promptTokens: 2, completionTokens: 1, estimated: true }
  );
});

test('recordLilUsage posts one increment row for the current UTC day', async () => {
  const originalFetch = globalThis.fetch;
  let called;
  globalThis.fetch = async (input, options) => {
    called = { url: String(input), body: JSON.parse(options.body), auth: new Headers(options.headers).get('Authorization') };
    return new Response(null, { status: 200 });
  };

  try {
    const ok = await recordLilUsage(
      { SUPABASE_URL: 'https://supabase.example/', SUPABASE_SECRET_KEY: 'service-secret' },
      { userId: 'user-1', usageType: 'chat', promptTokens: 100, completionTokens: 20, calls: 1, errors: 0 }
    );
    assert.equal(ok, true);
    assert.equal(called.url, 'https://supabase.example/rest/v1/rpc/increment_lil_usage');
    assert.equal(called.body.p_day, new Date().toISOString().slice(0, 10));
    assert.equal(called.body.p_user_id, 'user-1');
    assert.equal(called.body.p_usage_type, 'chat');
    assert.equal(called.body.p_prompt_tokens, 100);
    assert.equal(called.body.p_completion_tokens, 20);
    assert.equal(called.auth, 'Bearer service-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recordLilUsage never throws and rejects invalid inputs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };

  try {
    assert.equal(await recordLilUsage({ SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 's' }, { userId: 'u', usageType: 'chat' }), false);
    assert.equal(await recordLilUsage({}, { userId: 'u', usageType: 'chat' }), false);
    assert.equal(await recordLilUsage({ SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 's' }, { userId: '', usageType: 'chat' }), false);
    assert.equal(await recordLilUsage({ SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 's' }, { userId: 'u', usageType: 'bogus' }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
