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
