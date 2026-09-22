const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const time = require('./time');

const CLIENTS_DIR = path.join(__dirname, '..', 'data', 'clients');
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

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
    .map((f) => withDefaults(JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, f), 'utf8'))));
}

function getClient(slug) {
  const p = clientPath(slug);
  if (!fs.existsSync(p)) return null;
  return withDefaults(JSON.parse(fs.readFileSync(p, 'utf8')));
}

// Clients created before a field existed won't have it. Fill it in on read so callers
// never have to guard, and so older records keep working without a migration step.
function withDefaults(client) {
  if (!Array.isArray(client.timeEntries)) client.timeEntries = [];
  if (!Array.isArray(client.todos)) client.todos = [];
  if (!Array.isArray(client.notes)) client.notes = [];
  return client;
}

function saveClient(client) {
  client.updatedAt = new Date().toISOString();
  fs.writeFileSync(clientPath(client.slug), JSON.stringify(client, null, 2));
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

/** The one running timer, if any, as { client, entry }. */
function findRunningTimer() {
  for (const client of listClients()) {
    const entry = client.timeEntries.find(time.isOpen);
    if (entry) return { client, entry };
  }
  return null;
}

/**
 * Starts a timer for a client. Returns { client, stopped } where `stopped` is the
 * other client's timer that had to be closed, if any — the caller should tell the
 * user, so a silent stop never looks like lost time.
 */
function startTimer(slug, note = '') {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');

  let stopped = null;
  const running = findRunningTimer();
  if (running) {
    if (running.client.slug === slug) {
      // Already timing this client — don't restart and lose the accumulated time.
      return { client: running.client, stopped: null, alreadyRunning: true };
    }
    running.entry.end = new Date().toISOString();
    saveClient(running.client);
    stopped = { slug: running.client.slug, name: running.client.name, entry: running.entry };
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

/** Adds a completed entry by hand, for work that wasn't tracked live. */
function addTimeEntry(slug, { start, end, note }) {
  const client = getClient(slug);
  if (!client) throw new Error('Client not found');
  if (!end) throw new Error('A manual entry needs both a start and an end');

  time.validateEntry({ start, end });
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
  findRunningTimer,
  startTimer,
  stopTimer,
  addTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
};
