/**
 * Lil memory recall (public-Lil release, Step 1.5).
 *
 * Reads distilled memories from `lil_memories` for ONE user and builds
 * the small block the worker appends to Lil's system prompt. Step 1.5
 * calls this only from admin-gated Lil routes, so that user is the
 * admin (Katie). A later per-member step must pass the member's own
 * user_id — passing Katie's id for a member call would leak her
 * memories, and this module deliberately has no fallback to any
 * other user's rows.
 *
 * The one exception is global personality: `lil_memories` rows with a
 * NULL user_id are Lil's shared voice (personality/style only, written
 * by the admin or approved from distillation drafts). Global rows are
 * recalled first, then the caller's own memories, so the base voice
 * always comes before personalization. Draft rows from the global
 * distillation task (source 'global-distill-draft') are NEVER recalled
 * — they become live only when the admin approves them into a
 * non-draft global row.
 *
 * Recall is intentionally small and bounded: personality + style
 * memories always, plus keyword-relevant memories, plus a few recent
 * ones, capped at 2000 characters so prompt tokens stay predictable.
 * It never throws: on any fetch or parse failure it returns '' and
 * Lil answers without memories, exactly like a failed usage log.
 */

export const LIL_MEMORY_KINDS = new Set(['personality', 'style', 'preference', 'fact', 'episode']);

/** Source marking a global-personality draft that is not yet live. */
export const LIL_GLOBAL_DRAFT_SOURCE = 'global-distill-draft';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'what', 'how', 'why', 'when', 'where', 'who', 'can', 'could',
  'should', 'would', 'do', 'does', 'did', 'you', 'your', 'i', 'me', 'my',
  'we', 'our', 'lil', 'please', 'tell', 'about', 'give', 'make', 'show'
]);

export function tokenizeMemoryQuery(text) {
  if (typeof text !== 'string') return [];
  const tokens = new Set();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 3 && !STOPWORDS.has(token)) tokens.add(token);
  }
  return [...tokens];
}

function scoreMemory(memory, queryTokens) {
  if (queryTokens.length === 0 || typeof memory?.content !== 'string') return 0;
  const haystack = memory.content.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/**
 * Pick which memories to inject, in priority order: personality/style
 * first, then keyword-relevant, then recent. Exported for unit tests.
 */
export function pickMemories(memories, queryText) {
  const rows = Array.isArray(memories)
    ? memories.filter((m) => m && typeof m.content === 'string' && m.content.trim() && m.source !== LIL_GLOBAL_DRAFT_SOURCE)
    : [];
  const picked = [];
  const seen = new Set();
  const take = (memory) => {
    if (!memory || seen.has(memory.id) || picked.length >= 12) return;
    seen.add(memory.id);
    picked.push(memory);
  };
  for (const memory of rows) {
    if (memory.kind === 'personality' || memory.kind === 'style') take(memory);
  }
  const queryTokens = tokenizeMemoryQuery(queryText);
  const scored = rows
    .map((memory) => ({ memory, score: scoreMemory(memory, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.memory.created_at || '').localeCompare(a.memory.created_at || ''));
  for (const entry of scored.slice(0, 5)) take(entry.memory);
  for (const memory of rows.slice(0, 3)) take(memory);
  return picked;
}

export function buildMemoryBlock(memories, queryText) {
  const picked = pickMemories(memories, queryText);
  if (picked.length === 0) return '';
  const lines = picked.map((memory) => `- [${memory.kind}] ${memory.content.trim()}`);
  const block = [
    'Lil\u2019s memories about Katie and littlables. Use these to sound like Lil: same voice, same preferences, same facts. Do not quote them verbatim unless asked, and never reveal private details from them to anyone but Katie.',
    ...lines
  ].join('\n');
  return block.length > 2000 ? `${block.slice(0, 1997)}...` : block;
}

/**
 * Fetch one user's memories plus the global personality rows and build
 * the recall block, global rows first. Returns '' on any failure
 * (missing Supabase config, failed fetch, bad rows). A failed global
 * fetch is not fatal: the caller's own memories still recall without it.
 */
export async function getLilMemoryBlock(env, userId, queryText) {
  try {
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY || !userId) return '';
    const base = `${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/lil_memories`;
    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    };
    const ownParams = new URLSearchParams({
      select: 'id,kind,content,source,created_at',
      user_id: `eq.${userId}`,
      order: 'created_at.desc',
      limit: '50'
    });
    const ownResponse = await fetch(`${base}?${ownParams}`, { headers });
    if (!ownResponse.ok) return '';
    const ownRows = await ownResponse.json().catch(() => null);
    if (!Array.isArray(ownRows)) return '';
    let globalRows = [];
    try {
      const globalParams = new URLSearchParams({
        select: 'id,kind,content,source,created_at',
        user_id: 'is.null',
        kind: 'in.(personality,style)',
        source: `neq.${LIL_GLOBAL_DRAFT_SOURCE}`,
        order: 'created_at.desc',
        limit: '20'
      });
      const globalResponse = await fetch(`${base}?${globalParams}`, { headers });
      if (globalResponse.ok) {
        const parsed = await globalResponse.json().catch(() => null);
        if (Array.isArray(parsed)) globalRows = parsed;
      }
    } catch {
      globalRows = [];
    }
    return buildMemoryBlock([...globalRows, ...ownRows], queryText);
  } catch {
    return '';
  }
}
