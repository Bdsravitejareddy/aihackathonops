'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('../dist/display-format.js');

test('large INR values switch between millions and crores without changing the source number', () => {
  const source = 224532000;
  display.setMode('millions');
  assert.equal(display.money(source, 'INR/year'), '₹224.5M /year');
  display.setMode('crores');
  assert.equal(display.money(source, 'INR/year'), '₹22.45 Cr /year');
  assert.equal(source, 224532000);
});

test('small per-person values remain readable and population can be compacted', () => {
  display.setMode('millions');
  assert.equal(display.money(374.22, '₹/person/month'), '₹374.22 /person/month');
  assert.equal(display.count(85000), '85K');
  assert.equal(display.count(null), 'Unavailable');
});

test('currency mode rejects unknown values and persists only the display preference', () => {
  const previous = display.getMode();
  assert.equal(display.setMode('dollars'), previous);
});
