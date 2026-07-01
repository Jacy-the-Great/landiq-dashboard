-- ============================================================================
-- PostHog SUMMARY TABLES — the new "store only what we need" model
-- ----------------------------------------------------------------------------
-- Replaces the giant raw posthog."Posthog Events" table (1.4 GB) with a handful
-- of tiny summary tables (a few MB) that the nightly GitHub Action fills from
-- the PostHog API. The dashboard's ph_* functions read from these instead.
--
-- ORDER OF OPERATIONS (see scripts/README.md):
--   1. Run THIS file once (creates empty tables + rewires the functions).
--   2. Run the GitHub Action once (fills the tables from PostHog).
--   3. Confirm the Activity tab works.
--   4. THEN run posthog_drop_raw_events.sql to delete the 1.4 GB table.
-- ============================================================================

-- ── Summary tables (all tiny) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ph_lifecycle (
  distinct_id   text PRIMARY KEY,
  first_seen    date,
  last_seen     date,
  active_days   bigint,
  total_events  bigint,
  cohort_week   date,
  cohort_month  date
);
CREATE TABLE IF NOT EXISTS public.ph_daily (
  day          date PRIMARY KEY,
  active_users bigint,
  total_events bigint,
  login_users  bigint
);
CREATE TABLE IF NOT EXISTS public.ph_weekly (
  week_start   date PRIMARY KEY,
  active_users bigint,
  total_events bigint,
  login_users  bigint
);
CREATE TABLE IF NOT EXISTS public.ph_monthly (
  month_start  date PRIMARY KEY,
  mau          bigint
);
CREATE TABLE IF NOT EXISTS public.ph_feature_daily (
  day          date,
  feature      text,
  event_name   text,
  active_users bigint,
  events       bigint,
  PRIMARY KEY (day, feature, event_name)
);
CREATE TABLE IF NOT EXISTS public.ph_feature_adoption_tbl (
  feature          text PRIMARY KEY,
  users_who_tried  bigint
);

-- Lock the tables down: only the SECURITY DEFINER functions (below) and the
-- service-role sync script can touch them. No direct anon/authenticated access.
ALTER TABLE public.ph_lifecycle            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_daily                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_weekly               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_monthly              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_feature_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ph_feature_adoption_tbl ENABLE ROW LEVEL SECURITY;


-- ── Functions rewired to read the summary tables ────────────────────────────

DROP FUNCTION IF EXISTS public.ph_summary();
CREATE FUNCTION public.ph_summary()
RETURNS TABLE (total_users bigint, total_events bigint, first_event_date date, last_event_date date, avg_active_days numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::bigint, SUM(total_events)::bigint, MIN(first_seen), MAX(last_seen), ROUND(AVG(active_days),1)
  FROM public.ph_lifecycle;
$$;

DROP FUNCTION IF EXISTS public.ph_weekly_stats(int);
CREATE FUNCTION public.ph_weekly_stats(weeks_back int DEFAULT 12)
RETURNS TABLE (week_start date, active_users bigint, login_users bigint, new_users bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT w.week_start, w.active_users, w.login_users,
         COALESCE(nu.new_users, 0)::bigint AS new_users, w.total_events
  FROM public.ph_weekly w
  LEFT JOIN (SELECT cohort_week, COUNT(*)::bigint AS new_users
             FROM public.ph_lifecycle GROUP BY cohort_week) nu
    ON nu.cohort_week = w.week_start
  WHERE w.week_start >= (CURRENT_DATE - (weeks_back * 7))
  ORDER BY w.week_start;
$$;

DROP FUNCTION IF EXISTS public.ph_daily_active_users(int);
CREATE FUNCTION public.ph_daily_active_users(days_back int DEFAULT 30)
RETURNS TABLE (day date, active_users bigint, login_users bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT day, active_users, login_users, total_events
  FROM public.ph_daily
  WHERE day >= (CURRENT_DATE - days_back)
  ORDER BY day;
$$;

DROP FUNCTION IF EXISTS public.ph_dau_mau(int);
CREATE FUNCTION public.ph_dau_mau(days_back int DEFAULT 30)
RETURNS TABLE (day date, dau bigint, mau bigint, dau_mau_pct numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT d.day, d.active_users AS dau, m.mau,
         ROUND(d.active_users::numeric / NULLIF(m.mau, 0) * 100, 1) AS dau_mau_pct
  FROM public.ph_daily d
  JOIN public.ph_monthly m ON DATE_TRUNC('month', d.day)::date = m.month_start
  WHERE d.day >= (CURRENT_DATE - days_back)
  ORDER BY d.day;
$$;

DROP FUNCTION IF EXISTS public.ph_feature_usage(int);
CREATE FUNCTION public.ph_feature_usage(days_back int DEFAULT 30)
RETURNS TABLE (feature text, total_events bigint, active_users bigint, latest_day date)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT feature, SUM(events)::bigint AS total_events,
         MAX(active_users)::bigint AS active_users, MAX(day) AS latest_day
  FROM public.ph_feature_daily
  WHERE day >= (CURRENT_DATE - days_back) AND feature <> ''
  GROUP BY feature
  ORDER BY total_events DESC;
$$;

DROP FUNCTION IF EXISTS public.ph_new_users(int);
CREATE FUNCTION public.ph_new_users(weeks_back int DEFAULT 12)
RETURNS TABLE (week_start date, new_users bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT cohort_week AS week_start, COUNT(*)::bigint AS new_users
  FROM public.ph_lifecycle
  WHERE cohort_week >= (CURRENT_DATE - (weeks_back * 7))
  GROUP BY cohort_week ORDER BY week_start;
$$;

DROP FUNCTION IF EXISTS public.ph_retention_cohort(int);
CREATE FUNCTION public.ph_retention_cohort(cohort_weeks_back int DEFAULT 12)
RETURNS TABLE (cohort_week date, cohort_size bigint, retained_w1 bigint, retained_w2 bigint, retained_w4 bigint, retained_w8 bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT cohort_week, COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE last_seen >= first_seen + 7)::bigint,
    COUNT(*) FILTER (WHERE last_seen >= first_seen + 14)::bigint,
    COUNT(*) FILTER (WHERE last_seen >= first_seen + 28)::bigint,
    COUNT(*) FILTER (WHERE last_seen >= first_seen + 56)::bigint
  FROM public.ph_lifecycle
  WHERE cohort_week >= (CURRENT_DATE - (cohort_weeks_back * 7))
  GROUP BY cohort_week ORDER BY cohort_week;
$$;

DROP FUNCTION IF EXISTS public.ph_user_segments();
CREATE FUNCTION public.ph_user_segments()
RETURNS TABLE (segment text, user_count bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT seg, COUNT(*)::bigint FROM (
    SELECT CASE
      WHEN last_seen  <  CURRENT_DATE - 30 THEN 'Dormant'
      WHEN last_seen  <  CURRENT_DATE - 14 THEN 'At-risk'
      WHEN first_seen >= CURRENT_DATE - 14 THEN 'New'
      ELSE 'Active' END AS seg
    FROM public.ph_lifecycle
  ) s GROUP BY seg;
$$;

DROP FUNCTION IF EXISTS public.ph_at_risk_users(int, int);
CREATE FUNCTION public.ph_at_risk_users(min_active_days int DEFAULT 3, days_threshold int DEFAULT 14)
RETURNS TABLE (distinct_id text, first_seen date, last_seen date, active_days bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT distinct_id, first_seen, last_seen, active_days, total_events
  FROM public.ph_lifecycle
  WHERE active_days >= min_active_days
    AND last_seen < (CURRENT_DATE - days_threshold)
    AND last_seen >= (CURRENT_DATE - 90)
  ORDER BY last_seen DESC LIMIT 500;
$$;

DROP FUNCTION IF EXISTS public.ph_power_users(int);
CREATE FUNCTION public.ph_power_users(user_limit int DEFAULT 25)
RETURNS TABLE (distinct_id text, first_seen date, last_seen date, active_days bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT distinct_id, first_seen, last_seen, active_days, total_events
  FROM public.ph_lifecycle
  ORDER BY active_days DESC, total_events DESC LIMIT user_limit;
$$;

DROP FUNCTION IF EXISTS public.ph_feature_adoption();
CREATE FUNCTION public.ph_feature_adoption()
RETURNS TABLE (feature text, users_who_tried bigint, total_users bigint, adoption_pct numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH tot AS (SELECT COUNT(*)::bigint AS n FROM public.ph_lifecycle)
  SELECT a.feature, a.users_who_tried, tot.n,
         ROUND(100.0 * a.users_who_tried / NULLIF(tot.n, 0), 1)
  FROM public.ph_feature_adoption_tbl a, tot
  WHERE a.feature <> '' ORDER BY a.users_who_tried DESC;
$$;

DROP FUNCTION IF EXISTS public.ph_feature_completion();
CREATE FUNCTION public.ph_feature_completion()
RETURNS TABLE (feature text, started bigint, completed bigint, completion_pct numeric)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT feature,
    SUM(events) FILTER (WHERE event_name ILIKE '%start%')::bigint,
    SUM(events) FILTER (WHERE event_name ILIKE '%complet%' OR event_name ILIKE '%finish%'
                          OR event_name ILIKE '%success%' OR event_name ILIKE '%done%')::bigint,
    LEAST(100, ROUND(100.0 *
      COALESCE(SUM(events) FILTER (WHERE event_name ILIKE '%complet%' OR event_name ILIKE '%finish%'
                          OR event_name ILIKE '%success%' OR event_name ILIKE '%done%'), 0)
      / NULLIF(SUM(events) FILTER (WHERE event_name ILIKE '%start%'), 0), 1))
  FROM public.ph_feature_daily
  WHERE feature <> ''
  GROUP BY feature
  HAVING SUM(events) FILTER (WHERE event_name ILIKE '%start%') > 0
  ORDER BY 2 DESC;
$$;

-- Refresh function no longer needed (external script fills the tables), but keep
-- it as a harmless no-op so the dashboard's "Refresh PostHog" button doesn't error.
CREATE OR REPLACE FUNCTION public.ph_refresh_views()
RETURNS text LANGUAGE sql AS $$ SELECT 'Summaries are filled nightly by the PostHog sync job.'::text; $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.ph_summary()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_weekly_stats(int)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_daily_active_users(int)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_dau_mau(int)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_usage(int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_new_users(int)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_retention_cohort(int)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_user_segments()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_at_risk_users(int, int)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_power_users(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_adoption()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ph_feature_completion()       TO authenticated;
