'use strict';

const DEFAULT_ELASTICITIES = Object.freeze([0.5, 0.75, 1, 1.25]);

function isPositiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function metric(status, value, unit, evidenceClass, assumptions = [], warnings = []) {
  return { status, value, unit, evidenceClass, assumptions, warnings };
}

function unavailable(unit, reason, assumptions = []) {
  return metric('unavailable', null, unit, 'derived_estimate', assumptions, [reason]);
}

function validatePin(pin) {
  return typeof pin === 'string' && /^[1-9][0-9]{5}$/.test(pin);
}

function estimatePerCapitaSpend({ regionalSpend, pinIncomeProxy, regionalIncomeProxy, elasticity = 1 } = {}) {
  const warnings = [];
  if (![regionalSpend, pinIncomeProxy, regionalIncomeProxy].every(isPositiveFinite)) {
    warnings.push('Regional spend and both income proxies must be supplied as positive finite numbers.');
    return metric('unavailable', null, 'INR/person/month', 'derived_estimate', [], warnings);
  }
  if (!isPositiveFinite(elasticity)) {
    return metric('invalid', null, 'INR/person/month', 'derived_estimate', [], ['Elasticity must be a positive finite number.']);
  }
  const value = regionalSpend * (pinIncomeProxy / regionalIncomeProxy) ** elasticity;
  if (!Number.isFinite(value)) {
    return metric('unavailable', null, 'INR/person/month', 'derived_estimate', [], ['The spend estimate is outside the supported numeric range.']);
  }
  return metric('estimated', value, 'INR/person/month', 'derived_estimate', [
    `Regional spend ${regionalSpend} × (PIN income proxy ${pinIncomeProxy} / regional income proxy ${regionalIncomeProxy})^${elasticity}.`,
    'Income proxies are modeled inputs, not official PIN-level income observations.'
  ], warnings);
}

function factor(value, name, assumptions, warnings) {
  if (!isPositiveFinite(value) && value !== 0) {
    warnings.push(`${name} must be supplied as a finite value from 0 to 1.`);
    return null;
  }
  if (value > 1) {
    warnings.push(`${name} must be no greater than 1.`);
    return null;
  }
  assumptions.push(`${name}=${value} applied once.`);
  return value;
}

function calculateMarketAssessment(input = {}) {
  const warnings = [];
  const demand = input.demand || {};
  const segmentation = input.segmentation || {};
  const economics = input.economics || {};
  const metrics = {};
  let monthlyPerCapitaSpend = demand.monthlyPerCapitaSpend;
  const spendAssumptions = [];

  if (monthlyPerCapitaSpend === undefined && demand.monthlyHouseholdSpend !== undefined) {
    if (isPositiveFinite(demand.monthlyHouseholdSpend) && isPositiveFinite(demand.householdSize)) {
      monthlyPerCapitaSpend = demand.monthlyHouseholdSpend / demand.householdSize;
      spendAssumptions.push(`Household monthly spend divided by stated household size (${demand.householdSize}) to derive per-capita spend.`);
    } else {
      monthlyPerCapitaSpend = null;
      spendAssumptions.push('Household spend conversion requires positive household spend and an explicit positive household size.');
    }
  }

  metrics.annualPerCapitaSpend = isPositiveFinite(monthlyPerCapitaSpend)
    ? metric('estimated', monthlyPerCapitaSpend * 12, 'INR/person/year', 'derived_estimate', [...spendAssumptions, 'Monthly per-capita spend multiplied by 12.'])
    : unavailable('INR/person/year', 'A positive monthly per-capita spend or convertible household spend is required.', spendAssumptions);

  const population = demand.population;
  metrics.tam = isPositiveFinite(population) && metrics.annualPerCapitaSpend.value !== null
    ? metric('estimated', population * metrics.annualPerCapitaSpend.value, 'INR/year', 'derived_estimate', [`Population ${population} × annual per-capita spend; no household conversion applied.`])
    : unavailable('INR/year', 'TAM requires positive population and per-capita spend.');

  const names = ['categoryShare', 'audienceFit', 'priceEligibility', 'accessibility'];
  const factors = names.map(name => factor(segmentation[name], name, [], warnings));
  const captureRate = factor(segmentation.captureRate, 'captureRate', [], warnings);
  if (metrics.tam.value !== null && factors.every(value => value !== null)) {
    const share = factors.reduce((product, value) => product * value, 1);
    metrics.sam = metric('estimated', metrics.tam.value * share, 'INR/year', 'derived_estimate', names.map((name, index) => `${name}=${factors[index]} applied once.`));
  } else {
    metrics.sam = unavailable('INR/year', 'SAM requires TAM and explicit category, audience, price, and accessibility factors.');
  }
  metrics.som = metrics.sam.value !== null && captureRate !== null
    ? metric('estimated', metrics.sam.value * captureRate, 'INR/year', 'derived_estimate', [`Capture rate ${captureRate} applied once to SAM.`])
    : unavailable('INR/year', 'SOM requires SAM and an explicit capture rate from 0 to 1.');

  if (isPositiveFinite(economics.monthlyFixedCosts) && isPositiveFinite(economics.grossMargin) && economics.grossMargin <= 1) {
    metrics.breakEvenRevenue = metric('estimated', economics.monthlyFixedCosts / economics.grossMargin, 'INR/month', 'derived_estimate', ['Monthly fixed costs divided by gross margin.']);
  } else {
    metrics.breakEvenRevenue = unavailable('INR/month', 'Break-even revenue requires positive monthly fixed costs and gross margin from 0 to 1.');
  }
  const monthlyContribution = isPositiveFinite(economics.monthlyRevenue) && isPositiveFinite(economics.grossMargin) && economics.grossMargin <= 1
    ? economics.monthlyRevenue * economics.grossMargin - (Number.isFinite(economics.monthlyFixedCosts) && economics.monthlyFixedCosts >= 0 ? economics.monthlyFixedCosts : NaN)
    : NaN;
  metrics.paybackMonths = isPositiveFinite(economics.initialInvestment) && Number.isFinite(monthlyContribution) && monthlyContribution > 0
    ? metric('estimated', economics.initialInvestment / monthlyContribution, 'months', 'derived_estimate', ['Initial investment divided by positive monthly contribution after fixed costs; assumes constant monthly performance.'])
    : unavailable('months', 'Payback requires positive initial investment and positive monthly contribution after fixed costs.');

  const riskWarnings = [];
  if (input.risk?.downsideCashFlowNegative === true) riskWarnings.push('Downside scenario has negative cash flow.');
  if (input.risk?.criticalEvidenceMissing === true) riskWarnings.push('Critical evidence is missing.');
  warnings.push(...riskWarnings);
  const decision = riskWarnings.length
    ? { status: 'gated', warnings: riskWarnings }
    : { status: 'provisional', warnings: ['Market calculations do not determine franchisee eligibility or constitute an unconditional investment approval.'] };
  return {
    modelVersion: 'india-fashion-market-v1',
    sensitivities: { elasticity: [...DEFAULT_ELASTICITIES] },
    metrics,
    decision,
    warnings
  };
}

module.exports = { DEFAULT_ELASTICITIES, validatePin, estimatePerCapitaSpend, calculateMarketAssessment };
