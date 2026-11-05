-- Lil Muse queue, for the lil chat "Muse" model (admin only).
--
-- Why a queue: Muse (the personal assistant) has no public HTTP
-- endpoint the Worker could call synchronously, and the bridge secret
-- must never reach the browser. So a model=muse chat does not answer
-- inline: the chat route inserts one row here (status pending) and
-- returns its id, the lil frontend polls for the reply, and the
-- Muse-side bridge picks pending rows up and posts each reply back
-- with the bridge secret. The reply endpoint also logs the turn pair
-- to lil_transcripts, so a Muse answer in lil is preserved like any
-- other bridged chat.
--
-- Worker-only table, same pattern as lil_transcripts.sql: RLS is
-- enabled, but only the service role (the Worker via
-- SUPABASE_SECRET_KEY) is granted access. No anon/authenticated
-- grants and no policies are created here — service_role bypasses
-- RLS, and no frontend code may read this table directly; the
-- frontend polls through the Worker, which scopes rows to the
-- calling admin's user_id.

CREATE TABLE IF NOT EXISTS public.lil_muse_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  session_id text,
  -- The validated chat messages (1-12, last must be user), as sent by
  -- the lil frontend, so Muse answers with the same history Lil
  -- would have used. Stored as JSONB, never injected into a prompt
  -- by any other route.
  messages jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'error')),
  reply text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS lil_muse_queue_pending_idx
  ON public.lil_muse_queue (status, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS lil_muse_queue_user_idx
  ON public.lil_muse_queue (user_id, created_at DESC);

ALTER TABLE public.lil_muse_queue ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lil_muse_queue TO service_role;
