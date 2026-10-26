'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// calendarMonths lives in the browser bundle; load just that function from dist/app.js.
const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.js'), 'utf8');
const body = source.match(/function calendarMonths[\s\S]*?return whole\+\(end-anchor\)\/\(next-anchor\);\}/)[0];
const calendarMonths = new Function(`${body};return calendarMonths;`)();

test('time to reach potential counts calendar months, so 1 Jan to 1 Jul is exactly 6.0', () => {
  assert.equal(calendarMonths('2026-01-01', '2026-07-01').toFixed(1), '6.0');
  assert.equal(calendarMonths('2026-01-31', '2026-02-28'), 1);
  assert.equal(calendarMonths('2026-03-15', '2026-03-15'), 0);
  assert.equal(calendarMonths('2025-11-10', '2026-05-25').toFixed(2), '6.48');
});

test('missing, malformed or reversed dates give no value', () => {
  assert.equal(calendarMonths('2026-02-01', '2026-01-01'), null);
  assert.equal(calendarMonths('', '2026-01-01'), null);
  assert.equal(calendarMonths('01/01/2026', '2026-07-01'), null);
});
