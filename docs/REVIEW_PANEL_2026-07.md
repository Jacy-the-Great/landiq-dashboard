# Three-agent review panel — July 2026

Independent specialist reviews (UX/UI · Accuracy · Communication) of the dashboard
and its recent builds (metric registry, OPTI-MAX rolling window, FY27 targets,
roles, test harness), followed by a cross-discussion round in which each reviewer
saw the others' findings, resolved overlaps/ownership, and re-scored.
**Recommendations only — nothing here has been implemented.** Line numbers refer
to index.html at commit `e5d642d` and will drift.

## Final scores

| Category | Score now | With proposed changes | Bar ≥8.5 |
|---|---|---|---|
| Accuracy | 6.0 | **9.0** | ✅ |
| UX/UI | 5.0 | **8.5** | ✅ |
| Communication | 5.5 | **8.5** | ✅ |

Both Accuracy (6.5→6.0) and Communication (6→5.5) *lowered* their current scores
after the discussion round — peers' evidence (config divergence; invisible
progress bars; mislabelled rates) worsened the honest picture. UX raised its
with-proposals score 8.0→8.5 only by formally adding its substantial items to the
package. Consistent praise across all three: the metric registry, freshness
banners, honest-state captions, and the test harness are unusually strong for an
internal tool ("better than most commercial SaaS products" — Comms).

## The consensus headline (flagged independently by all three)

**One target story.** The old 600-seat / $2.4M targets still *drive* the Revenue
gap cards (`TARGET_ARR` math ~7341/7435), the Users chart target line (~8930),
Workstreams tiles (~6645/6881/6891), a Marketing $200k/mo line (~2397), and four
"Target: 600" card subs — on the same screens where the hero says /750. Agreed
rule: **every target-bearing calculation reads `fy27()`**; `TARGET_USERS`/
`TARGET_ARR` may appear only as labelled "previous business-case target"
annotations, enforced later by a drift-guard test. Plus the one-clause fix for the
worst exec framing: *"prev. $2.4M — reset under Land iQ 3.0 pricing: more
licences, half the price, higher margin."*

## Merged quick-win package (deduped, ranked by panel ROI; owner in brackets)

1. **Define `--bg2` / `--bor` in `:root`** — used 51× but never defined; the FY27
   hero/keyCard/Workstreams progress-bar *tracks*, many table borders and buttons
   render invisible today. Two lines. [UX]
2. **Fix the dead font `@import`** (line ~20, ignored per spec) — DM Sans/DM Mono
   never load; whole app + 80 charts render in fallback. Move to `<link>`. [UX]
3. **Replace the `':'` empty-value placeholder with "—"** — ~77 sites incl. all
   five formatters; a bare colon reads as a broken template on every sparse
   table. Likely a corrupted em-dash sweep. [Comms]
4. **Zero ≠ "no data"** — `|| null` coercion renders true 0 as "no data"
   ("Churned this month — no data" hides *good* news; "New licences (FY27) — no
   data" is false, the answer is 0). Three-state cardHTML: value / true zero /
   no source data. [Accuracy semantics · UX component · Comms strings]
5. **Exclude renewal/internal pipelines from `fy27_new_licences`** (~1422 has no
   pipeline filter) — renewal seats will otherwise count toward the 624 "new"
   target the day renewals close. [Accuracy]
6. **Fix `ph_weekly_stats` to return `active_engaged`** — the repo's SQL function
   omits the column the UI reads; "Did something in-product" is probably silently
   null everywhere. Verify live, commit the fixed function. [Accuracy]
7. **Base-retention cohort filter** — add `Date Access Granted < fy_start` so
   churn of customers acquired *during* FY27 stops decrementing "Existing base
   retained" (~1431). [Accuracy]
8. **Win/close rename** — two surfaces plot close rate under a "win rate" title
   (chart ~8075/8313; manual "Win %" column ~2276/2489): a 34%-vs-77% exec
   misread. Agreed labels: *"Win rate — of every lead entered"* / *"Close rate —
   of decided deals only"*, subs + cross-referencing tooltips as specified.
   [Accuracy + Comms]
9. **One target source + why-clause** (the consensus item above). [all three]
10. **Sync metric-bearing config to Supabase** — `liq_fy27`, `liq_optimax`,
    `liq_funnel_actual` are per-browser localStorage while metrics *compute* from
    them: an admin's target edits change numbers on their machine only; two
    people in one meeting can see different "Existing base retained". The
    `save()` plumbing already exists. [UX mechanics + Accuracy requirement]
11. **Tier-mix card face** — show "500 / 250" with a TARGET-ONLY corner tag
    (kpiCardHTML pattern exists) instead of a "no data" headline. [UX + Comms]
12. **Sales-tab funnel uses stage history** (`omReached`) instead of
    current-stage-only (~7878) — currently disagrees with OPTI-MAX semantics and
    understates mid-funnel for lost deals. [Accuracy]
13. **`licence_margin` reuses OPTI-MAX's quantity-restricted avg price** —
    current blend is biased upward and duplicates logic (~1444 vs ~9318). [Accuracy]
14. **OPTI-MAX Licences view windowing** — all-time counts ÷ 6-month window,
    ~1.5× inflation; same bug class fixed for Deals view in July. [Accuracy]
15. **Pipeline-cover card, added by substitution** — open pipeline ÷ remaining
    FY27 gap ("Pipeline cover — open deals vs the gap · 2.1× · rule of thumb
    3×+"); fold "Won/Churned this month" into narrative bullets so Exec card
    count stays flat. [Accuracy metric · UX placement · Comms label]
16. **Renewal dates from the real expiry field** (future `Date Access Removed`)
    with anniversary fallback (~8731, ~6551). [Accuracy]
17. **Accessibility trio** — darken `--tl` (#8a9fb0, ~2.7:1, used 210×) to ≥4.5:1;
    Escape-closes-modal + restore `.om-input` focus ring; make flag-dots/hide
    toggles real buttons. [UX]
18. **Copy sweep** — expand EOI/EDM/SDK/CTA/OFR on first use; “License”→“Licence”
    ×7; “Opt-Max”→“OPTI-MAX” + one-line gloss; un-invert the “Monthly leads”/
    “Target won / month” card pair; “Won this month” sub-lines disambiguating
    all-pipelines vs 2026-Sales-only. [Comms]
19. **Exec keyCard grid → fluid** (only non-responsive grid; breaks on phones). [UX]
20. **Hero unit caveat** — counts *people* against a 750-*licence* target (~1:1
    today, breaks silently under multi-seat licensing): sub-line names the
    assumption until a real licence count exists. [Comms wording, Accuracy check]

## Substantial improvements (called out, larger effort — owner judgment)

- **Data-derived base cohort + $-weighted gross retention** — snapshot the FY27
  base from data (not static 180); measure renewal $ kept ÷ renewal $ due once
  the 2027 Renewals pipeline carries values. The plan's biggest assumption (70%
  retention) is currently its weakest measurement. [Accuracy]
- **Stage-weighted pipeline forecast** — replace the flat ~77% close-rate
  multiplier (~7599) that overstates early-stage pipeline value. [Accuracy]
- **Label-level regression tests** — assert render-site labels match registry
  semantics; forbid computational references to `TARGET_USERS`/`TARGET_ARR`;
  cover the `_ph.weekly` column contract, Licences view, funnel parity. [Accuracy]
- **Canonical vocabulary sweep** (~30 strings) — **licence** = the thing sold and
  targeted; **paying customer** = person with an active paid licence; **user** =
  usage data only; retire *seat/subscriber/paid user* from UI. [Comms]
- **Exec narrative restructure** — position → movement → risk → action; add
  gap-to-pace and at-risk orgs (computed on Health, never surfaced). [Comms]
- **IA sharpening** — Home = "what changed", Exec = "position vs target", remove
  duplicated cards; slim the Sales shell; Import Data behind admin-only; delete
  dead `renderSales`/`renderTrials`. Component consolidation (4 card variants →
  2; one badge system). [UX]
- **Seasonally-weighted quarterly targets** — annual ÷4 will read false-red in
  Q1 against NSW-gov buying seasonality. [Accuracy; owner judgment]

## Ownership decisions from the discussion round

Zero-vs-no-data: Accuracy owns semantics, UX the component, Comms the strings.
':' artifact: Comms. Tier-mix face: UX implements, Comms words. Target story:
Accuracy owns which numbers drive calculations, UX the visual grammar
(primary/secondary), Comms the explanation clause. Naming: set once in registry
`label` so it propagates (UX mechanism, Comms vocabulary).
