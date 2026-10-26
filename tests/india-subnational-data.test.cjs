'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rasterize, pixelZones, calibrateUrban, zonalStats, cellAreaKm2 } = require('../scripts/india-population-grid.cjs');
const { parseCsv, cleanOffices, anchorsFor, readPinArtifact, expandPinFeature } = require('../scripts/build-india-pins.cjs');
const { normalizeFeature } = require('../server/market-map-store.cjs');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, 'data/india-geography', file), 'utf8'));
// Synthetic grids use 1-degree cells with the north-west corner at (70E, 20N); row 0 is the north edge.
const grid = (width, height, values) => ({ width, height, west: 70, north: 20, dx: 1, dy: 1, values: Float32Array.from(values) });
const rect = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

test('rasterize and zonalStats conserve population on a 4x4 grid', () => {
  const g = grid(4, 4, Array.from({ length: 16 }, (_, i) => (i + 1) * 10));
  const total = g.values.reduce((s, v) => s + v, 0);
  const leftHalf = [0, 1, 2, 3].reduce((s, r) => s + g.values[r * 4] + g.values[r * 4 + 1], 0);

  let viaRasterize = 0;
  rasterize(g, rect(70, 16, 74, 20), 4, (row, col, weight) => { viaRasterize += g.values[row * g.width + col] * weight; });
  assert.ok(Math.abs(viaRasterize - total) < 1e-6);

  const [whole, left] = zonalStats(g, [{ geometry: rect(70, 16, 74, 20) }, { geometry: rect(70, 16, 72, 20) }], { subdivisions: 4 });
  assert.ok(Math.abs(whole.population - total) < 1e-6);
  assert.ok(Math.abs(left.population - leftHalf) < 1e-6);

  // Quarter of cell row 1, column 2 (lon 72-73, lat 18-19): the 0.5-degree square covers one quarter of it.
  const [quarter] = zonalStats(g, [{ geometry: rect(72, 18, 72.5, 18.5) }], { subdivisions: 4 });
  assert.ok(Math.abs(quarter.population - g.values[1 * 4 + 2] / 4) < 1e-6);
});

test('calibrateUrban marks the densest cells first until the target urban share is reached', () => {
  const g = grid(3, 1, [100, 300, 600]);
  const zones = Int32Array.from([0, 0, 0]);
  const half = calibrateUrban(g, zones, [0.5]);
  assert.deepEqual(Array.from(half.urban), [0, 0, 1]);
  assert.equal(half.thresholds[0], Math.round(600 / cellAreaKm2(g, 0)));
  // 80% of 1000 needs the 600 and 300 cells; the 100 cell stays rural.
  assert.deepEqual(Array.from(calibrateUrban(g, zones, [0.8]).urban), [0, 1, 1]);
});

test('parseCsv handles quoted fields with commas, doubled quotes and CRLF', () => {
  const rows = parseCsv('name,address,pin\r\n"Smith, John","He said ""hi""",560001\r\n');
  assert.deepEqual(rows, [{ name: 'Smith, John', address: 'He said "hi"', pin: '560001' }]);
});

test('cleanOffices repairs swapped coordinates, drops wrong-state points and infers NA states', () => {
  // Karnataka covers lon 70-74 (columns 0-3), Kerala lon 74-80 (columns 4-9), both lat 16-20.
  const g = grid(10, 4, new Array(40).fill(1000));
  const states = [
    { properties: { name: 'Karnataka' }, geometry: rect(70, 16, 74, 20) },
    { properties: { name: 'Kerala' }, geometry: rect(74, 16, 80, 20) }
  ];
  const zones = pixelZones(g, states);
  const office = (pincode, statename, latitude, longitude) => ({ pincode, statename, district: 'D', officename: 'O', delivery: 'Delivery', latitude, longitude });
  const offices = [
    office('560001', 'Karnataka', '17.5', '70.5'),
    office('560002', 'Karnataka', '70.5', '17.5'),
    office('560003', 'Karnataka', '17.5', '79.5'),
    office('560004', 'NA', '17.5', '72.5'),
    office('560005', 'Kerala', 'n/a', '76.5')
  ];
  const { cleaned, counts } = cleanOffices(offices, g, zones, states);
  assert.equal(counts.swappedRepaired, 1);
  assert.equal(counts.wrongState, 1);
  assert.equal(counts.stateInferred, 1);
  assert.equal(counts.missingCoordinates, 1);
  assert.equal(counts.valid, 3);
  const byPin = pin => cleaned.find(r => r.pin === pin);
  assert.deepEqual([byPin('560002').lon, byPin('560002').lat], [70.5, 17.5]);
  assert.equal(byPin('560003').lon, null);
  assert.equal(byPin('560004').declared, 0);
  assert.equal(byPin('560005').lon, null);
});

test('anchorsFor places each PIN at the median of its delivery offices', () => {
  const base = { pin: '560001', declared: 0, district: 'Bengaluru' };
  const cleaned = [
    { ...base, office: 'A', delivery: true, lon: 70.2, lat: 17.0 },
    { ...base, office: 'B', delivery: true, lon: 70.6, lat: 18.0 },
    { ...base, office: 'C', delivery: true, lon: 71.0, lat: 17.5 },
    { ...base, office: 'D', delivery: false, lon: 79.5, lat: 19.0 },
    { pin: '560009', declared: 0, district: 'Bengaluru', office: 'E', delivery: true, lon: null, lat: null }
  ];
  const { pins, missing } = anchorsFor(cleaned);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].pin, '560001');
  assert.equal(pins[0].lon, 70.6);
  assert.equal(pins[0].lat, 17.5);
  assert.deepEqual(missing.map(m => m.pin), ['560009']);
});

test('normalizeFeature derives potentialRevenue from the modelled expenditure and organised store share', () => {
  const pin = {
    external_id: 'pin:560001', kind: 'pin', name: '560001', area_km2: 2,
    properties: { population: 1000, populationReferenceYear: 2020, annualApparelExpenditure: 1200000, organisedStoreShare: 0.3198 }
  };
  const pinRevenue = normalizeFeature(pin, 'potentialRevenue').metrics.potentialRevenue;
  assert.equal(pinRevenue.value, 1200000 * 0.3198);
  assert.equal(pinRevenue.unit, 'INR/year');

  const state = {
    external_id: 'state:IN-KA', kind: 'state', name: 'Karnataka', area_km2: 1,
    properties: { population: 1000, populationReferenceYear: 2020, annualApparelExpenditure: 999, modelAnnualApparelExpenditure: 1500000, organisedStoreShare: 0.5 }
  };
  assert.equal(normalizeFeature(state, 'potentialRevenue').metrics.potentialRevenue.value, 750000);

  const { organisedStoreShare, ...withoutShare } = pin.properties;
  const gap = normalizeFeature({ ...pin, properties: withoutShare }, 'potentialRevenue').metrics.potentialRevenue;
  assert.equal(gap.value, null);
  assert.equal(gap.missing.cause, 'missing_calculation_dependency');
});

test('district and PIN artifacts are internally consistent with the reconciliation and quality reports', () => {
  const states = readJson('india-state-features.geojson').features;
  const stateCodes = new Set(states.map(f => f.properties.code));
  const districts = readJson('india-district-features.geojson').features;
  for (const { properties: p } of districts) {
    assert.ok(p.population > 0, `${p.name} population`);
    assert.ok(stateCodes.has(p.parentId), `${p.name} parentId ${p.parentId}`);
  }
  assert.equal(districts.reduce((s, f) => s + f.properties.population, 0), readJson('india-district-reconciliation.json').summary.districtTotal);

  const quality = readJson('india-pin-quality-report.json');
  const o = quality.officeQuality;
  assert.equal(o.valid + o.missingCoordinates + o.outsideIndia + o.wrongState, o.offices - o.invalidPin);

  const collection = readPinArtifact(root);
  const pins = collection.features;
  assert.equal(pins.length, quality.pins.mapped);
  for (const f of pins) assert.match(f.properties.pin, /^[1-9]\d{5}$/);
  assert.equal(new Set(pins.map(f => f.id)).size, pins.length);

  const sums = new Map();
  for (const f of pins) sums.set(f.properties.parentId, (sums.get(f.properties.parentId) || 0) + f.properties.population);
  let checked = 0;
  for (const { properties: p } of districts) {
    if (!sums.has(p.code)) continue;
    checked++;
    assert.ok(Math.abs(sums.get(p.code) - p.population) <= Math.max(50, p.population * 0.001), `${p.name} PIN sum`);
  }
  assert.equal(checked, districts.length - quality.population.districtsWithoutPins.length);

  for (const f of pins.slice(0, 25).map(f => expandPinFeature(collection, f))) {
    assert.ok(f.properties.evidence.some(e => e.metric === 'population'), `${f.id} population evidence`);
    assert.ok(f.properties.warnings.some(w => /approximate/i.test(w)), `${f.id} approximate warning`);
  }
});

test('state populations match the Census 2011 figures and sum to the national total', () => {
  const states = readJson('india-state-features.geojson').features;
  const population = name => states.find(f => f.properties.name === name).properties.population;
  assert.equal(population('Telangana'), 35003674);
  assert.equal(population('Andhra Pradesh'), 49577103);
  assert.equal(population('Ladakh'), 274289);
  assert.equal(states.length, 36);
  assert.equal(states.reduce((s, f) => s + f.properties.population, 0), 1210854977);
});
