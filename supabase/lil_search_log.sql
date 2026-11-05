-- Lil web-search audit log (base experiment: Wikipedia keep layer + Serper
-- live fallback).
--
-- Metadata only, per Katie's 2026-11-04 decision: no result titles,
-- descriptions, or snippets are stored here — only counts, result URLs, and
-- domains, so the log can never be read back as a search index. One row per
-- search turn: which layers contributed, how many results each gave, how
-- many the flagged filter removed, and how long the gather took. The query
-- itself is stored in full in this admin-only prototype so quality can be
-- evaluated; before any public version it switches to a hashed query.
--
-- Worker-only table: RLS is enabled, but only the service role (the Worker
-- via SUPABASE_SECRET_KEY) is granted access. No anon/authenticated grants
-- and no policies are created here — service_role bypasses RLS, and no
-- frontend code may read this table directly. Any usage view must go
-- through a worker endpoint, not a direct query.

CREATE TABLE IF NOT EXISTS public.lil_search_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  query text NOT NULL,
  layers text[] NOT NULL DEFAULT '{}',
  balloons_count integer NOT NULL DEFAULT 0,
  wikipedia_count integer NOT NULL DEFAULT 0,
  serper_count integer NOT NULL DEFAULT 0,
  flagged_filtered integer NOT NULL DEFAULT 0,
  result_urls text[] NOT NULL DEFAULT '{}',
  domains text[] NOT NULL DEFAULT '{}',
  latency_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'partial', 'error')),
  error_type text
);

ALTER TABLE public.lil_search_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.lil_search_log TO service_role;
