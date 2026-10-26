'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');
const { normalizeFeature } = require('../server/market-map-store.cjs');
const { APPAREL, normalizeWeights, researchSector, validateSectorProfile, profileFields, createSectorRegistry } = require('../server/market-sectors.cjs');
const { applySectorDemand, sectorSpend, itemCatalog } = require('../server/market-sector-demand.cjs');
const { parseJson } = require('../server/market-research.cjs').createMarketResearchService({ apiKey: 'unused', fetchImpl: async () => { throw new Error('no network'); } });
const studio = require('../dist/sector-studio.js');

// Grounding metadata returns redirect URLs titled with the page's domain.
const CITATIONS = [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/a1', title: 'ibef.org' }, { url: 'https://www.example-coffee.in/investors/q4', title: 'Example Coffee Q4 presentation' }];
const RESEARCH = {
  description: 'Coffee and tea cafés.',
  hcesCategories: ['Beverages, processed food etc', 'not a group'],
  organisedShare: { value: 0.35, sourceUrl: 'https://www.ibef.org/industry/coffee', quote: 'organised cafés hold about 35%' },
  onlineShareOfOrganised: { value: 0.12, assumption: true, rationale: 'delivery apps' },
  osmTags: [['amenity', 'cafe'], ['shop', 'coffee'], ['bogus', 'x'], 'amenity=ice_cream'],
  majorBrands: ['Third Wave Coffee', 'Blue Tokai', 'Third Wave Coffee'],
  store: {
    areaSqFt: { value: 1200, sourceUrl: 'https://www.example-coffee.in/investors/q4', quote: 'average store 1,200 sq ft' },
    revenuePerSqFtYear: { value: 25000, sourceUrl: 'https://unretrieved.example.org/report' },
    capexPerSqFt: { value: 4000 },
    grossMargin: { value: 65, assumption: true },
    royaltyRate: { value: 0.9, assumption: true }
  },
  scoringWeights: { demand: 30, purchasingPower: 25, competition: 25, accessibility: 10, financial: 5, growth: 5, rationale: 'footfall-led' },
  partnerRequirements: { minInvestmentLakh: { value: 45, assumption: true }, minAreaSqFt: { value: 800, sourceUrl: 'https://www.example-coffee.in/franchise' }, minLaunchMonths: { value: 4, assumption: true }, targetLaunchMonths: null }
};
// Research runs in two steps: searched prose notes (with citations), then a no-search JSON conversion.
const mockGenerate = (payload = RESEARCH, extra = {}) => async ({ prompt, search = true }) => {
  if (search) { assert.match(prompt, /Use Google Search/); return { ok: true, text: 'Notes: organised share and store economics from the cited pages.', citations: CITATIONS, retrievedAt: '2026-10-26T10:00:00.000Z', ...extra }; }
  assert.match(prompt, /HCES 2023-24 item groups/); assert.match(prompt, /Retrieved pages:/);
  return { ok: true, text: '```json\n' + JSON.stringify(payload) + '\n```', citations: [], retrievedAt: '2026-10-26T10:00:05.000Z' };
};

test('research validator keeps cited or labelled values and rejects uncited, unretrieved and implausible numbers', async () => {
  const result = await researchSector({ name: 'Coffee cafés', generate: mockGenerate(), parseJson });
  assert.equal(result.ok, true);
  const p = result.profile;
  assert.equal(p.id, 'coffee-cafes');
  assert.deepEqual(p.hcesCategories, ['beverages, processed food, etc.']);
  assert.equal(p.organisedShare, 0.35);
  assert.equal(p.evidence.organisedShare.groundingUrl, CITATIONS[0].url, 'host matched a retrieved page');
  assert.equal(p.onlineShareOfOrganised, 0.12);
  assert.ok(p.assumptions.includes('onlineShareOfOrganised'));
  assert.equal(p.store.areaSqFt, 1200);
  assert.equal(p.store.revenuePerSqFtYear, null, 'cited page was never retrieved');
  assert.equal(p.store.capexPerSqFt, null, 'no citation and no assumption label');
  assert.equal(p.store.grossMargin, 0.65, 'percent read as a fraction, labelled assumption');
  assert.equal(p.store.royaltyRate, null, '90% royalty is implausible');
  assert.equal(p.partnerRequirements.minAreaSqFt, 800, 'cited on a retrieved host');
  assert.equal(p.partnerRequirements.targetLaunchMonths, 6, 'missing requirement falls back to the labelled apparel default');
  assert.match(p.rationale['partnerRequirements.targetLaunchMonths'], /apparel/);
  assert.deepEqual(p.osmTags, [['amenity', 'cafe'], ['shop', 'coffee'], ['amenity', 'ice_cream']]);
  assert.deepEqual(p.majorBrands, ['Third Wave Coffee', 'Blue Tokai']);
  const reasons = Object.fromEntries(result.rejected.map(r => [r.field, r.reason]));
  assert.match(reasons['store.revenuePerSqFtYear'], /not among the retrieved/);
  assert.match(reasons['store.capexPerSqFt'], /no citation/);
  assert.match(reasons['store.royaltyRate'], /plausible range/);
  assert.match(reasons.hcesCategories, /HCES/);
  // Every number left in the profile has evidence or an assumption label.
  for (const path of ['organisedShare', 'onlineShareOfOrganised', ...Object.keys(p.store).map(k => `store.${k}`), ...Object.keys(p.partnerRequirements).map(k => `partnerRequirements.${k}`)]) {
    const [head, key] = path.split('.'); const value = key ? p[head][key] : p[head];
    if (value !== null) assert.ok(p.evidence[path] || p.assumptions.includes(path), `${path} is unlabelled`);
  }
});

test('research failures pass through so the UI can offer manual entry', async () => {
  const failed = await researchSector({ name: 'Salons', generate: async () => ({ ok: false, error: { code: 'missing_api_key', message: 'Gemini research is not configured on the server.' } }), parseJson });
  assert.deepEqual(failed, { ok: false, error: { code: 'missing_api_key', message: 'Gemini research is not configured on the server.' } });
  const garbage = await researchSector({ name: 'Salons', generate: async () => ({ ok: true, text: 'no json here', citations: [] }), parseJson });
  assert.equal(garbage.error.code, 'invalid_response');
  assert.equal((await researchSector({ name: '   ', generate: mockGenerate(), parseJson })).error.code, 'invalid_name');
});

test('editing a cited value turns it into a user assumption', () => {
  const base = { id: 'x', name: 'X', organisedShare: 0.3, onlineShareOfOrganised: 0.1, evidence: { organisedShare: { url: 'https://a.example/1' }, onlineShareOfOrganised: { url: 'https://a.example/2' } } };
  const edited = validateSectorProfile(profileFields({ ...base, organisedShare: 0.4 }), { mode: 'edit', base }).profile;
  assert.equal(edited.organisedShare, 0.4);
  assert.equal(edited.evidence.organisedShare, undefined);
  assert.ok(edited.assumptions.includes('organisedShare'));
  assert.equal(edited.evidence.onlineShareOfOrganised.url, 'https://a.example/2', 'unchanged value keeps its source');
});

test('weights normalise to exactly 1 and sliders always total 100%', () => {
  const w = normalizeWeights({ demand: 3, purchasingPower: 2, competition: 3, accessibility: 2, financial: 1, growth: 1 });
  assert.equal(Object.values(w).reduce((s, v) => s + v, 0), 1);
  assert.equal(w.demand, 0.25);
  assert.equal(normalizeWeights({ demand: 0 }), null);
  assert.deepEqual(normalizeWeights({ demand: -1, growth: 2 }), { demand: 0, purchasingPower: 0, competition: 0, accessibility: 0, financial: 0, growth: 1 });
  let percents = studio.toPercents(APPAREL.scoringWeights);
  assert.deepEqual(percents, { demand: 25, purchasingPower: 20, competition: 20, accessibility: 15, financial: 15, growth: 5 });
  const keys = Object.keys(percents);
  for (let i = 0; i < 200; i++) {
    const key = keys[i % keys.length], value = (i * 37) % 101;
    percents = studio.rebalanceWeights(percents, key, value);
    assert.equal(Object.values(percents).reduce((s, v) => s + v, 0), 100);
    assert.equal(percents[key], value);
    assert.ok(Object.values(percents).every(v => Number.isInteger(v) && v >= 0));
  }
  assert.deepEqual(studio.rebalanceWeights({ demand: 100, purchasingPower: 0, competition: 0, accessibility: 0, financial: 0, growth: 0 }, 'demand', 50),
    { demand: 50, purchasingPower: 10, competition: 10, accessibility: 10, financial: 10, growth: 10 });
  assert.deepEqual(studio.describeChanges(APPAREL, { ...APPAREL, id: 'qsr', name: 'QSR', partnerRequirements: { ...APPAREL.partnerRequirements, minInvestmentLakh: 45 }, scoringWeights: { ...APPAREL.scoringWeights, competition: 0.3, demand: 0.15 } }),
    ['sector Apparel & fashion → QSR', 'minimum investment ₹30 L → ₹45 L', 'demand weight 25% → 15%', 'competition weight 20% → 30%']);
});

// Fixture district row shaped like the Neon/GeoJSON properties.
const districtRow = { external_id: 'district:IN-KA-fixture', kind: 'district', name: 'Fixture', parent_external_id: 'state:IN-KA',
  properties: { state: 'Karnataka', population: 1000000, urbanPopulation: 400000, ruralPopulation: 600000, populationReferenceYear: 2020,
    annualApparelExpenditure: 12 * (600000 * (231.86 + 37.66) + 400000 * 0), organisedStoreShare: 0.3198 } };

test('sector potential revenue sums the HCES item groups over rural and urban population', () => {
  const ka = itemCatalog.observations.find(o => o.state === 'Karnataka').sectors;
  const sector = { id: 'cafes', name: 'Cafés', hcesCategories: ['beverages, processed food, etc.', 'entertainment'], organisedShare: 0.3, onlineShareOfOrganised: 0.2, builtIn: false };
  const spend = sectorSpend('Karnataka', sector.hcesCategories);
  assert.equal(spend.rural, ka.rural.items['beverages, processed food, etc.'] + ka.rural.items.entertainment);
  const feature = applySectorDemand(normalizeFeature(districtRow, 'potentialRevenue'), sector);
  const expected = (600000 * spend.rural + 400000 * spend.urban) * 12 * 0.3 * 0.8;
  assert.ok(Math.abs(feature.metrics.potentialRevenue.value - expected) < 1e-3);
  assert.equal(feature.metrics.potentialRevenue.evidenceClass, 'derived_estimate');
  assert.equal(feature.metricValue.value, feature.metrics.potentialRevenue.value);
  assert.match(feature.metrics.potentialRevenue.warnings[0], /Karnataka/);
  // Missing shares → unavailable, never a guessed number.
  const missing = applySectorDemand(normalizeFeature(districtRow, 'potentialRevenue'), { ...sector, organisedShare: null });
  assert.equal(missing.metrics.potentialRevenue.value, null);
  assert.equal(missing.metrics.potentialRevenue.evidenceClass, 'unavailable');
});

test('the apparel profile reproduces the existing potential revenue', () => {
  const apparelRow = { ...districtRow, properties: { ...districtRow.properties, annualApparelExpenditure: 0 } };
  const spend = sectorSpend('Karnataka', APPAREL.hcesCategories);
  apparelRow.properties.annualApparelExpenditure = 12 * (600000 * spend.rural + 400000 * spend.urban);
  const base = normalizeFeature(apparelRow, 'potentialRevenue');
  const recomputed = applySectorDemand(base, { ...APPAREL, builtIn: false });
  assert.ok(Math.abs(recomputed.metrics.potentialRevenue.value - base.metrics.potentialRevenue.value) / base.metrics.potentialRevenue.value < 1e-9);
});

test('item-group data file: 36 States/UTs whose item groups sum to the published MPCE', () => {
  assert.equal(itemCatalog.observations.length, 36);
  assert.equal(itemCatalog.source.pdfSha256, '368deb9c858dcc71c3bf0e6cad096a31b5b337a724cf92a113637f3302ea268e');
  for (const row of itemCatalog.observations) for (const sector of ['rural', 'urban']) {
    const { items, totalMpce } = row.sectors[sector];
    const sum = Object.values(items).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - totalMpce) <= 0.2, `${row.state} ${sector}: ${sum} vs ${totalMpce}`);
  }
  // Hand-checked against the PDF pages (Statement 3R p. S6, 3U p. S10).
  const kerala = itemCatalog.observations.find(o => o.state === 'Kerala').sectors.rural.items;
  assert.equal(kerala['egg, fish & meat'], 621.8);
  assert.equal(itemCatalog.observations.find(o => o.state === 'Bihar').sectors.urban.items.education, 271.07);
});

// In-memory sector store and fixture map store for endpoint tests.
function memoryStore() {
  const rows = new Map();
  return { rows, async getSector(id) { return rows.get(id) || null; }, async listSectors() { return [...rows.values()]; },
    async saveSector(profile) { const version = (rows.get(profile.id)?.version || 0) + 1; const saved = { ...profile, version, builtIn: false }; rows.set(profile.id, saved); return saved; } };
}
function makeHandler({ generate = mockGenerate() } = {}) {
  const sectorStore = memoryStore();
  const marketMapStore = { sourceVersion: 'fixture-v1', async listMapGeographies({ metric }) { return [normalizeFeature(districtRow, metric)]; }, async getMapGeography(id, metric) { return id === districtRow.external_id ? normalizeFeature(districtRow, metric) : null; }, async getMapLevel() { return 'district'; } };
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore, marketLocationData: { resolvePin: () => null },
    sectorRegistry: createSectorRegistry({ store: sectorStore, cacheMs: 0 }), marketResearchService: { generate, parseJson } });
  async function call(method, url, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:8090', ...(body ? { 'content-type': 'application/json' } : {}) };
    let status, payload; await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { payload = value; } });
    return { status, body: payload ? JSON.parse(payload) : null };
  }
  return { call, sectorStore };
}

test('sector endpoints: research, save, then map levels, analysis and forecast follow the sector', async () => {
  const { call, sectorStore } = makeHandler();
  const list = await call('GET', '/api/sectors');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.sectors.map(s => s.id), ['apparel']);
  assert.equal(list.body.hcesItemGroups.length, 29);

  const researched = await call('POST', '/api/sectors/research', { name: 'Coffee cafés' });
  assert.equal(researched.status, 200);
  assert.equal(researched.body.saved, false);
  assert.equal(sectorStore.rows.size, 0, 'research alone does not persist');

  const profile = { ...researched.body.profile, scoringWeights: { demand: 0.2, purchasingPower: 0.2, competition: 0.3, accessibility: 0.15, financial: 0.1, growth: 0.05 } };
  const saved = await call('PUT', '/api/sectors/coffee-cafes', { profile });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.sector.version, 1);
  assert.equal(saved.body.sector.scoringWeights.competition, 0.3);
  assert.equal(saved.body.sector.evidence.organisedShare.url, 'https://www.ibef.org/industry/coffee');

  const apparelLevels = await call('GET', '/api/market/map/levels?metric=potentialRevenue');
  const coffeeLevels = await call('GET', '/api/market/map/levels?metric=potentialRevenue&sector=coffee-cafes');
  assert.equal(coffeeLevels.status, 200);
  assert.equal(coffeeLevels.body.sector.id, 'coffee-cafes');
  const spend = sectorSpend('Karnataka', ['beverages, processed food, etc.']);
  const expected = (600000 * spend.rural + 400000 * spend.urban) * 12 * 0.35 * (1 - 0.12);
  assert.ok(Math.abs(coffeeLevels.body.features[0].metrics.potentialRevenue.value - expected) < 1e-3);
  assert.notEqual(coffeeLevels.body.legend.thresholds[0], apparelLevels.body.legend.thresholds[0], 'legend rescaled for the sector');

  const analysis = await call('GET', `/api/market/analysis?geographyId=${encodeURIComponent(districtRow.external_id)}&sector=coffee-cafes`);
  assert.equal(analysis.status, 200);
  assert.equal(analysis.body.sector.id, 'coffee-cafes');
  assert.deepEqual(analysis.body.assumptions.areaSqFt.value, { low: 1200, mid: 1200, high: 1200 });
  assert.equal(analysis.body.assumptions.areaSqFt.evidenceClass, 'derived_estimate');
  assert.equal(analysis.body.assumptions.grossMargin.evidenceClass, 'model_assumption');
  assert.equal(analysis.body.revenueBasis.areaPotential, Math.round(expected));

  const scoreMetrics = { demand: 80, purchasingPower: 60, competition: 20, accessibility: 70, financial: 50, growth: 90 };
  const forecastBody = { sector: 'coffee-cafes', scoreMetrics, store: { initialInvestment: 1e6, workingCapital: 1e5, areaSqFt: 1000, monthlyFixedCosts: 1e5, grossMargin: 0.6, royaltyRate: 0.05, aov: 300, conversionRate: 0.2, salesRampMonths: 3, initialRampFraction: 0.6 }, market: {}, forecast: { years: 1, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 } };
  const forecast = await call('POST', '/api/market/forecast', forecastBody);
  assert.equal(forecast.status, 200, JSON.stringify(forecast.body));
  assert.equal(forecast.body.viability.weights.competition, 0.3);
  assert.equal(forecast.body.sector.id, 'coffee-cafes');

  assert.equal((await call('GET', '/api/market/map/levels?metric=potentialRevenue&sector=nope')).status, 404);
  assert.equal((await call('GET', '/api/market/map/levels?metric=potentialRevenue&sector=Bad%20Id')).status, 400);
  const ceo = await call('GET', '/api/insights/ceo?sector=coffee-cafes&stores=2');
  assert.equal(ceo.status, 200);
  assert.equal(ceo.body.sector.id, 'coffee-cafes');
  assert.equal(ceo.body.rankingMetric, 'potentialRevenue');
});

test('research unavailable returns 503 with manual entry, and manual sectors save as assumptions', async () => {
  const { call } = makeHandler({ generate: async () => ({ ok: false, error: { code: 'upstream_error', message: 'Research provider request failed.' } }) });
  const failed = await call('POST', '/api/sectors/research', { name: 'Salons' });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.manualEntry, true);
  const manual = await call('PUT', '/api/sectors/salons', { profile: { name: 'Salons', hcesCategories: ['consumer services excluding conveyance'], organisedShare: 0.25, onlineShareOfOrganised: 0, store: { areaSqFt: 600 }, partnerRequirements: { minInvestmentLakh: 20, minAreaSqFt: 500, minLaunchMonths: 2, targetLaunchMonths: 4 }, scoringWeights: APPAREL.scoringWeights } });
  assert.equal(manual.status, 200);
  const s = manual.body.sector;
  assert.deepEqual(s.evidence, {});
  for (const path of ['organisedShare', 'onlineShareOfOrganised', 'store.areaSqFt', 'partnerRequirements.minInvestmentLakh']) assert.ok(s.assumptions.includes(path), path);
  assert.equal(s.partnerRequirements.minInvestmentLakh, 20);
  const rejected = await call('PUT', '/api/sectors/salons', { profile: { name: 'Salons', organisedShare: 7 } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.sector.organisedShare, null);
  assert.match(rejected.body.rejected[0].reason, /plausible range/);
});
