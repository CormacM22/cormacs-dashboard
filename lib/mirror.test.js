// Guards the money maths duplicated between lib/time.js and public/app.js.
//
// The browser keeps its own copy of these functions so it can tick a live clock without
// a round trip — a trade-off accepted in knowledge/build/tooling-choices.md. The risk
// that buys is silent drift: someone edits one copy, the other keeps billing the old
// way, and nothing fails. An independent review flagged exactly this gap.
//
// This test pulls the real functions out of public/app.js and checks they agree with
// the server's across a wide sweep. It is deliberately a bit unusual — extracting
// functions from a browser file by name — because the alternative (a build step to
// share one module) is more machinery than this project wants.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const time = require('./time');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(APP_JS, 'utf8');

/** Pulls `function name(...) { ... }` out of the source by matching braces. */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `public/app.js no longer defines ${name}() — has it been renamed?`);

  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

// Rebuild the browser copies in isolation. appSettings is a module-level variable in
// the browser; effectiveRate closes over it, so it's declared here too.
const browser = new Function(`
  let appSettings = { defaultRate: 0 };
  ${extractFunction('billableHours')}
  ${extractFunction('billableAmount')}
  ${extractFunction('formatMoney')}
  ${extractFunction('effectiveRate')}
  return {
    billableHours, billableAmount, formatMoney, effectiveRate,
    setSettings: (s) => { appSettings = s; },
  };
`)();

const M = 60 * 1000;

test('mirror: billableHours agrees with the server for every minute up to 24h', () => {
  for (let minutes = 0; minutes <= 1440; minutes++) {
    assert.strictEqual(
      Number(browser.billableHours(minutes * M)),
      time.billableHours(minutes * M),
      `${minutes} minutes`
    );
  }
});

test('mirror: billableAmount agrees with the server across realistic rates', () => {
  const rates = [0, 7.5, 12.5, 20, 22.5, 37.5, 60, 85, 150];
  for (let minutes = 0; minutes <= 600; minutes += 1) {
    for (const rate of rates) {
      assert.strictEqual(
        browser.billableAmount(minutes * M, rate),
        time.billableAmount(minutes * M, rate),
        `${minutes}m at ${rate}/hr`
      );
    }
  }
});

test('mirror: billableAmount agrees on rejected rates too', () => {
  for (const rate of [null, undefined, -5, 'abc', NaN, Infinity]) {
    assert.strictEqual(
      browser.billableAmount(90 * M, rate),
      time.billableAmount(90 * M, rate),
      `rate ${String(rate)}`
    );
  }
});

test('mirror: formatMoney agrees with the server', () => {
  for (const amount of [0, 0.01, 26.6, 45, 600, 1234.5, 99999.99]) {
    assert.strictEqual(browser.formatMoney(amount), time.formatMoney(amount), `${amount}`);
  }
});

test('mirror: effectiveRate agrees with the server, including the tricky cases', () => {
  const settings = require('./settings');
  const cases = [null, undefined, '', '   ', 0, '0', 35, '35', -5, 'abc'];
  for (const defaultRate of [0, 20, 60]) {
    browser.setSettings({ defaultRate });
    for (const rate of cases) {
      assert.strictEqual(
        browser.effectiveRate({ rate }),
        settings.effectiveRate({ rate }, { defaultRate }),
        `rate ${JSON.stringify(rate)} with default ${defaultRate}`
      );
    }
  }
});
