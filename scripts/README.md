# PostHog summary sync — setup

This replaces the giant 1.4 GB raw-events table with tiny nightly summaries, so
the Activity tab works again and Supabase stays free.

Do these in order. Steps 1–4 bring the data back; step 5 frees the space.

---

## 1. Create the summary tables + rewire the functions

In the Supabase SQL editor, paste and run **`posthog_summary_tables.sql`**
(from the project root). It should say "Success". This creates empty tables and
points the dashboard's functions at them.

## 2. Add three secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add these three:

| Name | Value |
|------|-------|
| `POSTHOG_API_KEY` | your PostHog personal API key |
| `POSTHOG_PROJECT_ID` | your PostHog project id (the number) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** key |

(The service-role key is the one that can write. Keep it secret — never commit it.)

## 3. Run the sync once, by hand

Repo → **Actions** tab → **PostHog summary sync** → **Run workflow**.
Watch it run (a minute or two). It should finish green and the log should show
"wrote N rows" for each table.

*Prefer to test locally first?*
```bash
POSTHOG_API_KEY=xxx POSTHOG_PROJECT_ID=12345 SUPABASE_SERVICE_ROLE_KEY=xxx \
  node scripts/posthog-sync.mjs
```

## 4. Check the dashboard

Open the Activity tab and reload. It should now show current data — including the
weeks that were missing since May. Segments, at-risk, power users, feature usage
should all be live again.

**Stop here and confirm it all looks right before doing step 5.**

## 5. Delete the 1.4 GB raw-events table (frees the space)

Only once step 4 looks good. In the Supabase SQL editor, run
**`posthog_drop_raw_events.sql`**. This drops the old raw table and its
materialized views. Your database drops from ~1.4 GB to ~20 MB and the
"over quota" warning clears.

PostHog still holds every raw event, so nothing is truly lost — the nightly sync
keeps the summaries current from here on.

---

### How it works
- `scripts/posthog-sync.mjs` — pulls 6 small aggregates from the PostHog API.
- `.github/workflows/posthog-sync.yml` — runs it nightly (3am Sydney) + on demand.
- `posthog_summary_tables.sql` — the tables it fills + the functions the dashboard reads.
