-- Lil memories, public-Lil release Step 1.5 (admin-only recall).
--
-- Distilled memories Lil uses to sound like herself — personality, style,
-- preferences, and facts — NOT raw chat transcripts. This table is the
-- Supabase side of Katie's laptop memories: the laptop (SQLite/JSONL
-- forever logger) remains the source of truth, and any import is a
-- curated copy, never a replacement for it.
--
-- Separation guardrail, by design:
-- - Every row belongs to exactly one user_id, EXCEPT global rows, whose
--   user_id is NULL. A global row is Lil's shared personality (kind
--   personality or style only): it is read by every Lil call's recall
--   and may be written or deleted only through the admin-gated memory
--   endpoints. Step 1.5 recall runs only for admin-gated Lil calls, so
--   the recalled user is the admin (Katie). Per-member recall is a later
--   step and must pass that member's own user_id here — never Katie's —
--   or members would see her memories. Global rows are the one exception
--   to that rule, and they carry no member's private content by design:
--   they are either written by the admin or distilled as aggregate
--   style traits (source 'global-distill-draft' until the admin approves
--   them; drafts are never recalled).
-- - No frontend code may read this table directly. Recall and the admin
--   memory endpoints go through the worker with the service role.
--
-- Dedupe note: import rows carry source_key (the laptop record's id, or
-- timestamp+source) so an import can skip rows it already inserted.
-- No UNIQUE constraint on (user_id, source, source_key): manual rows
-- have no source_key, and Postgres treats NULLs as distinct, so the
-- import step checks for an existing row in code instead of relying
-- on a constraint that would not catch the manual case either.
--
-- Worker-only table: RLS is enabled, but only the service role (the
-- Worker via SUPABASE_SECRET_KEY) is granted access. No anon/
-- authenticated grants and no policies are created here — service_role
-- bypasses RLS, and no frontend code may read this table directly
-- (same pattern as lil_usage_daily.sql and ai_usage_daily.sql).

CREATE TABLE IF NOT EXISTS public.lil_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL user_id = global personality row (admin-writable, recalled for
  -- every Lil call). A NULL here is deliberate, not a missing owner.
  user_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('personality', 'style', 'preference', 'fact', 'episode')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  source text NOT NULL DEFAULT 'manual' CHECK (char_length(source) BETWEEN 1 AND 100),
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lil_memories_user_created_idx
  ON public.lil_memories (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lil_memories_global_created_idx
  ON public.lil_memories (created_at DESC)
  WHERE user_id IS NULL;

ALTER TABLE public.lil_memories ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lil_memories TO service_role;
