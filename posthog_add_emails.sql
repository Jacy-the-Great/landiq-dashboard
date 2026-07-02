-- ============================================================================
-- ADD EMAIL MATCHING — links product usage to paying customers
-- ----------------------------------------------------------------------------
-- 1. Adds an email column to the usage summaries (filled by the nightly sync).
-- 2. Adds ph_email_activity() so the dashboard can match usage to customer
--    emails — powering the Health Score usage dimension and the
--    "paying customers gone quiet" list.
--
-- Run once in the Supabase SQL editor, then re-run the GitHub sync
-- (Actions → "PostHog summary sync" → Run workflow) to fill in the emails.
-- ============================================================================

ALTER TABLE public.ph_lifecycle ADD COLUMN IF NOT EXISTS email text;

DROP FUNCTION IF EXISTS public.ph_email_activity();
CREATE FUNCTION public.ph_email_activity()
RETURNS TABLE (email text, first_seen date, last_seen date, active_days bigint, total_events bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT lower(email)      AS email,
         MIN(first_seen)   AS first_seen,
         MAX(last_seen)    AS last_seen,
         SUM(active_days)::bigint  AS active_days,
         SUM(total_events)::bigint AS total_events
  FROM public.ph_lifecycle
  WHERE email IS NOT NULL AND email <> ''
  GROUP BY lower(email);
$$;

GRANT EXECUTE ON FUNCTION public.ph_email_activity() TO authenticated;

-- Sanity check (after re-running the sync):
--   SELECT COUNT(*) FROM public.ph_lifecycle WHERE email IS NOT NULL;
--   SELECT * FROM public.ph_email_activity() LIMIT 10;
