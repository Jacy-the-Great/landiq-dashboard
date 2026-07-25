# Regression tests

`run-tests.mjs` is the dashboard's safety net: it extracts the **real** calculation
functions from `index.html` and runs them against fixture data, so an edit that
changes a metric's meaning turns a test red before a wrong number ships.

```bash
node tests/run-tests.mjs        # zero dependencies, runs in ~1s
```

CI runs it on every push (`.github/workflows/checks.yml`). Enforcement is
**warn-only** by the owner's decision: red = the commit gets a ✗ and the editor
must stop and escalate (see CLAUDE.md "Change-control protocol"), but deploys are
not blocked.

What's covered: inline-script syntax · Pipedrive date parsing · trial detection ·
funnel "reached stage" logic (incl. lost-deal stage history and the Closed-Lost
trap) · the OPTI-MAX rolling-window model (windowed numerator + denominator,
monotonic funnel, card/table consistency) · the active-paid rule (future removal
date = still active).

Rules of the road:
- **Red test ≠ edit the test.** Fix the code, or escalate the intentional change
  to the owner with consequences, then update the test + `docs/DECISIONS.md`.
- **New metric → new test.** A metric without a test is unprotected.
- If extraction fails (a function was renamed/moved), the suite goes red on
  purpose — update the extraction pattern alongside your change.
