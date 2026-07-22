# Pipedrive auto-sync — setup

Replaces the manual "export CSV from Pipedrive → upload on the Import tab" step.
A GitHub Action runs nightly, pulls straight from the Pipedrive API, and writes
into the same Supabase tables the CSV import used — so every tab keeps working
exactly as-is, just with fresh data every morning.

**Runs at 02:00 AEST daily** (and you can trigger it manually any time).

---

## 1. Get your Pipedrive API token

In Pipedrive: click your avatar (top right) → **Personal preferences** → **API** →
copy your personal API token.

Also note your **company domain** — it's the first part of your Pipedrive URL.
If you log in at `https://landiq.pipedrive.com`, the domain is `landiq`.

## 2. Add two secrets to GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|------|-------|
| `PIPEDRIVE_TOKEN` | the API token from step 1 |
| `PIPEDRIVE_DOMAIN` | your subdomain, e.g. `landiq` |

`SUPABASE_SERVICE_ROLE_KEY` is already set from the PostHog sync — you don't need to add it again.

> **Keep the token out of the repo.** Only ever paste it into the GitHub secrets
> box. Don't put it in `index.html`, don't commit it, and don't paste it into a
> chat — anything in the dashboard's HTML is visible to everyone who opens the page.
> GitHub secrets are write-only: even you can't read them back afterwards.

## 3. Run it once by hand

Repo → **Actions** → **Pipedrive sync** → **Run workflow**.

It takes a few minutes (the per-deal passes are the slow part). When it's green,
reload the dashboard — the Sales tab should show your deals with no CSV upload.

If it fails, open the run and read the last lines. The usual causes:
- `401` → the token is wrong or expired
- `404` → the `PIPEDRIVE_DOMAIN` is wrong
- anything else → paste the log back to me and I'll fix the script

---

## What it syncs

| Table | Contents |
|-------|----------|
| `liq_pipedrive_deals` | every deal, with `Deal - …` fields matching the old CSV columns |
| `liq_pipedrive_people` | every person, with `Person - …` fields |

Field names are rebuilt from Pipedrive's own `/dealFields` and `/personFields`,
which return each field's human name. A CSV export names its columns
`Deal - <name>`, so the sync reproduces that generically — **custom fields you add
in Pipedrive later will flow through automatically**, no code change needed.

### Two things the CSV could never give us

- **`Deal - Product quantity` / `Product name` / `Product amount`** — pulled from
  each deal's attached products. This is what the licence numbers are built on.
- **`Deal - Max stage reached` / `Max stage order`** — the furthest stage each deal
  *ever* reached, read from its change history. A CSV export only carries the
  *current* stage, so a lost deal's journey was erased and the funnel's middle
  stages read low. This is exactly why the OPTI-MAX funnel counts have been typed
  in by hand from Pipedrive Insights — once this sync has run, they can come from
  the data instead.

---

## Notes

- **Safe to re-run.** Each run replaces the tables wholesale (delete + insert),
  the same as a CSV re-import. There's no partial/merge state to get stuck in.
- **Manual CSV import still works** — it writes to the same tables. Handy as a
  fallback, but a nightly sync will overwrite it.
- **Rate limits** are handled: requests run 5-at-a-time with automatic backoff and
  retry on HTTP 429.
- **Quick test run:** set `SKIP_DETAIL=1` to skip the slow per-deal product and
  stage-history passes.
