import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tokenizeMemoryQuery,
  pickMemories,
  buildMemoryBlock,
  getLilMemoryBlock,
  LIL_GLOBAL_DRAFT_SOURCE
} from './lil-memory-recall.mjs';

const rows = [
  { id: '1', kind: 'fact', content: 'Littlables is a family-friendly discovery site.', created_at: '2026-11-01T00:00:00Z' },
  { id: '2', kind: 'personality', content: 'Lil is curious, playful, and warm.', created_at: '2026-11-02T00:00:00Z' },
  { id: '3', kind: 'episode', content: 'Katie and Lil built a word-search game together.', created_at: '2026-11-03T00:00:00Z' },
  { id: '4', kind: 'style', content: 'Lil explains things with short headings and examples.', created_at: '2026-11-04T00:00:00Z' }
];

test('tokenizeMemoryQuery drops stopwords, short tokens, and duplicates', () => {
  assert.deepEqual(
    tokenizeMemoryQuery('Tell me about the word-search game, please! Word-search is fun.'),
    ['word', 'search', 'game', 'fun']
  );
  assert.deepEqual(tokenizeMemoryQuery(''), []);
  assert.deepEqual(tokenizeMemoryQuery(null), []);
});

test('pickMemories always includes personality and style, then keyword matches, then recent', () => {
  const picked = pickMemories(rows, 'word-search game');
  assert.equal(picked[0].kind, 'personality');
  assert.equal(picked[1].kind, 'style');
  assert.ok(picked.some((m) => m.id === '3'), 'keyword-matching episode should be picked');
  assert.equal(picked.length, 4);
});

test('pickMemories returns nothing useful for empty or blank memories', () => {
  assert.deepEqual(pickMemories([], 'hello'), []);
  assert.deepEqual(pickMemories([{ id: 'x', kind: 'fact', content: '   ' }], 'hello'), []);
});

test('buildMemoryBlock is empty without memories and capped at 2000 chars', () => {
  assert.equal(buildMemoryBlock([], 'hello'), '');
  const block = buildMemoryBlock(rows, 'littlables');
  assert.match(block, /Lil\u2019s memories/);
  assert.match(block, /curious, playful, and warm/);
  const longRows = Array.from({ length: 12 }, (_, i) => ({
    id: `long-${i}`,
    kind: 'fact',
    content: `Memory number ${i} `.repeat(40),
    created_at: '2026-11-04T00:00:00Z'
  }));
  const longBlock = buildMemoryBlock(longRows, 'memory');
  assert.ok(longBlock.length <= 2000);
  assert.ok(longBlock.endsWith('...'));
});

test('pickMemories never picks global distillation drafts', () => {
  const withDraft = [
    ...rows,
    { id: 'draft-1', kind: 'style', content: 'Draft trait that must not appear.', source: LIL_GLOBAL_DRAFT_SOURCE, created_at: '2026-11-05T00:00:00Z' }
  ];
  const block = buildMemoryBlock(withDraft, 'hello');
  assert.doesNotMatch(block, /Draft trait that must not appear/);
});

test('buildMemoryBlock keeps global rows before the caller’s own rows', () => {
  const globalRow = { id: 'global-1', kind: 'personality', content: 'Global Lil voice trait.', user_id: null, created_at: '2026-11-05T00:00:00Z' };
  const ownRow = { id: 'own-1', kind: 'personality', content: 'Own admin personality note.', user_id: 'user-1', created_at: '2026-11-04T00:00:00Z' };
  const block = buildMemoryBlock([globalRow, ownRow], 'hello');
  assert.ok(block.indexOf('Global Lil voice trait.') < block.indexOf('Own admin personality note.'));
});

test('getLilMemoryBlock returns a block for the user and empty on any failure', async () => {
  const originalFetch = globalThis.fetch;
  const seenUserIds = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.match(url.pathname, /lil_memories$/);
    seenUserIds.push(url.searchParams.get('user_id'));
    if (url.searchParams.get('user_id') === 'is.null') {
      // Global rows: personality/style only, drafts excluded server-side.
      assert.equal(url.searchParams.get('kind'), 'in.(personality,style)');
      assert.equal(url.searchParams.get('source'), `neq.${LIL_GLOBAL_DRAFT_SOURCE}`);
      return Response.json([
        { id: 'global-1', kind: 'personality', content: 'Global Lil voice trait.', source: 'manual', created_at: '2026-11-05T00:00:00Z' }
      ]);
    }
    assert.equal(url.searchParams.get('user_id'), 'eq.user-1');
    return Response.json(rows);
  };
  try {
    const block = await getLilMemoryBlock(
      { SUPABASE_URL: 'https://supabase.example/', SUPABASE_SECRET_KEY: 'service-secret' },
      'user-1',
      'littlables'
    );
    assert.match(block, /curious, playful, and warm/);
    assert.match(block, /Global Lil voice trait/);
    assert.ok(block.indexOf('Global Lil voice trait.') < block.indexOf('curious, playful, and warm.'));
    assert.deepEqual(seenUserIds, ['eq.user-1', 'is.null']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(await getLilMemoryBlock({}, 'user-1', 'hello'), '');

  globalThis.fetch = async () => new Response('nope', { status: 500 });
  try {
    assert.equal(await getLilMemoryBlock(
      { SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 's' },
      'user-1',
      'hello'
    ), '');
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await getLilMemoryBlock(
      { SUPABASE_URL: 'https://supabase.example', SUPABASE_SECRET_KEY: 's' },
      'user-1',
      'hello'
    ), '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
