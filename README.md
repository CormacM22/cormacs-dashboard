# Cormac's Hub — Dashboard

A small, local-first dashboard for managing freelance client work. One place for what
you promised each client, when it's due, the notes and transcripts from your calls, and
the files that go with them — instead of it being scattered across separate chat
sessions, a voice recorder, a calendar and an inbox.

Built to run on one machine, for one person. No accounts, no cloud, no database.

## What it does

- **A hub per client** — contact, what you're building for them, and payment status.
- **To-dos / promises** — with due dates, so "what did I say I'd do, and by when" has
  an answer.
- **Notes & transcripts** — paste in a voice-note transcript or jot a note, dated.
- **Files** — drag and drop documents, PDFs and recordings against a client.
- **A briefing view** — across every client at once: what's due, what's overdue, and
  where each one stands on payment.

## How it's built

Deliberately small:

- **Node + Express** backend — a thin local server, no framework.
- **Plain HTML/CSS/JavaScript** frontend — no build step, no bundler.
- **One JSON file per client** as the data store — no database. At a handful of
  clients there's no query complexity that needs SQL, and plain files stay readable and
  diffable.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:4173>.

Client records are written to `data/clients/*.json` and uploaded files to
`data/files/<client>/`. Both are gitignored — this repo holds the application code
only.

### Keeping it running (Windows)

`start-dashboard.vbs` launches the server with no console window. Point a Task
Scheduler task at it with an "at logon" trigger to have the dashboard always available.
Add a repeating trigger with "ignore new instance if already running" as a keep-alive —
Task Scheduler's built-in restart-on-failure does not restart a long-running process
that exits badly, only one that fails to launch.

## A note on the network binding

The server binds to `127.0.0.1`, so it's reachable only from the machine it runs on.
That's deliberate: there is **no authentication**, and the app holds real client
contact details, notes and files. If you want to reach it from another device, add
authentication first, then change the bind address — not the other way round.

## Licence

MIT
