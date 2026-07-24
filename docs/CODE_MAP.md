# Land iQ Dashboard — Code Map

Orientation for `index.html` (~9,900 lines, one file). **Line numbers rot — grep
for the symbol names below.** Read [`CLAUDE.md`](../CLAUDE.md) for the golden rules
and [`DATA_CATALOGUE.md`](DATA_CATALOGUE.md) for the data schema.

---

## Global state

| Variable | Purpose |
|---|---|
| `_authState` / `_authSession` / `_authEmail` | auth: `'initialising'`\|`'authenticated'`\|`'unauthenticated'`, session, email |
| `_isAdmin` / `ADMIN_EMAILS` | role gate — admins see hidden items + management controls |
| `_cache` | in-memory store for all manual data (`load`/`save`) |
| `_pd_deals` / `_pd_people` | Pipedrive data (people always via `pdNormalisePeople()`) |
| `_pd_deals_imported_at` / `_pd_people_imported_at` | freshness (MAX(imported_at)) |
| `_pdSalesPipeline` | pipeline toggle: `'2026 Sales'` or `null` (all) |
| `_ph` | all PostHog data keyed by name (`_ph.weekly`, `_ph.lifecycle`, …) |
| `_hiddenMetrics` / `_metricFlags` / `_reviewMode` | hide + trust-flag systems (review-mode only) |
| `activeTab` / `activeSub` | current tab / per-tab sub-tab state |
| `charts` / `_INFO` | live Chart.js instances by canvas id; info-popup registry |

Constants: `TARGET_USERS = 600`, `TARGET_ARR = 2_400_000`, `SUPABASE_URL`,
`SUPABASE_KEY` (anon — RLS blocks reads without auth). `KEYS` maps short names →
Supabase keys. OPTI-MAX targets in `localStorage['liq_optimax']`; funnel Insights
counts in `localStorage['liq_funnel_actual']`.

---

## Render functions (grep `function <name>`)

**Top-level tabs** — routed by `switchTab(id)` → `renderTab(id)`:
`renderHome` · `renderWorkstreams` · `renderExec` (Exec Brief) · `renderPipedrive`
(Sales) · `renderTeam` · `renderMarketing` · `renderWeeklyTracker` · `renderTraining`
· `renderActivity`. (Also standalone manual renderers `renderSales`, `renderTrials`,
`renderWebsite` where used.)

**Sales sub-tabs** — `renderPipedrive` → `setPdSub(sub)` → `render<>(sc)` where
`sc = #pd-sub-content`: `renderPdImport` · `renderPdRevenue` · `renderPdSales` ·
`renderPdUsers` · `renderPdChurn` · `renderPdTrials` · `renderPdOptimax` ·
`renderPdHealth`.

**Workstreams** — `WORKSTREAMS` array (sections → workstreams → KPIs) merged with
stored overrides via `wsEffective()`; state handlers `setWsGran`, `setWsPeriod`,
`setWsFilter`, `wsEditKpi`, `wsSaveDef`, `wsAddKpi`, `wsDeleteKpi`; storage
`wsData()`/`wsPatch()` (key `workstream_kpis`).

---

## Helpers

**Pipedrive** (grep `pdParseDate`): `pdParseDate(s)` → Date|null · `pdValidDate(d)` ·
`pdInRange(dateStr, range)` · `isTrialType(s)` (use, never `===`) ·
`pdNormalisePeople(rows)` / `pdNormaliseDeals(rows)` (canonicalise CSV headers; the
deals one also strips currency formatting) · `pdGetRange()` → `{from,to,label}` ·
`pdRangeMonths(range)`.

**Data layer**: `load(key)` · `save(key, arr)` (Supabase + backup + localStorage) ·
`lsWrite`/`lsRead` (prefix `liq_bk_`) · `fetchAllRows(table, cols)` (paginates
1000/page — don't assume a single page).

**Charts/UI**: `makeChart(id, cfg)` (destroys the previous chart at `id` first) ·
`destroyAllCharts()` (auto on tab switch) · `cardHTML(label,value,prev,type,sub,info)`
· `cardsHTML([...tuples])` · `tableHTML(...)` · `infoBtn(title, bodyHTML)` (body uses
`<span class="src-tag">` + `<div class="calc-row">`) · `toast(msg)` · `delRow(...)`.

**Formatters**: `fmtDate` (en-AU) · `fmtNum` (commas) · `fmt1` (1 dp) · `fmtPct` ·
`fmtDollar` (full integer) · `fmtCur` ($1.2M/$45k shorthand) · `pct(a,b)` ·
`monthKey`/`monthLabel` · `thisMonth(arr, dateKey)`. Axis styling: `axStyle`,
`gridStyle`.

---

## Coding rules

- **Deploy = `git push` to `main`** (Vercel auto-deploys). No `vercel --prod`.
- **Never** add a build step, `package.json` for the app, or a bundler.
- **Canvas ids must be globally unique** — a collision silently breaks a chart.
  There are ~50 (`pd-*`, `act-*`, `home-*`, `pd-om-*`, …). Before adding one,
  `grep 'id="pd-'` / `grep makeChart` to check it's free; inside a sub-tab call
  `makeChart` (it destroys the old one at that id).
- **Always** run `pdNormalisePeople()` when setting `_pd_people` from any source.
- **Trust systems** (owner's #1 priority): metric trust flags (`_metricFlags`,
  `injectFlags()`, review-mode dots), per-source freshness (`pdFreshnessHTML`),
  required-field validation (`PD_FIELDS`, `pdFieldReport`), hidden-metric curation
  (`_hiddenMetrics`, `.hide-toggle`, admin-only). Keep new metrics sourced +
  verifiable; test the empty/edge case.
- **Roles**: `_isAdmin` from `ADMIN_EMAILS`; `body.viewer` hides `.admin-only`
  controls; `toggleReviewMode` no-ops for viewers.

---

## Repo layout beyond index.html

- `scripts/pipedrive-sync.mjs`, `scripts/posthog-sync.mjs` — nightly Node syncs
  (GitHub Actions). Each logs a sanity check every run. Setup:
  `scripts/PIPEDRIVE_SYNC.md`.
- `.github/workflows/*.yml` — the two sync schedules.
- `*.sql` (repo root) — one-off Supabase migrations; header says when to run.
- `docs/OPERATIONS.md` — connectors, secrets, deploy, syncs, auth, working from web.

---

## Working style (what the owner, Jacy, expects)

- **Plain English**, no jargon/acronyms in UI copy; every number shows its source.
- **Trustworthy numbers above all** — a silently-wrong metric is the worst outcome.
  When a bug is reported, fix the whole *class*, not the one instance.
- **Verify adversarially**: test empty/sparse/edge data yourself; don't ship a card
  that renders blank and wait for the user to catch it.
- Prefers **decisive action with a recommendation** over long option menus; keep
  explanations short and concrete.
