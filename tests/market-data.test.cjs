'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/india-market-sources.json'), 'utf8'));
const benchmarks = JSON.parse(fs.readFileSync(path.join(root, 'data/india-market-benchmarks.json'), 'utf8'));

test('source inventory records provenance and limitations for every listed dataset', () => {
  assert.match(sources.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(sources.sources) && sources.sources.length >= 5);
  for (const source of sources.sources) {
    assert.ok(source.id && source.publisher && source.title && source.url);
    assert.ok(source.referencePeriod && source.geography && source.variables.length);
    assert.ok(source.updateFrequency);
    assert.ok(source.licenseNote && source.limitations.length);
    assert.ok(['official_observed', 'official_survey_estimate', 'derived_estimate'].includes(source.evidenceClass));
  }
  const hces = sources.sources.find(source => source.id === 'mospi-hces-2023-24-report-592');
  assert.equal(hces.referencePeriod, '2023-08 to 2024-07; released 2025-01-31');
  assert.equal(hces.releaseDate, '2025-01-31');
  assert.match(hces.url, /Final_Report_HCES_2023-24L\.pdf$/);
});

test('HCES Karnataka clothing, bedding and footwear figures retain survey geography and units', () => {
  const rows = benchmarks.observations.filter(item => item.metric === 'clothing_bedding_footwear_mpce');
  const rural = rows.find(item => item.geography.state === 'Karnataka' && item.geography.sector === 'rural');
  const urban = rows.find(item => item.geography.state === 'Karnataka' && item.geography.sector === 'urban');
  assert.equal(rural.value, 273.17);
  assert.equal(urban.value, 374.22);
  for (const row of [rural, urban]) {
    assert.equal(row.unit, 'INR/person/month');
    assert.equal(row.referencePeriod, '2023-24');
    assert.equal(row.evidenceClass, 'official_survey_estimate');
    assert.equal(row.imputation, 'without_imputation');
    assert.equal(row.geography.level, 'state_sector');
  }
  assert.equal(rural.statement, '3R');
  assert.equal(rural.page, 'S5');
  assert.equal(urban.statement, '3U');
  assert.equal(urban.page, 'S11');
  for (const row of rows.filter(item => item.statement === '10U')) {
    assert.equal(row.imputation, 'with_imputation');
    assert.equal(row.page, 'S45');
  }
  for (const row of rows) {
    assert.equal(row.sourceUrl, 'https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf');
  }
});

test('official PIN directory or boundary does not imply observed PIN income or spend', () => {
  const rows = benchmarks.observations;
  assert.equal(rows.some(item => item.metric === 'income_proxy' && item.geography.level === 'pin'), false);
  assert.equal(rows.some(item => item.geography.level === 'pin'), false);
  assert.ok(sources.sources.some(item => item.id === 'india-post-pin-directory'));
});

test('CSV geographic allocation conserves totals and rejects invalid weights', () => {
  const { allocateParentTotal } = require('../server/market-data.cjs');
  assert.deepEqual(allocateParentTotal(100, [{ id: 'a', weight: 0.3 }, { id: 'b', weight: 0.7 }]), [
    { id: 'a', value: 30 }, { id: 'b', value: 70 }
  ]);
  const allocated = allocateParentTotal(123.45, [{ id: 'first', weight: 0.25 }, { id: 'second', weight: 0.75 }]);
  assert.deepEqual(allocated.map(row => row.id), ['first', 'second']);
  assert.ok(Math.abs(allocated.reduce((sum, row) => sum + row.value, 0) - 123.45) < 1e-9);
  assert.throws(() => allocateParentTotal(100, [{ id: 'a', weight: 0.2 }, { id: 'b', weight: 0.2 }]), /weights/);
});

test('map source inventory exposes pipeline status without promoting catalogs to available data', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/india-geography/manifest.json')));
  for (const dataset of manifest.datasets) {
    const source = sources.sources.find(item => item.id === dataset.sourceId);
    assert.ok(source, dataset.sourceId);
    assert.equal(source.geographyPipeline.manifest, 'data/india-geography/manifest.json');
    assert.equal(source.geographyPipeline.datasetId, dataset.id);
    assert.equal(source.geographyPipeline.status, dataset.status);
  }
});
