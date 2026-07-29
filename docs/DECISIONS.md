# Decisions & Learnings Log

The shared, living record every Claude Code chat can read and append to — the
project's memory across sessions and devices. **Newest entry first.**

**When to add an entry** (any chat, after the work): a decision worth remembering,
a non-obvious learning, a gotcha that cost time, or a "why we did it this way."
**Don't** log routine edits — git history covers those. Keep entries short: what,
and why.

**When something becomes a permanent rule**, also fold it into the right reference
doc (CLAUDE.md / docs/DATA_CATALOGUE.md / docs/CODE_MAP.md / docs/OPERATIONS.md) so
it's found without reading the whole log.

**How to append safely:** `git pull` first, add your entry at the top, commit, push.
This file rarely conflicts (unlike `index.html`), but pull first anyway.

Format: `## YYYY-MM-DD — Short title` + a few lines. Use absolute dates.

---

## 2026-07-29 — Three-agent review panel (UX/UI · Accuracy · Communication)
Independent specialist reviews + a cross-discussion round; all converged ≥8.5/10
with their proposed packages (Accuracy 6.0→9.0, UX 5.0→8.5, Comms 5.5→8.5 — two
reviewers honestly LOWERED current scores after seeing peers' evidence).
**Nothing implemented — recommendations only**, recorded in full in
docs/REVIEW_PANEL_2026-07.md. Highest-signal findings: `--bg2`/`--bor` CSS vars
used 51× but never defined (FY27 progress-bar tracks invisible); dead font
@import; metric-bearing config (liq_fy27/liq_optimax) is per-browser localStorage
so admin target edits don't reach viewers (divergent numbers); fy27_new_licences
counts renewal seats toward the 624 "new" target; ph_weekly_stats SQL omits
active_engaged (likely silently-null metric); two "win rate" surfaces plot close
rate; ':' empty-value artifact ~77 sites; zeros render as "no data"; old
600/$2.4M targets still DRIVE several tabs' calculations. Consensus #1: one
target story — everything derives from fy27(), old targets as labelled secondary
only.

## 2026-07-28 — FY2026-27 targets implemented (Exec Brief + registry + tests)
Audit found NONE of the FY27 email targets had been built (plan existed only).
Now implemented per the locked plan: editable `liq_fy27` config (all targets +
assumptions, admin box in Exec Brief); Home hero → /750 licences with 600 as
secondary; Exec revenue card → $1.61M FY27 ($1.56M licence + $50k advisory,
$2.4M secondary); new Exec cards for new-licences-FY27, base retention (180 −
paid churn since 1 Jul 2026, target 126), tier mix (target-only until Pipedrive
carries a Licence Tier field), licence margin (blended price vs $3,499 cost,
target >70% under 3.0); margin narrative bullet; Workstreams quarterly defaults
(advisory $12.5k, net seats 156, licence rev $390k). Four new registry entries +
five tests (§6b). **The tests caught a timezone bug before ship**: `new
Date('2026-07-01')` is UTC midnight = 10am Sydney, so deals won before 10am on
1 Jul fell outside the FY window — fy27Range now parses local date components.
Status table: docs/FY27_TARGETS_PLAN.md.

## 2026-07-28 — Metric registry (reliability Phase 3)
`METRICS` in index.html is now the single source of truth for 10 key metrics
(active_paid, active_trials, win_rate, close_rate, monthly_leads, target_won,
won_revenue_2026, licences_sold, active_users_week, active_engaged_week): each
entry declares source, human formula, tooltip text AND the actual computation.
Render sites call `mVal(id)` / `mTest(id)` for values and `mDoc(id)`/`mInfo(id)`
for tooltips, so a tooltip physically cannot drift from the calculation. Found and
killed 5 divergent inline copies of the active-paid predicate — two of them used a
DIFFERENT rule (unparseable removal date counted as active). Canonical rule:
unparseable = NOT active. Tests §6 run the real registry on fixtures; §7 adds
drift guards (the inline paid-filter pattern may appear exactly once — in the
registry; adding a copy turns CI red). Rule: new key metric → registry entry +
test, never a second inline copy.

## 2026-07-26 — Regression test harness + CI + change-control protocol (Phase 1+2)
Built the reliability system the owner asked for ("don't break one thing when
updating another"): `tests/run-tests.mjs` extracts the REAL calculation functions
from index.html and asserts documented behaviour on fixtures (36 checks: dates,
trial detection, funnel stage history incl. the Closed-Lost trap, the rolling-
window model, active-paid rule). CI runs it on every push (`Checks` workflow).
Enforcement decision: **warn loudly, never block** — red ✗ on the commit, deploys
not gated. CLAUDE.md now carries a mandatory change-control protocol: check
dependents before editing shared logic, run tests after, never edit a test to
green it, and **escalate intentional metric-meaning changes to the owner with
consequences** before proceeding. Adversarially verified: re-injecting the July
all-time-counts bug turns exactly the right 4 tests red. Deferred by choice:
metric registry (tooltip-from-spec) and the admin "under the hood" audit tab —
agreed design: registry renders tooltips so they can't drift; audit tab shows
every metric's source/formula/health, admin-only.

## 2026-07-26 — OPTI-MAX window switched to rolling past-6-months
Replaced the editable start-month with a rolling 3/6/12-month selector (default 6,
`liq_optimax.roll_months`) computed once in `omModel()` and shared by the table,
Sales cards, charts and labels. Clearer, and pre-pipeline deals can never creep in.

## 2026-07-24 — OPTI-MAX per-month averaging fixed + Target-won reconnected
When the live stage-history data switched OPTI-MAX off the hand-typed Insights
counts, two bugs surfaced: (1) the funnel counts were **all-time** but divided by
the **window** months (9 since avg_from), so changing the month only moved the
denominator — inflated, "not accurate". Fixed by windowing the numerator (deals
*created* since avg_from that reached each stage, ÷ window months). (2) The Sales
"Monthly leads" / "Target won" cards read the hand-typed FA counts while the table
used live data, so they diverged. Fixed by one canonical `omModel()` (global,
windowed, live) that BOTH the table and the cards use. Also clarified the period UI
(shows years, "Nov 2025 → Jul 2026 = 9 months"). Lesson: never compute the same
metric two ways in two places — extract one source.

## 2026-07-24 — Deep reference + this log moved into the repo
Ported the data catalogue and code map out of local CLI memory into
`docs/DATA_CATALOGUE.md` and `docs/CODE_MAP.md`, and created this log, so any chat
(web or CLI, any device) is self-briefing. Local CLI memory does **not** travel to
web instances — the repo docs are now the shared source of truth.

## 2026-07-24 — "Active users" was counting anonymous web traffic
The PostHog weekly query counted `count(distinct distinct_id)` over ALL events, so
it included every logged-out browser/bot that fired a pageview — inflating "active
users last week" to ~389 when real usage was far lower. **Fix:** count distinct
known people (by person email), split into `active_users` ("showed up", any event)
and `active_engaged` ("did something", real product action, excludes `$`-events and
clicks). Needs `posthog_active_engaged.sql` run once in Supabase for the new column;
the sync degrades gracefully until then. Decision (owner): track both — showing up
and doing something both matter.

## 2026-07-23 — Pipedrive API sync regressions found + fixed
A comprehensive audit (now logged by the sync every run) after switching from CSV
to the API found: **(1)** `Person - Email` came through as a JSON blob
(`[{value,primary}]`), silently breaking every PostHog email-match metric
(active-usage %, ROI, at-risk) — fixed to extract the primary address. **(2)**
`Deal - Person` was empty — filled from the deal's contact. **(3)** Region/LGA/
Council don't exist in Pipedrive's API (only unpopulated postal-address parts), so
the geographic breakdown is blank until addresses are filled there — not a bug.
Lesson: after any source change, verify field coverage, not just headline totals.

## 2026-07-23 — "Paying customers dropped to 99" was a stale load, not real
The data was always 179 active paid. `Person - Date Access Removed` is usually a
**future** subscription-expiry date (e.g. 2026-12-31), which means still active, not
churned. The 99 was a browser showing an incomplete earlier sync. Rule now in
CLAUDE.md: a future removal date ≠ churned.

## 2026-07-22 — Nightly Pipedrive API sync live; funnel uses real stage history
`scripts/pipedrive-sync.mjs` replaces the manual CSV upload (GitHub Actions,
02:00 AEST). It writes the same table shape, rebuilds field names from Pipedrive's
`/dealFields`/`/personFields` (custom fields flow through automatically), and adds
`Deal - Stages visited` so LOST deals count at the furthest funnel stage they
reached — the OPTI-MAX funnel switches to this automatically. **Gotcha caught by the
sanity check:** `/dealFields` names Pipeline under a key that isn't the property on
a deal record, so the first run synced every deal with a blank pipeline (which would
have emptied the whole Sales tab). Always resolve relation fields by field *name*.

## 2026-07-?? — Admin/viewer roles
`ADMIN_EMAILS` in `index.html` gates visibility: admins see hidden items + get
Review/Export/Import/Clear; everyone else is a viewer (dashboard minus hidden items,
can still edit values). UI-level only — all data still loads to every logged-in
browser, so it's declutter/visibility, not hard security.
