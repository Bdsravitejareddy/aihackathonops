'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

const workspaceId = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
const assessmentId = 'd18b6324-2abc-4f24-97c6-69e0c28bb54f';

function harness({ marketStore, marketMapStore, applicationRows = null, marketSources = { sources: [{ id: 'official' }] }, marketBenchmarks = { observations: [] } } = {}) {
  const workspaces = new Map([[workspaceId, { state: { apps: [{ key: 'A-1', score: 77 }], territories: [] }, revision: 1 }]]);
  const store = {
    async load(id) { return workspaces.get(id) || null; },
    async listApplicationsByPin(id,pin) { return id===workspaceId ? applicationRows ? applicationRows.filter(row=>row.pin===pin) : pin==='560001' ? [{id:'APP-1',pin:'560001'}] : [] : []; },
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
  async function call(method, path, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = path;
    req.headers = { host: '127.0.0.1:8080', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers };
    let status;
    let payload;
    let responseHeaders = {};
    const res = { writeHead(code, headers = {}) { status = code; responseHeaders = headers; }, setHeader() {}, end(value) { payload = value; } };
    await handler(req, res);
    return { status, headers:responseHeaders, json: () => JSON.parse(payload) };
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

test('public map levels expose versioned ETags and geometry-free metric refreshes while workspace data stays private', async () => {
  const geometry={type:'Polygon',coordinates:[[[75,12],[76,12],[76,13],[75,13],[75,12]]]};
  const map={sourceVersion:'india-test-v1',async getMapLevel(){return 'state';},async listMapGeographies(){return [{id:'state:IN-KA',name:'Karnataka',level:'state',geometry,metrics:{apparelExpenditure:{value:42}},evidence:[]}];}};
  const {call}=harness({marketMapStore:map});
  const url='/api/market/map/levels?metric=apparelExpenditure&year=2026';
  const first=await call('GET',url);
  assert.equal(first.status,200);
  assert.match(first.headers['cache-control'],/public/);
  assert.ok(first.headers.etag);
  const conditional=await call('GET',url,undefined,{'if-none-match':first.headers.etag});
  assert.equal(conditional.status,304);
  const withoutGeometry=await call('GET',url+'&geometry=none');
  assert.equal(withoutGeometry.json().features[0].geometry,null);
  assert.ok(JSON.stringify(withoutGeometry.json()).length<JSON.stringify(first.json()).length);
  const privateResponse=await call('GET','/api/market/assessments?workspaceId='+workspaceId);
  assert.equal(privateResponse.headers['cache-control'],'no-store');
  map.sourceVersion='india-test-v2';
  const changed=await call('GET',url,undefined,{'if-none-match':first.headers.etag});
  assert.equal(changed.status,200);
  assert.notEqual(changed.headers.etag,first.headers.etag);
});

test('market estimate separates observed aggregate apparel spend from unsupported unique-customer TAM and caches by source version',async()=>{
  const cache=new Map();let reads=0;
  const geography={id:'state:KA',name:'Karnataka',level:'state',metrics:{population:{value:1000,unit:'people',evidenceClass:'official_observed',referenceYear:2011},apparelExpenditure:{value:1200000,unit:'INR/year',evidenceClass:'derived_estimate',evidence:[{sourceId:'HCES',referencePeriod:'2023-24',url:'https://mospi.gov.in/'}]},tam:{value:1200000,unit:'INR/year',evidenceClass:'derived_estimate'}},evidence:[{sourceId:'HCES',referencePeriod:'2023-24'}]};
  const map={sourceVersion:'sources-v1',async getMapGeography(){reads++;return geography;},async getCustomerMarketEstimate(input){const row=cache.get(JSON.stringify({geographyId:input.geographyId,retailCategory:input.retailCategory,analysisYear:input.analysisYear,modelVersion:input.modelVersion,sourceVersion:input.sourceVersion}));return row?{...row,cached:true}:null;},async saveCustomerMarketEstimate(input){cache.set(JSON.stringify({geographyId:input.geographyId,retailCategory:input.retailCategory,analysisYear:input.analysisYear,modelVersion:input.modelVersion,sourceVersion:input.sourceVersion}),input.result);return new Date().toISOString();}};
  const {call}=harness({marketMapStore:map});
  const first=await call('GET','/api/market/map/geographies/state%3AKA/market-estimate?year=2026');
  assert.equal(first.status,200);assert.equal(first.json().metrics.categoryExpenditureTAM.value,1200000);assert.equal(first.json().metrics.customerTAM.value,null);assert.equal(first.json().metrics.potentialCustomers.value,null);assert.equal(first.json().customerModel.complete,false);assert.match(first.json().explanation,/does not identify unique fashion customers/i);
  const second=await call('GET','/api/market/map/geographies/state%3AKA/market-estimate?year=2026');
  assert.equal(second.json().cached,true);assert.equal(reads,1);
  map.sourceVersion='sources-v2';const refreshed=await call('GET','/api/market/map/geographies/state%3AKA/market-estimate?year=2026');assert.equal(refreshed.json().sourceVersion,'sources-v2');assert.equal(reads,2);
});

test('workspace PIN screening validates input and remains private', async () => {
  const {call}=harness();
  const found=await call('GET',`/api/screening/applications?workspaceId=${workspaceId}&pin=560001`);
  assert.equal(found.status,200);
  assert.equal(found.headers['cache-control'],'no-store');
  assert.equal(found.json().applications[0].id,'APP-1');
  assert.equal((await call('GET',`/api/screening/applications?workspaceId=${workspaceId}&pin=56001`)).status,400);
  assert.equal((await call('GET','/api/screening/applications?workspaceId=bad&pin=560001')).status,400);
});

test('unmapped six digit PIN search reports format coverage without inventing a postal area', async () => {
  const map={sourceVersion:'fixture-v1',async searchMapGeographies(){return [];}};
  const {call}=harness({marketMapStore:map});
  const result=await call('GET','/api/market/map/search?q=560001');
  assert.equal(result.status,200);
  assert.deepEqual(result.json().results,[]);
  assert.equal(result.json().queryType,'pin');
  assert.equal(result.json().coverage,'not_verified');
});

test('verified India Post PIN search attaches regional HCES benchmarks while leaving PIN totals unsupported', async () => {
  const map={sourceVersion:'fixture-v1',async searchMapGeographies(){return [];}};
  const {call}=harness({marketMapStore:map});
  const search=await call('GET','/api/market/map/search?q=560026');
  assert.equal(search.status,200);
  assert.equal(search.json().coverage,'sourced');
  assert.equal(search.json().results[0].id,'pin:560026');
  assert.equal(search.json().results[0].metrics.monthlyPerCapitaSpend.value,374.22);
  assert.equal(search.json().results[0].metrics.population.value,null);
  assert.equal(search.json().results[0].metrics.tam.value,null);
  const detail=await call('GET','/api/market/map/geographies/pin%3A560026');
  assert.equal(detail.json().geography.metrics.annualPerCapitaSpend.value,4490.64);
  assert.equal(detail.json().geography.geometry,null);
  const valid=await call('POST','/api/market/pins/validate',{pin:'560026'});
  assert.equal(valid.json().directoryStatus,'verified');
});

test('PIN applicant lookup returns exact synthetic territory records for six distinct dataset PINs', async () => {
  const rows=require('../dist/demo.json').apps;
  const pins=['560101','570102','575103','580101','590102','572103'];
  const {call}=harness({applicationRows:rows});
  for(const pin of pins){
    const response=await call('GET',`/api/screening/applications?workspaceId=${workspaceId}&pin=${pin}`);
    assert.equal(response.status,200);
    assert.ok(response.json().applications.length>0,`expected applicant rows for ${pin}`);
    assert.ok(response.json().applications.every(row=>row.pin===pin));
  }
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

test('market preview calculates deterministically without writing a Neon assessment', async () => {
  const {call}=harness();
  const response=await call('POST','/api/market/assessments/preview',{snapshot:{
    modelVersion:'india-fashion-market-v1',sourceVintage:'HCES 2023-24',
    geography:{level:'PIN',pin:'560026'},inputs:{elasticity:1,demand:{monthlyPerCapitaSpend:374.22}},
    location:{pin:'560026',state:'Karnataka',city:'Bengaluru'}
  }});
  assert.equal(response.status,200);
  assert.equal(response.json().persisted,false);
  assert.equal(response.json().results.metrics.annualPerCapitaSpend.value,4490.64);
  assert.equal(response.json().results.metrics.tam.value,null);
  assert.match(response.json().warning,/not saved to Neon/i);
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
  const map = { sourceVersion: 'india-test-v1', async getMapLevel() { return 'state'; }, async listMapGeographies({scenario}) { this.appliedScenario=scenario; return [geo]; }, async getMapGeography() { return geo; } };
  const { call } = harness({ marketMapStore: map });
  const response = await call('POST', '/api/market/map/scenario', { scenario: 'base', horizonYears: 3, metric: 'revenue', assumptions: { elasticity: 1, captureRate: 0.02, investment: 100000 } });
  assert.equal(response.status, 200);
  assert.equal(response.json().map.features[0].metrics.revenue.value, null);
  assert.equal(response.json().forecast.evidenceClass, 'model_assumption');
  assert.equal(map.appliedScenario.captureRate,0.02);
  assert.ok(response.json().forecast.warnings.some(text => /not be interpreted as observed sales/i.test(text)));
  assert.equal((await call('POST', '/api/market/map/scenario', { horizonYears: 4, assumptions: {} })).status, 400);
  assert.equal((await call('POST', '/api/market/map/scenario', { scenario:'wild',horizonYears:3,assumptions:{} })).status,400);
});

test('map scenario invokes existing store economics when full financial assumptions are supplied', async () => {
  const geo={id:'KA',name:'Karnataka',level:'state',metrics:{sam:{value:5000000},tam:{value:10000000},som:{value:100000}},evidence:[],confidence:'scenario fixture'};
  const map={sourceVersion:'india-test-v1',async getMapLevel(){return 'state';},async listMapGeographies({scenario}){this.appliedScenario=scenario;return [geo];},async getMapGeography(){return geo;}};
  const {call}=harness({marketMapStore:map});
  const assumptions={elasticity:1,captureRate:0.02,aov:500,areaSqFt:1000,investment:100000,workingCapital:10000,monthlyFixedCosts:10000,grossMargin:0.5,royaltyRate:0.05,conversionRate:0.1,monthlyPassingPedestrianTraffic:20000,entryRate:0.2,salesRampMonths:2,initialRampFraction:0.4,annualNominalGrowth:0.05,annualInflation:0.04,discountRate:0.1};
  const response=await call('POST','/api/market/map/scenario',{geographyIds:['KA'],horizonYears:3,scenario:'optimistic',metric:'revenue',assumptions});
  assert.equal(response.status,200);
  const forecast=response.json().forecast;
  assert.ok(forecast.financial);assert.equal(forecast.footfall.storeVisits.value,4000);assert.equal(forecast.effectiveCaptureRate,0.025);assert.equal(map.appliedScenario.captureRate,0.025);
  assert.equal(forecast.breakEvenRevenueMonthly,10000/0.45);
  assert.ok(forecast.annualRevenue>0);assert.equal(forecast.roi,forecast.financial.scenarios.optimistic.roiPercent);
  assert.ok(forecast.paybackMonths>0);
  assert.ok(forecast.warnings.some(text=>/not be interpreted as observed sales/i.test(text)));
});
