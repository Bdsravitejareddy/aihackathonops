'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeature } = require('../server/market-map-store.cjs');
const { MISSING_CAUSES } = require('../server/market-evidence.cjs');

test('missing evidence taxonomy contains the six supported cause classes', () => {
  assert.deepEqual(Object.keys(MISSING_CAUSES), [
    'source_unavailable', 'not_integrated', 'geography_mismatch',
    'missing_calculation_dependency', 'api_database_failure', 'user_input_required'
  ]);
});

test('map metrics classify source, geography, integration, and calculation gaps without filling values', () => {
  const place = normalizeFeature({ external_id:'pin:560026', kind:'pin', name:'Bengaluru PIN', properties:{} });
  for (const key of ['population','monthlyPerCapitaSpend','competitorCount','tam']) {
    assert.equal(place.metrics[key].value, null, `${key} remains unsupported`);
    assert.ok(place.metrics[key].missing.nextAction);
  }
  assert.equal(place.metrics.population.missing.cause, 'geography_mismatch');
  assert.equal(place.metrics.monthlyPerCapitaSpend.missing.cause, 'source_unavailable');
  assert.equal(place.metrics.competitorCount.missing.cause, 'not_integrated');
  assert.equal(place.metrics.tam.missing.cause, 'missing_calculation_dependency');
});
