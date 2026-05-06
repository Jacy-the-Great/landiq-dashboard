-- ================================================================
-- Land iQ · Auth RLS Migration
-- Run this in the Supabase SQL Editor ONCE:
-- https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor
--
-- Implements the Database Authentication protocol:
--   - Drops permissive anon policies
--   - Adds authenticated-role policies on all tables
--   - Adds get_user_email() and verify_caller_email() helpers
--   - Removes anon grants from all RPC functions
--   - Grants all RPCs to authenticated role
--
-- After running this, the anon key can no longer read/write any table.
-- All access requires a valid Supabase Auth session (email OTP).
-- ================================================================


-- ================================================================
-- STEP 1 — Helper functions (per protocol spec)
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_user_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT auth.jwt() ->> 'email';
$$;

CREATE OR REPLACE FUNCTION public.verify_caller_email(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM p_email THEN
    RAISE EXCEPTION 'Caller email mismatch: JWT email does not match supplied email';
  END IF;
END;
$$;


-- ================================================================
-- STEP 2 — Replace anon policies with authenticated policies
--          on all four dashboard tables
-- ================================================================

-- ── dashboard_data ───────────────────────────────────────────────
ALTER TABLE public.dashboard_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_dashboard_data"   ON public.dashboard_data;
DROP POLICY IF EXISTS "auth_all_dashboard_data"   ON public.dashboard_data;

CREATE POLICY "auth_all_dashboard_data"
  ON public.dashboard_data
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── liq_pipedrive_deals ──────────────────────────────────────────
ALTER TABLE public.liq_pipedrive_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_pipedrive_deals"  ON public.liq_pipedrive_deals;
DROP POLICY IF EXISTS "auth_all_pipedrive_deals"  ON public.liq_pipedrive_deals;

CREATE POLICY "auth_all_pipedrive_deals"
  ON public.liq_pipedrive_deals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── liq_pipedrive_people ─────────────────────────────────────────
ALTER TABLE public.liq_pipedrive_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_pipedrive_people" ON public.liq_pipedrive_people;
DROP POLICY IF EXISTS "auth_all_pipedrive_people" ON public.liq_pipedrive_people;

CREATE POLICY "auth_all_pipedrive_people"
  ON public.liq_pipedrive_people
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── dashboard_backups ────────────────────────────────────────────
ALTER TABLE public.dashboard_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_backups"          ON public.dashboard_backups;
DROP POLICY IF EXISTS "auth_all_backups"          ON public.dashboard_backups;

CREATE POLICY "auth_all_backups"
  ON public.dashboard_backups
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ================================================================
-- STEP 3 — Revoke anon, grant authenticated on all RPC functions
-- ================================================================

-- PostHog functions
REVOKE EXECUTE ON FUNCTION public.ph_weekly_stats(int)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_daily_active_users(int)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_dau_mau(int)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_feature_usage(int)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_feature_daily(text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_summary()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_retention_cohort(int)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_new_users(int)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.ph_refresh_views()          FROM anon;

GRANT EXECUTE ON FUNCTION public.ph_weekly_stats(int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_daily_active_users(int)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_dau_mau(int)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_usage(int)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_daily(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_summary()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_retention_cohort(int)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_new_users(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_refresh_views()          TO authenticated;

-- Backup / health functions
REVOKE EXECUTE ON FUNCTION public.get_latest_backups()        FROM anon;
REVOKE EXECUTE ON FUNCTION public.trim_old_backups(int)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.db_health_check()           FROM anon;

GRANT EXECUTE ON FUNCTION public.get_latest_backups()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.trim_old_backups(int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_check()            TO authenticated;

-- New helper functions
GRANT EXECUTE ON FUNCTION public.get_user_email()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_caller_email(text)    TO authenticated;


-- ================================================================
-- STEP 4 — PostHog advanced RPC functions (if they exist)
-- ================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
             WHERE n.nspname='public' AND p.proname='ph_user_segments') THEN
    REVOKE EXECUTE ON FUNCTION public.ph_user_segments()                      FROM anon;
    GRANT  EXECUTE ON FUNCTION public.ph_user_segments()                      TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
             WHERE n.nspname='public' AND p.proname='ph_at_risk_users') THEN
    REVOKE EXECUTE ON FUNCTION public.ph_at_risk_users(int, int)              FROM anon;
    GRANT  EXECUTE ON FUNCTION public.ph_at_risk_users(int, int)              TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
             WHERE n.nspname='public' AND p.proname='ph_feature_adoption') THEN
    REVOKE EXECUTE ON FUNCTION public.ph_feature_adoption()                   FROM anon;
    GRANT  EXECUTE ON FUNCTION public.ph_feature_adoption()                   TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
             WHERE n.nspname='public' AND p.proname='ph_feature_completion') THEN
    REVOKE EXECUTE ON FUNCTION public.ph_feature_completion()                 FROM anon;
    GRANT  EXECUTE ON FUNCTION public.ph_feature_completion()                 TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
             WHERE n.nspname='public' AND p.proname='ph_power_users') THEN
    REVOKE EXECUTE ON FUNCTION public.ph_power_users(int)                     FROM anon;
    GRANT  EXECUTE ON FUNCTION public.ph_power_users(int)                     TO authenticated;
  END IF;
END $$;


-- ================================================================
-- VERIFY
-- ================================================================

-- Should show authenticated policies on all 4 tables
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('dashboard_data','liq_pipedrive_deals','liq_pipedrive_people','dashboard_backups')
ORDER BY tablename, policyname;
