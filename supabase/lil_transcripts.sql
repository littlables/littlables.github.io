-- Lil transcripts, public-Lil release Step 1.5 (expanded scope).
--
-- Raw chat transcripts, one store per user: every row carries its
-- owner's user_id, so the admin's laptop import and (later) each
-- member's own Lil chats live in the same table without ever mixing.
-- The worker never reads another user's rows, and transcripts are
-- NEVER injected into a prompt or used for recall — recall reads only
-- the distilled `lil_memories` table. Transcripts exist for two jobs:
-- (1) the admin's record, like a chat history, and (2) the input to
-- the global distillation task, which reads them worker-side and
-- writes only aggregate style traits as drafts.
--
-- The uploaded laptop export goes to the littlables admin account:
-- the import endpoint always targets the calling admin's own user_id,
-- never a user_id supplied in the request body, so an import cannot
-- be aimed at another account.
--
-- Dedupe: laptop rows carry source_key (the laptop SQLite row id), and
-- the partial unique index below enforces one copy per (user, key).
-- Rows written later from the site have no source_key, so they are
-- unaffected by the index (Postgres allows many NULLs there).
--
-- Worker-only table: RLS is enabled, but only the service role (the
-- Worker via SUPABASE_SECRET_KEY) is granted access. No anon/
-- authenticated grants and no policies are created here — service_role
-- bypasses RLS, and no frontend code may read this table directly
-- (same pattern as lil_memories.sql and lil_usage_daily.sql).

CREATE TABLE IF NOT EXISTS public.lil_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  session_id text,
  source text,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  model text,
  -- No length cap here by design: a transcript is verbatim, and a few
  -- laptop messages run past 2000 characters. The distilled memories
  -- table keeps its 2000-char cap; this table does not.
  content text NOT NULL,
  -- The timestamp from the laptop logger, kept separate from created_at
  -- (when the row reached Supabase) so the original chronology survives.
  message_timestamp timestamptz,
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lil_transcripts_user_source_key_idx
  ON public.lil_transcripts (user_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS lil_transcripts_user_message_idx
  ON public.lil_transcripts (user_id, message_timestamp DESC);

ALTER TABLE public.lil_transcripts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lil_transcripts TO service_role;
