/**
 * Per-user Lil usage logging (public-Lil release, Step 1).
 *
 * Step 1 is admin-gated and Workers-AI-only, but it already records the
 * per-member counts the later budget/enforcement and usage-view steps need:
 * one row per UTC day per user per usage type, via the `increment_lil_usage`
 * RPC (see `supabase/lil_usage_daily.sql`).
 *
 * This module deliberately does NOT import `news-storage.mjs` (which would
 * create a cycle with `index.js`, the same reason `ai-usage-log.mjs` is
 * standalone) and it never throws: if logging fails, Lil still answers and
 * the counts just gap, exactly like the global AI usage counter.
 */

export const LIL_WORKERS_AI_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export const LIL_USAGE_TYPES = new Set(['search', 'chat', 'code', 'games']);

/** Rough token estimate used only when the model response carries no usage. */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function usageField(usage, ...names) {
  if (!usage || typeof usage !== 'object') return null;
  for (const name of names) {
    const value = usage[name];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/**
 * Token counts for one Workers AI call. Workers AI may report usage in an
 * OpenAI-style `usage` object; when it does not, fall back to a
 * character-based estimate and mark the result as estimated so a later
 * step can tell the two apart in code (the daily aggregate stores the
 * numbers, not the flag — see the migration comment).
 */
export function extractLilTokenUsage(aiRes, promptText, answerText) {
  const usage =
    (aiRes && typeof aiRes === 'object' && aiRes.usage) ||
    (aiRes && typeof aiRes === 'object' && aiRes.token_usage) ||
    null;
  const promptTokens = usageField(usage, 'prompt_tokens', 'input_tokens');
  const completionTokens = usageField(usage, 'completion_tokens', 'output_tokens');
  if (promptTokens !== null && completionTokens !== null) {
    return { promptTokens, completionTokens, estimated: false };
  }
  return {
    promptTokens: estimateTokens(promptText),
    completionTokens: estimateTokens(answerText),
    estimated: true,
  };
}

/**
 * Record one Lil call (or one failed call) for a user. Returns true when
 * the RPC accepted the row, false otherwise. Never throws.
 */
export async function recordLilUsage(env, { userId, usageType, promptTokens = 0, completionTokens = 0, calls = 1, errors = 0 }) {
  try {
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY || !userId) return false;
    if (!LIL_USAGE_TYPES.has(usageType)) return false;
    const day = new Date().toISOString().slice(0, 10);
    const response = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/increment_lil_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
      },
      body: JSON.stringify({
        p_day: day,
        p_user_id: userId,
        p_usage_type: usageType,
        p_prompt_tokens: promptTokens,
        p_completion_tokens: completionTokens,
        p_calls: calls,
        p_errors: errors
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}
