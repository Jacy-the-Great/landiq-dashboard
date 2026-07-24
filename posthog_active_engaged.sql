-- Adds the "did something in-product" active-user metric alongside the existing
-- "showed up" one. Run once in the Supabase SQL editor (Dashboard → SQL editor).
-- Safe to re-run (IF NOT EXISTS).
--
-- After this, run the PostHog sync (Actions → "PostHog summary sync" → Run
-- workflow, or wait for the nightly run) to populate the new column.

alter table if exists public.ph_weekly add column if not exists active_engaged integer;
alter table if exists public.ph_daily  add column if not exists active_engaged integer;

-- Sanity check:
-- select week_start, active_users, active_engaged from public.ph_weekly order by week_start desc limit 6;
