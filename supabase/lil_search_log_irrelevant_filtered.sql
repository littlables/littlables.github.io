-- Lil search audit: count Wikipedia results dropped by the relevance
-- screen (title/extract shares no content keyword with the question).
-- Idempotent; the migrate job runs all supabase/*.sql in filename order
-- with ON_ERROR_STOP=1, before the worker deploy.
ALTER TABLE public.lil_search_log
  ADD COLUMN IF NOT EXISTS irrelevant_filtered integer NOT NULL DEFAULT 0;
