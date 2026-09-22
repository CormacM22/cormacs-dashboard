// Tests for app-level settings — currently just the default hourly rate.
//
// This feeds invoice amounts, so it gets the same treatment as the rest of the billing
// path: a bad rate must fail loudly rather than quietly producing a wrong figure.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-settings-test-'));
process.env.DASHBOARD_DATA_DIR = TMP;
fs.mkdirSync(path.join(TMP, 'clients'), { recursive: true });

const settings = require('./settings');

test('getSettings: works before the file exists', () => {
  const s = settings.getSettings();
  assert.strictEqual(typeof s.defaultRate, 'number');
  assert.ok(s.defaultRate >= 0);
});

test('saveSettings: round-trips the default rate', () => {
  settings.saveSettings({ defaultRate: 45 });
  assert.strictEqual(settings.getSettings().defaultRate, 45);
});

test('saveSettings: accepts a fractional rate', () => {
  settings.saveSettings({ defaultRate: 37.5 });
  assert.strictEqual(settings.getSettings().defaultRate, 37.5);
});

test('saveSettings: rejects a negative rate', () => {
  assert.throws(() => settings.saveSettings({ defaultRate: -10 }), /rate/i);
});

test('saveSettings: rejects a non-numeric rate rather than storing NaN', () => {
  assert.throws(() => settings.saveSettings({ defaultRate: 'twenty' }), /rate/i);
  assert.throws(() => settings.saveSettings({ defaultRate: null }), /rate/i);
});

test('getSettings: a corrupt settings file falls back to the default instead of crashing', () => {
  fs.writeFileSync(path.join(TMP, 'settings.json'), '{ not json');
  const s = settings.getSettings();
  assert.strictEqual(typeof s.defaultRate, 'number');
});

// ---------- which rate actually applies to a client ----------

test('effectiveRate: a client with no rate of its own inherits the default', () => {
  assert.strictEqual(settings.effectiveRate({ rate: null }, { defaultRate: 20 }), 20);
  assert.strictEqual(settings.effectiveRate({}, { defaultRate: 20 }), 20);
});

test('effectiveRate: a client rate overrides the default', () => {
  assert.strictEqual(settings.effectiveRate({ rate: 35 }, { defaultRate: 20 }), 35);
});

test('effectiveRate: an explicit zero is honoured, not treated as "unset"', () => {
  // Pro-bono or internal work should bill zero, not silently fall back to €20/hr.
  assert.strictEqual(settings.effectiveRate({ rate: 0 }, { defaultRate: 20 }), 0);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
