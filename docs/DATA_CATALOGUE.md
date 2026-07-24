# Land iQ Dashboard — Data Catalogue

Every field, indicator, and data point available from each source. Read this
before building a feature so you don't re-discover the schema. Field *lists* are
durable; specific counts drift — verify against current data (the sync sanity-check
log or the live dashboard) before quoting a number.

Sources: **Pipedrive** (CRM, nightly API sync) · **PostHog** (product usage, nightly
sync) · **manual tables** in Supabase `dashboard_data`.

---

## 1. Pipedrive — `liq_pipedrive_deals` / `liq_pipedrive_people`

Rows are `{raw: {...}}` with CSV-style keys. Populated nightly by
`scripts/pipedrive-sync.mjs` (or a manual CSV import). Loaded into `_pd_deals[]` /
`_pd_people[]`; people run through `pdNormalisePeople()`. Field names are rebuilt
from Pipedrive's `/dealFields` + `/personFields`, so **any custom field added in
Pipedrive appears automatically** as `"Deal - <name>"` / `"Person - <name>"`.

### Deal fields — `d['Deal - …']`
| Field | Notes |
|---|---|
| Pipeline | `2026 Sales` · `Trial Pipeline` · `Cold Outreach` · `General Onboarding Pipeline` · `2027 Renewals` · `WSP Internal Pipeline` · `Feedback Pipeline` · `Outside NSW` |
| Stage | current stage (see stage lists) |
| Status | `Won` · `Lost` · `Open` |
| Value | dollars (numeric string) |
| Won time / Lost time / Deal created / Deal closed on | dates (`YYYY-MM-DD HH:MM:SS`) |
| Owner · Organisation · Person | names (Person filled from the deal's contact) |
| Category · Label · Source channel · Source origin · Lost reason | text |
| Product quantity · Product amount · Product name | from the deal's attached products (drives licence counts) |
| **Stages visited** | `A \| B \| C` — every stage the deal ever sat in (from stage history) |
| **Max stage reached** / **Max stage order** | furthest funnel stage, so LOST deals count where they actually reached |

### Person fields — `p['Person - …']`
| Field | Notes |
|---|---|
| Customer Type | see values below |
| Previous Customer Type | **comma-separated multi-value** — always `.includes()`, never `===` |
| Date Access Granted | licence/trial start |
| Date Access Removed | **usually a FUTURE subscription-expiry date** — a future value ≠ churned |
| Email | plain address (sync extracts the primary from Pipedrive's `[{value,primary}]`) |
| Organisation · Owner · Name · First/Last name | text |
| Region / LGA / Council | **empty** — Pipedrive has no such fields (only postal-address parts, unpopulated). Geographic breakdown is blank unless addresses get filled in Pipedrive. |

**Customer Type values** (verify counts against current data): `Contact Register`,
`Access Revoked` (= churned), `Paid Subscription`, `Admin Accounts`,
`2 Week Trial Licence`, `Extended Trial Licence`, `Centrally Funded Licence`,
`WSP/Giraffe`, `Land iQ Project Team`, `Cold Outreach Lead`, `Expression of Interest`.

### 2026 Sales funnel stages (in order)
Contact Made/Discovery → Meeting Scheduled → Negotiations → Order Form Sent →
Signed Order Form Returned → Invoice Sent → Payment Received. (Lost deals move to a
terminal *Closed Lost* stage — hence the stage-history fields.)

### Key metric rules
- **Active paid seats** = Customer Type `Paid Subscription` AND (no removal date OR
  removal date in the future).
- **Trial detection**: `isTrialType(s)` (`.includes('trial')`), never `===`.
- **Revenue churn**: Customer Type `Access Revoked` AND Previous Type includes
  `Paid Subscription`.
- **Trained count**: exclude `Contact Register` and `Expression of Interest`.
- **Win rate** (Won ÷ Contacts, ~34%) ≠ **close rate** (Won ÷ Won+Lost, ~65%).
- Helpers: `pdParseDate`, `pdValidDate`, `pdInRange`, `pdGetRange`, `pdRangeMonths`.

---

## 2. PostHog — `ph_*` summary tables

Written nightly by `scripts/posthog-sync.mjs` (the old in-DB RPC/materialized-view
model is gone). Loaded into `_ph.*` at startup. **"Active users" counts distinct
KNOWN PEOPLE by email**, not raw `distinct_id` (which includes anonymous browsers
and bots and massively inflates the number).

| Table → `_ph` key | Columns |
|---|---|
| `ph_weekly` → `_ph.weekly` | `week_start`, `active_users` (showed up), `active_engaged` (did a real product action), `total_events`, `login_users` |
| `ph_daily` → `_ph.daily` | `day`, `active_users`, `active_engaged`, `total_events`, `login_users` |
| `ph_monthly` → `_ph.monthly` | `month_start`, `mau` |
| `ph_lifecycle` → `_ph.lifecycle` | `distinct_id`, `first_seen`, `last_seen`, `active_days`, `total_events`, `cohort_week`, `cohort_month`, `email` |
| `ph_feature_daily` → `_ph.featureDaily` | `day`, `feature`, `event_name`, `active_users`, `events` |
| `ph_feature_adoption_tbl` → `_ph.featureAdoption` | `feature`, `users_who_tried` |

- `active_users` = "showed up" (known person, any event). `active_engaged` = "did
  something" (known person, real product action; excludes `$`-events and clicks).
- The Exec/Home "active users" cards use the **last fully-ended week**, not the
  current partial week.
- Email matching (Health Score, ROI, at-risk) joins `_ph.lifecycle.email` /
  `_ph.featureDaily` to `Person - Email`. If `Person - Email` is a JSON blob the
  Pipedrive sync regressed — it must be a plain address.
- `_ph` in-memory key casing has bitten before — grep the actual read
  (`_ph.atRisk`, `_ph.powerUsers`, `_ph.featureAdoption`, `_ph.dauMau`) rather than
  guessing; a wrong-case key silently renders empty.

---

## 3–10. Manual tables (Supabase `dashboard_data`, via `load`/`save`)

Each is an array under a `KEYS` short-name. Row id field noted.

**`website`** (key `week`): `week, views, users, active, sessions, cta, eoiform`.
**`website_daily`** (key `date`): `date, views, users, sessions, cta, eoiform`.

**`weekly_tracker`** (key `week`) — weekly marketing single-source-of-truth:
LinkedIn `jsImp/jmImp/lbImp`; EDM `edmOpen/edmCtr`; webinar email
`wbEmailSend/wbEmailOpen/wbEmailCtr`; webinar reg `wbRegPage/wbReg`; website
`websiteVisits/purchaseEnq/eoiTickets/trialsStarted`.

**`training`** (id `_id`, date `date`): `type, attendees, org, custtype, trainer,
sdk, notes`. Types: Webinar / 1:1 / Group onsite / Self-serve.

**`webinars`** (id `_id`, date `date`): `title, regPageViews, registered, attended,
cancelled, avgTime` (e.g. "49m 34s"), `reactions`. *"Webinars held" counts only
date ≤ today.*

**`trials`** (key `week`): `lead, trialEoi, trialsGranted, demoAttended, sdkActive,
orderFormSent, signed`.

**`sales`** (key `week`) — manual weekly snapshot (distinct from the Pipedrive Sales
tab): `newDeals, won, wonVal, lost, lostVal, revenue, avgDealVal, websiteUsers,
winRate, withTrial, noTrial, withDemo, noDemo`, pipeline stage counts
(`contactMade…invoiceSent`), and `src_*` source counts.

**`content`** (id `_id`, date `date`) — marketing content log, `type` selects the
channel columns: LinkedIn `impressions/reactions/comments/shares/clicks`; YouTube
`ytviews/watchtime/subs`; EDM `recipients/opens/edmclicks/unsub`; Viva
`vivaviews/vivareactions`; Speaking `event/audience/leads`; Webinar `wb*`. Common:
`title, outcome, tags`.

**Activity** — `activity_giraffe` (weekly: `logins, active_users, new_users,
dau_mau, avg_session, notes`), `activity_sdk` (`date, app_name, events,
active_users, notes`), `activity_labs` (weekly: `logins, active_users, sessions,
avg_session, top_feature, notes`). These are manual fallbacks; live usage comes
from PostHog.

**Workstreams KPIs** — `workstream_kpis` holds overrides/custom KPIs/values for the
`WORKSTREAMS` board (see CODE_MAP). Patch keys: `def|<id>` (label/unit overrides),
`new` (custom KPIs), `t|<id>` (target), `v|<id>|<period>` (a period's value),
`ms|<id>` (milestone), `cl|<id>` (checklist).

---

## Storage architecture

| Layer | Mechanism |
|---|---|
| Primary | Supabase `dashboard_data` (`{key,value}`, RLS authenticated-only) |
| Backup | Supabase `dashboard_backups` (append-only) |
| Cache | `localStorage` prefix `liq_bk_` (offline/first-paint fallback) |

`save(key, arr)` writes all three. `load(key)` reads from the in-memory `_cache`.
Pipedrive/PostHog tables are fetched via `fetchAllRows()` (paginates 1000/page).
