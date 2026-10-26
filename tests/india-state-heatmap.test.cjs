'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assembleIndiaStates } = require('../scripts/assemble-india-state-data.cjs');

const root = path.resolve(__dirname, '..');

test('state assembly covers all 36 states/UTs with final Census 2011 and reconciled successor states', () => {
  const result = assembleIndiaStates({ rootDir: root, write: false });
  assert.equal(result.features.length, 36);
  assert.equal(new Set(result.features.map(f => f.properties.code)).size, 36);
  for (const feature of result.features) {
    const p = feature.properties;
    assert.ok(p.population > 0, `${p.name} should have Census population`);
    assert.ok(p.annualApparelExpenditure > 0, `${p.name} should have expenditure estimate`);
    assert.equal(p.demographics.ruralPopulation + p.demographics.urbanPopulation, p.population);
    assert.ok(p.evidence.some(e => e.sourceId === 'mospi-hces-2023-24-report-592'));
  }
  const population = name => result.features.find(f => f.properties.name === name).properties.population;
  assert.equal(population('Telangana'), 35003674);
  assert.equal(population('Andhra Pradesh'), 49577103);
  assert.equal(population('Telangana') + population('Andhra Pradesh'), 84580777);
  assert.equal(population('Ladakh'), 274289);
  assert.equal(population('Jammu and Kashmir') + population('Ladakh'), 12541302);
  for (const name of ['Andhra Pradesh','Telangana','Jammu and Kashmir','Ladakh']) assert.ok(result.features.find(f => f.properties.name === name).properties.evidence.some(e => e.crosswalk));
  assert.equal(result.reconciliation.censusSourcePopulation, 1210854977);
  assert.equal(result.reconciliation.mappedPopulation, 1210854977);
  assert.equal(result.reconciliation.censusSourceRural + result.reconciliation.censusSourceUrban, result.reconciliation.censusSourcePopulation);
});

test('HCES extraction benchmarks and state/UT coverage match the official report', () => {
  const hces = JSON.parse(fs.readFileSync(path.join(root,'data/india-geography/hces-state-sector.json'),'utf8'));
  assert.equal(hces.observations.length, 36);
  const karnataka = hces.observations.find(row => row.state === 'Karnataka');
  assert.equal(karnataka.sectors.rural.combinedINRPerPersonMonth, 273.17);
  assert.equal(karnataka.sectors.urban.combinedINRPerPersonMonth, 374.22);
  assert.equal(hces.observations.every(row => row.sectors.rural && row.sectors.urban), true);
});

test('geography manifest verifies sourced artifacts and retains license / accuracy provenance', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'data/india-geography/manifest.json'),'utf8'));
  const boundaries = manifest.datasets.find(row => row.id === 'geoboundaries-india-adm1');
  assert.equal(boundaries.status, 'available');
  assert.equal(boundaries.coverage.featureCount, 36);
  assert.match(boundaries.license.note, /CC BY 2.5 IN/i);
  assert.match(boundaries.sourceVintage, /2011/);
  assert.ok(manifest.evidence.some(item => item.id === 'census-state-population-2011'));
});
