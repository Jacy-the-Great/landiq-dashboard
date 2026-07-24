# Land iQ Dashboard — Operations Guide

Everything needed to run, update, and reason about the dashboard from **any
device**, and to brief a fresh Claude Code chat. Pairs with the auto-loaded
[`CLAUDE.md`](../CLAUDE.md).

---

## 1. The stack — what each piece does

| Piece | Role | Where |
|---|---|---|
| **GitHub** | Source of truth. All code + the two sync jobs live here. | `github.com/Jacy-the-Great/landiq-dashboard` |
| **Vercel** | Hosting. **Auto-deploys on every push to `main`.** No manual deploy. | `landiq-dashboard.vercel.app` |
| **Supabase** | Database + auth. Holds all dashboard data and user logins. | project `ysdonnjezvoyrrizadik` |
| **GitHub Actions** | Runs the two nightly data syncs (uses secrets stored in GitHub). | `.github/workflows/` |
| **Pipedrive** | CRM source (deals + people), pulled by the nightly sync. | `landiq.pipedrive.com` |
| **PostHog** | Product-usage source (events), summarised by the nightly sync. | us.posthog.com project `307005` |

Nothing here is tied to a specific computer. Editing anywhere → push → live.

```
  edit (any device) ──push──▶ GitHub ──auto-deploy──▶ Vercel (live site)
                                 │
                                 ├─ Action: Pipedrive sync (nightly) ─▶ Supabase
                                 └─ Action: PostHog sync   (nightly) ─▶ Supabase
```

---

## 2. Working from any device (Claude Code on the web)

1. Go to **claude.ai/code** and connect it to GitHub with access to
   `Jacy-the-Great/landiq-dashboard`. Grant the **`workflow`** scope — without it,
   Claude can't edit files under `.github/workflows/` (you'll get a
   "refusing to update workflow without workflow scope" error on push).
2. Start a session on the repo. Claude clones it into a cloud sandbox, edits
   `index.html`, and pushes — Vercel deploys automatically. The nightly syncs keep
   running in GitHub Actions regardless of where you're working.
3. You don't paste a "master prompt" — `CLAUDE.md` is auto-loaded, so every chat
   starts briefed. To focus a chat, just say so, e.g. *"Only working on the
   Marketing tab today."*

**The one rule for multiple chats:** the whole app is a single `index.html`, so two
chats editing it at the same time will conflict. Work **one focused change at a
time**: each chat should `git pull` first, make its change, push, and finish before
the next chat starts. For risky/parallel work, use a branch and open a PR.

**Suggested per-function split** (each is a self-contained area of the file):
Sales/OPTI-MAX · Marketing · Workstreams KPIs · Activity/PostHog · Data syncs
(`scripts/`). Tell the chat which one and it can grep straight to it.

**Local CLI still works too** — it's the same repo. Just `git pull` before editing
so web and local don't diverge.

---

## 3. Connectors, access & secrets

**Secrets live only in GitHub → Settings → Secrets and variables → Actions.** They
are never in the repo or in `index.html`.

| Secret | Used by | Get it from |
|---|---|---|
| `PIPEDRIVE_TOKEN` | Pipedrive sync | Pipedrive → avatar → Personal preferences → API |
| `PIPEDRIVE_DOMAIN` | Pipedrive sync | your subdomain: `landiq` |
| `POSTHOG_API_KEY` | PostHog sync | PostHog → personal API key |
| `POSTHOG_PROJECT_ID` | PostHog sync | PostHog project id (`307005`) |
| `SUPABASE_SERVICE_ROLE_KEY` | both syncs (DB writes) | Supabase → Project Settings → API → service_role |

In `index.html` there is a Supabase **anon** key — this is **public by design**
(safe to commit); row-level security limits it to logged-in reads. A determined
person can read the loaded data in their browser, so treat "hidden" items as
visibility/declutter, not secrecy (see §6).

> **Security rule:** never put a service-role key or API token in `index.html`, in
> a commit, or in a chat message. GitHub secrets are write-only — even you can't
> read them back, which is correct.

---

## 4. Deploying

Just push to `main`:

```bash
git add index.html && git commit -m "..." && git push
```

Vercel builds and deploys in ~30–60s. Verify it's live:

```bash
curl -s "https://landiq-dashboard.vercel.app/?_=$(date +%s)" | grep "some new text you added"
```

Editing files under `.github/workflows/` needs the `workflow` OAuth scope
(`gh auth refresh -h github.com -s workflow` on the CLI, or it's granted when you
connect Claude Code web).

---

## 5. The two data syncs

Both are Node scripts run nightly by GitHub Actions, writing into Supabase in the
same shape the dashboard already reads — so they need no dashboard changes.

### Pipedrive → Supabase  (`scripts/pipedrive-sync.mjs`)
- **Schedule:** 02:00 AEST daily (`.github/workflows/pipedrive-sync.yml`).
- **Writes:** `liq_pipedrive_deals`, `liq_pipedrive_people` (replaces both wholesale).
- Rebuilds CSV-style field names from Pipedrive's `/dealFields` + `/personFields`,
  so **custom fields you add in Pipedrive flow through automatically**.
- Also captures what a CSV export can't: product quantity/amount, and each deal's
  **stage history** (`Deal - Stages visited`) so lost deals count at the furthest
  stage reached.
- **Every run logs a sanity check** — pipeline breakdown, active-paid count,
  headline metrics, and field-coverage %. A bad sync (e.g. a field suddenly empty)
  shows up there. Setup details: [`scripts/PIPEDRIVE_SYNC.md`](../scripts/PIPEDRIVE_SYNC.md).

### PostHog → Supabase  (`scripts/posthog-sync.mjs`)
- **Schedule:** ~03:00 AEST daily (`.github/workflows/posthog-sync.yml`).
- **Writes:** `ph_weekly`, `ph_daily`, `ph_monthly`, `ph_lifecycle`, `ph_feature_*`.
- "Active users" = distinct **known people (by email)**, split into
  `active_users` (showed up) and `active_engaged` (did a real product action) — not
  raw distinct_ids, which include anonymous browsers/bots.

### Running a sync by hand / reading logs
```bash
gh workflow run "Pipedrive sync"          # or "PostHog summary sync"
gh run list --workflow="Pipedrive sync" --limit 1
gh run view <run-id> --log                # read the sanity-check output
```
Or in the browser: repo → **Actions** → pick the workflow → **Run workflow**.

Common failures: `401` = bad/expired token · `404` = wrong `PIPEDRIVE_DOMAIN` ·
a "column not present" warning = a pending SQL migration (the sync degrades
gracefully and keeps going).

---

## 6. Auth, users & roles

- Login is Supabase **email + password** — no email delivery required (Supabase's
  built-in auth email is unreliable, so don't rely on welcome/recovery mails).
- **Add a user:** Supabase → Authentication → Users → **Add user → Create new
  user** → set email + password, tick **Auto Confirm User**. Send them the URL +
  credentials directly. (Reset a password the same way.)
- **Roles:** `ADMIN_EMAILS` in `index.html` lists admins (currently
  `jacymacnee1@gmail.com`). Admins see everything incl. hidden items and get Review
  mode / Export / Import / Clear. Everyone else is a **viewer**: the dashboard
  minus whatever the admin has hidden, no admin controls, but can still edit values.
- **Hiding items:** admin turns on **Review mode**, clicks **hide** on any card /
  KPI / sub-tab / whole tab. That is exactly what viewers won't see.
- This is UI-level visibility, **not** a hard wall — all data still loads into every
  logged-in browser. Anything genuinely sensitive needs per-role rules at the
  database (row-level security), a separate, larger job.

---

## 7. Supabase reference

- Project: `ysdonnjezvoyrrizadik` · SQL editor:
  `supabase.com/dashboard/project/ysdonnjezvoyrrizadik/editor`
- **Tables:** `dashboard_data` (manual data), `dashboard_backups`,
  `liq_pipedrive_deals`, `liq_pipedrive_people`, `ph_weekly`, `ph_daily`,
  `ph_monthly`, `ph_lifecycle`, `ph_feature_daily`, `ph_feature_adoption_tbl`.
- **Migrations** = the `*.sql` files in the repo root. Each has a header saying when
  to run it; paste into the SQL editor and run once. They're safe to re-run
  (`if not exists`). Run any *pending* one when a sync logs a "column not present"
  warning.

---

## 8. Quick "how do I…" index

| Task | Where |
|---|---|
| Change a number/metric/UI | edit `index.html`, push, verify live (§4) |
| Refresh Pipedrive/PostHog data now | run the Action (§5) |
| Add a colleague's login | Supabase Auth (§6) |
| Make someone an admin | add their email to `ADMIN_EMAILS` in `index.html` |
| Hide something from viewers | Review mode → hide (§6) |
| See why a metric looks wrong | run the sync, read its sanity-check log (§5) |
| Add a Pipedrive custom field to the data | nothing — the sync picks it up nightly |
| Work from another device | Claude Code web on the repo (§2) |
