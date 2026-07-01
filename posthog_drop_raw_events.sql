-- ============================================================================
-- STEP 5 — free the space (run ONLY after the summary sync is working)
-- ----------------------------------------------------------------------------
-- Drops the 1.4 GB raw events table and the old materialized views that were
-- built from it. The dashboard no longer uses any of these — it reads the small
-- public.ph_* summary tables filled by the nightly sync.
--
-- SAFE because PostHog still holds every raw event; the sync rebuilds summaries
-- from PostHog each night. Do NOT run this until the Activity tab looks correct.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS posthog.mv_daily_active_users   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_weekly_active_users  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_user_lifecycle       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_new_users_by_week    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_feature_usage        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_dau_mau              CASCADE;
DROP MATERIALIZED VIEW IF EXISTS posthog.mv_feature_adoption     CASCADE;

DROP TABLE IF EXISTS posthog."Posthog Events" CASCADE;

-- Dropping the table returns its files to disk on its own (no VACUUM needed).
-- Check the new size (should be ~20 MB):
--   SELECT pg_size_pretty(pg_database_size(current_database()));
