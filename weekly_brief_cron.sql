-- Schedule the weekly-brief Edge Function to run every Friday at 8am Sydney time.
-- Run once in the Supabase SQL editor. Requires pg_cron + pg_net (both available on Supabase).
--
-- 22:00 UTC = 08:00 Fri AEST (UTC+10). Adjust if you observe daylight saving (AEDT = UTC+11 → 21:00 UTC).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace YOUR_SUPABASE_ANON_KEY before running.
select cron.schedule(
  'landiq-weekly-brief',
  '0 22 * * 4',   -- Thursday 22:00 UTC = Friday 08:00 AEST
  $$
  select net.http_post(
    url     := 'https://ysdonnjezvoyrrizadik.supabase.co/functions/v1/weekly-brief',
    headers := '{"Authorization": "Bearer YOUR_SUPABASE_ANON_KEY", "Content-Type": "application/json"}'::jsonb
  );
  $$
);

-- To check it's scheduled:   select * from cron.job;
-- To remove it later:        select cron.unschedule('landiq-weekly-brief');
