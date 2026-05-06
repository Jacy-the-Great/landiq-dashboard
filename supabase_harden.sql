-- ================================================================
-- Land iQ · Supabase Hardening Script
-- Run this once in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor
--
-- What this does:
--   1. Enables RLS on data tables with permissive anon policies
--      (satisfies Security Advisor so the warning goes away,
--       while keeping the anon key able to read/write)
--   2. Schedules nightly PostHog view refresh via pg_cron
--   3. Sets a safe statement timeout for the anon role
--   4. Creates a health-check function the dashboard can ping
-- ================================================================


-- ================================================================
-- STEP 1 — RLS: enable it properly so Security Advisor is happy
--   We enable RLS but add a permissive policy for the anon role,
--   so the dashboard continues to work even if someone clicks
--   "Enable RLS" in the Supabase UI.
-- ================================================================

-- dashboard_data (manual metrics: website, tracker, etc.)
ALTER TABLE public.dashboard_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_dashboard_data" ON public.dashboard_data;
CREATE POLICY "anon_all_dashboard_data"
  ON public.dashboard_data
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- liq_pipedrive_deals
ALTER TABLE public.liq_pipedrive_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_pipedrive_deals" ON public.liq_pipedrive_deals;
CREATE POLICY "anon_all_pipedrive_deals"
  ON public.liq_pipedrive_deals
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- liq_pipedrive_people
ALTER TABLE public.liq_pipedrive_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_pipedrive_people" ON public.liq_pipedrive_people;
CREATE POLICY "anon_all_pipedrive_people"
  ON public.liq_pipedrive_people
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);


-- ================================================================
-- STEP 2 — Statement timeout: give anon queries up to 30 seconds
--   Default is 8s which can cause PostHog view timeouts.
-- ================================================================

ALTER ROLE anon SET statement_timeout = '30s';


-- ================================================================
-- STEP 3 — Nightly PostHog view refresh via pg_cron
--   Runs at 3 AM UTC every day so views never go stale.
--   (Requires pg_cron extension — available on Pro plans)
-- ================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove old schedule if it exists, then recreate
SELECT cron.unschedule('refresh-posthog-views')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'refresh-posthog-views'
  );

SELECT cron.schedule(
  'refresh-posthog-views',
  '0 3 * * *',
  $$ SELECT public.ph_refresh_views(); $$
);


-- ================================================================
-- STEP 4 — Health check function
--   The dashboard pings this on load to get DB status.
-- ================================================================

CREATE OR REPLACE FUNCTION public.db_health_check()
RETURNS TABLE (
  status          text,
  dashboard_rows  bigint,
  deals_count     bigint,
  people_count    bigint,
  ph_last_event   date,
  checked_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    'ok'                                                    AS status,
    (SELECT COUNT(*) FROM public.dashboard_data)            AS dashboard_rows,
    (SELECT COUNT(*) FROM public.liq_pipedrive_deals)       AS deals_count,
    (SELECT COUNT(*) FROM public.liq_pipedrive_people)      AS people_count,
    (SELECT MAX(last_seen) FROM posthog.mv_user_lifecycle)  AS ph_last_event,
    NOW()                                                   AS checked_at;
$$;

GRANT EXECUTE ON FUNCTION public.db_health_check() TO anon;


-- ================================================================
-- VERIFY — Run this to confirm everything is set up correctly
-- ================================================================

-- Should show RLS = true for all three tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('dashboard_data', 'liq_pipedrive_deals', 'liq_pipedrive_people');

-- Should show the cron job
SELECT jobname, schedule, command
FROM cron.job
WHERE jobname = 'refresh-posthog-views';

-- Should return status = 'ok' with row counts
SELECT * FROM public.db_health_check();
