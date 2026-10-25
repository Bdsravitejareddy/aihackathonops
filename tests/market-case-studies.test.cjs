'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreMarketViability, projectStoreEconomics } = require('../server/market-forecast.cjs');

const caseStudies = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/case-studies/india-fashion-catchments.json'), 'utf8'));

const store = {
  initialInvestment: 1000000,
  workingCapital: 100000,
  areaSqFt: 1000,
  monthlyFixedCosts: 100000,
  grossMargin: 0.5,
  royaltyRate: 0.05,
  aov: 1000,
  monthlyPassingPedestrianTraffic: 30000,
  entryRate: 1 / 3,
  trafficEvidenceClass: 'model_assumption',
  conversionRate: 0.1,
  salesRampMonths: 6,
  initialRampFraction: 0.5
};

test('market viability score uses provisional weights and discloses factor contributions', () => {
  const result = scoreMarketViability({ demand: 80, purchasingPower: 60, competition: 40, accessibility: 70, financial: 70, growth: 60 });
  assert.equal(result.score, 64);
  assert.equal(result.status, 'provisional');
  assert.equal(result.factors.length, 6);
  assert.equal(result.weights.demand, 0.25);
});

test('missing factor keeps market score incomplete without redistributing its weight', () => {
  const result = scoreMarketViability({ demand: 80, purchasingPower: null, competition: 40, accessibility: 70, financial: 70, growth: 60 });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.score, null);
  assert.equal(result.weights.purchasingPower, 0.2);
});

test('financial loss or critical evidence gate the market recommendation', () => {
  const factors = { demand: 100, purchasingPower: 100, competition: 100, accessibility: 100, financial: 100, growth: 100 };
  const loss = scoreMarketViability(factors, undefined, { downsideCashFlowNegative: true });
  assert.equal(loss.status, 'gated');
  const missing = scoreMarketViability(factors, undefined, { criticalEvidenceMissing: true });
  assert.equal(missing.status, 'gated');
});

test('store forecast distinguishes passing traffic, store visits and transactions', () => {
  const result = projectStoreEconomics({ store, market: { samAnnual: 50000000, captureBenchmark: 0.05 }, forecast: { years: 5, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 } });
  const month1 = result.scenarios.base.months[0];
  assert.equal(month1.passingPedestrianTraffic, 30000);
  assert.equal(month1.storeVisits, 10000);
  assert.equal(month1.transactions, 500);
  assert.equal(month1.revenue, 500000);
  assert.equal(month1.rampFactor, 0.5);
  assert.equal(result.footfall.evidenceClass, 'model_assumption');
  assert.equal(result.footfall.uniqueShoppers.value, null);
});

test('store forecast models a 60-month ramp, three scenarios and nominal vs real expansion', () => {
  const result = projectStoreEconomics({ store, market: { samAnnual: 50000000, captureBenchmark: 0.05 }, forecast: { years: 5, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 } });
  for (const name of ['conservative', 'base', 'optimistic']) assert.equal(result.scenarios[name].months.length, 60);
  assert.ok(result.scenarios.conservative.months[5].revenue < result.scenarios.base.months[5].revenue);
  assert.ok(result.scenarios.base.months[5].revenue < result.scenarios.optimistic.months[5].revenue);
  assert.equal(result.expansion.years.length, 5);
  assert.equal(result.expansion.years[2].year, 3);
  assert.equal(result.expansion.years[4].year, 5);
  assert.ok(result.expansion.years[4].nominalRevenue > result.expansion.years[4].realRevenue);
  assert.equal(result.scenarios.base.years[0].samAnnual, 50000000);
  assert.equal(typeof result.scenarios.base.years[0].impliedCaptureRate, 'number');
});

test('break-even, required capture, cash flow, ROI, payback, NPV and IRR are unit-consistent', () => {
  const result = projectStoreEconomics({ store, market: { samAnnual: 50000000, captureBenchmark: 0.05 }, forecast: { years: 5, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 } });
  assert.ok(Math.abs(result.economics.breakEvenRevenueMonthly - 222222.2222) < 0.01);
  assert.ok(Math.abs(result.economics.requiredAnnualCaptureRate - (222222.2222 * 12 / 50000000)) < 1e-8);
  assert.equal(result.scenarios.base.months[0].cumulativeCashFlow, -975000);
  assert.ok(result.economics.base.roiPercent > 0);
  assert.ok(result.economics.base.paybackMonths > 0);
  assert.ok(Number.isFinite(result.economics.base.npv));
  assert.ok(Number.isFinite(result.economics.base.irrAnnual));
});

test('unsupported store visits or market size stay unavailable instead of becoming zero', () => {
  const incomplete = projectStoreEconomics({ store: { ...store, monthlyPassingPedestrianTraffic: null, entryRate: null }, market: {}, forecast: { years: 5, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 } });
  assert.equal(incomplete.footfall.storeVisits.value, null);
  assert.equal(incomplete.economics.requiredAnnualCaptureRate, null);
  assert.equal(incomplete.economics.base.paybackMonths, null);
});

test('contraction scenarios are allowed and year-one sales density uses one year only', () => {
  const input = { store, market: { samAnnual: 50000000 }, forecast: { years: 3, annualNominalGrowth: -0.05, annualInflation: -0.01, discountRate: 0.08 } };
  const result = projectStoreEconomics(input);
  const yearOne = result.scenarios.base.years[0].nominalRevenue;
  assert.equal(result.economics.revenuePerSqFtYearOne, yearOne / store.areaSqFt);
  assert.equal(result.scenarios.base.years[2].nominalRevenue < result.scenarios.base.years[1].nominalRevenue, true);
});

test('three contrasting city case studies use Census geography and never claim PIN catchment population', () => {
  assert.equal(caseStudies.cases.length, 3);
  assert.deepEqual(caseStudies.cases.map(item => item.role), ['metro', 'tier2', 'smaller_city']);
  for (const item of caseStudies.cases) {
    assert.equal(item.geography.level, 'census_town');
    assert.equal(item.catchmentPinPopulation, null);
    assert.ok(item.evidence.length > 0);
    assert.ok(item.limitations.length > 0);
  }
});
