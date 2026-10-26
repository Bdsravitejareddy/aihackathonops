'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCustomerMarket } = require('../server/customer-market-model.cjs');

function completeInput(overrides = {}) {
  return {
    relevantPopulation: 1000,
    customerPenetration: 0.5,
    baselineAnnualSpend: 10000,
    incomeSegments: [
      { share: 0.25, spendingMultiplier: 0.5 },
      { share: 0.75, spendingMultiplier: 1.5 }
    ],
    serviceablePercentage: 0.4,
    capturePercentage: 0.1,
    evidence: { status: 'estimated', source: 'survey' },
    provenance: {
      sourceGeography: 'Pune, India',
      sourceYear: 2025,
      uncertainty: { low: 0.8, high: 1.2 },
      confidence: 0.7
    },
    ...overrides
  };
}

test('calculates customer TAM, SAM, and SOM with an income weighted annual spend', () => {
  const result = calculateCustomerMarket(completeInput());

  assert.deepEqual(result.metrics, {
    tam: { annualRevenue: 6250000, customers: 500 },
    sam: { annualRevenue: 2500000, customers: 200 },
    som: { annualRevenue: 250000, customers: 20 }
  });
  assert.deepEqual(result.units, { annualRevenue: 'INR/year', customers: 'people' });
  assert.deepEqual(result.formulaBreakdown, {
    weightedSpendMultiplier: 1.25,
    adjustedAnnualSpendPerCustomer: 12500,
    eligibleCustomers: 500,
    serviceableCustomers: 200,
    capturedCustomers: 20,
    tamAnnualRevenue: 6250000,
    samAnnualRevenue: 2500000,
    somAnnualRevenue: 250000
  });
  assert.deepEqual(result.evidence, { status: 'estimated', source: 'survey' });
  assert.deepEqual(result.provenance, {
    sourceGeography: 'Pune, India',
    sourceYear: 2025,
    uncertainty: { low: 0.8, high: 1.2 },
    confidence: 0.7
  });
});

test('accepts zero values and returns zero market sizes', () => {
  const result = calculateCustomerMarket(completeInput({
    relevantPopulation: 0,
    customerPenetration: 0,
    baselineAnnualSpend: 0,
    incomeSegments: [{ share: 1, spendingMultiplier: 0 }],
    serviceablePercentage: 0,
    capturePercentage: 0
  }));

  assert.deepEqual(result.metrics, {
    tam: { annualRevenue: 0, customers: 0 },
    sam: { annualRevenue: 0, customers: 0 },
    som: { annualRevenue: 0, customers: 0 }
  });
});

test('leaves derived metrics uncalculated when a required metric is null or missing', () => {
  const withNull = calculateCustomerMarket(completeInput({ baselineAnnualSpend: null }));
  const withMissing = completeInput();
  delete withMissing.capturePercentage;
  const missingResult = calculateCustomerMarket(withMissing);

  for (const result of [withNull, missingResult]) {
    assert.equal(result.complete, false);
    assert.deepEqual(result.metrics, { tam: null, sam: null, som: null });
    assert.equal(result.formulaBreakdown, null);
  }
  assert.deepEqual(withNull.missingInputs, ['baselineAnnualSpend']);
  assert.deepEqual(missingResult.missingInputs, ['capturePercentage']);
});

test('rejects out of range fractions and non-normalized income shares', () => {
  for (const input of [
    completeInput({ customerPenetration: 1.01 }),
    completeInput({ serviceablePercentage: -0.01 }),
    completeInput({ capturePercentage: 2 }),
    completeInput({ incomeSegments: [{ share: 0.6, spendingMultiplier: 1 }] })
  ]) {
    assert.throws(() => calculateCustomerMarket(input), RangeError);
  }
});

test('accepts income segment shares normalized within floating point tolerance', () => {
  const result = calculateCustomerMarket(completeInput({
    incomeSegments: [
      { share: 0.5, spendingMultiplier: 1 },
      { share: 0.5000000001, spendingMultiplier: 1 }
    ]
  }));

  assert.equal(result.formulaBreakdown.weightedSpendMultiplier, 1.0000000001);
});

test('preserves supported evidence statuses and does not invent missing provenance', () => {
  for (const status of ['observed', 'estimated', 'scenario input']) {
    const result = calculateCustomerMarket(completeInput({ evidence: { status } }));
    assert.deepEqual(result.evidence, { status });
  }

  const input = completeInput();
  delete input.evidence;
  delete input.provenance;
  const result = calculateCustomerMarket(input);
  assert.equal(Object.hasOwn(result, 'evidence'), false);
  assert.equal(Object.hasOwn(result, 'provenance'), false);
});

test('rejects evidence with an unsupported status', () => {
  assert.throws(
    () => calculateCustomerMarket(completeInput({ evidence: { status: 'inferred' } })),
    RangeError
  );
});

test('rejects invalid population, spend, multipliers, and non-finite derived values', () => {
  for (const input of [
    completeInput({ relevantPopulation: -1 }),
    completeInput({ baselineAnnualSpend: Infinity }),
    completeInput({ incomeSegments: [{ share: 1, spendingMultiplier: -1 }] }),
    completeInput({ relevantPopulation: Number.MAX_VALUE, baselineAnnualSpend: Number.MAX_VALUE,
      incomeSegments: [{ share: 1, spendingMultiplier: 1 }] })
  ]) {
    assert.throws(() => calculateCustomerMarket(input), RangeError);
  }
});
