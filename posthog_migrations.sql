-- ================================================================
-- Land iQ · PostHog → Supabase SQL Migrations
-- Run this entire file in the Supabase SQL Editor
-- (https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor)
--
-- What this does:
--   1. Adds performance indexes on posthog.events
--   2. Creates materialized views for pre-aggregated metrics
--   3. Creates SECURITY DEFINER RPC functions in the public schema
--      so the anon key can call them via sb.rpc(...)
--   4. Adds a refresh helper to keep materialized views current
-- ================================================================


-- ================================================================
-- STEP 0 — DIAGNOSTIC: find your event names
--   Run this first (separately) to see what events exist in your data
-- ================================================================
/*
SELECT event, COUNT(*) AS cnt
FROM posthog.events
GROUP BY event
ORDER BY cnt DESC
LIMIT 50;

-- Also inspect what property keys look like for common events:
SELECT DISTINCT jsonb_object_keys(properties) AS prop_key
FROM posthog.events
WHERE event = '$pageview'   -- swap for your login event name
LIMIT 100;
*/


-- ================================================================
-- STEP 1 — INDEXES for query performance
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_ph_events_timestamp
  ON posthog.events (timestamp);

CREATE INDEX IF NOT EXISTS idx_ph_events_event
  ON posthog.events (event);

CREATE INDEX IF NOT EXISTS idx_ph_events_distinct_id
  ON posthog.events (distinct_id);

-- Composite index: most queries filter by date range + event type
CREATE INDEX IF NOT EXISTS idx_ph_events_event_ts
  ON posthog.events (event, timestamp DESC);

-- JSONB GIN indexes for property lookups (adjust key names after running STEP 0)
CREATE INDEX IF NOT EXISTS idx_ph_events_props_gin
  ON posthog.events USING GIN (properties);

-- Partial index for pageviews only (very common filter)
CREATE INDEX IF NOT EXISTS idx_ph_events_pageview_ts
  ON posthog.events (timestamp DESC)
  WHERE event = '$pageview';

-- Functional index on date (used by DAU queries)
CREATE INDEX IF NOT EXISTS idx_ph_events_date
  ON posthog.events ( (timestamp::date) );


-- ================================================================
-- STEP 2 — MATERIALIZED VIEWS in posthog schema
--
-- NOTE: Adjust event name filters below to match your actual events
--       (run the diagnostic above first).
--
-- Common Giraffe / PostHog event patterns:
--   Login events:   'user signed in', 'login', '$identify', 'Logged In'
--   Page views:     '$pageview'
--   Feature events: any custom event name, often with properties->>'feature'
-- ================================================================

-- ── 2a. Daily Active Users ────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_daily_active_users CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_daily_active_users AS
SELECT
  timestamp::date                         AS day,
  COUNT(DISTINCT distinct_id)             AS active_users,
  COUNT(*)                                AS total_events,
  -- Logins: adjust event name(s) to match your PostHog setup
  COUNT(DISTINCT CASE
    WHEN event IN ('login', 'user signed in', 'Logged In', '$identify', 'user_logged_in')
    THEN distinct_id
  END)                                    AS login_users
FROM posthog.events
GROUP BY timestamp::date
ORDER BY day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dau_day
  ON posthog.mv_daily_active_users (day);


-- ── 2b. Weekly Active Users ───────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_weekly_active_users CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_weekly_active_users AS
SELECT
  DATE_TRUNC('week', timestamp)::date     AS week_start,
  COUNT(DISTINCT distinct_id)             AS active_users,
  COUNT(*)                                AS total_events,
  COUNT(DISTINCT CASE
    WHEN event IN ('login', 'user signed in', 'Logged In', '$identify', 'user_logged_in')
    THEN distinct_id
  END)                                    AS login_users,
  -- New users: first event in this week
  COUNT(DISTINCT CASE
    WHEN timestamp::date = first_seen.min_date THEN distinct_id
  END)                                    AS new_users
FROM posthog.events
LEFT JOIN (
  SELECT distinct_id, MIN(timestamp::date) AS min_date
  FROM posthog.events
  GROUP BY distinct_id
) first_seen USING (distinct_id)
GROUP BY DATE_TRUNC('week', timestamp)::date
ORDER BY week_start;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_wau_week
  ON posthog.mv_weekly_active_users (week_start);


-- ── 2c. User first/last seen (retention base) ─────────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_user_lifecycle CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_user_lifecycle AS
SELECT
  distinct_id,
  MIN(timestamp)::date                    AS first_seen,
  MAX(timestamp)::date                    AS last_seen,
  COUNT(DISTINCT timestamp::date)         AS active_days,
  COUNT(*)                                AS total_events,
  DATE_TRUNC('week', MIN(timestamp))::date AS cohort_week,
  DATE_TRUNC('month', MIN(timestamp))::date AS cohort_month
FROM posthog.events
GROUP BY distinct_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_lifecycle_user
  ON posthog.mv_user_lifecycle (distinct_id);
CREATE INDEX IF NOT EXISTS idx_mv_lifecycle_cohort
  ON posthog.mv_user_lifecycle (cohort_week);


-- ── 2d. New-user cohort curve (users by first-seen week) ──────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_new_users_by_week CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_new_users_by_week AS
SELECT
  cohort_week                             AS week_start,
  COUNT(*)                                AS new_users
FROM posthog.mv_user_lifecycle
GROUP BY cohort_week
ORDER BY week_start;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_newusers_week
  ON posthog.mv_new_users_by_week (week_start);


-- ── 2e. Feature / SDK usage per app or component ─────────────────
--
-- PostHog SDK events typically carry one of these property keys:
--   properties->>'$app_namespace'    (PostHog SDK default)
--   properties->>'app'               (custom)
--   properties->>'component'         (custom)
--   properties->>'$feature'          (feature flags)
--
-- We COALESCE across all common keys so nothing is missed.
-- After running STEP 0 diagnostic, narrow this to your actual keys.
-- ─────────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_feature_usage CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_feature_usage AS
SELECT
  timestamp::date                                               AS day,
  COALESCE(
    NULLIF(properties->>'app', ''),
    NULLIF(properties->>'component', ''),
    NULLIF(properties->>'$app_namespace', ''),
    NULLIF(properties->>'feature', ''),
    NULLIF(properties->>'$feature_flag', ''),
    '(untagged)'
  )                                                             AS feature,
  event                                                         AS event_name,
  COUNT(DISTINCT distinct_id)                                   AS active_users,
  COUNT(*)                                                      AS events
FROM posthog.events
WHERE
  -- only include events that carry a feature/app tag
  (
    properties->>'app'              IS NOT NULL OR
    properties->>'component'        IS NOT NULL OR
    properties->>'$app_namespace'   IS NOT NULL OR
    properties->>'feature'          IS NOT NULL OR
    properties->>'$feature_flag'    IS NOT NULL
  )
  -- exclude internal PostHog housekeeping events
  AND event NOT IN ('$feature_flag_called', '$$plugin_metrics')
GROUP BY day, feature, event_name
ORDER BY day DESC, events DESC;

CREATE INDEX IF NOT EXISTS idx_mv_feature_day
  ON posthog.mv_feature_usage (day DESC);
CREATE INDEX IF NOT EXISTS idx_mv_feature_name
  ON posthog.mv_feature_usage (feature);


-- ── 2f. DAU/MAU ratio helper ──────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_dau_mau CASCADE;
CREATE MATERIALIZED VIEW posthog.mv_dau_mau AS
WITH monthly AS (
  SELECT
    DATE_TRUNC('month', timestamp)::date AS month_start,
    COUNT(DISTINCT distinct_id)          AS mau
  FROM posthog.events
  GROUP BY 1
),
daily AS (
  SELECT day, active_users AS dau
  FROM posthog.mv_daily_active_users
)
SELECT
  d.day,
  d.dau,
  m.mau,
  ROUND(d.dau::numeric / NULLIF(m.mau, 0) * 100, 1) AS dau_mau_pct
FROM daily d
JOIN monthly m
  ON DATE_TRUNC('month', d.day)::date = m.month_start
ORDER BY d.day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daumau_day
  ON posthog.mv_dau_mau (day);


-- ================================================================
-- STEP 3 — RPC FUNCTIONS in public schema (SECURITY DEFINER)
--
-- These are callable by the Supabase anon key via sb.rpc('fn', args)
-- because they live in the `public` schema and carry SECURITY DEFINER.
-- ================================================================

-- ── 3a. Weekly active users (last N weeks) ────────────────────────
CREATE OR REPLACE FUNCTION public.ph_weekly_stats(weeks_back int DEFAULT 12)
RETURNS TABLE (
  week_start     date,
  active_users   bigint,
  login_users    bigint,
  new_users      bigint,
  total_events   bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    week_start,
    active_users,
    login_users,
    new_users,
    total_events
  FROM posthog.mv_weekly_active_users
  WHERE week_start >= (CURRENT_DATE - (weeks_back * 7))
  ORDER BY week_start;
$$;


-- ── 3b. Daily active users (last N days) ─────────────────────────
CREATE OR REPLACE FUNCTION public.ph_daily_active_users(days_back int DEFAULT 30)
RETURNS TABLE (
  day            date,
  active_users   bigint,
  login_users    bigint,
  total_events   bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    day,
    active_users,
    login_users,
    total_events
  FROM posthog.mv_daily_active_users
  WHERE day >= (CURRENT_DATE - days_back)
  ORDER BY day;
$$;


-- ── 3c. DAU/MAU ratio (last N days) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ph_dau_mau(days_back int DEFAULT 30)
RETURNS TABLE (
  day          date,
  dau          bigint,
  mau          bigint,
  dau_mau_pct  numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT day, dau, mau, dau_mau_pct
  FROM posthog.mv_dau_mau
  WHERE day >= (CURRENT_DATE - days_back)
  ORDER BY day;
$$;


-- ── 3d. Feature/SDK usage (last N days, grouped by feature) ──────
CREATE OR REPLACE FUNCTION public.ph_feature_usage(days_back int DEFAULT 30)
RETURNS TABLE (
  feature        text,
  total_events   bigint,
  active_users   bigint,
  latest_day     date
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    feature,
    SUM(events)::bigint       AS total_events,
    MAX(active_users)::bigint AS active_users,
    MAX(day)                  AS latest_day
  FROM posthog.mv_feature_usage
  WHERE day >= (CURRENT_DATE - days_back)
    AND feature != '(untagged)'
  GROUP BY feature
  ORDER BY total_events DESC;
$$;


-- ── 3e. Feature/SDK usage daily time-series ───────────────────────
CREATE OR REPLACE FUNCTION public.ph_feature_daily(
  feature_name text,
  days_back    int DEFAULT 30
)
RETURNS TABLE (
  day            date,
  events         bigint,
  active_users   bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    day,
    SUM(events)::bigint         AS events,
    MAX(active_users)::bigint   AS active_users
  FROM posthog.mv_feature_usage
  WHERE feature = feature_name
    AND day >= (CURRENT_DATE - days_back)
  GROUP BY day
  ORDER BY day;
$$;


-- ── 3f. Total unique users + summary stats ────────────────────────
CREATE OR REPLACE FUNCTION public.ph_summary()
RETURNS TABLE (
  total_users      bigint,
  total_events     bigint,
  first_event_date date,
  last_event_date  date,
  avg_active_days  numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    COUNT(*)                            AS total_users,
    SUM(total_events)::bigint           AS total_events,
    MIN(first_seen)                     AS first_event_date,
    MAX(last_seen)                      AS last_event_date,
    ROUND(AVG(active_days), 1)          AS avg_active_days
  FROM posthog.mv_user_lifecycle;
$$;


-- ── 3g. User retention cohort (% of cohort still active after N weeks) ──
CREATE OR REPLACE FUNCTION public.ph_retention_cohort(cohort_weeks_back int DEFAULT 12)
RETURNS TABLE (
  cohort_week    date,
  cohort_size    bigint,
  retained_w1    bigint,
  retained_w2    bigint,
  retained_w4    bigint,
  retained_w8    bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    ul.cohort_week,
    COUNT(*)                                             AS cohort_size,
    COUNT(DISTINCT CASE
      WHEN ul.last_seen >= ul.first_seen + 7  THEN ul.distinct_id
    END)                                                 AS retained_w1,
    COUNT(DISTINCT CASE
      WHEN ul.last_seen >= ul.first_seen + 14 THEN ul.distinct_id
    END)                                                 AS retained_w2,
    COUNT(DISTINCT CASE
      WHEN ul.last_seen >= ul.first_seen + 28 THEN ul.distinct_id
    END)                                                 AS retained_w4,
    COUNT(DISTINCT CASE
      WHEN ul.last_seen >= ul.first_seen + 56 THEN ul.distinct_id
    END)                                                 AS retained_w8
  FROM posthog.mv_user_lifecycle ul
  WHERE ul.cohort_week >= (CURRENT_DATE - (cohort_weeks_back * 7))
  GROUP BY ul.cohort_week
  ORDER BY ul.cohort_week;
$$;


-- ── 3h. New users per week ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ph_new_users(weeks_back int DEFAULT 12)
RETURNS TABLE (
  week_start   date,
  new_users    bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT week_start, new_users
  FROM posthog.mv_new_users_by_week
  WHERE week_start >= (CURRENT_DATE - (weeks_back * 7))
  ORDER BY week_start;
$$;


-- ── 3i. Refresh all materialized views ───────────────────────────
--   Call this nightly via pg_cron, or manually after large imports.
CREATE OR REPLACE FUNCTION public.ph_refresh_views()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_daily_active_users;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_weekly_active_users;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_user_lifecycle;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_new_users_by_week;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_feature_usage;
  REFRESH MATERIALIZED VIEW CONCURRENTLY posthog.mv_dau_mau;
  RETURN 'Refreshed at ' || NOW()::text;
END;
$$;


-- ================================================================
-- STEP 4 — GRANT execute to anon role
-- ================================================================

GRANT EXECUTE ON FUNCTION public.ph_weekly_stats(int)         TO anon;
GRANT EXECUTE ON FUNCTION public.ph_daily_active_users(int)   TO anon;
GRANT EXECUTE ON FUNCTION public.ph_dau_mau(int)              TO anon;
GRANT EXECUTE ON FUNCTION public.ph_feature_usage(int)        TO anon;
GRANT EXECUTE ON FUNCTION public.ph_feature_daily(text, int)  TO anon;
GRANT EXECUTE ON FUNCTION public.ph_summary()                 TO anon;
GRANT EXECUTE ON FUNCTION public.ph_retention_cohort(int)     TO anon;
GRANT EXECUTE ON FUNCTION public.ph_new_users(int)            TO anon;
GRANT EXECUTE ON FUNCTION public.ph_refresh_views()           TO anon;


-- ================================================================
-- STEP 5 — INITIAL REFRESH (takes a minute on ~250k rows)
-- ================================================================
SELECT public.ph_refresh_views();


-- ================================================================
-- STEP 6 — OPTIONAL: Schedule nightly refresh via pg_cron
--   Uncomment if your Supabase plan includes pg_cron.
-- ================================================================
/*
SELECT cron.schedule(
  'refresh-posthog-views',
  '0 3 * * *',   -- 3 AM daily (UTC)
  $$ SELECT public.ph_refresh_views(); $$
);
*/


-- ================================================================
-- QUICK SANITY CHECKS (run after Step 5 completes)
-- ================================================================
/*
SELECT * FROM public.ph_summary();
SELECT * FROM public.ph_weekly_stats(8) ORDER BY week_start;
SELECT * FROM public.ph_daily_active_users(7);
SELECT * FROM public.ph_feature_usage(30) LIMIT 10;
SELECT * FROM public.ph_new_users(12);
*/
