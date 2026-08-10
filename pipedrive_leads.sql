-- Land iQ · Pipedrive Leads Inbox table
--
-- WHY: "New leads generated per week" (the sales-board KPI, target 10/week) comes
-- from Pipedrive's **Leads Inbox**, which is a different endpoint from Deals. The
-- nightly sync only pulled /deals and /persons, so there was nowhere to read a
-- lead count from. This creates the table the sync now writes to.
--
-- Run this ONCE in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor
-- Safe to re-run (IF NOT EXISTS).
--
-- AFTER running this, populate it: Actions -> "Pipedrive sync" -> Run workflow
-- (or wait for the nightly run). Until then the dashboard shows "no data" for the
-- leads KPI and everything else keeps working — the app reads this table
-- defensively and never breaks when it is missing or empty.

create table if not exists public.liq_pipedrive_leads (
  id          bigserial primary key,
  raw         jsonb       not null,
  imported_at timestamptz not null default now()
);

-- The sync clears the table with a delete on imported_at, and the dashboard reads
-- by import time, so index it.
create index if not exists liq_pipedrive_leads_imported_at_idx
  on public.liq_pipedrive_leads (imported_at);

-- Same access rule as every other dashboard table: authenticated only, never anon.
-- (Matches supabase_auth_rls.sql — the anon key must return empty, not data.)
alter table public.liq_pipedrive_leads enable row level security;

drop policy if exists "anon_all_pipedrive_leads" on public.liq_pipedrive_leads;
drop policy if exists "auth_all_pipedrive_leads" on public.liq_pipedrive_leads;

create policy "auth_all_pipedrive_leads"
  on public.liq_pipedrive_leads
  for all
  to authenticated
  using (true)
  with check (true);

-- Sanity check (expect 0 rows until the first sync run):
-- select count(*), max(imported_at) from public.liq_pipedrive_leads;
