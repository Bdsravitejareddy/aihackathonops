'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

const workspaceId = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
const assessmentId = 'd18b6324-2abc-4f24-97c6-69e0c28bb54f';

function harness({ marketStore, marketSources = { sources: [{ id: 'official' }] }, marketBenchmarks = { observations: [] } } = {}) {
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
  const handler = createHandler({ store, marketStore: marketStore || defaultMarketStore, marketSources, marketBenchmarks });
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
