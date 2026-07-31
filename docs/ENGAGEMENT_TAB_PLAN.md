# Engagement data — Activity tab layout plan

Draft layout for the two Power BI extracts (customer health bands + Labs/Core
usage) landing in the **Activity** tab. Status: **drafted, not built.**

## Source data & refresh (decided)

Weekly manual refresh from two Power BI exports of the Land iQ semantic model.
The band logic lives in the semantic model and is not available here, so the
dashboard **consumes the band labels as given** — it does not recompute them.

**File A — customer health** (`data.xlsx`, one row per person):

| Person - Email | Organisation | Customer Health Score | CHS (Last Week) |
|---|---|---|---|
| abhijeet.sharma@… | Infrastructure NSW | Monitor | Attention |

187 scored people across 33 organisations. Carries **both weeks per person**, so
band movement needs no history to compute. `Person - Email` joins to Pipedrive
`Person - Email` (customer type, organisation, access-granted date).

**File B — usage** (`data (1).xlsx`, one row per day):

| timestamp - Year | timestamp - Month | timestamp - Day | Labs Events | Land iQ Events | Land iQ Events (excl. Site Search) |
|---|---|---|---|---|---|
| 2026 | February | 9 | 31 | 30 | 3 |

147 daily rows (Feb–Jul 2026). Trailing "Total" and "Applied filters:" rows must
be stripped on import. "Land iQ Events" = Core; the excl-Site-Search column
separates real analytical work from search traffic.

**Import mechanism:** paste-from-Excel into a tab-separated textarea, matching
the existing pattern (`web-csv` on the Website tab). No new library, no build
step, no file-format dependency. Admin-only.

**History accrual (the point):** each health import is stored as a **dated
weekly snapshot** (`liq_health_weeks`, keyed by week-ending date), so a record of
weeks builds from now on even while the numbers stay bad. Re-importing the same
week overwrites that week, never duplicates. Usage imports merge into a single
daily series (`liq_usage_daily`) keyed by date.

**Calibration caveat (must be visible in the UI):** 129 of 187 people (69%) are
in *Attention* and exactly **1** is *Good*. Thresholds are known to be harsh and
will be relaxed upstream. Until then the **direction** (attention rate falling
75.9% → 69.0%) is the trustworthy signal, not the level. Band-mix charts carry a
caption saying so, so nobody reads "1 Good" as a measurement of quality.

**Privacy (decided):** organisation-level everywhere by default. The named
movers list (individual staff emails at client agencies) is **admin-only**
(`.admin-only`), like the FY27 settings box.

---

## Sub-tab A — "Customer health" (new)

**Row 1 · KPI cards**
1. **Attention rate** — 69.0%, ▼ from 75.9% last week. *Lower is better* — the
   card must invert its trend colouring (falling = green), or it will read a real
   improvement as a decline.
2. **People scored** — 187 across 33 organisations.
3. **Improved this week** — 13 improved · 174 held · 0 declined.
4. **Organisations needing attention** — count of orgs where >50% of their people
   are in Attention. The prioritisation number.

**Row 2 · Band mix, this week vs last** — grouped bars (Attention / Monitor /
Good × two weeks). Carries the calibration caption.

**Row 3 · Attention rate by organisation** — horizontal bars, ranked worst-first,
each labelled with its person count (`n`). *This is the "who needs a call" list
and the most actionable thing on the tab.* Small orgs (n<3) visually de-emphasised
so a single dormant user doesn't top the list.

**Row 4 · Health mix by organisation** — stacked bars per org.

**Row 5 · Attention rate over time** — line chart across stored weekly snapshots.
Empty until the second import; shows "building — one week recorded so far" with
the count. This is the record of weeks.

**Row 6 · People who changed band** *(admin-only)* — table: organisation, from →
band, with emails visible to admins only. Viewers see an org-level count instead.

## Sub-tab B — "Usage trends" (new)

**Row 1 · KPI cards**
1. **Events last full week** — total, with week-on-week change.
2. **Labs share of all events** — 37.5%, ▲ from 10.2% in February. The headline
   product-mix story.
3. **Average weekday events** — normalised for weekends/holidays; the honest
   volume trend.
4. **Analytical share of Core** — Land iQ events excluding Site Search ÷ all Core
   events. Distinguishes real work from search traffic.

**Row 2 · Daily events, Labs vs Core** — two lines plus their 7-day rolling
averages (raw daily is too noisy to read alone).

**Row 3 · Weekly totals** — bars with a moving average overlay.

**Row 4 · Labs share of all events, by month** — the "Labs overtook Core" trend.

**Row 5 · What Core activity actually is** — Site Search vs everything else, by
month.

**Row 6 · Day-of-week profile** — Labs peaks Wednesday; useful for scheduling
training and webinars.

---

## How this links to the existing KPIs

Four Workstreams KPIs are flagged `proposed:true` — specified but never built
because the data did not exist. This data makes three of them real (at
organisation level, see the constraint below).

| KPI | Today | With this data |
|---|---|---|
| `active_usage` — "Active usage (% of licensed seats)" | live, binary active/inactive via PostHog email match | attention rate is the richer three-band version of the same question; use as the drill-down |
| `trained_active` — "Trained → still active after 30 days" | **proposed, empty** | orgs trained in the last 90 days vs their attention-rate change — the objective test of whether training works |
| `cf_util` — "Centrally-funded seats active (30d)" | **proposed, empty** | per-org health mix filtered to centrally-funded organisations |
| `w4_ret` — "Week-4 retention (new users)" | **proposed, empty** | weekly snapshots + Pipedrive access-granted date, once ~4 weeks of history exist |
| `ttfv` — "Time-to-first-value (≤14 days)" | proposed | needs first-event date per person; PostHog `ph_lifecycle.first_seen` has it — not served by these two files |
| `users_trained` | live count | gains an outcome measure instead of just a volume |
| `train_sat` | manual satisfaction score | band movement is its objective counterpart |

**Constraint to state honestly:** the training log records `org`, not attendee
emails, so training→health can only be joined at **organisation level**, not per
person. That still answers "did engagement improve at the orgs we trained?" — it
cannot answer "did *this trainee* become active." Person-level would need emails
captured in the training log.

**Strategic link:** attention rate is a **leading indicator for the FY27 70%
retention target** (126 of 180). With 69% of licensed people in Attention, that
target is at risk, and this is the earliest warning available — months before a
renewal conversation. Recommend surfacing attention-rate-by-org next to the
retention card on the Exec Brief once a few weeks of history exist.

---

## Build order

1. Import + storage (paste parser, dated weekly snapshots, usage series merge).
2. Sub-tab A rows 1–4 and Sub-tab B rows 1–3 — the immediately useful half.
3. Trend charts (health over time) — turn on as history accrues.
4. Movers table (admin-only) + the KPI wiring for `trained_active` / `cf_util`.
5. Registry entries + tests for every new metric, per the change-control protocol.
