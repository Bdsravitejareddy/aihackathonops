'use strict';

const DEFAULT_ELASTICITIES = Object.freeze([0.5, 0.75, 1, 1.25]);
const { missingEvidence } = require('./market-evidence.cjs');

function isPositiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function metric(status, value, unit, evidenceClass, assumptions = [], warnings = []) {
  return { status, value, unit, evidenceClass, assumptions, warnings };
}

function unavailable(unit, reason, assumptions = [], cause = 'user_input_required', nextAction = 'Provide the missing input, then recalculate this assessment.') {
  return { ...metric('unavailable', null, unit, 'derived_estimate', assumptions, [reason]), missing: missingEvidence(cause, nextAction) };
}

function finiteEstimate(value, unit, assumptions, warning) {
  return Number.isFinite(value)
    ? metric('estimated', value, unit, 'derived_estimate', assumptions)
    : unavailable(unit, warning, assumptions);
}

function provenanceField(value, label) {
  const present = value !== undefined && value !== null && value !== '';
  return present
    ? { status: 'available', value }
    : { status: 'unavailable', value: null, warnings: [`${label} was not supplied.`] };
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
  if (typeof demand.spendBasis === 'string' && demand.spendBasis.trim()) spendAssumptions.push(demand.spendBasis.trim());

  metrics.annualPerCapitaSpend = isPositiveFinite(monthlyPerCapitaSpend)
    ? finiteEstimate(monthlyPerCapitaSpend * 12, 'INR/person/year', [...spendAssumptions, 'Monthly per-capita spend multiplied by 12.'], 'Annualizing monthly per-capita spend overflowed the supported numeric range.')
    : unavailable('INR/person/year', 'A positive monthly per-capita spend or convertible household spend is required.', spendAssumptions, 'user_input_required', 'Enter a sourced monthly per-person spend, or household spend with household size.');

  const population = demand.population;
  metrics.tam = isPositiveFinite(population) && metrics.annualPerCapitaSpend.value !== null
    ? finiteEstimate(population * metrics.annualPerCapitaSpend.value, 'INR/year', [`Population ${population} × annual per-capita spend; no household conversion applied.`], 'TAM multiplication overflowed the supported numeric range.')
    : unavailable('INR/year', 'TAM requires positive population and per-capita spend.', [], 'missing_calculation_dependency', 'Supply supported population and annual per-person spend inputs; TAM will remain blank until both are present.');

  const names = ['categoryShare', 'audienceFit', 'priceEligibility', 'accessibility'];
  const factors = names.map(name => factor(segmentation[name], name, [], warnings));
  const captureRate = factor(segmentation.captureRate, 'captureRate', [], warnings);
  if (metrics.tam.value !== null && factors.every(value => value !== null)) {
    const share = factors.reduce((product, value) => product * value, 1);
    metrics.sam = finiteEstimate(metrics.tam.value * share, 'INR/year', names.map((name, index) => `${name}=${factors[index]} applied once.`), 'SAM calculation overflowed the supported numeric range.');
  } else {
    metrics.sam = unavailable('INR/year', 'SAM requires TAM and explicit category, audience, price, and accessibility factors.', [], metrics.tam.value === null ? 'missing_calculation_dependency' : 'user_input_required', metrics.tam.value === null ? 'Resolve the TAM population and spend dependencies first.' : 'Enter documented category share, audience fit, price eligibility, and accessibility factors.');
  }
  metrics.som = metrics.sam.value !== null && captureRate !== null
    ? finiteEstimate(metrics.sam.value * captureRate, 'INR/year', [`Capture rate ${captureRate} applied once to SAM.`], 'SOM calculation overflowed the supported numeric range.')
    : unavailable('INR/year', 'SOM requires SAM and an explicit capture rate from 0 to 1.', [], metrics.sam.value === null ? 'missing_calculation_dependency' : 'user_input_required', metrics.sam.value === null ? 'Resolve the SAM dependencies first.' : 'Enter an explicit capture rate from 0 to 1.');

  const royaltyRate = economics.royaltyRate === undefined ? 0 : economics.royaltyRate;
  const contributionMargin = isPositiveFinite(economics.grossMargin) && economics.grossMargin <= 1
    && typeof royaltyRate === 'number' && Number.isFinite(royaltyRate) && royaltyRate >= 0 && royaltyRate < economics.grossMargin
    ? economics.grossMargin - royaltyRate : null;
  if (isPositiveFinite(economics.monthlyFixedCosts) && contributionMargin !== null) {
    metrics.breakEvenRevenue = finiteEstimate(economics.monthlyFixedCosts / contributionMargin, 'INR/month', [
      `Monthly fixed costs divided by contribution margin (${economics.grossMargin} gross margin − ${royaltyRate} royalty rate).`,
      ...(economics.royaltyRate === undefined ? ['Royalty rate was not supplied and is assumed to be 0 for this calculation.'] : [])
    ], 'Break-even calculation overflowed the supported numeric range.');
  } else {
    metrics.breakEvenRevenue = unavailable('INR/month', 'Break-even revenue requires positive monthly fixed costs and a gross margin greater than the supplied royalty rate.', [], 'user_input_required', 'Enter monthly fixed costs and a gross margin above the royalty rate.');
  }
  const monthlyContribution = isPositiveFinite(economics.monthlyRevenue) && contributionMargin !== null
    ? economics.monthlyRevenue * contributionMargin - (Number.isFinite(economics.monthlyFixedCosts) && economics.monthlyFixedCosts >= 0 ? economics.monthlyFixedCosts : NaN)
    : NaN;
  metrics.paybackMonths = isPositiveFinite(economics.initialInvestment) && Number.isFinite(monthlyContribution) && monthlyContribution > 0
    ? finiteEstimate(economics.initialInvestment / monthlyContribution, 'months', ['Initial investment divided by positive monthly contribution after fixed costs; assumes constant monthly performance.'], 'Payback calculation overflowed the supported numeric range.')
    : unavailable('months', 'Payback requires positive initial investment and positive monthly contribution after fixed costs.', [], 'missing_calculation_dependency', 'Provide initial investment, monthly revenue, fixed costs, and a valid gross margin/royalty rate.');

  const riskWarnings = [];
  if (input.risk?.downsideCashFlowNegative === true) riskWarnings.push('Downside scenario has negative cash flow.');
  if (input.risk?.criticalEvidenceMissing === true) riskWarnings.push('Critical evidence is missing.');
  warnings.push(...riskWarnings);
  const sourceVintage = provenanceField(input.sourceVintage, 'Source vintage');
  const geography = provenanceField(input.geography, 'Geography');
  for (const result of Object.values(metrics)) {
    result.sourceVintage = sourceVintage;
    result.geography = geography;
  }
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
