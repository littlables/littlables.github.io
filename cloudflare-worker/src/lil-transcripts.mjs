/**
 * Lil transcript validation and dedupe (public-Lil release, Step 1.5
 * expanded scope). Pure helpers, no I/O, so they are unit-testable.
 *
 * Transcripts are verbatim chat history, one store per user. They are
 * NEVER used for recall and NEVER injected into a prompt — recall reads
 * only the distilled `lil_memories` table. These helpers exist for the
 * admin import endpoint: validate a laptop export row, and skip rows
 * the admin already imported (dedupe by source_key, enforced in the
 * database by a partial unique index and checked here first so the
 * endpoint can report how many rows were skipped).
 */

export const LIL_TRANSCRIPT_ROLES = new Set(['user', 'assistant', 'system']);

function cappedString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Normalize one import row, or return null when it is unusable. A row
 * is usable when it has a valid role and non-empty content; the
 * timestamp is nice-to-have (an unparseable one becomes null, it does
 * not reject the row), and content is kept verbatim with no length cap.
 */
export function validateTranscriptRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (!LIL_TRANSCRIPT_ROLES.has(row.role)) return null;
  if (typeof row.content !== 'string' || !row.content.trim()) return null;
  let messageTimestamp = null;
  if (typeof row.message_timestamp === 'string' && row.message_timestamp.trim()) {
    const parsed = new Date(row.message_timestamp.trim());
    if (!Number.isNaN(parsed.getTime())) messageTimestamp = parsed.toISOString();
  } else if (typeof row.timestamp === 'string' && row.timestamp.trim()) {
    // Laptop exports use `timestamp`; the table column is message_timestamp.
    const parsed = new Date(row.timestamp.trim());
    if (!Number.isNaN(parsed.getTime())) messageTimestamp = parsed.toISOString();
  }
  return {
    session_id: cappedString(row.session_id, 500),
    source: cappedString(row.source, 100),
    role: row.role,
    model: cappedString(row.model, 100),
    content: row.content,
    message_timestamp: messageTimestamp,
    source_key: cappedString(row.source_key, 500)
  };
}

function dedupeKey(row) {
  if (!row.source_key) return null;
  return `${row.source || ''}||${row.source_key}`;
}

/**
 * Split validated rows into new rows and already-imported ones.
 * `existingKeys` holds dedupe keys for rows this user already has
 * (from a `select source,source_key` read); rows without a source_key
 * cannot be deduped, so they are always treated as new.
 */
export function dedupeTranscriptRows(rows, existingKeys) {
  const seen = new Set(existingKeys instanceof Set ? existingKeys : []);
  const newRows = [];
  let skipped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = dedupeKey(row);
    if (key && seen.has(key)) {
      skipped += 1;
      continue;
    }
    if (key) seen.add(key);
    newRows.push(row);
  }
  return { newRows, skipped };
}
