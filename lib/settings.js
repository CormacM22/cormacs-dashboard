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
  const rate = Number(defaultRate);
  if (defaultRate === null || defaultRate === undefined || !Number.isFinite(rate)) {
    throw new Error('Hourly rate must be a number');
  }
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
  const own = client ? client.rate : null;
  if (own === null || own === undefined || own === '') return Number(settings.defaultRate) || 0;
  const r = Number(own);
  return Number.isFinite(r) && r >= 0 ? r : Number(settings.defaultRate) || 0;
}

module.exports = { SETTINGS_FILE, getSettings, saveSettings, effectiveRate };
