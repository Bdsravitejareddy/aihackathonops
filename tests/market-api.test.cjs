'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

const workspaceId = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
const assessmentId = 'd18b6324-2abc-4f24-97c6-69e0c28bb54f';

function harness({ marketStore, marketMapStore, marketSources = { sources: [{ id: 'official' }] }, marketBenchmarks = { observations: [] } } = {}) {
  const workspaces = new Map([[workspaceId, { state: { apps: [{ key: 'A-1', score: 77 }], territories: [] }, revision: 1 }]]);
  const store = {
    async load(id) { return workspaces.get(id) || null; },
    async save(id, state, revision) {
      const current = workspaces.get(id);
      if ((current?.revision || 0) !== revision) throw Object.assign(new Error('conflict'), { status: 409 });
      const next = { state: structuredClone(state), revision: revision + 1 };
      workspaces.set(id, next);
      return next.revision;
    }
  };
  const saved = new Map();
  const competitors = new Map();
  const defaultMarketStore = {
    async listAssessments(owner) { return [...saved.values()].filter(row => row.workspaceId === owner); },
    async getAssessment(owner, id) { const row = saved.get(id); return row?.workspaceId === owner ? row : null; },
    async saveAssessment(owner, id, expectedVersion, snapshot) {
      const current = saved.get(id);
      if ((current?.version || 0) !== expectedVersion) throw Object.assign(new Error('conflict'), { status: 409 });
      const row = { ...structuredClone(snapshot), id, workspaceId: owner, version: expectedVersion + 1 };
      saved.set(id, row);
      return row;
    },
    async listCompetitors(owner, id) { return competitors.get(id)?.workspaceId === owner ? competitors.get(id).items : []; },
    async replaceCompetitors(owner, id, items) { competitors.set(id, { workspaceId: owner, items: structuredClone(items) }); return items; }
  };
  const handler = createHandler({ store, marketStore: marketStore || defaultMarketStore, marketMapStore, marketSources, marketBenchmarks });
  async function call(method, path, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = path;
    req.headers = { host: '127.0.0.1:8080', ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    let status;
    let payload;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(value) { payload = value; } };
    await handler(req, res);
    return { status, json: () => JSON.parse(payload) };
  }
  return { call, workspaces, saved };
}

test('market source and benchmark endpoints return versioned official catalog data', async () => {
  const sources = { version: '1.0.0', sources: [{ id: 'hces', evidenceClass: 'official_survey_estimate' }] };
  const benchmarks = { version: '1.0.0', observations: [{ metric: 'apparel', value: 374.22 }] };
  const { call } = harness({ marketSources: sources, marketBenchmarks: benchmarks });
  assert.deepEqual((await call('GET', '/api/market/sources')).json(), sources);
  assert.deepEqual((await call('GET', '/api/market/benchmarks')).json(), benchmarks);
});

test('PIN validation reports format validity without claiming directory membership', async () => {
  const { call } = harness();
  const valid = await call('POST', '/api/market/pins/validate', { pin: '560001' });
  assert.equal(valid.status, 200);
  assert.equal(valid.json().formatValid, true);
  assert.equal(valid.json().directoryStatus, 'not_verified');
  const invalid = await call('POST', '/api/market/pins/validate', { pin: '56001x' });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.json().formatValid, false);
});

test('market assessment snapshots persist separately from franchise eligibility workspace', async () => {
  const { call, workspaces } = harness();
  const snapshot = {
    name: 'Bengaluru apparel pilot', modelVersion: 'india-fashion-market-v1',
    sourceVintage: 'HCES 2023-24', sourceVersions: [{ sourceId: 'mospi-hces', version: '1.0.0' }],
    location: { pin: '560001' }, inputs: { demand: { population: 1000, monthlyPerCapitaSpend: 300 } },
    results: { metrics: { tam: { value: 3600000, unit: 'INR/year' } } }
  };
  const saved = await call('PUT', `/api/market/assessments/${assessmentId}`, { workspaceId, expectedVersion: 0, snapshot });
  assert.equal(saved.status, 200);
  assert.equal(saved.json().version, 1);
  const list = await call('GET', `/api/market/assessments?workspaceId=${workspaceId}`);
  assert.equal(list.json().assessments.length, 1);
  const detail = await call('GET', `/api/market/assessments/${assessmentId}?workspaceId=${workspaceId}`);
  assert.equal(detail.json().snapshot.results.metrics.tam.value, 3600000);
  assert.deepEqual(detail.json().snapshot.sourceVersions, snapshot.sourceVersions);
  assert.deepEqual(workspaces.get(workspaceId).state.apps, [{ key: 'A-1', score: 77 }]);
});

test('market assessment rejects stale version and isolates workspace ownership', async () => {
  const { call } = harness();
  const body = { workspaceId, expectedVersion: 0, snapshot: { modelVersion: 'v1', inputs: {}, results: {} } };
  assert.equal((await call('PUT', `/api/market/assessments/${assessmentId}`, body)).status, 200);
  assert.equal((await call('PUT', `/api/market/assessments/${assessmentId}`, body)).status, 409);
  const other = '2de330f2-e48e-4df2-90a3-59a8549d0a7f';
  assert.equal((await call('GET', `/api/market/assessments/${assessmentId}?workspaceId=${other}`)).status, 404);
});

test('market compare returns only snapshots owned by the requested workspace', async () => {
  const { call } = harness();
  await call('PUT', `/api/market/assessments/${assessmentId}`, { workspaceId, expectedVersion: 0, snapshot: { name: 'Bengaluru', inputs: {}, results: {} } });
  const response = await call('POST', '/api/market/assessments/compare', { workspaceId, ids: [assessmentId] });
  assert.equal(response.status, 200);
  assert.equal(response.json().assessments.length, 1);
});

test('market recalculate uses the market engine and preserves source provenance', async () => {
  const { call } = harness();
  const snapshot = {
    name: 'Bengaluru apparel pilot',
    sourceVintage: 'HCES 2023-24, released 2025-01-31',
    geography: { level: 'state_sector', state: 'Karnataka', sector: 'urban' },
    inputs: { demand: { population: 1000, monthlyPerCapitaSpend: 374.22 } }
  };
  await call('PUT', `/api/market/assessments/${assessmentId}`, { workspaceId, expectedVersion: 0, snapshot });
  const response = await call('POST', `/api/market/assessments/${assessmentId}/recalculate`, { workspaceId, expectedVersion: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.json().version, 2);
  assert.equal(response.json().snapshot.results.metrics.tam.value, 4490640);
  assert.equal(response.json().snapshot.results.metrics.tam.sourceVintage.value, snapshot.sourceVintage);
  assert.deepEqual(response.json().snapshot.results.metrics.tam.geography.value, snapshot.geography);
});

test('market competitor routes are workspace scoped and reject malformed identifiers', async () => {
  const { call } = harness();
  const snapshot = { name: 'Bengaluru', inputs: {}, results: {} };
  await call('PUT', `/api/market/assessments/${assessmentId}`, { workspaceId, expectedVersion: 0, snapshot });
  const replacement = await call('PUT', `/api/market/assessments/${assessmentId}/competitors`, { workspaceId, competitors: [{ name: 'Retailer A', latitude: 12.9, longitude: 77.6 }] });
  assert.equal(replacement.status, 200);
  const listed = await call('GET', `/api/market/assessments/${assessmentId}/competitors?workspaceId=${workspaceId}`);
  assert.equal(listed.json().competitors[0].name, 'Retailer A');
  assert.equal((await call('GET', '/api/market/assessments/not-a-uuid?workspaceId=' + workspaceId)).status, 400);
  assert.equal((await call('GET', '/api/market/assessments?workspaceId=bad')).status, 400);
});

test('map API progressively serves sourced geographies with fixed national legend and gray missing metrics', async () => {
  const geo = { id: 'KA', name: 'Karnataka', level: 'state', parentId: null, geometry: null,
    metrics: { population: { value: 100, unit: 'people', evidenceClass: 'official_observed' }, tam: { value: null, unit: 'INR/year', evidenceClass: 'unavailable' } },
    evidence: [{ sourceId: 'census', referenceYear: 2011, geographicResolution: 'state' }], confidence: 'historical' };
  const map = { sourceVersion: 'india-test-v1', async getMapLevel(parentId) { return parentId ? 'district' : 'state'; },
    async listMapGeographies({ level }) { return level === 'state' ? [geo] : []; }, async searchMapGeographies() { return [geo]; },
    async getMapGeography() { return geo; }, async getMapEvidence() { return { evidence: geo.evidence, warnings: [] }; } };
  const { call } = harness({ marketMapStore: map });
  const root = await call('GET', '/api/market/map/levels?metric=tam&year=2026');
  assert.equal(root.status, 200); assert.equal(root.json().level, 'state');
  assert.equal(root.json().features[0].metrics.tam.value, null);
  assert.equal(root.json().legend.scope, 'national'); assert.equal(root.json().legend.colors.length, 5);
  assert.equal((await call('GET', '/api/market/map/levels?parentId=KA&metric=population')).json().level, 'district');
  assert.equal((await call('GET', '/api/market/map/search?q=Karnataka')).json().results[0].id, 'KA');
  assert.equal((await call('GET', '/api/market/map/levels?metric=unknown')).status, 400);
  assert.equal((await call('GET', '/api/market/map/levels?bbox=98,37,67,6')).status, 400);
});

test('scenario recalculation leaves missing inputs unavailable and explicitly labels projections', async () => {
  const geo = { id: 'KA', name: 'Karnataka', level: 'state', metrics: { revenue: { value: null } }, evidence: [], confidence: 'insufficient evidence' };
  const map = { sourceVersion: 'india-test-v1', async getMapLevel() { return 'state'; }, async listMapGeographies() { return [geo]; }, async getMapGeography() { return geo; } };
  const { call } = harness({ marketMapStore: map });
  const response = await call('POST', '/api/market/map/scenario', { scenario: 'base', horizonYears: 3, metric: 'revenue', assumptions: { elasticity: 1, captureRate: 0.02, investment: 100000 } });
  assert.equal(response.status, 200);
  assert.equal(response.json().map.features[0].metrics.revenue.value, null);
  assert.equal(response.json().forecast.evidenceClass, 'model_assumption');
  assert.ok(response.json().forecast.warnings.some(text => /not be interpreted as observed sales/i.test(text)));
  assert.equal((await call('POST', '/api/market/map/scenario', { horizonYears: 4, assumptions: {} })).status, 400);
});
