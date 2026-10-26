'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_NATIONAL_DOMAIN,
  MISSING_COLOR,
  interpolateColor,
  getScaleDomain,
  createColorScale,
  colorForValue,
  legendLabels
} = require('../dist/market-color-scale.js');

test('interpolation follows the perceptual ramp and clamps its position', () => {
  assert.equal(interpolateColor(0), '#440154');
  assert.equal(interpolateColor(1), '#fde725');
  assert.equal(interpolateColor(-1), '#440154');
  assert.equal(interpolateColor(2), '#fde725');
  assert.notEqual(interpolateColor(0.5), '#808080');
  const lightness = color => {
    const channels = color.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const samples = Array.from({ length: 21 }, (_, index) => lightness(interpolateColor(index / 20)));
  assert.ok(samples.every((value, index) => index === 0 || value > samples[index - 1]));
});

test('national domain stays fixed by default and declares its scope', () => {
  const scale = createColorScale({ values: [100, 900] });
  assert.deepEqual(scale.domain, DEFAULT_NATIONAL_DOMAIN);
  assert.deepEqual(getScaleDomain([100, 900]), DEFAULT_NATIONAL_DOMAIN);
  assert.equal(scale.metadata.scope, 'national');
  assert.match(scale.metadata.label, /national.*fixed/i);
});

test('local domain is derived from supplied observations and explicitly labeled', () => {
  const scale = createColorScale({ values: [5, 20, 12], scope: 'local' });
  assert.deepEqual(scale.domain, [5, 20]);
  assert.equal(scale.metadata.scope, 'local');
  assert.match(scale.metadata.label, /local.*varies by selection/i);
});

test('linear, logarithmic, and percentile modes map the same values differently', () => {
  const values = [1, 10, 100];
  const linear = createColorScale({ values, domain: [1, 100] });
  const logarithmic = createColorScale({ values, mode: 'log', domain: [1, 100] });
  const percentile = createColorScale({ values, mode: 'percentile', scope: 'local' });
  assert.equal(colorForValue(10, linear), interpolateColor(9 / 99));
  assert.equal(colorForValue(10, logarithmic), interpolateColor(0.5));
  assert.equal(colorForValue(10, percentile), interpolateColor(0.5));
  assert.equal(colorForValue(0, logarithmic), colorForValue(1, logarithmic));
});

test('quantile is a continuous percentile mapping with tied values sharing a rank', () => {
  const scale = createColorScale({ values: [1, 2, 2, 4], mode: 'quantile', scope: 'local' });
  assert.equal(colorForValue(2, scale), interpolateColor(0.5));
  assert.equal(colorForValue(3, scale), interpolateColor(5 / 6));
});

test('missing values alone receive reserved gray; zero remains measurable', () => {
  const scale = createColorScale({ values: [0, 1], domain: [0, 1] });
  for (const value of [null, undefined, NaN, Infinity, '']) {
    assert.equal(colorForValue(value, scale), MISSING_COLOR);
  }
  assert.equal(colorForValue(0, scale), interpolateColor(0));
});

test('legend labels expose domain endpoints and metadata without sample metric claims', () => {
  const scale = createColorScale({ domain: [10, 90], unit: 'units' });
  assert.deepEqual(legendLabels(scale, 3, { unit: 'units' }), [
    { value: 10, label: '10 units' },
    { value: 50, label: '50 units' },
    { value: 90, label: '90 units' }
  ]);
  assert.match(scale.metadata.label, /national.*fixed/i);
});

test('module loads as a browser global without CommonJS', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/market-color-scale.js'), 'utf8'), context);
  assert.equal(typeof context.MarketColorScale.createColorScale, 'function');
  assert.equal(context.MarketColorScale.MISSING_COLOR, MISSING_COLOR);
});
