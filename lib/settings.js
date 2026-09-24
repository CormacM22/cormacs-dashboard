// App-level settings. Currently just the default hourly rate.
//
// Kept separate from client records because it isn't about any one client — it's the
// rate a new client inherits unless you set one specifically for them.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = { defaultRate: 0 };

function getSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    // Missing or unreadable: fall back rather than take the dashboard down. A wrong
    // rate would be worse than no rate, so the fallback is 0 — which shows no amount
    // at all instead of inventing one.
    return { ...DEFAULTS };
  }
}

function saveSettings({ defaultRate }) {
  // Only a real number or a numeric string. Number() alone would quietly turn [],
  // false and '' into 0 and true into 1 — saving a rate the caller never meant, while
  // the error message promised it had to be a number.
  const isNumber = typeof defaultRate === 'number';
  const isNumericString = typeof defaultRate === 'string' && defaultRate.trim() !== '' && Number.isFinite(Number(defaultRate));
  const isClearedField = defaultRate === ''; // the rate box, emptied: a deliberate zero

  if (!isNumber && !isNumericString && !isClearedField) {
    throw new Error('Hourly rate must be a number');
  }

  const rate = isClearedField ? 0 : Number(defaultRate);
  if (!Number.isFinite(rate)) throw new Error('Hourly rate must be a number');
  if (rate < 0) throw new Error('Hourly rate cannot be negative');

  const next = { ...getSettings(), defaultRate: rate };

  // Same atomic write as client records — a half-written settings file would mean
  // falling back to a 0 rate and silently showing no money anywhere.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  return next;
}

/**
 * The rate that actually applies to a client: their own if set, otherwise the default.
 *
 * Note this checks for null/undefined rather than falsiness — a deliberate rate of 0
 * (pro-bono, internal work) must bill zero, not silently inherit the default.
 */
function effectiveRate(client, settings = getSettings()) {
  // Clamped: a corrupt or hand-edited negative default must not bill a negative amount.
  const fallback = Math.max(0, Number(settings && settings.defaultRate)) || 0;

  const own = client ? client.rate : null;
  // Blank in any form — null, undefined, '' or whitespace — means "inherit". Untrimmed,
  // a whitespace rate used to read as 0 and silently make a client pro-bono.
  if (own === null || own === undefined || (typeof own === 'string' && own.trim() === '')) {
    return fallback;
  }

  const r = typeof own === 'number' || typeof own === 'string' ? Number(own) : NaN;
  return Number.isFinite(r) && r >= 0 ? r : fallback;
}

module.exports = { SETTINGS_FILE, getSettings, saveSettings, effectiveRate };
