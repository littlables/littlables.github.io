/**
 * Global personality distillation (public-Lil release, Step 1.5
 * expanded scope).
 *
 * A worker job that reads transcripts across ALL users and distills
 * Lil's shared voice into drafts — never into live rows, and never
 * with member content attached. The rules that make that safe:
 *
 * - Only assistant turns are sampled: the job learns how Lil talks,
 *   not what any member said. User turns are never sent to the model.
 * - The distill prompt forbids quotes, names, places, and personal
 *   facts; the output is aggregate style traits only ("keep answers
 *   short and playful"), each capped at 200 characters.
 * - Every trait is inserted as a DRAFT global row
 *   (source 'global-distill-draft', user_id NULL). Drafts are never
 *   recalled. They become live only when the admin approves them
 *   (by saving the wording as a normal global row and deleting the
 *   draft, or via the admin memory endpoints).
 * - Nothing is deleted and no existing global row is overwritten.
 *
 * The job never throws: on any failure it returns { ok: false } and
 * the caller logs it. It is triggered two ways: the worker's scheduled
 * handler on the weekly cron, and the admin-only POST
 * /api/lil/distill-global endpoint. Until the member gate opens, the
 * only transcripts that exist are the admin's, so early runs simply
 * seed the global voice from the admin's history.
 */

import { LIL_GLOBAL_DRAFT_SOURCE } from './lil-memory-recall.mjs';
import { LIL_WORKERS_AI_MODEL } from './lil-usage-log.mjs';

export const GLOBAL_DISTILL_CRON = '0 3 * * 0';
export const GLOBAL_DISTILL_SAMPLE_LIMIT = 100;
export const GLOBAL_DISTILL_FETCH_LIMIT = 500;

function extractDistillText(aiRes) {
  if (!aiRes || typeof aiRes !== 'object') return '';
  if (typeof aiRes.response === 'string') return aiRes.response;
  const message = aiRes.choices?.[0]?.message?.content;
  if (typeof message === 'string') return message;
  if (typeof aiRes.result?.response === 'string') return aiRes.result.response;
  return '';
}

/**
 * Build the distill prompt from sampled assistant turns. Exported for
 * unit tests: the prompt itself is the privacy guardrail, so its
 * wording is asserted, not just its existence.
 */
export function buildGlobalDistillPrompt(samples) {
  const lines = samples.map((sample) => `- ${sample.content}`).join('\n');
  return [
    'You are distilling the shared personality of Lil, a friendly discovery guide for curious kids and families, from samples of how she has answered in the past.',
    'Output ONLY a JSON array of strings, at most 10 items, each a single aggregate style or tone trait (for example: "Keep answers short, warm, and playful.").',
    'Rules you must follow:',
    '- Describe style and tone ONLY. Never describe topics, facts, people, places, or anything a specific person said or asked about.',
    '- Never quote or paraphrase any sample. Never include a name, a place, a date, or any personal detail.',
    '- Each trait must be between 1 and 200 characters.',
    'Samples of how Lil answers:',
    lines
  ].join('\n');
}

/**
 * Parse the model's JSON array into validated traits. Anything that is
 * not a clean string array, or any trait outside 1-200 characters, is
 * dropped — a malformed distill produces zero drafts, never bad rows.
 */
export function parseGlobalDistillTraits(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const traits = [];
  for (const trait of parsed) {
    if (typeof trait !== 'string') continue;
    const cleaned = trait.trim();
    if (!cleaned || cleaned.length > 200 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    traits.push(cleaned);
  }
  return traits.slice(0, 10);
}

/** Take the most recent assistant turns, truncated for the prompt. */
export function sampleAssistantMessages(rows, limit = GLOBAL_DISTILL_SAMPLE_LIMIT) {
  const samples = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.role !== 'assistant' || typeof row.content !== 'string' || !row.content.trim()) continue;
    samples.push({ content: row.content.trim().slice(0, 500) });
    if (samples.length >= limit) break;
  }
  return samples;
}

/**
 * Run one distillation pass. Returns { ok, draftsCreated,
 * sampleMessages, sampleUsers } on success, or { ok: false, error }
 * on any failure. Counts only — no user ids or transcript content are
 * returned or logged by this function.
 */
export async function runGlobalDistill(env) {
  try {
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SECRET_KEY) return { ok: false, error: 'Supabase is not configured.' };
    if (!env?.AI?.run) return { ok: false, error: 'Workers AI is not configured.' };
    const base = String(env.SUPABASE_URL).replace(/\/$/, '');
    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    };
    const params = new URLSearchParams({
      select: 'user_id,role,content,message_timestamp',
      role: 'eq.assistant',
      order: 'message_timestamp.desc',
      limit: String(GLOBAL_DISTILL_FETCH_LIMIT)
    });
    const response = await fetch(`${base}/rest/v1/lil_transcripts?${params}`, { headers });
    if (!response.ok) return { ok: false, error: 'Could not read Lil transcripts.' };
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, error: 'Could not read Lil transcripts.' };
    const sampleUsers = new Set(rows.map((row) => row.user_id).filter(Boolean)).size;
    const samples = sampleAssistantMessages(rows);
    if (samples.length === 0) {
      return { ok: true, draftsCreated: 0, sampleMessages: 0, sampleUsers };
    }
    const aiRes = await env.AI.run(LIL_WORKERS_AI_MODEL, {
      messages: [
        { role: 'system', content: 'You distill aggregate style traits from assistant answer samples. Follow the output rules exactly.' },
        { role: 'user', content: buildGlobalDistillPrompt(samples) }
      ],
      max_tokens: 512,
      temperature: 0.3
    });
    const traits = parseGlobalDistillTraits(extractDistillText(aiRes));
    if (traits.length === 0) {
      return { ok: true, draftsCreated: 0, sampleMessages: samples.length, sampleUsers };
    }
    const insertResponse = await fetch(`${base}/rest/v1/lil_memories`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(traits.map((content) => ({
        user_id: null,
        kind: 'style',
        content,
        source: LIL_GLOBAL_DRAFT_SOURCE,
        source_key: null
      })))
    });
    if (!insertResponse.ok) return { ok: false, error: 'Could not save distillation drafts.' };
    return { ok: true, draftsCreated: traits.length, sampleMessages: samples.length, sampleUsers };
  } catch (err) {
    console.error('Global Lil distillation failed:', err);
    return { ok: false, error: 'Global Lil distillation failed.' };
  }
}
