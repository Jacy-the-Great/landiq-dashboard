-- ============================================================================
-- FIX: Activity tab "statement timeout" error
-- ----------------------------------------------------------------------------
-- Cause: five PostHog functions (segments, at-risk, power users, feature
-- adoption, feature completion) were querying the raw posthog."Posthog Events"
-- table live on every page load. On a large events table those queries exceed
-- Supabase's ~8s statement timeout, so the whole Activity tab fails.
--
-- Fix: rewrite all five to read from the existing materialized views
-- (mv_user_lifecycle, mv_feature_usage) which are pre-computed and fast, plus
-- one small new view for feature adoption. Reads become instant.
--
-- Run this ONCE in the Supabase SQL editor, then click "Refresh PostHog" in the
-- dashboard (or just reload the Activity tab).
-- ============================================================================

-- ── New: distinct users per feature (needed for adoption %) ─────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_feature_adoption CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_feature_adoption AS
SELECT
  SPLIT_PART(event, '.', 1)      AS feature,
  COUNT(DISTINCT distinct_id)    AS users_who_tried
FROM posthog."Posthog Events"
WHERE event NOT LIKE '$%'
  AND event NOT LIKE '%click%'
  AND event NOT IN ('$web_vitals', '$dead_click', '$rageclick', '$pageleave')
GROUP BY feature;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_feature_adoption
  ON posthog.mv_feature_adoption (feature);


-- ── 1. User segments (New / Active / At-risk / Dormant) ─────────────────────
DROP FUNCTION IF EXISTS public.ph_user_segments();
CREATE FUNCTION public.ph_user_segments()
RETURNS TABLE (segment text, user_count bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT seg AS segment, COUNT(*)::bigint AS user_count
  FROM (
    SELECT CASE
      WHEN last_seen  <  CURRENT_DATE - 30 THEN 'Dormant'
      WHEN last_seen  <  CURRENT_DATE - 14 THEN 'At-risk'
      WHEN first_seen >= CURRENT_DATE - 14 THEN 'New'
      ELSE 'Active'
    END AS seg
    FROM posthog.mv_user_lifecycle
  ) s
  GROUP BY seg;
$$;


-- ── 2. At-risk users (previously active, gone quiet) ────────────────────────
DROP FUNCTION IF EXISTS public.ph_at_risk_users(int, int);
CREATE FUNCTION public.ph_at_risk_users(min_active_days int DEFAULT 3, days_threshold int DEFAULT 14)
RETURNS TABLE (distinct_id text, first_seen date, last_seen date, active_days bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT distinct_id, first_seen, last_seen, active_days, total_events
  FROM posthog.mv_user_lifecycle
  WHERE active_days >= min_active_days
    AND last_seen  <  CURRENT_DATE - days_threshold
    AND last_seen  >= CURRENT_DATE - 90        -- ignore long-dormant users
  ORDER BY last_seen DESC
  LIMIT 500;
$$;


-- ── 3. Power users (most active) ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ph_power_users(int);
CREATE FUNCTION public.ph_power_users(user_limit int DEFAULT 25)
RETURNS TABLE (distinct_id text, first_seen date, last_seen date, active_days bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT distinct_id, first_seen, last_seen, active_days, total_events
  FROM posthog.mv_user_lifecycle
  ORDER BY active_days DESC, total_events DESC
  LIMIT user_limit;
$$;


-- ── 4. Feature adoption (% of all users who tried each feature) ─────────────
DROP FUNCTION IF EXISTS public.ph_feature_adoption();
CREATE FUNCTION public.ph_feature_adoption()
RETURNS TABLE (feature text, users_who_tried bigint, total_users bigint, adoption_pct numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH tot AS (SELECT COUNT(*)::bigint AS n FROM posthog.mv_user_lifecycle)
  SELECT a.feature,
         a.users_who_tried::bigint,
         tot.n AS total_users,
         ROUND(100.0 * a.users_who_tried / NULLIF(tot.n, 0), 1) AS adoption_pct
  FROM posthog.mv_feature_adoption a, tot
  WHERE a.feature <> ''
  ORDER BY a.users_who_tried DESC;
$$;


-- ── 5. Feature completion (started vs completed events) ─────────────────────
-- Heuristic: event names containing "start" vs "complete/finish/success/done".
DROP FUNCTION IF EXISTS public.ph_feature_completion();
CREATE FUNCTION public.ph_feature_completion()
RETURNS TABLE (feature text, started bigint, completed bigint, completion_pct numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT feature,
         SUM(events) FILTER (WHERE event_name ILIKE '%start%')::bigint AS started,
         SUM(events) FILTER (WHERE event_name ILIKE '%complet%'
                                OR event_name ILIKE '%finish%'
                                OR event_name ILIKE '%success%'
                                OR event_name ILIKE '%done%')::bigint  AS completed,
         LEAST(100, ROUND(100.0 *
           COALESCE(SUM(events) FILTER (WHERE event_name ILIKE '%complet%'
                                OR event_name ILIKE '%finish%'
                                OR event_name ILIKE '%success%'
                                OR event_name ILIKE '%done%'), 0)
           / NULLIF(SUM(events) FILTER (WHERE event_name ILIKE '%start%'), 0), 1)) AS completion_pct
  FROM posthog.mv_feature_usage
  WHERE feature <> ''
  GROUP BY feature
  HAVING SUM(events) FILTER (WHERE event_name ILIKE '%start%') > 0
  ORDER BY started DESC;
$$;


-- ── Extend the refresh routine to include the new view ──────────────────────
CREATE OR REPLACE FUNCTION public.ph_refresh_views()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_daily_active_users;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_weekly_active_users;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_user_lifecycle;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_new_users_by_week;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_feature_usage;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_dau_mau;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_feature_adoption;
  RETURN 'Refreshed at ' || NOW()::text;
END;
$$;


-- ── Grants (authenticated only — matches the RLS hardening) ─────────────────
GRANT EXECUTE ON FUNCTION public.ph_user_segments()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_at_risk_users(int, int)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_power_users(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_adoption()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_completion()       TO authenticated;


-- ── Sanity check — all five should return instantly now ─────────────────────
-- SELECT * FROM public.ph_user_segments();
-- SELECT * FROM public.ph_at_risk_users(3, 14) LIMIT 5;
-- SELECT * FROM public.ph_power_users(10);
-- SELECT * FROM public.ph_feature_adoption() LIMIT 10;
-- SELECT * FROM public.ph_feature_completion() LIMIT 10;
