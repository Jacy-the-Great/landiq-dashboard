# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy

```bash
cd /Users/jacymacnee/Desktop/landiq-dashboard && vercel --prod
```

No build step. The repo is a single HTML file deployed as a static site. Never add a build process.

## Architecture

Everything lives in **`index.html`** (~5,900 lines). It is a single-file vanilla JS + CSS + HTML dashboard with no framework, no bundler, and no dependencies except CDN-loaded libraries (Supabase JS v2, Chart.js, PapaParse).

### Sections in file order

| Lines (approx) | Section |
|---|---|
| 1–270 | CSS (variables, layout, components) |
| 270–485 | Auth state machine (`_authState`, `initialiseDatabaseAuth`, token refresh) |
| 485–750 | Data layer: Supabase fetch, localStorage backup, PostHog RPC calls, `save()`, `load()` |
| 750–895 | Global UI helpers: `makeChart`, `cardHTML`, `cardsHTML`, `tableHTML`, `toast`, formatters |
| 895–1075 | `renderHome` |
| 1075–1430 | `renderSales` (manual weekly sales tracker) |
| 1430–1585 | `renderTrials` (manual trials tracker) |
| 1585–1935 | `renderWebsite` |
| 1935–2705 | `renderActivity` (Giraffe/PostHog, SDK, Labs sub-tabs) |
| 2705–3010 | `renderTraining` |
| 3010–3135 | `renderWeeklyTracker` |
| 3135–3830 | `renderMarketing` (content log, webinars, LinkedIn, EDM) |
| 3830–4005 | Pipedrive helpers (`pdNormalisePeople`, `pdGetRange`, `pdRangeMonths`, `pdParseDate`, `pdValidDate`, `pdInRange`, `isTrialType`) |
| 4005–4085 | `renderPipedrive` (tab shell + header cards + pipeline toggle) + `setPdSub` |
| 4085–4355 | `renderPdRevenue` |
| 4355–4780 | `renderPdSales` + `renderPdOptimax` |
| 4780–5010 | `renderPdChurn` |
| 5010–5165 | `renderPdUsers` |
| 5165–5345 | `renderPdTrials` |
| 5345–5600 | `renderPdOptimax` |
| 5600–5900 | Info popup system (`_INFO`, `infoBtn`, `showInfo`, `closeInfo`), shared UI helpers, HTML shell |

### Tab / sub-tab routing

```
TABS array → switchTab(id) → renderTab(id)
  'home'      → renderHome
  'pipedrive' → renderPipedrive → setPdSub(sub)
                  'import'  → renderPdImport
                  'revenue' → renderPdRevenue
                  'sales'   → renderPdSales
                  'users'   → renderPdUsers
                  'churn'   → renderPdChurn
                  'trials'  → renderPdTrials
                  'optimax' → renderPdOptimax
  'training'  → renderTraining
  'marketing' → renderMarketing
  'tracker'   → renderWeeklyTracker
  'activity'  → renderActivity
```

Active sub-tab state is stored in `activeSub` (e.g. `activeSub.pd_sub`).

### Data layer

**Manual data** (all tabs except Pipedrive/PostHog):
- Stored in Supabase `dashboard_data` table as `{ key, data }` rows
- Read via `load(key)` → returns array from `_cache`
- Written via `save(key, arr)` → writes Supabase + backup table + localStorage simultaneously
- `KEYS` constant maps short names to Supabase key strings
- `localStorage` (prefix `liq_bk_`) is a fallback if Supabase is slow/offline

**Pipedrive data** (CSV import):
- `_pd_deals[]` — from `liq_pipedrive_deals` table (`{ raw }` JSONB rows)
- `_pd_people[]` — from `liq_pipedrive_people` table, always run through `pdNormalisePeople()` on load
- `_pdSalesPipeline` — global toggle `'2026 Sales'` | `null` (all pipelines); affects header cards + Sales/Revenue sub-tabs
- **Critical:** always use `isTrialType(s)` (`.includes('trial')`) never `=== '2 Week Trial Licence'` — the field is multi-value comma-separated and has multiple trial type variants
- **Critical:** always run `pdNormalisePeople()` after any CSV parse — Pipedrive exports sometimes omit the `Person - ` prefix from column headers

**PostHog data** (Supabase materialized views):
- Loaded into `_ph` object at startup via 12 parallel `sb.rpc('ph_...')` calls
- Views refresh nightly at 3am via pg_cron (`SELECT public.ph_refresh_views()`)
- Can be manually refreshed with the button in the Activity tab (calls `sb.rpc('ph_refresh_views')`)
- Requires `posthog_migrations.sql` to have been run in Supabase SQL Editor first

### Auth

- Email + password via `sb.auth.signInWithPassword()`; OTP magic link also available
- `persistSession: false`, `autoRefreshToken: false` — token refresh is managed manually by `scheduleTokenRefresh()`
- Auth state machine: `'initialising' → 'authenticated' | 'unauthenticated'`
- RLS: all tables restrict to `authenticated` role only; anon key returns empty results (not an error)

### Charts

- `makeChart(id, config)` wraps Chart.js — always destroys the previous chart at that canvas ID first
- `destroyAllCharts()` is called on every tab switch
- Chart canvas IDs must be unique across the whole file — collisions silently break charts
- `axStyle` and `gridStyle` are global constants for consistent axis styling

### UI patterns

**Cards:**
```js
cardHTML(label, value, prev, type, sub, info)
// type: null | '$' | '%'
// info: HTML string → renders ⓘ button that opens info popup
// value=null or 0 renders "no data" state
```

**Info popups:**
```js
infoBtn(title, bodyHTML)
// Registers in _INFO{} keyed by random ID
// Body should use: <span class="src-tag">Source</span> and <div class="calc-row">formula</div>
```

**cardsHTML(items):** takes array of `[label, value, prev, type, sub, info]` tuples.

### Adding a new Pipedrive sub-tab

1. Add the key to the `['import','revenue','sales',...]` array in `renderPipedrive`
2. Add its label to the label map in the same line
3. Add `else if (sub === 'key') renderPdKey(sc);` in `setPdSub`
4. Write `function renderPdKey(sc) { ... }` near the other `renderPd*` functions

### Global constants

```js
TARGET_USERS = 600       // paid subscriber target
TARGET_ARR   = 2400000   // $2.4M ARR target
```

OPTI-MAX conversion targets are stored in `localStorage` under key `liq_optimax` (JSON object).

## Supabase project

- **URL:** `https://ysdonnjezvoyrrizadik.supabase.co`
- **SQL Editor:** `https://supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor`
- **Tables:** `dashboard_data`, `dashboard_backups`, `liq_pipedrive_deals`, `liq_pipedrive_people`
- **PostHog schema:** `posthog."Posthog Events"` — materialized views sit in `public`
- Run `supabase_auth_rls.sql` to apply RLS, `posthog_migrations.sql` to set up PostHog views

## Known field name rules (Pipedrive)

- `Person - Customer Type` values: `Paid Subscription`, `Access Revoked`, `2 Week Trial Licence`, `Extended Trial Licence`, `Centrally Funded Licence`, `Contact Register`, `Expression of Interest`, `Admin Accounts`, `WSP/Giraffe`, `Land iQ Project Team`
- `Person - Previous Customer Type` is **comma-separated multi-value** — never use `===`, always use `.includes()`
- Exclude `Contact Register` and `Expression of Interest` from any "trained" count
- `Access Revoked` is a Customer Type (not a field) representing churned users
- `Deal - Pipeline` values: `2026 Sales`, `General Onboarding Pipeline`, `Trial Pipeline`
