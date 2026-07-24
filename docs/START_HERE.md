# Start Here — working on this dashboard from any device

Simple steps to open a fully set-up, connected Claude Code chat for the Land iQ
dashboard. Everything (deploys, data syncs, database) is already wired through
GitHub — you only ever connect GitHub once.

---

## Part A — One-time setup (do once, ~5 min)

1. Go to **claude.ai/code** and sign in with your Claude account.
2. Choose to **connect GitHub**. Authorize it, and give it access to the
   **`Jacy-the-Great/landiq-dashboard`** repository.
3. If it offers a permissions/scope choice, make sure **`workflow`** is included —
   that's what lets Claude edit the nightly sync jobs. If you miss it, you can add
   it later; you'll just hit a "workflow scope" error the first time a chat touches
   `.github/workflows/`.

That's the whole setup — you never repeat it. Vercel (which deploys the site),
the Pipedrive/PostHog syncs, and Supabase are all already connected through GitHub,
so there is nothing else to hook up.

---

## Part B — Starting a new chat (every time, ~30 sec)

1. In Claude Code, **start a new session** and pick the **landiq-dashboard** repo.
2. It automatically loads `CLAUDE.md`, so it's already briefed on the project.
3. Send the first message below (change one line).

---

## Part C — Your first message (copy, paste, edit one line)

```
Read CLAUDE.md and skim the top of docs/DECISIONS.md before starting.

Today I'm working on: <the Marketing tab / OPTI-MAX / a number that looks wrong>.

Please git pull first, confirm what you're about to change before editing, and
after it's done: verify it live, then add a short entry to docs/DECISIONS.md.
```

Just change the `Today I'm working on:` line each time. Example:

```
Read CLAUDE.md and skim the top of docs/DECISIONS.md before starting.

Today I'm working on: the Marketing tab — the webinar attendance chart looks wrong.

Please git pull first, confirm what you're about to change before editing, and
after it's done: verify it live, then add a short entry to docs/DECISIONS.md.
```

---

## The one rule to remember

**One focused chat at a time.** The whole app is a single `index.html`, so don't
have two chats editing at once — let one finish and push before starting the next.
(The "git pull first" line in the template guards against this.)

---

## What each doc is (so you know where to point a chat)

| Doc | Use it for |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | Auto-loaded master brief — rules, navigation, conventions |
| [docs/OPERATIONS.md](OPERATIONS.md) | Connectors, secrets, deploy, syncs, auth/roles, working from web |
| [docs/DATA_CATALOGUE.md](DATA_CATALOGUE.md) | Every field/indicator from every data source |
| [docs/CODE_MAP.md](CODE_MAP.md) | Code structure, helpers, canvas-id rules, conventions |
| [docs/DECISIONS.md](DECISIONS.md) | The shared living log — read the top, append after real work |

- **On GitHub (phone-readable):** https://github.com/Jacy-the-Great/landiq-dashboard/tree/main/docs
- **Live dashboard:** https://landiq-dashboard.vercel.app
