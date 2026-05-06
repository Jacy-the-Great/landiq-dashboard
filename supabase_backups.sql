-- ================================================================
-- Land iQ · Dashboard Data Backup Table
-- Run this in the Supabase SQL Editor ONCE:
-- https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor
--
-- Creates an append-only backup log of every dashboard save.
-- Even if dashboard_data is wiped, the last saved state of every
-- key is preserved here and auto-restored on next load.
-- ================================================================

-- ── Backup log table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_backups (
  id         bigserial PRIMARY KEY,
  key        text        NOT NULL,
  value      jsonb       NOT NULL,
  saved_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_key_saved
  ON public.dashboard_backups (key, saved_at DESC);

-- RLS: same permissive policy as other tables
ALTER TABLE public.dashboard_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_backups" ON public.dashboard_backups;
CREATE POLICY "anon_all_backups"
  ON public.dashboard_backups
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.dashboard_backups TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.dashboard_backups_id_seq TO anon;


-- ── Restore function: get most recent value for each key ─────────
CREATE OR REPLACE FUNCTION public.get_latest_backups()
RETURNS TABLE (key text, value jsonb, saved_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT ON (key) key, value, saved_at
  FROM public.dashboard_backups
  ORDER BY key, saved_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_backups() TO anon;


-- ── Cleanup function: keep only last 20 backups per key ──────────
-- Call this via pg_cron weekly to stop the table growing forever
CREATE OR REPLACE FUNCTION public.trim_old_backups(keep_per_key int DEFAULT 20)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted int;
BEGIN
  DELETE FROM public.dashboard_backups
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY key ORDER BY saved_at DESC) AS rn
      FROM public.dashboard_backups
    ) ranked
    WHERE rn <= keep_per_key
  );
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN 'Trimmed ' || deleted || ' old backup rows at ' || NOW()::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trim_old_backups(int) TO anon;


-- ── Schedule weekly cleanup via pg_cron ─────────────────────────
SELECT cron.unschedule('trim-dashboard-backups')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trim-dashboard-backups');

SELECT cron.schedule(
  'trim-dashboard-backups',
  '0 4 * * 0',   -- 4 AM UTC every Sunday
  $$ SELECT public.trim_old_backups(20); $$
);


-- ── Verify setup ─────────────────────────────────────────────────
SELECT 'dashboard_backups table ready' AS status,
       COUNT(*) AS existing_rows
FROM public.dashboard_backups;
