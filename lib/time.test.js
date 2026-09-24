// Tests for the time-tracking maths.
//
// These numbers end up on real invoices, so this file is written first and deliberately
// covers the cases that quietly produce wrong money: entries spanning midnight, week
// boundaries, the clocks changing, an entry still running, and a timer left on
// overnight.
//
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert');

const {
  durationMs,
  isOpen,
  totalMs,
  weekStartOf,
  entriesInWeekOf,
  formatDuration,
  billableHours,
  billableAmount,
  formatMoney,
  validateEntry,
  isLongRunning,
  LONG_RUNNING_MS,
} = require('./time');

const H = 60 * 60 * 1000;
const M = 60 * 1000;

function entry(start, end, note) {
  return { id: 'x', start, end: end === undefined ? null : end, note: note || '' };
}

// ---------- durationMs ----------

test('durationMs: a simple closed entry', () => {
  const e = entry('2026-09-22T09:00:00.000Z', '2026-09-22T10:30:00.000Z');
  assert.strictEqual(durationMs(e), 90 * M);
});

test('durationMs: an open entry measures up to now, not zero', () => {
  const now = new Date('2026-09-22T11:00:00.000Z');
  const e = entry('2026-09-22T10:00:00.000Z', null);
  assert.strictEqual(durationMs(e, now), 1 * H);
});

test('durationMs: an entry spanning midnight is one continuous block', () => {
  const e = entry('2026-09-22T23:30:00.000Z', '2026-09-23T00:30:00.000Z');
  assert.strictEqual(durationMs(e), 1 * H);
});

test('durationMs: real elapsed time is correct across a DST change', () => {
  // Ireland puts clocks back 1h at 02:00 on 25 Oct 2026. Wall-clock 01:30->01:30
  // looks like zero but is really 1 hour. Storing UTC is what makes this work.
  const e = entry('2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z');
  assert.strictEqual(durationMs(e), 1 * H);
});

test('durationMs: never returns negative for a reversed entry', () => {
  const e = entry('2026-09-22T10:00:00.000Z', '2026-09-22T09:00:00.000Z');
  assert.strictEqual(durationMs(e), 0);
});

// ---------- isOpen ----------

test('isOpen: true only when there is no end', () => {
  assert.strictEqual(isOpen(entry('2026-09-22T09:00:00.000Z', null)), true);
  assert.strictEqual(isOpen(entry('2026-09-22T09:00:00.000Z', '2026-09-22T10:00:00.000Z')), false);
});

// ---------- totalMs ----------

test('totalMs: sums closed entries', () => {
  const entries = [
    entry('2026-09-22T09:00:00.000Z', '2026-09-22T10:00:00.000Z'),
    entry('2026-09-22T14:00:00.000Z', '2026-09-22T15:30:00.000Z'),
  ];
  assert.strictEqual(totalMs(entries), 150 * M);
});

test('totalMs: includes a running timer so the displayed total is live', () => {
  const now = new Date('2026-09-22T15:00:00.000Z');
  const entries = [
    entry('2026-09-22T09:00:00.000Z', '2026-09-22T10:00:00.000Z'),
    entry('2026-09-22T14:30:00.000Z', null),
  ];
  assert.strictEqual(totalMs(entries, now), 90 * M);
});

test('totalMs: empty list is zero, not NaN', () => {
  assert.strictEqual(totalMs([]), 0);
  assert.strictEqual(totalMs(undefined), 0);
});

// ---------- weeks ----------

// Weeks are a LOCAL concept - "this week" means Cormac's week, not UTC's. These tests
// build dates in local time on purpose so they assert the real intent and pass in any
// timezone. Using UTC strings here would make them wrong by an hour in Irish summer
// time, which is exactly the bug class that produces wrong weekly totals.
const local = (y, mIndex, d, h = 0, min = 0) => new Date(y, mIndex, d, h, min, 0, 0);
const localIso = (...args) => local(...args).toISOString();

test('weekStartOf: weeks run Monday to Sunday', () => {
  // 2026-09-22 is a Tuesday; its week starts Monday 2026-09-21.
  const ws = weekStartOf(local(2026, 8, 22, 11));
  assert.strictEqual(ws.getFullYear(), 2026);
  assert.strictEqual(ws.getMonth(), 8); // September
  assert.strictEqual(ws.getDate(), 21);
  assert.strictEqual(ws.getHours(), 0);
  assert.strictEqual(ws.getMinutes(), 0);
});

test('weekStartOf: Sunday belongs to the week that began the previous Monday', () => {
  // 2026-09-27 is a Sunday - must NOT roll forward to the 28th.
  assert.strictEqual(weekStartOf(local(2026, 8, 27, 11)).getDate(), 21);
});

test('weekStartOf: Monday is its own week start', () => {
  assert.strictEqual(weekStartOf(local(2026, 8, 21, 11)).getDate(), 21);
});

test('entriesInWeekOf: an entry is attributed to the week it STARTED in', () => {
  // Sunday-night-into-Monday work counts to the week it began, so the same block
  // can never be counted in two different weeks.
  const now = local(2026, 8, 23, 12); // Wednesday
  const sundayNight = entry(localIso(2026, 8, 20, 22), localIso(2026, 8, 21, 1));
  const thisWeek = entry(localIso(2026, 8, 22, 9), localIso(2026, 8, 22, 10));
  const got = entriesInWeekOf([sundayNight, thisWeek], now);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].start, thisWeek.start);
});

test('entriesInWeekOf: work just after local Monday midnight counts to the new week', () => {
  const now = local(2026, 8, 23, 12);
  const mondayJustAfterMidnight = entry(localIso(2026, 8, 21, 0, 30), localIso(2026, 8, 21, 2));
  assert.strictEqual(entriesInWeekOf([mondayJustAfterMidnight], now).length, 1);
});

test('entriesInWeekOf: excludes older weeks', () => {
  const now = local(2026, 8, 23, 12);
  const lastMonth = entry(localIso(2026, 7, 10, 9), localIso(2026, 7, 10, 17));
  assert.strictEqual(entriesInWeekOf([lastMonth], now).length, 0);
});

// ---------- formatting ----------

test('formatDuration: reads the way a person would say it', () => {
  assert.strictEqual(formatDuration(0), '0m');
  assert.strictEqual(formatDuration(45 * M), '45m');
  assert.strictEqual(formatDuration(1 * H), '1h');
  assert.strictEqual(formatDuration(90 * M), '1h 30m');
  assert.strictEqual(formatDuration(8 * H + 5 * M), '8h 5m');
});

test('formatDuration: seconds round down, never inventing a minute', () => {
  assert.strictEqual(formatDuration(59 * 1000), '0m');
  assert.strictEqual(formatDuration(119 * 1000), '1m');
});

// ---------- billing ----------

test('billableHours: decimal hours for invoicing', () => {
  assert.strictEqual(billableHours(90 * M), 1.5);
  assert.strictEqual(billableHours(1 * H), 1);
  assert.strictEqual(billableHours(0), 0);
});

test('billableHours: rounds to 2dp so invoice lines are exact', () => {
  // 1h 20m = 1.3333... hours
  assert.strictEqual(billableHours(80 * M), 1.33);
  // 10 minutes = 0.1666...
  assert.strictEqual(billableHours(10 * M), 0.17);
});

test('billableHours: agrees with what formatDuration displays', () => {
  // Found in testing: a total of 2h30m52s displayed as "2h 30m" but billed as 2.51h.
  // Reading one number and invoicing a different one is a real way to bill wrong, and
  // sub-minute precision is meaningless anyway — both must come from whole minutes.
  const ms = (2 * H) + (30 * M) + (52 * 1000);
  assert.strictEqual(formatDuration(ms), '2h 30m');
  assert.strictEqual(billableHours(ms), 2.5);
});

test('billableHours: ignores stray seconds rather than rounding them up', () => {
  assert.strictEqual(billableHours(59 * 1000), 0);
  assert.strictEqual(billableHours(1 * H + 59 * 1000), 1);
});

test('billableHours: many small sessions do not drift', () => {
  // Six 10-minute blocks are exactly 1 hour. Summing durations before converting
  // avoids the per-entry rounding error that would give 1.02.
  const entries = Array.from({ length: 6 }, () =>
    entry('2026-09-22T09:00:00.000Z', '2026-09-22T09:10:00.000Z')
  );
  assert.strictEqual(billableHours(totalMs(entries)), 1);
});

// ---------- money ----------

test('billableAmount: the headline case - 30 hours at 20/hr', () => {
  assert.strictEqual(billableAmount(30 * H, 20), 600);
});

test('billableAmount: ALWAYS equals the hours shown on screen times the rate', () => {
  // The lesson from the earlier "2h 30m displayed, 2.51 h billed" bug: never show one
  // number and charge from another. The amount must be reproducible by hand from what
  // is on the screen, or it can't be trusted on an invoice.
  for (const ms of [80 * M, 10 * M, 137 * M, 3 * H + 7 * M, 59 * 1000]) {
    for (const rate of [20, 37.5, 85]) {
      const shown = billableHours(ms);
      assert.strictEqual(
        billableAmount(ms, rate),
        Math.round(shown * rate * 100) / 100,
        `${ms}ms at ${rate}/hr must equal ${shown} x ${rate}`
      );
    }
  }
});

test('billableAmount: no floating-point crumbs', () => {
  // 0.1 * 3 style errors must never reach a money figure.
  assert.strictEqual(billableAmount(6 * M, 0.3), 0.03);
  assert.strictEqual(Number.isInteger(billableAmount(30 * H, 20)), true);
});

test('billableAmount: matches the displayed hours even when that loses a cent', () => {
  // 20 minutes at 3/hr is "really" 1.00, but the screen shows 0.33 h, and 0.33 x 3 is
  // 0.99. We take the visible number. This is the deliberate cost of the rule that the
  // amount must always be reproducible by hand from what's on screen — a cent of drift
  // on a total is cheaper than an invoice you can't explain to a client.
  assert.strictEqual(billableHours(20 * M), 0.33);
  assert.strictEqual(billableAmount(20 * M, 3), 0.99);
});

test('billableAmount: zero time or no rate is zero, never NaN', () => {
  assert.strictEqual(billableAmount(0, 20), 0);
  assert.strictEqual(billableAmount(5 * H, 0), 0);
  assert.strictEqual(billableAmount(5 * H, null), 0);
  assert.strictEqual(billableAmount(5 * H, undefined), 0);
  assert.strictEqual(billableAmount(5 * H, 'not a number'), 0);
});

test('billableAmount: a negative rate cannot produce a negative bill', () => {
  assert.strictEqual(billableAmount(5 * H, -20), 0);
});

test('billableAmount: a half-cent rounds up, not down by float luck', () => {
  // Review finding: Math.round on a binary float rounds an exact half-cent by luck.
  // 0.03 h x 7.5 = 0.225 -> must be 0.23, but float made it 0.22 in 3.3% of
  // minute/rate combinations. A cent, never compounding, but it's money.
  assert.strictEqual(billableAmount(2 * M, 7.5), 0.23);
  assert.strictEqual(billableAmount(3 * M, 12.5), 0.63); // 0.05 x 12.5 = 0.625
});

test('billableAmount: no minute/rate combination disagrees with a half-up calculation', () => {
  const rates = [7.5, 12.5, 20, 22.5, 37.5, 60, 85];
  for (let minutes = 1; minutes <= 600; minutes++) {
    for (const rate of rates) {
      const hours = billableHours(minutes * M);
      const expected = Math.round((hours * rate * 100).toFixed(6)) / 100;
      assert.strictEqual(
        billableAmount(minutes * M, rate),
        expected,
        `${minutes}m at ${rate}/hr`
      );
    }
  }
});

test('formatMoney: two decimals, euro symbol, thousands separated', () => {
  assert.strictEqual(formatMoney(600), '€600.00');
  assert.strictEqual(formatMoney(26.6), '€26.60');
  assert.strictEqual(formatMoney(0), '€0.00');
  assert.strictEqual(formatMoney(1234.5), '€1,234.50');
});

// ---------- validation ----------

test('validateEntry: rejects an end before the start', () => {
  assert.throws(
    () => validateEntry({ start: '2026-09-22T10:00:00.000Z', end: '2026-09-22T09:00:00.000Z' }),
    /end.*before.*start/i
  );
});

test('validateEntry: rejects unparseable dates', () => {
  assert.throws(() => validateEntry({ start: 'not a date', end: null }), /invalid/i);
  assert.throws(() => validateEntry({ start: '2026-09-22T09:00:00.000Z', end: 'nope' }), /invalid/i);
});

test('validateEntry: requires a start', () => {
  assert.throws(() => validateEntry({ start: null, end: null }), /start/i);
});

test('validateEntry: accepts a valid open entry', () => {
  assert.doesNotThrow(() => validateEntry({ start: '2026-09-22T09:00:00.000Z', end: null }));
});

// ---------- forgotten timers ----------

test('isLongRunning: flags a timer left on overnight', () => {
  const now = new Date('2026-09-23T09:00:00.000Z');
  const overnight = entry('2026-09-22T18:00:00.000Z', null); // 15 hours
  assert.strictEqual(isLongRunning(overnight, now), true);
});

test('isLongRunning: a normal working stretch is not flagged', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');
  assert.strictEqual(isLongRunning(entry('2026-09-22T09:00:00.000Z', null), now), false);
});

test('isLongRunning: only applies to running timers, not finished ones', () => {
  const now = new Date('2026-09-23T09:00:00.000Z');
  const longButFinished = entry('2026-09-22T06:00:00.000Z', '2026-09-22T20:00:00.000Z');
  assert.strictEqual(isLongRunning(longButFinished, now), false);
});

test('LONG_RUNNING_MS is 8 hours', () => {
  assert.strictEqual(LONG_RUNNING_MS, 8 * H);
});
