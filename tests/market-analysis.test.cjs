'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');
const { resolveTier, estimateIncomeTrend, validateOverrides, projectScenario, analyzeLocation } = require('../server/market-analysis.cjs');
const income = require('../data/india-state-per-capita-income.json');
const costs = require('../data/india-store-cost-benchmarks.json');

// Synthetic geographies shaped like the map catalog; no production code loads them.
const pin = { id: 'pin:560026', name: 'Test office · Bengaluru', level: 'pin', city: 'Bengaluru', state: 'Karnataka', metrics: {} };
const city = name => ({ id: `city:${name}`, name, level: 'city', state: 'Karnataka', metrics: {} });

test('city tiers come from the HRA classification and PINs inherit their city', () => {
  assert.equal(resolveTier(pin).tierClass, 'X');
  assert.match(resolveTier(pin).basis, /PIN inherits/);
  assert.equal(resolveTier(city('Mysuru')).tierClass, 'Y');
  assert.equal(resolveTier(city('Hubballi')).tierClass, 'Y');
  const z = resolveTier(city('Tumakuru'));
  assert.equal(z.tierClass, 'Z');
  assert.ok(z.warnings.some(w => /defaulted to Z/.test(w)));
  const state = resolveTier({ level: 'state', name: 'Karnataka' });
  assert.equal(state.tierClass, 'mixed');
  assert.deepEqual(state.levels, { low: 'Z', mid: 'Y', high: 'X' });
  // A territory with only an X city (Delhi) uses X for the mid case, not the residual Z class.
  assert.deepEqual(resolveTier({ level: 'state', name: 'Delhi' }).levels, { low: 'Z', mid: 'X', high: 'X' });
  // A Y city name in another state must not match.
  assert.equal(resolveTier({ level: 'city', name: 'Mysuru', state: 'Kerala' }).tierClass, 'Z');
});

test('cost range is ordered low ≤ mid ≤ high and every assumption is classified and sourced or caveated', () => {
  const result = analyzeLocation({ geography: pin });
  const { investmentTotal, components } = result.costRange;
  assert.ok(investmentTotal.low <= investmentTotal.mid && investmentTotal.mid <= investmentTotal.high);
  for (const row of components) assert.ok(row.low <= row.mid && row.mid <= row.high, row.component);
  // Tier-1 rent band is applied.
  assert.deepEqual(result.assumptions.rentPerSqFtMonth.value, costs.assumptions.rentPerSqFtMonth.byTierClass.X);
  for (const [key, item] of Object.entries(result.assumptions)) {
    assert.ok(['official_observed', 'official_survey_estimate', 'derived_estimate', 'model_assumption'].includes(item.evidenceClass), key);
    if (item.evidenceClass === 'model_assumption') assert.ok(item.caveat, `${key} needs a visible caveat`);
    else assert.ok(item.sources.length && item.sources.every(s => s.url.startsWith('https://')), `${key} needs a source`);
  }
  // Hand check: mid fit-out = area × fit-out per sq ft; deposit = rent × months.
  const a = costs.assumptions;
  assert.equal(components.find(r => r.component === 'fitOut').mid, a.areaSqFt.value.mid * a.fitOutPerSqFt.value.mid);
  assert.equal(components.find(r => r.component === 'securityDeposit').mid, a.areaSqFt.value.mid * a.rentPerSqFtMonth.byTierClass.X.mid * a.depositMonthsOfRent.value.mid);
  const tier3 = analyzeLocation({ geography: city('Tumakuru') });
  assert.ok(tier3.costRange.investmentTotal.mid < investmentTotal.mid, 'Tier 3 rent lowers the investment');
});

test('ROI, payback and break-even match a hand-checked flat example', () => {
  // ₹12,00,000 invested; ₹12,00,000/yr revenue, 50% contribution, ₹25,000/month fixed:
  // monthly cash flow = 1,00,000 × 0.5 − 25,000 = 25,000 → payback 48 months;
  // 60-month cash = 15,00,000 → ROI = (15,00,000 − 12,00,000) / 12,00,000 = 25%.
  const flat = projectScenario({ investment: 1200000, annualRevenue: 1200000, fixedMonthly: 25000, contributionMargin: 0.5, growth: 0, inflation: 0, discountRate: 0, initialRamp: 1, rampMonths: 1 });
  assert.equal(flat.paybackMonths, 48);
  assert.equal(flat.totalCashFlow, 1500000);
  assert.equal(flat.roi5YearPercent, 25);
  assert.equal(flat.npv, 300000);
  assert.equal(flat.years[0].operatingCashFlow, 300000);
  assert.equal(flat.years.at(-1).cumulativeCashFlow, 300000);
  // Break-even revenue = fixed × 12 / contribution margin, checked through the full analysis with overrides.
  const result = analyzeLocation({ geography: pin, overrides: { annualRevenue: 50000000, grossMargin: 0.35, royaltyRate: 0.05, marketingRate: 0.02 } });
  const mid = result.scenarios.mid;
  assert.equal(mid.contributionMargin, 0.28);
  assert.equal(mid.breakEvenRevenueAnnual, Math.round(mid.monthlyFixedCosts * 12 / 0.28));
  assert.equal(mid.annualRevenue, 50000000);
});

test('scenarios pair downside revenue with high costs and carry a 5-year projection', () => {
  // Area potential ₹90 Cr × capture 5% / 10% / 15% = ₹4.5 / 9 / 13.5 Cr; capacity 8,652 sq ft × ₹7,888 / 8,520 / 9,595.
  const result = analyzeLocation({ geography: { ...pin, metrics: { potentialRevenue: { value: 900000000, unit: 'INR/year', evidenceClass: 'derived_estimate' } } } });
  const { low, mid, high } = result.scenarios;
  const cap = costs.assumptions.captureRate.value, density = costs.assumptions.revenuePerSqFtYear.value, area = costs.assumptions.areaSqFt.value.mid;
  assert.equal(result.revenueBasis.basis, 'potentialRevenue');
  assert.equal(low.annualRevenue, Math.round(900000000 * cap.low));
  assert.equal(low.revenueConstraint, 'demand_limited');
  assert.equal(mid.annualRevenue, area * density.mid);
  assert.equal(mid.demandRevenue, Math.round(900000000 * cap.mid));
  assert.equal(mid.revenueConstraint, 'store_capacity_limited');
  assert.equal(high.annualRevenue, area * density.high);
  assert.deepEqual(result.revenueBasis.constraint, { low: 'demand_limited', mid: 'store_capacity_limited', high: 'store_capacity_limited' });
  assert.ok(low.investment >= mid.investment && mid.investment >= high.investment);
  assert.ok(low.roi5YearPercent <= mid.roi5YearPercent && mid.roi5YearPercent <= high.roi5YearPercent);
  // A PIN with a large area potential never yields store revenue above the store's capacity.
  const areaWide = analyzeLocation({ geography: { ...pin, metrics: { potentialRevenue: { value: 5e11, unit: 'INR/year', evidenceClass: 'derived_estimate' } } } });
  for (const s of Object.values(areaWide.scenarios)) { assert.ok(s.annualRevenue <= s.capacityRevenue); assert.equal(s.revenueConstraint, 'store_capacity_limited'); }
  assert.ok(areaWide.warnings.some(w => /capped at store capacity/.test(w)));
  // Small demand binds below capacity; the capture rate is editable.
  const small = analyzeLocation({ geography: { ...pin, metrics: { potentialRevenue: { value: 2e8, unit: 'INR/year', evidenceClass: 'derived_estimate' } } } , overrides: { captureRate: 0.2 } });
  assert.equal(small.scenarios.mid.annualRevenue, 4e7);
  assert.equal(small.scenarios.mid.revenueConstraint, 'demand_limited');
  assert.equal(small.assumptions.captureRate.evidenceClass, 'user_assumption');
  assert.throws(() => analyzeLocation({ geography: pin, overrides: { captureRate: 1.2 } }), /fraction/);
  for (const s of [low, mid, high]) { assert.equal(s.projection.length, 5); assert.ok(s.paybackMonths === null || s.paybackMonths >= 1); }
});

test('implausible inputs surface warnings instead of being clamped', () => {
  const result = analyzeLocation({ geography: pin, overrides: { annualRevenue: 5e10 } });
  assert.equal(result.scenarios.mid.annualRevenue, 5e10);
  assert.ok(result.warnings.some(w => /payback in the first month is implausible/.test(w)));
  assert.ok(result.warnings.some(w => /ROI .* (outside the plausible range|implausibly high)/.test(w)));
  assert.ok(result.warnings.some(w => /area-wide market figure/.test(w)));
  const unordered = analyzeLocation({ geography: pin, overrides: { fitOutPerSqFt: { low: 3000, mid: 1000 } } });
  assert.ok(unordered.warnings.some(w => /Fit-out and interiors costs are not ordered/.test(w)));
});

test('override validation rejects unknown keys, negatives, non-finite values and out-of-range rates', () => {
  assert.deepEqual(validateOverrides({ areaSqFt: 4000 }), { areaSqFt: { low: 4000, mid: 4000, high: 4000 } });
  assert.throws(() => validateOverrides({ bogus: 1 }), /Unknown assumption/);
  assert.throws(() => validateOverrides({ areaSqFt: -1 }), /non-negative/);
  assert.throws(() => validateOverrides({ areaSqFt: Infinity }), /number or an object/);
  assert.throws(() => validateOverrides({ areaSqFt: 0 }), /positive/);
  assert.throws(() => validateOverrides({ grossMargin: 1.5 }), /fraction/);
  assert.throws(() => validateOverrides({ rampMonths: 2.5 }), /integer/);
  assert.throws(() => validateOverrides({ rentPerSqFtMonth: { mid: 'x' } }), /finite/);
  assert.throws(() => validateOverrides([1]), /object/);
});

test('income trend uses the state per-capita NSDP series and labels sub-state use as an estimate', () => {
  const trend = estimateIncomeTrend(pin);
  const ka = income.states.Karnataka;
  assert.equal(trend.status, 'available');
  assert.equal(trend.latest.value, ka['2024-25']);
  assert.equal(trend.appliedAs, 'inherited_from_state');
  assert.equal(trend.evidenceClass, 'derived_estimate');
  const expected = (ka['2024-25'] / ka['2016-17']) ** (1 / 8) - 1;
  assert.ok(Math.abs(trend.cagr.longRun.rate - expected) < 1e-12);
  assert.equal(trend.projection.length, 5);
  assert.equal(trend.projection[0].year, '2025-26');
  assert.equal(trend.projection[0].value, Math.round(ka['2024-25'] * (1 + expected)));
  assert.ok(trend.warnings.some(w => /State-level Karnataka income applied/.test(w)));
  assert.equal(estimateIncomeTrend({ level: 'state', name: 'Karnataka' }).evidenceClass, 'official_observed');
  // NA cells are omitted, never imputed: Gujarat has no 2024-25 value.
  assert.equal(estimateIncomeTrend({ level: 'state', name: 'Gujarat' }).latest.year, '2023-24');
  assert.equal(estimateIncomeTrend({ level: 'state', name: 'Atlantis' }).status, 'unavailable');
});

async function call(handler, { method = 'GET', url, body, host = '127.0.0.1:8080' }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method = method; req.url = url; req.headers = { host, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) };
  let status, payload;
  await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { payload = value; } });
  return { status, body: payload ? JSON.parse(payload) : null };
}

test('analysis endpoint returns assumptions, scenarios, income trend, warnings and evidence', async () => {
  const marketMapStore = { getMapGeography: async id => id === 'city:Test' ? { ...city('Mysuru'), id } : null };
  const marketLocationData = { resolvePin: code => code === '560026' ? pin : null };
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore, marketLocationData });
  const ok = await call(handler, { url: '/api/market/analysis?geographyId=pin%3A560026' });
  assert.equal(ok.status, 200);
  for (const key of ['assumptions', 'scenarios', 'incomeTrend', 'warnings', 'evidence', 'costRange']) assert.ok(ok.body[key], key);
  assert.deepEqual(Object.keys(ok.body.scenarios), ['low', 'mid', 'high']);
  assert.equal(ok.body.tier.tierClass, 'X');
  const viaStore = await call(handler, { method: 'POST', url: '/api/market/analysis', body: { geographyId: 'city:Test', overrides: { areaSqFt: 4000 } } });
  assert.equal(viaStore.status, 200);
  assert.equal(viaStore.body.tier.tierClass, 'Y');
  assert.equal(viaStore.body.assumptions.areaSqFt.evidenceClass, 'user_assumption');
  const withQueryOverrides = await call(handler, { url: `/api/market/analysis?geographyId=pin%3A560026&overrides=${encodeURIComponent(JSON.stringify({ franchiseFee: 0 }))}` });
  assert.equal(withQueryOverrides.status, 200);
  assert.equal(withQueryOverrides.body.assumptions.franchiseFee.value.mid, 0);
  assert.equal((await call(handler, { url: '/api/market/analysis' })).status, 400);
  assert.equal((await call(handler, { url: '/api/market/analysis?geographyId=%3Cscript%3E' })).status, 400);
  assert.equal((await call(handler, { url: '/api/market/analysis?geographyId=pin%3A560026&overrides=%7Bbad' })).status, 400);
  assert.equal((await call(handler, { method: 'POST', url: '/api/market/analysis', body: { geographyId: 'pin:560026', overrides: { rentPerSqFtMonth: -5 } } })).status, 400);
  assert.equal((await call(handler, { method: 'POST', url: '/api/market/analysis', body: { geographyId: 'pin:560026', overrides: { grossMargin: 2 } } })).status, 400);
  assert.equal((await call(handler, { method: 'POST', url: '/api/market/analysis', body: { geographyId: 'city:Missing' } })).status, 404);
  assert.equal((await call(handler, { method: 'DELETE', url: '/api/market/analysis' })).status, 405);
  assert.equal((await call(handler, { url: '/api/market/analysis?geographyId=pin%3A560026', host: 'example.com' })).status, 403);
});

test('analysis endpoint reports an unavailable catalog instead of failing silently', async () => {
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketLocationData: { resolvePin: () => null } });
  assert.equal((await call(handler, { url: '/api/market/analysis?geographyId=state%3AKA' })).status, 503);
  const failing = createHandler({ store: { load: async () => null, save: async () => 1 }, marketLocationData: { resolvePin: () => null }, marketMapStore: { getMapGeography: async () => { throw new Error('down'); } } });
  assert.equal((await call(failing, { url: '/api/market/analysis?geographyId=state%3AKA' })).status, 503);
});

test('analysis panel renders the range, income trend and editable assumptions in the side panel', async () => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs'), path = require('node:path');
  const dom = new JSDOM('<div id="panel"></div>', { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', 'dist', 'market-analysis.js'), 'utf8'));
  const requests = [];
  const fetch = async (url, init) => { const body = JSON.parse(init.body); requests.push(body); return { ok: true, json: async () => analyzeLocation({ geography: pin, overrides: body.overrides }) }; };
  const panel = dom.window.MarketAnalysisPanel.create({ container: dom.window.document.getElementById('panel'), fetch });
  panel.load('pin:560026');
  await new Promise(resolve => setTimeout(resolve, 10));
  const html = dom.window.document.getElementById('panel').innerHTML;
  assert.match(html, /Downside/); assert.match(html, /Upside/); assert.match(html, /Payback/);
  assert.match(html, /Estimated growth in per-capita income/);
  assert.match(html, /Edit assumptions/);
  assert.match(html, /Model assumption/);
  const form = dom.window.document.querySelector('[data-analysis-form]');
  form.querySelector('[name="areaSqFt"]').value = '4000';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(requests.at(-1), { geographyId: 'pin:560026', overrides: { areaSqFt: 4000 } });
  assert.match(dom.window.document.getElementById('panel').innerHTML, /1 assumption edited/);
  panel.destroy();
});
