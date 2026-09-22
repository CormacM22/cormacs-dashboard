const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const time = require('./time');

// Overridable so tests run against a throwaway directory and can never touch real
// client records.
const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, '..', 'data');
const CLIENTS_DIR = path.join(DATA_DIR, 'clients');
const FILES_DIR = path.join(DATA_DIR, 'files');

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function clientPath(slug) {
  return path.join(CLIENTS_DIR, `${slug}.json`);
}

function clientFilesDir(slug) {
  return path.join(FILES_DIR, slug);
}

function listClients() {
  return fs
    .readdirSync(CLIENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      // One unreadable file must not black out the whole dashboard — including the
      // running-timer display. Skip it loudly in the log and keep going.
      try {
        return withDefaults(JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, f), 'utf8')));
      } catch (err) {
        console.error(`Skipping unreadable client file ${f}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function getClient(slug) {
  const p = clientPath(slug);
  if (!fs.existsSync(p)) return null;
  return withDefaults(JSON.parse(fs.readFileSync(p, 'utf8')));
}

// Clients created before a field existed won't have it. Fill it in on read so callers
// never have to guard, and so older records keep working without a migration step.
function withDefaults(client) {
  // null means "inherit the default hourly rate" — see lib/settings.js effectiveRate.
  if (client.rate === undefined) client.rate = null;
  if (!Array.isArray(client.timeEntries)) client.timeEntries = [];
  if (!Array.isArray(client.todos)) client.todos = [];
  if (!Array.isArray(client.notes)) client.notes = [];
  return client;
}

function saveClient(client) {
  client.updatedAt = new Date().toISOString();

  // Write to a temp file then rename. Rename is atomic, so an interrupted write — a
  // crash, power loss, OneDrive or antivirus touching the file mid-save — can never
  // leave a half-written record. Writing in place would risk losing every entry, note
  // and to-do for that client, with nothing to restore from.
  const target = clientPath(client.slug);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(client, null, 2));
  fs.renameSync(tmp, target);
  return client;
}

function createClient({ name, contact, building }) {
  const slug = slugify(name);
  if (!slug) throw new Error('Client name required');
  if (getClient(slug)) throw new Error('A client with that name already exists');

  const client = {
    slug,
    name,
    contact: contact || '',
    building: building || '',
    money: 'not started',
    rate: null, // inherits the default hourly rate
    todos: [],
    notes: [],
    timeEntries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveClient(client);
  fs.mkdirSync(clientFilesDir(slug), { recursive: true });
  return client;
}

function listFiles(slug) {
  const dir = clientFilesDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((filename) => {
      const stat = fs.statSync(path.join(dir, filename));
      return { filename, size: stat.size, uploadedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// ---------- Time tracking ----------
//
// A running timer is a time entry with `end: null`. At most ONE exists across all
// clients: starting a timer stops any other first, so the same hour can never be
// billed to two clients. That invariant lives here because this is the only place
// entries are written.

/** Every open entry across every client. Should be 0 or 1 — more means corruption. */
function findOpenEntries() {
  const open = [];
  for (const client of listClients()) {
    for (const entry of client.timeEntries.filter(time.isOpen)) open.push({ client, entry });
  }
  return open;
}

/**
 * The running timer as { client, entry, conflicts }.
 *
 * `conflicts` lists ALL open entries. It should never have more than one item, but if
 * the invariant is ever broken — a hand-edited JSON file, a crash mid-write, a
 * OneDrive sync conflict copy — returning only the first would hide a second client
 * silently accruing billable hours. Surfacing it lets the UI warn instead.
 */
function findRunningTimer() {
  const open = findOpenEntries();
  if (open.length === 0) return null;
  return { client: open[0].client, entry: open[0].entry, conflicts: open };
}

/**
 * Starts a timer for a client. Returns { client, stopped } where `stopped` is the
 * other client's timer that had to be closed, if any — the caller should tell the
 * user, so a silent stop never looks like lost time.
 */
function startTimer(slug, note = '') {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');

  const open = findOpenEntries();

  // Already timing this client and nothing else is running: leave it alone rather than
  // restarting, which would discard the time accrued so far.
  if (open.length === 1 && open[0].client.slug === slug) {
    return { client: open[0].client, stopped: null, alreadyRunning: true };
  }

  // Close every other open entry, not just the first. If the invariant was already
  // broken, this is what repairs it — stopping only one would leave a second client
  // billing the same hours indefinitely, with nothing in the UI to reveal it.
  let stopped = null;
  const now = new Date().toISOString();
  for (const o of open) {
    if (o.client.slug === slug) continue;
    o.entry.end = now;
    time.validateEntry(o.entry); // a backwards clock step must fail loudly, not bill 0
    saveClient(o.client);
    if (!stopped) stopped = { slug: o.client.slug, name: o.client.name, entry: o.entry };
  }

  // A stray second entry on this same client (corruption) also gets closed.
  const strayOnThisClient = client.timeEntries.filter(time.isOpen);
  if (strayOnThisClient.length) {
    for (const e of strayOnThisClient) {
      e.end = now;
      time.validateEntry(e);
    }
    saveClient(client);
  }

  const entry = {
    id: crypto.randomUUID(),
    start: new Date().toISOString(),
    end: null,
    note: String(note || '').trim(),
  };
  time.validateEntry(entry);
  client.timeEntries.push(entry);
  saveClient(client);

  return { client, stopped, alreadyRunning: false };
}

function stopTimer(slug) {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');

  const entry = client.timeEntries.find(time.isOpen);
  if (!entry) throw new Error('No timer is running for this client');

  entry.end = new Date().toISOString();
  time.validateEntry(entry);
  return saveClient(client);
}

/** Rejects a start in the future — usually a mistyped year, which would otherwise
 *  land in this week's billable total. */
function assertNotFuture(start) {
  // A minute of slack absorbs ordinary clock skew.
  if (new Date(start).getTime() > Date.now() + 60000) {
    throw new Error('That start time is in the future — check the date');
  }
}

/**
 * Rejects an entry overlapping one already recorded for a different client. You can't
 * have worked for two clients in the same minute, and manual entry — reconstructing
 * untracked work from memory — is the likeliest way to double-bill an hour by accident.
 */
function assertNoOverlap(slug, start, end, ignoreId) {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();

  for (const other of listClients()) {
    for (const e of other.timeEntries) {
      if (e.id === ignoreId) continue;
      if (other.slug === slug && !e.end) continue;
      const eStart = new Date(e.start).getTime();
      const eEnd = e.end ? new Date(e.end).getTime() : Date.now();
      // Touching endpoints are fine: 09:00-10:00 then 10:00-11:00 doesn't overlap.
      if (from < eEnd && to > eStart) {
        throw new Error(
          `That overlaps time already logged for ${other.slug === slug ? 'this client' : other.name}`
        );
      }
    }
  }
}

/** Adds a completed entry by hand, for work that wasn't tracked live. */
function addTimeEntry(slug, { start, end, note }) {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');
  if (!end) throw new Error('A manual entry needs both a start and an end');

  time.validateEntry({ start, end });
  assertNotFuture(start);
  assertNoOverlap(slug, start, end);

  const entry = {
    id: crypto.randomUUID(),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    note: String(note || '').trim(),
  };
  client.timeEntries.push(entry);
  return saveClient(client);
}

function updateTimeEntry(slug, id, { start, end, note }) {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');

  const entry = client.timeEntries.find((e) => e.id === id);
  if (!entry) throw new Error('Time entry not found');

  const next = {
    start: start === undefined ? entry.start : start,
    end: end === undefined ? entry.end : end,
  };
  time.validateEntry(next);
  assertNotFuture(next.start);

  // Clearing the end turns a finished entry back into a running timer. If anything
  // else is already running, that puts two clients on the clock at once and the total
  // climbs without limit — the exact failure the one-timer rule exists to prevent.
  // The likely trigger is innocuous: opening a past entry to fix its note.
  const reopening = !next.end && entry.end;
  if (reopening) {
    const othersRunning = findOpenEntries().filter((o) => o.entry.id !== id);
    if (othersRunning.length) {
      throw new Error(
        'A timer is already running — stop it before reopening this entry. Only one timer runs at a time.'
      );
    }
  }

  if (next.end) assertNoOverlap(client.slug, next.start, next.end, id);

  entry.start = new Date(next.start).toISOString();
  entry.end = next.end ? new Date(next.end).toISOString() : null;
  if (note !== undefined) entry.note = String(note || '').trim();

  return saveClient(client);
}

function deleteTimeEntry(slug, id) {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');
  client.timeEntries = client.timeEntries.filter((e) => e.id !== id);
  return saveClient(client);
}

module.exports = {
  CLIENTS_DIR,
  FILES_DIR,
  slugify,
  clientFilesDir,
  listClients,
  getClient,
  saveClient,
  createClient,
  listFiles,
  findOpenEntries,
  findRunningTimer,
  startTimer,
  stopTimer,
  addTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
};
