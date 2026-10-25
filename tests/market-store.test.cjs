'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketStore } = require('../server/market-store.cjs');

const workspaceId = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
const assessmentId = 'd18b6324-2abc-4f24-97c6-69e0c28bb54f';

function fakePool({ saveRows = [{ version: 1 }] } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/INSERT INTO market_assessments/.test(sql)) return { rows: saveRows };
      return { rows: [] };
    },
    release() { queries.push({ sql: 'RELEASE', params: [] }); }
  };
  return { queries, pool: { async connect() { return client; }, async query(sql, params = []) { queries.push({ sql, params }); return { rows: [] }; } } };
}

test('versioned assessment save runs transaction and appends an immutable version snapshot', async () => {
  const { pool, queries } = fakePool();
  const store = createMarketStore(pool);
  const snapshot = { modelVersion: 'india-fashion-market-v1', inputs: { population: 100 }, results: { tam: 1 } };
  const version = await store.saveAssessment(workspaceId, assessmentId, 0, snapshot);
  assert.equal(version, 1);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.ok(queries.some(item => /INSERT INTO market_assessments/.test(item.sql)));
  const history = queries.find(item => /INSERT INTO market_assessment_versions/.test(item.sql));
  assert.ok(history);
  assert.equal(history.params.includes(JSON.stringify(snapshot)), true);
  assert.equal(queries.at(-2).sql, 'COMMIT');
});

test('stale assessment version rolls back with a conflict error', async () => {
  const { pool, queries } = fakePool({ saveRows: [] });
  const store = createMarketStore(pool);
  await assert.rejects(store.saveAssessment(workspaceId, assessmentId, 5, { inputs: {}, results: {} }), error => error.status === 409);
  assert.ok(queries.some(item => item.sql === 'ROLLBACK'));
});

test('competitor replacement is scoped to one assessment and transaction safe', async () => {
  const { pool, queries } = fakePool();
  const store = createMarketStore(pool);
  await store.replaceCompetitors(workspaceId, assessmentId, [{ name: 'Retailer A', latitude: 12.9, longitude: 77.6 }]);
  assert.ok(queries.some(item => /DELETE FROM market_competitors/.test(item.sql) && item.params.includes(assessmentId)));
  assert.ok(queries.some(item => /INSERT INTO market_competitors/.test(item.sql) && item.params.includes('Retailer A')));
  assert.equal(queries.at(-2).sql, 'COMMIT');
});

test('catalog seeding is idempotent and retains source and observation provenance', async () => {
  const { pool, queries } = fakePool();
  const store = createMarketStore(pool);
  const sources = { version: '2.1.0', sources: [{ id: 'hces', title: 'HCES' }] };
  const benchmarks = { version: '1.4.0', observations: [{ sourceId: 'hces', metric: 'apparel', value: 374.22, unit: 'INR/person/month', referencePeriod: '2023-24', evidenceClass: 'official_survey_estimate', statement: '3U' }] };
  await store.seedCatalog(sources, benchmarks);
  await store.seedCatalog(sources, benchmarks);
  const source = queries.find(item => /INSERT INTO market_source_versions/.test(item.sql));
  const observations = queries.filter(item => /INSERT INTO market_observations/.test(item.sql));
  const observation = observations[0];
  assert.match(source.sql, /ON CONFLICT \(id, version\) DO NOTHING/);
  assert.equal(source.params[1], '2.1.0');
  assert.match(observation.sql, /ON CONFLICT \(observation_key\) DO NOTHING/);
  assert.equal(observation.params[2], '2.1.0');
  assert.equal(JSON.parse(observation.params[8]).benchmarkCatalogVersion, '1.4.0');
  assert.equal(JSON.parse(observation.params[8]).statement, '3U');
  assert.equal(observations[1].params[0], observation.params[0]);
  assert.match(observations[1].sql, /ON CONFLICT \(observation_key\) DO NOTHING/);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-2).sql, 'COMMIT');
});
