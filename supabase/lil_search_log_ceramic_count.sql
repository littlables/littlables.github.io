-- Lil search: Ceramic layer count for the audit log (Option B, 2026-11-05:
-- Ceramic runs before Serper when the grounding is thin).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run, and the migrate
-- job re-runs every supabase/*.sql file in order on SQL-changing pushes.
-- No new GRANTs: grants are table-level, so the existing service_role
-- SELECT + INSERT on lil_search_log already covers the new column.
-- Metadata only, per Katie's 2026-11-04 decision: counts only, never
-- titles, descriptions, or snippets.

ALTER TABLE public.lil_search_log
  ADD COLUMN IF NOT EXISTS ceramic_count integer NOT NULL DEFAULT 0;
