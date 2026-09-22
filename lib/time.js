// Time-tracking maths.
//
// These numbers feed real invoices, so this module is deliberately pure — no file
// access, no clock reads except the `now` passed in — which is what makes it testable.
// See time.test.js; tests were written before this file.
//
// Two conventions worth knowing:
//   - Timestamps are stored as UTC ISO strings. That's what keeps elapsed time correct
//     across a DST change, when wall-clock arithmetic would be wrong by an hour.
//   - A time entry with `end: null` is a RUNNING timer. There is at most one across all
//     clients (enforced in lib/clients.js), so an hour can't be billed twice.

const LONG_RUNNING_MS = 8 * 60 * 60 * 1000;

function isOpen(entry) {
  return Boolean(entry) && !entry.end;
}

function toTime(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Elapsed milliseconds. An open entry is measured up to `now`. Never negative. */
function durationMs(entry, now = new Date()) {
  if (!entry) return 0;
  const start = toTime(entry.start);
  if (start === null) return 0;

  const end = isOpen(entry) ? now.getTime() : toTime(entry.end);
  if (end === null) return 0;

  return Math.max(0, end - start);
}

/** Total across entries, including any running timer so the display stays live. */
function totalMs(entries, now = new Date()) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, e) => sum + durationMs(e, now), 0);
}

/** Local midnight on the Monday of the week containing `date`. */
function weekStartOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay(): Sunday is 0. Shift so Monday is 0 and Sunday is 6, otherwise Sunday
  // would be treated as the start of the coming week rather than the end of this one.
  const dayIndex = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayIndex);
  return d;
}

/**
 * Entries belonging to the current week, attributed by START time. A block begun on
 * Sunday night and finished on Monday counts once, to the week it began — never split
 * or double-counted.
 */
function entriesInWeekOf(entries, now = new Date()) {
  if (!Array.isArray(entries)) return [];
  const from = weekStartOf(now).getTime();
  return entries.filter((e) => {
    const start = toTime(e.start);
    return start !== null && start >= from;
  });
}

/** Human-readable duration: "1h 30m". Seconds round down — never invents a minute. */
function formatDuration(ms) {
  const safe = Math.max(0, Math.floor(ms));
  const totalMinutes = Math.floor(safe / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Decimal hours for an invoice line, to 2dp.
 *
 * Two rules, both learned the hard way:
 *   - Convert a SUMMED total, not entry by entry — rounding each entry first makes six
 *     10-minute sessions bill as 1.02h instead of 1h.
 *   - Truncate to whole minutes first, so this always agrees with what formatDuration
 *     shows. Otherwise a total of 2h30m52s displays as "2h 30m" but bills as 2.51h,
 *     and you invoice a number you never saw on screen.
 */
function billableHours(ms) {
  const wholeMinutes = Math.floor(Math.max(0, ms) / 60000);
  return Math.round((wholeMinutes / 60) * 100) / 100;
}

/**
 * What that time is worth, at `rate` per hour.
 *
 * Deliberately derived from `billableHours` — the same rounded figure shown on screen —
 * so the amount is always reproducible by hand as "hours × rate". Computing from raw
 * milliseconds instead would be a hair more precise but would put a number on an
 * invoice that doesn't match the hours printed beside it, which is the mistake that
 * already bit us once. Visible and checkable beats precise-but-unverifiable.
 *
 * Rounded to whole cents so floating-point crumbs never reach a money figure.
 */
function billableAmount(ms, rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.round(billableHours(ms) * r * 100) / 100;
}

/** Money for display: "€1,234.50". */
function formatMoney(amount) {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return `€${safe.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Throws if an entry could not have happened. Used before anything is saved. */
function validateEntry({ start, end }) {
  if (!start) throw new Error('A start time is required');

  const startTime = toTime(start);
  if (startTime === null) throw new Error('Invalid start time');

  if (end) {
    const endTime = toTime(end);
    if (endTime === null) throw new Error('Invalid end time');
    if (endTime < startTime) throw new Error('Entry end is before its start');
  }
  return true;
}

/** A running timer that's been going implausibly long — probably left on. */
function isLongRunning(entry, now = new Date()) {
  if (!isOpen(entry)) return false;
  return durationMs(entry, now) >= LONG_RUNNING_MS;
}

module.exports = {
  LONG_RUNNING_MS,
  isOpen,
  durationMs,
  totalMs,
  weekStartOf,
  entriesInWeekOf,
  formatDuration,
  billableHours,
  billableAmount,
  formatMoney,
  validateEntry,
  isLongRunning,
};
