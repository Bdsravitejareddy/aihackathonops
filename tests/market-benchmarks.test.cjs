'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBenchmark,
  normalizeComparableBenchmark,
  selectComparableBenchmarks,
  ABFRL_FY26_PANTALOONS_CONTEXT,
  estimateInvestmentRange,
  estimateRevenueScenarios,
  calculateFinancialMetrics
} = require('../server/market-benchmarks.cjs');

function sourceRecord(patch = {}) {
  return {
    title: 'Illustrative test source', publisher: 'Test publisher',
    url: 'https://example.org/report', publicationDate: '2025-01-15',
    referencePeriod: 'FY2024', geography: 'Tier 2 India',
    supportingPassage: 'Test-only assumption, not retailer data.',
    ...patch
  };
}

function benchmark(patch = {}) {
  return {
    id: 'TEST-FORMAT-1', retailer: 'Test fixture only', format: 'small apparel store',
    ownershipModel: 'franchise', category: 'apparel', priceSegment: 'value',
    geography: { country: 'India', tier: 'tier2', name: 'Test city' },
    storeSizeSqFt: 400, annualRevenueINR: 2400000,
    evidenceClass: 'derived', source: sourceRecord(),
    ...patch
  };
}

test('benchmark validation requires traceable source evidence and rejects fabricated-looking gaps', () => {
  const result = validateBenchmark(benchmark());
  assert.equal(result.id, 'TEST-FORMAT-1');
  assert.throws(() => validateBenchmark(benchmark({ source: { ...sourceRecord(), supportingPassage: '' } })), /supporting passage/i);
  assert.throws(() => validateBenchmark(benchmark({ source: { ...sourceRecord(), url: 'not a URL' } })), /source URL/i);
  assert.throws(() => validateBenchmark(benchmark({ annualRevenueINR: -1 })), /annualRevenueINR/i);
  assert.throws(() => validateBenchmark(benchmark({ evidenceClass: 'official' })), /evidenceClass/i);
});

test('normalization derives revenue per square foot with period and provenance intact', () => {
  const normalized = normalizeComparableBenchmark(benchmark());
  assert.equal(normalized.revenuePerSqFtPerYearINR, 6000);
  assert.equal(normalized.revenuePerSqFtEvidenceClass, 'derived');
  assert.equal(normalized.normalization, 'annualRevenueINR / storeSizeSqFt');
  assert.equal(normalized.evidenceClass, 'derived');
  assert.equal(normalizeComparableBenchmark(benchmark({ storeSizeSqFt: null })).revenuePerSqFtPerYearINR, null);
});

test('comparability rejects incompatible format, ownership, segment and size instead of silently using them', () => {
  const candidates = [
    benchmark(),
    benchmark({ id: 'LARGE', format: 'large format', storeSizeSqFt: 20000 }),
    benchmark({ id: 'OWNED', ownershipModel: 'company-owned' }),
    benchmark({ id: 'PREMIUM', priceSegment: 'premium' })
  ];
  const result = selectComparableBenchmarks(candidates, {
    category: 'apparel', priceSegment: 'value', ownershipModel: 'franchise',
    storeSizeSqFt: 400, minSizeRatio: 0.5, maxSizeRatio: 2
  });
  assert.deepEqual(result.accepted.map(item => item.id), ['TEST-FORMAT-1']);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejected.every(item => item.reasons.length));
});

test('ABFRL FY26 context preserves sourced network figures but cannot be treated as 400 sq ft store economics', () => {
  const record = ABFRL_FY26_PANTALOONS_CONTEXT;
  assert.equal(validateBenchmark(record).id, record.id);
  assert.equal(record.networkContext.segmentRevenueINR, 45600000000);
  assert.equal(record.networkContext.ebitdaMargin, 0.162);
  assert.equal(record.networkContext.networkAreaSqFt, 5781000);
  assert.equal(record.networkContext.storeCount, 399);
  assert.ok(Math.abs(record.networkContext.meanAreaPerStoreSqFt - 14488.721804511278) < 1e-10);
  assert.equal(record.networkContext.meanAreaEvidenceClass, 'derived');
  assert.equal(record.storeSizeSqFt, null);
  assert.equal(record.annualRevenueINR, null);
  assert.equal(record.initialInvestmentINR, null);
  const result = selectComparableBenchmarks([record], {
    category: 'apparel', priceSegment: 'value', ownershipModel: 'franchise', storeSizeSqFt: 400
  });
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0].reasons.some(reason => /ownership/i.test(reason)));
  assert.ok(result.rejected[0].reasons.some(reason => /size unavailable/i.test(reason)));
  assert.ok(result.rejected[0].reasons.some(reason => /revenue unavailable/i.test(reason)));
});

test('investment range sums explicit evidence-backed or labelled assumption components', () => {
  const cost = (base, rationale) => ({ min: base * 0.8, recommended: base, max: base * 1.2, unit: 'INR', evidence: { evidenceClass: 'model_assumption', rationale } });
  const result = estimateInvestmentRange({ components: {
    fitOut: cost(100000, 'Test assumption only'),
    inventory: cost(50000, 'Test assumption only'),
    workingCapital: cost(25000, 'Test assumption only')
  } });
  assert.deepEqual(result.totalsINR, { minimum: 140000, recommended: 175000, maximum: 210000 });
  assert.equal(result.evidenceClass, 'model_assumption');
  assert.throws(() => estimateInvestmentRange({ components: { fitOut: { min: 1, recommended: 2, max: 3, unit: 'INR' } } }), /evidence/i);
  assert.throws(() => estimateInvestmentRange({ components: { fitOut: cost(100, 'x'), inventory: { min: 10, recommended: 9, max: 20, unit: 'INR', evidence: { evidenceClass: 'model_assumption', rationale: 'x' } } } }), /ordered/i);
});

test('TAM capture and footfall forecasts remain independent and require explicit scenario assumptions', () => {
  const result = estimateRevenueScenarios({
    evidenceClass: 'model_assumption',
    tam: { annualMarketINR: 12000000, serviceableShare: 0.5, captureRates: { conservative: 0.01, base: 0.02, optimistic: 0.03 } },
    footfall: { monthlyPassingPeople: 10000, entryRate: 0.1, conversionRate: 0.2, averageOrderValueINR: 1000,
      scenarioFactors: { conservative: 0.8, base: 1, optimistic: 1.2 } }
  });
  assert.deepEqual(result.tamAnnualRevenueINR, { conservative: 60000, base: 120000, optimistic: 180000 });
  assert.deepEqual(result.footfallAnnualRevenueINR, { conservative: 1920000, base: 2400000, optimistic: 2880000 });
  assert.equal(result.methodsAreIndependent, true);
  assert.equal(result.inputEvidenceClass, 'model_assumption');
  assert.equal(estimateRevenueScenarios({}).tamAnnualRevenueINR.base, null);
});

test('financial metrics calculate break-even, cash payback, NPV and annualized IRR from explicit cash assumptions', () => {
  const result = calculateFinancialMetrics({
    initialInvestmentINR: 100000, monthlyRevenueINR: 30000, grossMargin: 0.5,
    operatingCostRate: 0.1, monthlyFixedCostsINR: 9000,
    annualDiscountRate: 0.12, months: 24, evidenceClass: 'model_assumption'
  });
  assert.equal(result.breakEvenRevenueMonthlyINR, 22500);
  assert.equal(result.monthlyOperatingCashFlowINR, 3000);
  assert.equal(result.simplePaybackMonths, 34); // Beyond modeled 24 months: no payback within horizon
  assert.equal(result.paybackStatus, 'not_reached_within_horizon');
  const monthlyRate = (1 + 0.12) ** (1 / 12) - 1;
  assert.ok(Math.abs(result.npvINR - (-100000 + 3000 * (1 - (1 + monthlyRate) ** -24) / monthlyRate)) < 1e-8);
  assert.equal(typeof result.irrAnnualPercent, 'number');
  assert.equal(result.evidenceClass, 'model_assumption');
  assert.throws(() => calculateFinancialMetrics({ initialInvestmentINR: 1, monthlyRevenueINR: 2, grossMargin: 0.5, operatingCostRate: 0.1, monthlyFixedCostsINR: 0, annualDiscountRate: 0.1, months: 12 }), /evidenceClass/i);
  assert.equal(calculateFinancialMetrics({}).breakEvenRevenueMonthlyINR, null);
});
