import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTranscriptRow, dedupeTranscriptRows } from './lil-transcripts.mjs';

test('validateTranscriptRow normalizes a laptop export row', () => {
  const row = validateTranscriptRow({
    session_id: 'sess-1',
    source: 'vscode',
    role: 'assistant',
    model: 'qwen3.5-4b-64k:latest',
    content: 'Hello from Lil.',
    timestamp: '2026-11-04T05:58:21.625Z',
    source_key: '42'
  });
  assert.equal(row.role, 'assistant');
  assert.equal(row.content, 'Hello from Lil.');
  assert.equal(row.message_timestamp, '2026-11-04T05:58:21.625Z');
  assert.equal(row.source_key, '42');
});

test('validateTranscriptRow accepts message_timestamp and drops bad timestamps', () => {
  // Explicit offsets parse exactly; naive laptop timestamps parse in the
  // runtime's timezone (UTC on the worker), which preserves ordering.
  const withColumn = validateTranscriptRow({ role: 'user', content: 'Hi.', message_timestamp: '2026-11-03T08:18:57Z' });
  assert.equal(withColumn.message_timestamp, '2026-11-03T08:18:57.000Z');
  const badTimestamp = validateTranscriptRow({ role: 'user', content: 'Hi.', timestamp: 'not-a-date' });
  assert.equal(badTimestamp.message_timestamp, null);
});

test('validateTranscriptRow rejects bad roles and empty content', () => {
  assert.equal(validateTranscriptRow({ role: 'narrator', content: 'Hi.' }), null);
  assert.equal(validateTranscriptRow({ role: 'user', content: '   ' }), null);
  assert.equal(validateTranscriptRow(null), null);
});

test('validateTranscriptRow keeps long content verbatim (no 2000-char cap)', () => {
  const long = 'x'.repeat(7045);
  const row = validateTranscriptRow({ role: 'assistant', content: long });
  assert.equal(row.content.length, 7045);
});

test('dedupeTranscriptRows skips already-imported keys, within and across batches', () => {
  const rows = [
    { source: 'vscode', source_key: '1', role: 'user', content: 'a' },
    { source: 'vscode', source_key: '2', role: 'user', content: 'b' },
    { source: 'vscode', source_key: '2', role: 'user', content: 'b again' },
    { source: 'web-lil', source_key: null, role: 'user', content: 'no key, always new' }
  ];
  const { newRows, skipped } = dedupeTranscriptRows(rows, new Set(['vscode||1']));
  assert.equal(skipped, 2);
  assert.equal(newRows.length, 2);
  assert.equal(newRows[0].source_key, '2');
  assert.equal(newRows[1].source_key, null);
});
