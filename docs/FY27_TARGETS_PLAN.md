# FY2026-27 Targets — integration plan

Extracted from the FY27 revenue/pricing forecast (Land iQ 3.0). Status:
**IMPLEMENTED 2026-07-28** (phases 1–3; phase 4 waits on a Pipedrive tier field).

## Implementation status — target by target

| Target | Status | Where it lives |
|---|---|---|
| Total revenue $1.61M | ✅ live | Exec Brief "Revenue won · FY2026-27" key card (FY27-window won deals vs $1.61M; prev. $2.4M shown as secondary) · registry `fy27_revenue` |
| Licence rev $1.56M / advisory $50k | ✅ shown | Split named on the same card's sub-line; advisory targeted on the Workstreams Advisory KPI ($12.5k/qtr default) |
| Total licences 750 | ✅ live | Home hero "/750" progress bar (prev. 600 as secondary) + Exec "Active paying customers" card (% of 750) |
| New licences 624 | ✅ live | Exec "New licences (FY27)" card · registry `fy27_new_licences` · Workstreams net-seats target 156/qtr |
| Retention 70% → 126 of 180 | ✅ live | Exec "Existing base retained" card · registry `fy27_base_retention` (base − paid churn since 1 Jul 2026) |
| Tier mix 500 Base / 250 Premium | ⚠ target-only | Exec "Tier mix target" card — live split needs a **Licence Tier field in Pipedrive** (sync picks it up automatically) |
| Pricing $2,000 / $4,000 | ✅ config | `liq_fy27` (price_base / price_premium), shown on the tier-mix card |
| Cost/licence $3,499 → $584 | ✅ config | `liq_fy27`; both figures shown on the margin card + narrative bullet |
| Margin 13% → >70% | ✅ live | Exec "Licence margin (current)" card · registry `licence_margin` (real blended price vs current cost) + narrative bullet |
| Royalty/WSP-IP upside | — noted only | Untargeted upside; not tracked (per plan) |

All targets/assumptions are **editable in the Exec Brief "FY27 model settings" box**
(admin-only, stored in `liq_fy27`) — no code change needed to adjust the model.
Guardrails: registry entries are tooltip-safe by construction; tests §6b cover the
FY-window edges (a timezone bug on 1-Jul was caught by these tests before ship),
retention, margin math, and config flow-through.

Decisions below were locked before the build; phases at the end record the plan.

FY2026-27 = 1 Jul 2026 → 30 Jun 2027 (we are at the start of it).

## The KPIs & targets

| KPI | FY27 target | Baseline / today | How it's sourced |
|---|---|---|---|
| Total forecast revenue | $1.61M | ~$1.03M won all-time | Live (Pipedrive, FY27 window) vs target |
| — Net licence revenue | $1.56M | — | gross licence − ($584 × licences) |
| — Fee-for-service advisory | $50k | Workstreams Advisory KPI | Live/manual vs target |
| Royalty / WSP-IP revenue | upside (untargeted) | $0 | note only |
| Total licences | 750 | ~180 active paid (= "existing base") | Live vs target |
| New licence sales | 624 | ~0 FY27-to-date | Live (deals won in FY27) vs target |
| Retention of 180 base | 70% → 126 | 180 base at FY27 start | Live (churn of the base cohort) |
| Base-tier licences ($2,000) | 500 | 0 | target-only until a tier field exists |
| Premium-tier licences ($4,000) | 250 | 0 | target-only until a tier field exists |
| Third-party cost / licence | $584 (from $3,499) | $3,499 | config assumption |
| Licence margin | >70% (from 13%) | ~13% | computed: (price − 584) ÷ price |
| Pricing: Base / Premium | $2,000 / $4,000 | $8,000 full / $4,000 gov | config |

Competitor benchmarks (Archistar $79/$287/$495; Landchecker free + $400/user/yr)
are context for *why*, not tracked KPIs — put them in a tooltip on the margin/
pricing card, not as metrics.

## Decisions (locked)

1. **Show both target sets.** FY27 (750 licences, $1.61M) is the primary headline;
   the old 600-seat / $2.4M numbers stay as a smaller secondary/reference line.
2. **Total now, tiers later.** Track total 750 / new 624 / retained 126 live now.
   Show the Base/Premium split (500/250) as **target-only** until Pipedrive carries
   a licence-tier signal, then wire the live split in. No guessing tier from $ value.
3. **Editable config block.** An in-dashboard "FY27 model" box (like OPTI-MAX) holds
   the tier prices, $584 cost, and every target; margin is computed live from actual
   deal values vs the cost. No code edit needed to adjust the model.

## What goes where

### Exec Brief (primary)
- **Hero:** licences → **750** (progress bar), with "126 retained + 624 new" and a
  small secondary line "prev. target 600 seats".
- **Revenue card:** **$1.61M FY27** (bar), sub "$1.56M licence + $50k advisory",
  small secondary "prev. $2.4M". Revenue counts Won deals in the FY27 window.
- **New cards:**
  - *Base retention* — X of **126** target (70% of 180). Live from churn of the
    base cohort (paid subs active at FY27 start).
  - *Tier mix* — Base vs Premium, **target-only** (500 / 250) with a "live once
    Pipedrive tags tier" note.
  - *Licence margin* — current blended margin vs **70%** target; computed
    `(avg realised licence price − $584) ÷ price`.
- **Narrative bullet:** the margin story — "half the price, ~4× the margin: $584
  third-party cost vs $3,499 today."

### Workstreams
- Set the **Advisory Revenue** KPI target to $50k, and the **License Sales** KPI
  targets to 624 new / 750 total (KPIs already exist — just wire the numbers).

### Sales / OPTI-MAX
- Feed the new $2,000 / $4,000 tier prices and $584 cost into the deal-value +
  margin model; reframe the "increase average deal value" lever around tier mix.

## Config block spec — `localStorage` key `liq_fy27` (admin-editable)

Targets: `total_rev 1_610_000`, `licence_rev 1_560_000`, `advisory_rev 50_000`,
`total_licences 750`, `new_licences 624`, `retained_target 126`, `base_target 500`,
`premium_target 250`, `retention_pct 70`, `base_customers 180`.
Assumptions: `price_base 2_000`, `price_premium 4_000`, `cost_per_licence 584`,
`margin_target 70`. Default from the numbers above; editable in the Exec Brief.

## Data dependency
Tier mix (KPI 8/9) stays target-only until Pipedrive has a **Licence Tier** field
(or similar). Once it does, the nightly sync picks it up automatically (field names
are rebuilt from `/dealFields`), and the live Base/Premium split can be wired in.

## Build phases
1. **Config block + Exec Brief headline** — `liq_fy27` model, reframe hero +
   revenue card (FY27 primary, old as secondary), FY27 revenue/licence progress.
2. **New Exec cards** — base retention (live), tier mix (target-only), margin (live).
3. **Workstreams targets** — advisory $50k, licence 624/750.
4. **Later (needs Pipedrive tier field)** — live Base/Premium split; OPTI-MAX tier
   pricing model.
