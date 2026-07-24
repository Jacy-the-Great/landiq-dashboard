# CLAUDE.md

Guidance for Claude Code (CLI or claude.ai/code) working in this repo. This file
is auto-loaded into every session — it is the master brief. Deeper references:
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — connectors, secrets, syncs,
  deploys, auth/roles, working from the web, troubleshooting.
- **[docs/DATA_CATALOGUE.md](docs/DATA_CATALOGUE.md)** — every field/indicator from
  every source (Pipedrive, PostHog, manual tables).
- **[docs/CODE_MAP.md](docs/CODE_MAP.md)** — global state, render functions,
  helpers, canvas-id rules, coding conventions for `index.html`.

## What this is

The **Land iQ Performance** dashboard — an internal team tracker for the Land iQ
product. Live at **https://landiq-dashboard.vercel.app**. It is Jacy's working
tracker alongside Mark Elakawi's official Power BI tracker.

## Golden rules

1. **One file.** The entire app is `index.html` (~9,900 lines, vanilla JS + CSS +
   HTML, no framework, no bundler). CDN libs only: Supabase JS v2, Chart.js,
   PapaParse. **Never add a build step, framework, or node_modules to the app.**
   (`scripts/*.mjs` are separate Node sync jobs run by GitHub Actions — not part
   of the app.)
2. **Deploy = `git push` to `main`.** Vercel auto-deploys on push. No `vercel --prod`,
   no local-path dependency. Confirm live with a cache-buster:
   `curl -s "https://landiq-dashboard.vercel.app/?_=$(date +%s)" | grep <marker>`.
3. **Verify before you claim done.** Syntax-check every inline script, then confirm
   the behaviour — never assert a fix works on inspection alone. See "Verifying".
   The owner's #1 priority is **trustworthy, sourced, current numbers**; a
   silently-wrong metric is the worst outcome.
4. **Plain English.** No SaaS/sales jargon in UI copy (no ARR/MoM/WoW/DAU/MAU — say
   "monthly active users"). Every number shows a visible source.
5. **Commit messages** end with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
6. **Secrets never touch the repo or the HTML.** The Supabase *anon* key in
   `index.html` is public by design; service-role keys / API tokens live only in
   GitHub Actions secrets. Never print, commit, or paste a token.

## Navigating the single file

Line numbers rot — **grep for symbols**, don't trust a line map:
- Tabs: `switchTab(id)` → `renderTab(id)` → `render<Name>`. Grep `function renderHome`,
  `renderPipedrive`, `renderWorkstreams`, `renderExec`, `renderTeam`,
  `renderMarketing`, `renderActivity`, `renderTraining`, `renderWeeklyTracker`.
- Sales sub-tabs: `renderPipedrive` → `setPdSub(sub)` → `renderPdRevenue` /
  `renderPdSales` / `renderPdUsers` / `renderPdChurn` / `renderPdTrials` /
  `renderPdOptimax` / `renderPdHealth`. Sub-tab state lives in `activeSub`.
- Workstreams KPI board: `WORKSTREAMS` array + `renderWorkstreams`; editable KPI
  overrides via `wsEffective()` / `wsData()` (Supabase key `workstream_kpis`).

## Data model (where numbers come from)

- **Manual data** (most tabs): Supabase `dashboard_data`, `{key,value}` rows. Read
  `load(key)`, write `save(key, arr)` (Supabase + `localStorage` `liq_bk_` backup).
  `KEYS` maps short names → Supabase keys.
- **Pipedrive** (`_pd_deals`, `_pd_people`): tables `liq_pipedrive_deals` /
  `liq_pipedrive_people`, each row `{raw:{...}}` with CSV-style keys like
  `"Deal - Title"`, `"Person - Customer Type"`. Populated by the nightly API sync
  (`scripts/pipedrive-sync.mjs`) or a manual CSV import on the Import tab. People
  are run through `pdNormalisePeople()` on load.
- **PostHog** (`_ph.*`): summary tables `ph_weekly` / `ph_daily` / `ph_monthly` /
  `ph_lifecycle` / `ph_feature_daily` / `ph_feature_adoption_tbl`, written nightly
  by `scripts/posthog-sync.mjs`. Loaded into `_ph` at startup.

### Data conventions — read before touching Pipedrive/PostHog metrics
- Trial detection: **`isTrialType(s)`** (`.includes('trial')`), never `===` a single
  value — the field is multi-value with several trial variants.
- `Person - Previous Customer Type` is comma-separated multi-value — always
  `.includes()`, never `===`.
- CSV import path only: run **`pdNormalisePeople()`** after parsing (exports
  sometimes drop the `"Person - "` prefix).
- `Person - Date Access Removed` is usually a **future** subscription-expiry date.
  "Active paid" = Customer Type `Paid Subscription` AND (no removal date OR removal
  in the future). Never treat a future date as churned.
- Funnel "reached stage": prefer `Deal - Stages visited` (synced stage history)
  over the current stage, so LOST deals count at the furthest stage reached.
- Win rate (Won ÷ Contacts, ~34%) ≠ close rate (Won ÷ Won+Lost, ~65%). OPTI-MAX is
  anchored at Contact Made.
- `Person - Email` must be a plain address. If you see a JSON blob, the sync mapper
  regressed (Pipedrive returns email as `[{value,primary}]` — extract the primary).
- "Active users" (PostHog) counts **distinct known people by email**, not raw
  `distinct_id` (which includes anonymous browsers/bots). Two flavours:
  `active_users` = showed up, `active_engaged` = did a real product action.
- Exclude `Contact Register` and `Expression of Interest` from any "trained" count.

## Auth & roles

Supabase email+password (`sb.auth.signInWithPassword`; RLS restricts every table to
the `authenticated` role, so the anon key returns empty, not an error). Token
refresh is manual (`scheduleTokenRefresh`). `ADMIN_EMAILS` in `index.html`
(currently `jacymacnee1@gmail.com`) = admins: see everything incl. hidden items,
get Review mode / Export / Import / Clear. Everyone else is a viewer (dashboard
minus hidden items; can still edit values). UI-level visibility, not hard security.
Add users in the Supabase dashboard — see docs/OPERATIONS.md.

## Charts & UI patterns

- `makeChart(id, config)` wraps Chart.js and destroys the previous chart at that
  canvas id first; `destroyAllCharts()` runs on every tab switch. **Canvas ids must
  be globally unique** — a collision silently breaks a chart.
- Cards: `cardHTML(label, value, prev, type, sub, info)` — `type` is `null|'$'|'%'`;
  `value` null/0 renders a "no data" state; `info` is HTML for the ⓘ popup.
  `cardsHTML([...tuples])` renders a row.
- Info popups: `infoBtn(title, bodyHTML)` — body should use
  `<span class="src-tag">Source</span>` and `<div class="calc-row">formula</div>`.
- Number formatters: `fmtNum` (commas), `fmt1` (1 dp), `fmtCur`/`fmtDollar`, `fmtPct`.
- Hidden metrics + trust flags: review-mode only; `_hiddenMetrics`,
  `flagKey(...)`, `.hide-toggle`, `.metric-hidden`.

### Adding a Pipedrive sub-tab
1. Add the key to the `['import','revenue',...]` array in `renderPipedrive`.
2. Add its label to the label map on the same line.
3. Add `else if (sub === 'key') renderPdKey(sc);` in `setPdSub`.
4. Write `function renderPdKey(sc){ ... }` near the other `renderPd*` functions.

## Verifying

1. Syntax-check every inline `<script>` before pushing:
   ```bash
   node -e 'const h=require("fs").readFileSync("index.html","utf8");const re=/<script\b[^>]*>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){i++;if(!m[1].trim()||/\bsrc=/.test(m[0].slice(0,m[0].indexOf(">"))))continue;try{new Function(m[1])}catch(e){bad++;console.log("block",i,e.message)}}console.log(i+" blocks, "+bad+" errors")'
   ```
2. Metric/data changes: verify against real numbers. The sync scripts log a sanity
   check each run — `gh workflow run "Pipedrive sync"` then read the log with
   `gh run view <id> --log`. Test the empty/sparse/edge case, not just the happy path.
3. After push, confirm the change is live with the cache-buster curl above.

## Global constants

`TARGET_USERS = 600` (paid-seat target) · `TARGET_ARR = 2_400_000` ($2.4M target).
OPTI-MAX targets: `localStorage` key `liq_optimax`. Funnel Insights counts:
`liq_funnel_actual`.

## Supabase

- Project: `ysdonnjezvoyrrizadik` · SQL editor:
  `https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor`
- Tables: `dashboard_data`, `dashboard_backups`, `liq_pipedrive_deals`,
  `liq_pipedrive_people`, `ph_weekly`/`ph_daily`/`ph_monthly`/`ph_lifecycle`/`ph_feature_*`.
- `*.sql` files in the repo root are one-off migrations to run in the SQL editor;
  each says at the top when to run it. Newest: `posthog_active_engaged.sql`.
