// Tests for the stateful bookkeeping around time entries.
//
// An independent review found that test-first had been applied to the easy pure maths
// in time.js and skipped on exactly the logic that protects the money — the
// "one running timer" invariant lives here, and every serious defect it found was in
// this file. These tests close that gap.
//
// They run against a throwaway data directory, never real client records.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-clients-test-'));
process.env.DASHBOARD_DATA_DIR = TMP;

const clients = require('./clients');
const time = require('./time');

fs.mkdirSync(path.join(TMP, 'clients'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'files'), { recursive: true });

function reset() {
  for (const f of fs.readdirSync(path.join(TMP, 'clients'))) {
    fs.unlinkSync(path.join(TMP, 'clients', f));
  }
  clients.createClient({ name: 'Alpha Co' });
  clients.createClient({ name: 'Zulu Co' });
}

function openEntriesEverywhere() {
  return clients
    .listClients()
    .flatMap((c) => c.timeEntries.filter(time.isOpen).map((e) => ({ slug: c.slug, id: e.id })));
}

// ---------- the core invariant: one running timer, ever ----------

test('startTimer: starting one client stops any other client\'s timer', () => {
  reset();
  clients.startTimer('alpha-co');
  const res = clients.startTimer('zulu-co');

  assert.strictEqual(res.stopped.slug, 'alpha-co', 'should report which timer it stopped');
  assert.deepStrictEqual(
    openEntriesEverywhere().map((e) => e.slug),
    ['zulu-co'],
    'exactly one timer may run across all clients'
  );
});

test('startTimer: pressing start twice on the same client does not lose accrued time', () => {
  reset();
  const first = clients.startTimer('alpha-co');
  const startedAt = first.client.timeEntries[0].start;

  const second = clients.startTimer('alpha-co');
  assert.strictEqual(second.alreadyRunning, true);
  assert.strictEqual(openEntriesEverywhere().length, 1);
  assert.strictEqual(
    clients.getClient('alpha-co').timeEntries[0].start,
    startedAt,
    'the original start must survive - restarting would silently discard elapsed time'
  );
});

test('stopTimer then startTimer leaves exactly one closed entry and one open', () => {
  reset();
  clients.startTimer('alpha-co');
  clients.stopTimer('alpha-co');
  clients.startTimer('alpha-co');

  const entries = clients.getClient('alpha-co').timeEntries;
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries.filter(time.isOpen).length, 1);
});

// ---------- H1: editing must not be able to open a second timer ----------

test('updateTimeEntry: clearing the end of a finished entry is rejected while another timer runs', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:00.000Z',
    end: '2026-09-21T10:00:00.000Z',
    note: 'past work',
  });
  clients.startTimer('zulu-co');

  const id = clients.getClient('alpha-co').timeEntries[0].id;
  assert.throws(
    () => clients.updateTimeEntry('alpha-co', id, { end: null }),
    /already running|only one/i,
    'reopening a past entry would put two clients on the clock at once'
  );
  assert.strictEqual(openEntriesEverywhere().length, 1);
});

test('updateTimeEntry: cannot create a second open entry on the same client', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:00.000Z',
    end: '2026-09-21T10:00:00.000Z',
  });
  clients.startTimer('alpha-co');

  const closed = clients.getClient('alpha-co').timeEntries.find((e) => e.end);
  assert.throws(() => clients.updateTimeEntry('alpha-co', closed.id, { end: null }), /already running|only one/i);
  assert.strictEqual(openEntriesEverywhere().length, 1);
});

test('updateTimeEntry: editing only the note leaves the times untouched', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:59.000Z',
    end: '2026-09-21T10:30:01.000Z',
  });
  const before = clients.getClient('alpha-co').timeEntries[0];

  clients.updateTimeEntry('alpha-co', before.id, { note: 'renamed' });
  const after = clients.getClient('alpha-co').timeEntries[0];

  assert.strictEqual(after.start, before.start);
  assert.strictEqual(after.end, before.end);
  assert.strictEqual(after.note, 'renamed');
});

// ---------- H2: a broken invariant must be visible and repairable ----------

test('findRunningTimer: reports ALL open entries, not just the first', () => {
  reset();
  // Simulate a corrupted state (hand-edited JSON, or a crash mid-write).
  const a = clients.getClient('alpha-co');
  a.timeEntries.push({ id: 'a1', start: new Date().toISOString(), end: null, note: '' });
  clients.saveClient(a);
  const z = clients.getClient('zulu-co');
  z.timeEntries.push({ id: 'z1', start: new Date().toISOString(), end: null, note: '' });
  clients.saveClient(z);

  const running = clients.findRunningTimer();
  assert.ok(running, 'should still report a timer');
  assert.strictEqual(running.conflicts.length, 2, 'both stray timers must be surfaced, not hidden');
});

test('startTimer: repairs a broken invariant by closing every stray timer', () => {
  reset();
  const a = clients.getClient('alpha-co');
  a.timeEntries.push({ id: 'a1', start: new Date().toISOString(), end: null, note: '' });
  clients.saveClient(a);
  const z = clients.getClient('zulu-co');
  z.timeEntries.push({ id: 'z1', start: new Date().toISOString(), end: null, note: '' });
  clients.saveClient(z);

  clients.startTimer('alpha-co');
  assert.strictEqual(
    openEntriesEverywhere().length,
    1,
    'starting a timer must leave exactly one running, even from a corrupt state'
  );
});

// ---------- M2: the same hour must not be billable twice ----------

test('addTimeEntry: rejects a manual entry that overlaps another client', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:00.000Z',
    end: '2026-09-21T11:00:00.000Z',
  });
  assert.throws(
    () =>
      clients.addTimeEntry('zulu-co', {
        start: '2026-09-21T09:30:00.000Z',
        end: '2026-09-21T10:30:00.000Z',
      }),
    /overlap/i,
    'you cannot have worked for two clients at the same moment'
  );
});

test('addTimeEntry: back-to-back entries do not count as overlapping', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:00.000Z',
    end: '2026-09-21T10:00:00.000Z',
  });
  assert.doesNotThrow(() =>
    clients.addTimeEntry('zulu-co', {
      start: '2026-09-21T10:00:00.000Z',
      end: '2026-09-21T11:00:00.000Z',
    })
  );
});

// ---------- M3 / L4: bad times must fail loudly, not silently become zero ----------

test('addTimeEntry: rejects a start in the future', () => {
  reset();
  const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  assert.throws(
    () => clients.addTimeEntry('alpha-co', { start: future, end: future }),
    /future/i,
    'a typo in the year would otherwise land in this week\'s billable total'
  );
});

test('updateTimeEntry: rejects an end before the start', () => {
  reset();
  clients.addTimeEntry('alpha-co', {
    start: '2026-09-21T09:00:00.000Z',
    end: '2026-09-21T10:00:00.000Z',
  });
  const id = clients.getClient('alpha-co').timeEntries[0].id;
  assert.throws(
    () => clients.updateTimeEntry('alpha-co', id, { end: '2026-09-21T08:00:00.000Z' }),
    /before/i
  );
});

// ---------- H3: a crash must not destroy a client's history ----------

test('saveClient: a corrupt file does not take down every other client', () => {
  reset();
  fs.writeFileSync(path.join(TMP, 'clients', 'broken.json'), '{ this is not json');

  const listed = clients.listClients().map((c) => c.slug);
  assert.ok(listed.includes('alpha-co'), 'good records must still load');
  assert.ok(!listed.includes('broken'), 'the unreadable one is skipped, not fatal');

  fs.unlinkSync(path.join(TMP, 'clients', 'broken.json'));
});

test('saveClient: writes atomically, leaving no partial file behind', () => {
  reset();
  const c = clients.getClient('alpha-co');
  c.notes.push({ id: 'n1', text: 'x'.repeat(50000), date: new Date().toISOString() });
  clients.saveClient(c);

  const leftovers = fs.readdirSync(path.join(TMP, 'clients')).filter((f) => !f.endsWith('.json'));
  assert.deepStrictEqual(leftovers, [], 'no .tmp files should survive a successful write');
  assert.strictEqual(clients.getClient('alpha-co').notes[0].text.length, 50000);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
