# CLAUDE.md

Guidance for Claude Code (CLI or claude.ai/code) working in this repo. This file
is auto-loaded into every session — it is the master brief. New here or setting up
a chat on another device? See **[docs/START_HERE.md](docs/START_HERE.md)**. Deeper
references:
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — connectors, secrets, syncs,
  deploys, auth/roles, working from the web, troubleshooting.
- **[docs/DATA_CATALOGUE.md](docs/DATA_CATALOGUE.md)** — every field/indicator from
  every source (Pipedrive, PostHog, manual tables).
- **[docs/CODE_MAP.md](docs/CODE_MAP.md)** — global state, render functions,
  helpers, canvas-id rules, coding conventions for `index.html`.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — the shared living log. **Skim the
  top few entries at the start of a session**, and **append a dated entry after any
  significant decision, non-obvious learning, or gotcha** (not routine edits). When
  a learning becomes a permanent rule, also fold it into the doc above that owns it.

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
- **Pipedrive Leads Inbox** (`_pd_leads`): table `liq_pipedrive_leads`, rows
  `{raw:{...}}` with `"Lead - Created"`, `"Lead - Archived"`, `"Lead - Source"`.
  A **separate endpoint from Deals** — it is the only source for "new leads
  generated" (target 10/week). Optional everywhere: the table may not exist and
  `/leads` may be unavailable to the token, so both the sync and the app degrade
  to "no data" rather than failing. See `pipedrive_leads.sql`.
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
- "New leads generated" counts leads **created** in the period, from the Leads
  Inbox — **including archived ones**. Archiving tidies the inbox; it must never
  retro-shrink a past week. Never filter on `Lead - Archived`.
- An empty Leads Inbox is an **absent source** → "no data", never `0`
  (`hasLeadData`). A confident zero every week is worse than a blank.

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

## Change-control protocol (MANDATORY on every edit)

The regression suite (`tests/run-tests.mjs`) encodes the documented behaviour of
the key calculations. CI (`.github/workflows/checks.yml`) runs it on every push —
**warn loudly, never block**: a red run marks the commit ✗ but does not stop the
Vercel deploy. The discipline therefore lives with the editor:

1. **Before editing shared logic** (any global helper, `omModel`/`omReached`,
   `pdParseDate`, the data layer, a metric used on more than one tab): grep for its
   call sites first and list what depends on it. If an edit changes behaviour for a
   caller you weren't asked about, that's a flag (see 4).
2. **After editing, always run** `node tests/run-tests.mjs` locally before pushing.
3. **If a test goes red, STOP. Never quietly edit a test to make it pass.**
   Either the code broke real behaviour (fix/revert the code), or the behaviour is
   changing on purpose — which requires step 4.
4. **Escalate intentional behaviour changes.** If a change alters what a metric
   *means* (source dataset, formula, window, filter) or affects anything beyond
   what the owner asked for, stop and put the decision to the owner **boldly and
   plainly, with the consequences**: what number changes, on which tabs, roughly by
   how much, and what breaks if wrong. Only proceed on an explicit yes — then
   update the test to the new behaviour AND add a `docs/DECISIONS.md` entry in the
   same commit.
5. **When you add or materially change a metric/calculation, add a test for it**
   in `tests/run-tests.mjs` (extraction pattern at the top of that file). A metric
   without a test is unprotected.

## Verifying

1. Run the regression suite (includes the inline-script syntax check):
   ```bash
   node tests/run-tests.mjs
   ```
2. Metric/data changes: verify against real numbers. The sync scripts log a sanity
   check each run — `gh workflow run "Pipedrive sync"` then read the log with
   `gh run view <id> --log`. Test the empty/sparse/edge case, not just the happy path.
3. After push, confirm the change is live with the cache-buster curl above, and
   that the **Checks** workflow is green on the commit (`gh run list --workflow=Checks`).

## Global constants

`TARGET_USERS = 600` (paid-seat target) · `TARGET_ARR = 2_400_000` ($2.4M target).
OPTI-MAX targets: `localStorage` key `liq_optimax`. Funnel Insights counts:
`liq_funnel_actual`.

## Supabase

- Project: `ysdonnjezvoyrrizadik` · SQL editor:
  `https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor`
- Tables: `dashboard_data`, `dashboard_backups`, `liq_pipedrive_deals`,
  `liq_pipedrive_people`, `liq_pipedrive_leads`,
  `ph_weekly`/`ph_daily`/`ph_monthly`/`ph_lifecycle`/`ph_feature_*`.
- `*.sql` files in the repo root are one-off migrations to run in the SQL editor;
  each says at the top when to run it. Newest: `pipedrive_leads.sql`.
