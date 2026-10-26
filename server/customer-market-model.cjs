'use strict';

const REQUIRED_INPUTS = [
  'relevantPopulation',
  'customerPenetration',
  'baselineAnnualSpend',
  'incomeSegments',
  'serviceablePercentage',
  'capturePercentage'
];
const EVIDENCE_STATUSES = new Set(['observed', 'estimated', 'scenario input']);
const SEGMENT_SHARE_TOLERANCE = 1e-9;

function assertFiniteNonnegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number`);
  }
}

function assertFraction(value, name) {
  assertFiniteNonnegative(value, name);
  if (value > 1) throw new RangeError(`${name} must be between 0 and 1`);
}

function validateSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError('incomeSegments must be a non-empty array');
  }

  let shareTotal = 0;
  let weightedSpendMultiplier = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
      throw new TypeError(`incomeSegments[${index}] must be an object`);
    }
    assertFraction(segment.share, `incomeSegments[${index}].share`);
    assertFiniteNonnegative(segment.spendingMultiplier, `incomeSegments[${index}].spendingMultiplier`);
    shareTotal += segment.share;
    weightedSpendMultiplier += segment.share * segment.spendingMultiplier;
  }

  if (!Number.isFinite(shareTotal) || Math.abs(shareTotal - 1) > SEGMENT_SHARE_TOLERANCE) {
    throw new RangeError('income segment shares must sum to 1');
  }
  if (!Number.isFinite(weightedSpendMultiplier)) {
    throw new RangeError('weightedSpendMultiplier must be finite');
  }
  return weightedSpendMultiplier;
}

function validateEvidence(evidence) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('evidence must be an object');
  }
  if (Object.hasOwn(evidence, 'status') && !EVIDENCE_STATUSES.has(evidence.status)) {
    throw new RangeError(`evidence.status must be one of: ${Array.from(EVIDENCE_STATUSES).join(', ')}`);
  }
}

function calculateCustomerMarket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('input must be an object');
  }

  const missingInputs = REQUIRED_INPUTS.filter((key) => !Object.hasOwn(input, key) || input[key] === null || input[key] === undefined);

  for (const key of ['relevantPopulation', 'baselineAnnualSpend']) {
    if (!missingInputs.includes(key)) assertFiniteNonnegative(input[key], key);
  }
  for (const key of ['customerPenetration', 'serviceablePercentage', 'capturePercentage']) {
    if (!missingInputs.includes(key)) assertFraction(input[key], key);
  }

  let weightedSpendMultiplier = null;
  if (!missingInputs.includes('incomeSegments')) weightedSpendMultiplier = validateSegments(input.incomeSegments);
  if (Object.hasOwn(input, 'evidence') && input.evidence !== null && input.evidence !== undefined) {
    validateEvidence(input.evidence);
  }

  const result = {
    complete: missingInputs.length === 0,
    missingInputs,
    units: { annualRevenue: 'INR/year', customers: 'people' },
    metrics: { tam: null, sam: null, som: null },
    formulaBreakdown: null,
    formulas: {
      weightedSpendMultiplier: 'sum(incomeSegments[].share * incomeSegments[].spendingMultiplier)',
      adjustedAnnualSpendPerCustomer: 'baselineAnnualSpend * weightedSpendMultiplier',
      tamCustomers: 'relevantPopulation * customerPenetration',
      samCustomers: 'tamCustomers * serviceablePercentage',
      somCustomers: 'samCustomers * capturePercentage',
      tamAnnualRevenue: 'tamCustomers * adjustedAnnualSpendPerCustomer',
      samAnnualRevenue: 'tamAnnualRevenue * serviceablePercentage',
      somAnnualRevenue: 'samAnnualRevenue * capturePercentage'
    },
    assumptions: [
      'Income segment shares describe the composition of customers reached by customerPenetration.',
      'Each segment multiplier scales baselineAnnualSpend for an annual spend estimate.',
      'Serviceability and capture percentages apply successively to customers and annual revenue.'
    ]
  };

  if (Object.hasOwn(input, 'evidence') && input.evidence !== undefined) result.evidence = input.evidence;
  if (Object.hasOwn(input, 'provenance') && input.provenance !== undefined) result.provenance = input.provenance;
  if (!result.complete) return result;

  const adjustedAnnualSpendPerCustomer = input.baselineAnnualSpend * weightedSpendMultiplier;
  const eligibleCustomers = input.relevantPopulation * input.customerPenetration;
  const serviceableCustomers = eligibleCustomers * input.serviceablePercentage;
  const capturedCustomers = serviceableCustomers * input.capturePercentage;
  const tamAnnualRevenue = eligibleCustomers * adjustedAnnualSpendPerCustomer;
  const samAnnualRevenue = tamAnnualRevenue * input.serviceablePercentage;
  const somAnnualRevenue = samAnnualRevenue * input.capturePercentage;
  const intermediates = {
    weightedSpendMultiplier,
    adjustedAnnualSpendPerCustomer,
    eligibleCustomers,
    serviceableCustomers,
    capturedCustomers,
    tamAnnualRevenue,
    samAnnualRevenue,
    somAnnualRevenue
  };

  for (const [name, value] of Object.entries(intermediates)) {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  }

  result.metrics = {
    tam: { annualRevenue: tamAnnualRevenue, customers: eligibleCustomers },
    sam: { annualRevenue: samAnnualRevenue, customers: serviceableCustomers },
    som: { annualRevenue: somAnnualRevenue, customers: capturedCustomers }
  };
  result.formulaBreakdown = intermediates;
  return result;
}

module.exports = { calculateCustomerMarket };
