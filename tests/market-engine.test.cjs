const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePin, estimatePerCapitaSpend, calculateMarketAssessment } = require('../server/market-engine.cjs');

test('PIN validation accepts six digits and rejects malformed or coerced values', () => {
  assert.equal(validatePin('560001'), true);
  for (const pin of ['0560001', '56000', '56000A', ' 560001', 560001, null]) {
    assert.equal(validatePin(pin), false, `${String(pin)} should be invalid`);
  }
});

test('elasticity presets scale per-capita spend deterministically', () => {
  const args = { regionalSpend: 400, pinIncomeProxy: 8000, regionalIncomeProxy: 4000 };
  const values = [0.5, 0.75, 1, 1.25].map(elasticity => estimatePerCapitaSpend({ ...args, elasticity }).value);
  [565.685424949238, 672.7171322029716, 800, 951.3656920021768].forEach((expected, index) => assert.ok(Math.abs(values[index] - expected) < 1e-10));
  assert.equal(estimatePerCapitaSpend(args).value, 800);
  assert.equal(estimatePerCapitaSpend({ ...args, elasticity: 0 }).status, 'invalid');
});

test('missing, zero, negative and non-finite proxies remain unavailable', () => {
  for (const patch of [{ pinIncomeProxy: null }, { pinIncomeProxy: 0 }, { regionalIncomeProxy: 0 }, { regionalSpend: undefined }, { pinIncomeProxy: -1 }, { regionalSpend: Infinity }]) {
    const result = estimatePerCapitaSpend({ regionalSpend: 400, pinIncomeProxy: 8000, regionalIncomeProxy: 4000, ...patch });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.value, null);
    assert.ok(result.warnings.length);
  }
});

test('assessment keeps per-capita and household expenditure as distinct units', () => {
  const perCapita = calculateMarketAssessment({ demand: { population: 1000, monthlyPerCapitaSpend: 200 } });
  assert.equal(perCapita.metrics.annualPerCapitaSpend.unit, 'INR/person/year');
  assert.equal(perCapita.metrics.annualPerCapitaSpend.value, 2400);
  assert.equal(perCapita.metrics.tam.value, 2400000);
  const household = calculateMarketAssessment({ demand: { population: 1000, monthlyHouseholdSpend: 600, householdSize: 3 } });
  assert.equal(household.metrics.annualPerCapitaSpend.value, 2400);
  assert.ok(household.metrics.annualPerCapitaSpend.assumptions.some(x => /household/i.test(x)));
  assert.equal(calculateMarketAssessment({ demand: { population: 1000, monthlyHouseholdSpend: 600 } }).metrics.tam.value, null);
});

test('TAM, SAM, and SOM apply each declared factor once', () => {
  const result = calculateMarketAssessment({
    demand: { population: 1000, monthlyPerCapitaSpend: 100 },
    segmentation: { categoryShare: 0.5, audienceFit: 0.8, priceEligibility: 0.5, accessibility: 0.5, captureRate: 0.1 }
  });
  assert.equal(result.metrics.tam.value, 1200000);
  assert.equal(result.metrics.sam.value, 120000);
  assert.equal(result.metrics.som.value, 12000);
  for (const key of ['tam', 'sam', 'som']) assert.ok(result.metrics[key].unit);
});

test('break-even and payback require complete inputs and return transparent values', () => {
  const result = calculateMarketAssessment({ economics: { monthlyFixedCosts: 100000, grossMargin: 0.5, initialInvestment: 600000, monthlyRevenue: 300000 } });
  assert.equal(result.metrics.breakEvenRevenue.value, 200000);
  assert.equal(result.metrics.paybackMonths.value, 12);
  const incomplete = calculateMarketAssessment({ economics: { monthlyFixedCosts: 100000, grossMargin: 0 } });
  assert.equal(incomplete.metrics.breakEvenRevenue.value, null);
  assert.equal(incomplete.metrics.paybackMonths.value, null);
});

test('market break-even and payback subtract royalties from gross margin when supplied', () => {
  const result = calculateMarketAssessment({ economics: { monthlyFixedCosts: 100000, grossMargin: 0.5, royaltyRate: 0.05, initialInvestment: 600000, monthlyRevenue: 300000 } });
  assert.equal(result.metrics.breakEvenRevenue.value, 100000 / 0.45);
  assert.equal(result.metrics.paybackMonths.value, 600000 / (300000 * 0.45 - 100000));
});

test('risk gates block unconditional approval for downside loss or critical evidence gaps', () => {
  for (const risk of [{ downsideCashFlowNegative: true }, { criticalEvidenceMissing: true }]) {
    const result = calculateMarketAssessment({ risk, economics: { monthlyFixedCosts: 1, grossMargin: 0.5, initialInvestment: 10, monthlyRevenue: 20 } });
    assert.notEqual(result.decision.status, 'unconditional');
    assert.ok(result.warnings.length);
  }
});

test('every calculated metric exposes structured evidence and outputs are JSON serializable', () => {
  const result = calculateMarketAssessment({ demand: { population: 100, monthlyPerCapitaSpend: 100 } });
  for (const metric of Object.values(result.metrics)) {
    for (const key of ['status', 'value', 'unit', 'evidenceClass', 'assumptions', 'warnings']) assert.ok(Object.hasOwn(metric, key));
  }
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('metrics carry explicit source vintage and geography, with missing provenance unavailable', () => {
  const input = {
    sourceVintage: 'HCES 2023-24',
    geography: { level: 'state', name: 'Karnataka' },
    demand: { population: 100, monthlyPerCapitaSpend: 100 }
  };
  const withProvenance = calculateMarketAssessment(input);
  assert.deepEqual(withProvenance.metrics.tam.sourceVintage, { status: 'available', value: 'HCES 2023-24' });
  assert.deepEqual(withProvenance.metrics.tam.geography, { status: 'available', value: { level: 'state', name: 'Karnataka' } });
  const withoutProvenance = calculateMarketAssessment({ demand: input.demand });
  assert.equal(withoutProvenance.metrics.tam.sourceVintage.status, 'unavailable');
  assert.equal(withoutProvenance.metrics.tam.geography.status, 'unavailable');
});

test('annualization and TAM overflow return unavailable metrics with warnings', () => {
  const annualizationOverflow = calculateMarketAssessment({ demand: { monthlyPerCapitaSpend: Number.MAX_VALUE } });
  assert.equal(annualizationOverflow.metrics.annualPerCapitaSpend.status, 'unavailable');
  assert.equal(annualizationOverflow.metrics.annualPerCapitaSpend.value, null);
  assert.ok(annualizationOverflow.metrics.annualPerCapitaSpend.warnings.length);

  const tamOverflow = calculateMarketAssessment({ demand: { population: Number.MAX_VALUE, monthlyPerCapitaSpend: 1 } });
  assert.equal(tamOverflow.metrics.annualPerCapitaSpend.status, 'estimated');
  assert.equal(tamOverflow.metrics.tam.status, 'unavailable');
  assert.equal(tamOverflow.metrics.tam.value, null);
  assert.ok(tamOverflow.metrics.tam.warnings.length);
});

test('regional HCES benchmark annualizes without claiming PIN population or income adjustment', () => {
  const result=calculateMarketAssessment({demand:{monthlyPerCapitaSpend:374.22,spendBasis:'Karnataka urban HCES 2023-24 state-sector benchmark; no PIN income adjustment.'}});
  assert.equal(result.metrics.annualPerCapitaSpend.value,4490.64);
  assert.equal(result.metrics.tam.value,null);
  assert.ok(result.metrics.annualPerCapitaSpend.assumptions.some(value=>/state-sector benchmark/i.test(value)));
});

test('zero SAM factors are valid boundaries while invalid factors block SAM and SOM', () => {
  const base = { demand: { population: 100, monthlyPerCapitaSpend: 100 } };
  const zero = calculateMarketAssessment({ ...base, segmentation: { categoryShare: 0, audienceFit: 1, priceEligibility: 1, accessibility: 1, captureRate: 0 } });
  assert.equal(zero.metrics.sam.value, 0);
  assert.equal(zero.metrics.som.value, 0);

  const invalid = calculateMarketAssessment({ ...base, segmentation: { categoryShare: -0.1, audienceFit: 1, priceEligibility: 1, accessibility: 1, captureRate: 1 } });
  assert.equal(invalid.metrics.sam.status, 'unavailable');
  assert.equal(invalid.metrics.som.status, 'unavailable');
  assert.ok(invalid.warnings.some(warning => /categoryShare/.test(warning)));
});
