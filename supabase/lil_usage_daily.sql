-- Per-user Lil usage, public-Lil release Step 1.
--
-- One row per UTC day per user per usage type. Step 1 is admin-gated, but
-- recording per-user counts now is what the later budget-enforcement and
-- member usage-view steps read from; there is no backfill of past Lil calls.
--
-- Token counts are provider-reported when Workers AI returns a usage object,
-- otherwise a character-based estimate (see lil-usage-log.mjs). The daily
-- aggregate stores the numbers, not which path produced them, so Step 1
-- counts should be read as approximate until a live Workers AI call
-- confirms the provider-usage path.
--
-- Worker-only table: RLS is enabled, but only the service role (the Worker
-- via SUPABASE_SECRET_KEY) is granted access. No anon/authenticated grants
-- and no policies are created here — service_role bypasses RLS, and no
-- frontend code may read this table directly. The member usage view in a
-- later step must go through a worker endpoint, not a direct query.

CREATE TABLE IF NOT EXISTS public.lil_usage_daily (
  usage_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('search', 'chat', 'code', 'games')),
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, user_id, usage_type)
);

ALTER TABLE public.lil_usage_daily ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lil_usage_daily TO service_role;

CREATE OR REPLACE FUNCTION public.increment_lil_usage(
  p_day date,
  p_user_id uuid,
  p_usage_type text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_calls integer,
  p_errors integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lil_usage_daily (
    usage_date, user_id, usage_type, prompt_tokens, completion_tokens, calls, errors
  ) VALUES (
    p_day, p_user_id, p_usage_type, p_prompt_tokens, p_completion_tokens, p_calls, p_errors
  )
  ON CONFLICT (usage_date, user_id, usage_type)
  DO UPDATE SET
    prompt_tokens = lil_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
    completion_tokens = lil_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
    calls = lil_usage_daily.calls + EXCLUDED.calls,
    errors = lil_usage_daily.errors + EXCLUDED.errors;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_lil_usage(date, uuid, text, integer, integer, integer, integer) TO service_role;
