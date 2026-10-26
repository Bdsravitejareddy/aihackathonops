'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');
const { buildCeoInsights, rankAreas } = require('../server/ceo-insights.cjs');
const { analyzeLocation, estimateIncomeTrend } = require('../server/market-analysis.cjs');

// Synthetic state features shaped like /api/market/map/levels; no production code loads them.
const state = (code, name, population, spend, extra = {}) => ({ id: `state:IN-${code}`, name, level: 'state', state: name,
  metrics: { population: { value: population, unit: 'people' }, apparelExpenditure: { value: spend, unit: 'INR/year', evidenceClass: 'derived_estimate' }, ...extra } });
const features = [
  state('KA', 'Karnataka', 61130704, 2.29e11), state('BR', 'Bihar', 103804637, 3.02e11), state('KL', 'Kerala', 33387677, 1.42e11),
  state('MN', 'Manipur', 2721756, 9.6e9), state('TG', 'Telangana', null, null), state('DL', 'Delhi', 16753235, null)
];
const marketMapStore = {
  sourceVersion: 'fixture-v1',
  calls: [],
  async listMapGeographies(args) { this.calls.push(args); return features; },
  async getMapGeography(id) { return features.find(f => f.id === id) || null; }
};
const handler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore, marketLocationData: { resolvePin: () => null } });
async function call(url, host = '127.0.0.1:8080') {
  const req = Readable.from([]); req.method = 'GET'; req.url = url; req.headers = { host };
  let status, body; await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } });
  return { status, body: body ? JSON.parse(body) : null };
}
const card = (result, id) => result.cards.find(c => c.id === id);

test('rankings use only non-null values and list areas with missing population as insufficient data', () => {
  const { ranked, insufficient } = rankAreas(features, 'apparelExpenditure');
  assert.deepEqual(ranked.map(r => r.name), ['Bihar', 'Karnataka', 'Kerala', 'Manipur']);
  assert.deepEqual(insufficient.map(r => r.name), ['Telangana', 'Delhi']);
  assert.deepEqual(insufficient[0].missing, ['population', 'apparelExpenditure']);
  assert.deepEqual(insufficient[1].missing, ['apparelExpenditure']);
});

test('potentialRevenue is the ranking metric whenever the map supplies it', async () => {
  const withPotential = features.map(f => f.name === 'Kerala' ? { ...f, metrics: { ...f.metrics, potentialRevenue: { value: 9e11, unit: 'INR/year', evidenceClass: 'derived_estimate' } } } : f);
  const result = await buildCeoInsights({ features: withPotential, loadGeography: async id => withPotential.find(f => f.id === id), stores: 2 });
  assert.equal(result.rankingMetric, 'potentialRevenue');
  assert.equal(card(result, 'top-markets').geographyName, 'Kerala');
  assert.equal(result.rankedCount, 1);
});

test('CEO card numbers equal the map feature and Analysis panel values for the same geography', async () => {
  const { status, body } = await call('/api/insights/ceo?stores=3');
  assert.equal(status, 200);
  // Same call as the national map layer.
  assert.deepEqual(marketMapStore.calls.at(-1), { parentId: null, level: 'state', metric: 'apparelExpenditure', scenario: { captureRate: null }, includeGeometry: false });
  const top = card(body, 'top-markets');
  assert.equal(top.geographyId, 'state:IN-BR');
  assert.equal(top.value.value, features.find(f => f.id === top.geographyId).metrics.apparelExpenditure.value);

  const best = card(body, 'best-return'), capital = card(body, 'capital');
  const panel = await call(`/api/insights/ceo?stores=3`);
  assert.deepEqual(panel.body.cards.map(c => c.value), body.cards.map(c => c.value), 'deterministic');
  // The Analysis endpoint for the same geography returns the same payback and investment.
  const analysisHandler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore, marketLocationData: { resolvePin: () => null } });
  const req = Readable.from([]); req.method = 'GET'; req.url = `/api/market/analysis?geographyId=${encodeURIComponent(best.geographyId)}`; req.headers = { host: '127.0.0.1:8080' };
  let raw; await analysisHandler(req, { writeHead() {}, setHeader() {}, end(value) { raw = value; } });
  const analysis = JSON.parse(raw);
  const mid = analysis.scenarios.mid;
  assert.equal(best.analysis.paybackMonths, mid.paybackMonths);
  assert.equal(best.analysis.roi5YearPercent, mid.roi5YearPercent);
  assert.equal(capital.perStore.mid, mid.investment);
  assert.equal(capital.value.value, mid.investment * 3);
  assert.equal(capital.range.low, analysis.costRange.investmentTotal.low * 3);
  assert.equal(capital.range.high, analysis.costRange.investmentTotal.high * 3);

  const income = card(body, 'income-growth');
  const trend = estimateIncomeTrend({ level: 'state', name: income.geographyName });
  assert.equal(income.value.value, trend.cagr.longRun.rate * 100);
  for (const f of features) {
    const other = estimateIncomeTrend({ level: 'state', name: f.name });
    if (other.status === 'available') assert.ok(other.cagr.longRun.rate <= trend.cagr.longRun.rate);
  }
  assert.equal(income.badge, 'official');

  const gap = card(body, 'data-gap');
  assert.equal(gap.value.value, 2);
  assert.match(gap.detail, /Telangana, Delhi/);
  for (const c of body.cards) {
    assert.ok(['official', 'estimate', 'assumption'].includes(c.badge), c.id);
    assert.ok(c.headline && c.action, c.id);
  }
});

test('best-return card ranks the top markets by base-case payback from analyzeLocation', async () => {
  const result = await buildCeoInsights({ features, loadGeography: async id => features.find(f => f.id === id), stores: 1 });
  const top = rankAreas(features, 'apparelExpenditure').ranked.slice(0, 5);
  const payback = top.map(t => ({ id: t.id, months: analyzeLocation({ geography: features.find(f => f.id === t.id) }).scenarios.mid.paybackMonths ?? Infinity }));
  const fastest = Math.min(...payback.map(p => p.months));
  assert.equal(card(result, 'best-return').analysis.paybackMonths ?? Infinity, fastest);
  assert.ok(result.warnings.some(w => /city-tier costs only/.test(w)));
});

test('CEO endpoint validates input and reports an unavailable catalog', async () => {
  assert.equal((await call('/api/insights/ceo?stores=0')).status, 400);
  assert.equal((await call('/api/insights/ceo?stores=2.5')).status, 400);
  assert.equal((await call('/api/insights/ceo?stores=abc')).status, 400);
  assert.equal((await call('/api/insights/ceo', 'example.com')).status, 403);
  const bare = createHandler({ store: { load: async () => null, save: async () => 1 } });
  const req = Readable.from([]); req.method = 'GET'; req.url = '/api/insights/ceo'; req.headers = { host: '127.0.0.1:8080' };
  let status; await bare(req, { writeHead(code) { status = code; }, setHeader() {}, end() {} });
  assert.equal(status, 503);
  const failing = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore: { listMapGeographies: async () => { throw new Error('down'); } } });
  const req2 = Readable.from([]); req2.method = 'GET'; req2.url = '/api/insights/ceo'; req2.headers = { host: '127.0.0.1:8080' };
  await failing(req2, { writeHead(code) { status = code; }, setHeader() {}, end() {} });
  assert.equal(status, 503);
});

test('CEO view renders server cards plus the pipeline card and opens an area on the map', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', 'dist', 'ceo-view.js'), 'utf8'));
  const insights = await buildCeoInsights({ features, loadGeography: async id => features.find(f => f.id === id), stores: 4 });
  const requested = [], opened = [];
  const fetch = async url => { requested.push(url); return { ok: true, json: async () => insights }; };
  const view = dom.window.CeoView.mount({ container: dom.window.document.getElementById('root'), fetch, pipeline: { total: 10, recommended: 4, siteNeeded: 3, clarification: 2 }, onOpenArea: id => opened.push(id) });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(requested, ['/api/insights/ceo?stores=4']);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.ceo-card').length, insights.cards.length + 1);
  assert.match(doc.querySelector('[data-ceo-card="pipeline"]').textContent, /4 partners are recommended; 3 still need a confirmed site/);
  assert.match(doc.querySelector('[data-ceo-card="top-markets"] .ceo-badge').textContent, /Estimate/);
  assert.match(doc.querySelector('[data-ceo-card="income-growth"] .ceo-badge').textContent, /Official data/);
  doc.querySelector('[data-ceo-card="top-markets"] [data-ceo-open]').click();
  assert.deepEqual(opened, ['state:IN-BR']);
  assert.match(doc.querySelector('[data-ceo-foot]').textContent, /2 left out for missing data/);
  view.destroy();
});
