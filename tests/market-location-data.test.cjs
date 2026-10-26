'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketLocationData } = require('../server/market-location-data.cjs');

test('PIN 560026 resolves to sourced Bengaluru postal offices and Karnataka HCES benchmarks without inventing catchment metrics', () => {
  const data = createMarketLocationData();
  const place = data.resolvePin('560026');
  assert.equal(place.id, 'pin:560026');
  assert.equal(place.state, 'Karnataka');
  assert.equal(place.city, 'Bengaluru');
  assert.equal(place.geometry, null, 'postal directory does not supply a PIN boundary or coordinate');
  assert.deepEqual(place.postOffices.map(row => row.name), [
    'Government Electric Factory S.O', 'Deepanjalinagar S.O', 'Nayandahalli S.O'
  ]);
  assert.equal(place.metrics.population.value, null);
  assert.equal(place.metrics.incomeProxy.value, null);
  assert.equal(place.metrics.monthlyPerCapitaSpend.value, 374.22);
  assert.equal(place.metrics.monthlyPerCapitaSpend.geographicResolution, 'state_sector');
  assert.equal(place.metrics.annualPerCapitaSpend.value, 4490.64);
  assert.equal(place.metrics.apparelExpenditure.value, null);
  assert.equal(place.metrics.tam.value, null);
  assert.deepEqual(place.metrics.population.missing, {
    cause: 'geography_mismatch',
    nextAction: 'Use a supported census geography or add a validated PIN-to-population crosswalk.'
  });
  assert.equal(place.metrics.tam.missing.cause, 'missing_calculation_dependency');
  assert.equal(place.metrics.competitorCount.missing.cause, 'not_integrated');
  assert.equal(place.metrics.population.value, null, 'missing evidence must remain null');
  assert.ok(place.evidence.some(row => /Department of Posts/i.test(row.publisher)));
  assert.ok(place.evidence.some(row => /MoSPI/i.test(row.publisher)));
});

test('PIN resolver does not treat a valid six digit format as directory evidence', () => {
  const data = createMarketLocationData();
  assert.equal(data.resolvePin('560999'), null);
  assert.equal(data.resolvePin('56002'), null);
});
