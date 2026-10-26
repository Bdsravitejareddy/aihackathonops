'use strict';

const EVIDENCE_CLASSES = new Set(['observed', 'derived', 'model_assumption']);
const INVESTMENT_LEVELS = ['min', 'recommended', 'max'];
const SCENARIOS = ['conservative', 'base', 'optimistic'];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const ABFRL_FY26_PANTALOONS_CONTEXT = deepFreeze({
  id: 'ABFRL-PANTALOONS-NETWORK-FY26',
  retailer: 'Aditya Birla Fashion and Retail Limited — Pantaloons',
  format: 'Pantaloons retail network aggregate; individual unit format not established',
  ownershipModel: 'not_disclosed',
  category: 'apparel',
  priceSegment: 'not_disclosed',
  geography: { country: 'India', tier: 'national', name: 'India network aggregate' },
  storeSizeSqFt: null,
  annualRevenueINR: null,
  initialInvestmentINR: null,
  evidenceClass: 'observed',
  scope: 'network_context_not_individual_store_comparable',
  networkContext: {
    segmentRevenueINR: 45600000000,
    segmentRevenueEvidenceClass: 'observed',
    segmentRevenueScope: 'Pantaloons FY26 segment revenue; not attributed to individual stores or a single format',
    ebitdaMargin: 0.162,
    ebitdaMarginEvidenceClass: 'observed',
    ebitdaMarginScope: 'Pantaloons segment FY26 EBITDA margin',
    networkAreaSqFt: 5781000,
    networkAreaEvidenceClass: 'observed',
    storeCount: 399,
    storeCountEvidenceClass: 'observed',
    referenceDate: '2026-03-31',
    meanAreaPerStoreSqFt: 5781000 / 399,
    meanAreaEvidenceClass: 'derived',
    meanAreaDerivation: 'networkAreaSqFt / storeCount',
    storeRevenuePerStoreINR: null,
    storeRevenuePerSqFtINR: null,
    investmentCostsINR: null
  },
  source: {
    title: 'ABFRL Q4 & FY26 Investor Presentation',
    publisher: 'Aditya Birla Fashion and Retail Limited',
    url: 'https://www.abfrl.com/wp-content/uploads/2026/05/SE_Investor-Presentation.pdf',
    publicationDate: '2026-05-25',
    referencePeriod: 'FY2026; network area and store count at March 2026',
    geography: 'India network aggregate',
    supportingPassage: 'FY26 Update: segment revenue Rs. 4560 Cr; segment EBITDA margin 16.2%. Area (000s sq. ft.) / stores, Mar 2026: 5,781 / 399.',
    pageReferences: ['PDF extraction P11', 'PDF extraction P15']
  }
});

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function bounded(value, name, min, max) {
  if (!finite(value) || value < min || value > max) throw new RangeError(`${name} must be a finite number from ${min} to ${max}`);
  return value;
}
function positive(value, name, allowZero = false) {
  if (!finite(value) || value < (allowZero ? 0 : Number.MIN_VALUE)) throw new RangeError(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  return value;
}
function isoDate(value, name) {
  const date = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!date) throw new TypeError(`${name} must be an ISO calendar date (YYYY-MM-DD)`);
  const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
  if (parsed.toISOString().slice(0, 10) !== value) throw new TypeError(`${name} must be an ISO calendar date (YYYY-MM-DD)`);
}

/** Validate and return a detached benchmark record. No benchmark values are embedded in this module. */
function validateBenchmark(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('benchmark must be an object');
  for (const key of ['id', 'retailer', 'format', 'ownershipModel', 'category', 'priceSegment']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError(`${key} is required`);
  }
  if (!EVIDENCE_CLASSES.has(input.evidenceClass)) throw new TypeError(`evidenceClass must be one of ${[...EVIDENCE_CLASSES].join(', ')}`);
  if (!input.geography || typeof input.geography !== 'object' || typeof input.geography.tier !== 'string' || !input.geography.tier.trim()) throw new TypeError('geography.tier is required');
  const source = input.source;
  if (!source || typeof source !== 'object') throw new TypeError('source provenance is required');
  for (const key of ['title', 'publisher', 'referencePeriod', 'geography', 'supportingPassage']) {
    if (typeof source[key] !== 'string' || !source[key].trim()) throw new TypeError(key === 'supportingPassage' ? 'source supporting passage is required' : `source.${key} is required`);
  }
  let sourceUrl;
  try { sourceUrl = new URL(source.url); } catch { throw new TypeError('source URL must be a valid HTTPS URL'); }
  if (sourceUrl.protocol !== 'https:') throw new TypeError('source URL must use HTTPS');
  isoDate(source.publicationDate, 'source.publicationDate');
  if (source.retrievedAt !== undefined) isoDate(source.retrievedAt, 'source.retrievedAt');
  const storeSizeSqFt = input.storeSizeSqFt;
  const annualRevenueINR = input.annualRevenueINR;
  if (storeSizeSqFt !== null && storeSizeSqFt !== undefined) positive(storeSizeSqFt, 'storeSizeSqFt');
  if (annualRevenueINR !== null && annualRevenueINR !== undefined) positive(annualRevenueINR, 'annualRevenueINR', true);
  if (input.initialInvestmentINR !== undefined && input.initialInvestmentINR !== null) positive(input.initialInvestmentINR, 'initialInvestmentINR', true);
  return {
    ...input,
    geography: { ...input.geography },
    source: { ...source, url: sourceUrl.href },
    storeSizeSqFt: storeSizeSqFt ?? null,
    annualRevenueINR: annualRevenueINR ?? null,
    initialInvestmentINR: input.initialInvestmentINR ?? null
  };
}

function normalizeComparableBenchmark(input) {
  const benchmark = validateBenchmark(input);
  const revenuePerSqFtPerYearINR = finite(benchmark.annualRevenueINR) && finite(benchmark.storeSizeSqFt)
    ? benchmark.annualRevenueINR / benchmark.storeSizeSqFt
    : null;
  return {
    ...benchmark,
    revenuePerSqFtPerYearINR: revenuePerSqFtPerYearINR !== null && Number.isFinite(revenuePerSqFtPerYearINR) ? revenuePerSqFtPerYearINR : null,
    revenuePerSqFtEvidenceClass: revenuePerSqFtPerYearINR === null ? null : 'derived',
    normalization: revenuePerSqFtPerYearINR === null ? null : 'annualRevenueINR / storeSizeSqFt',
    normalizationUnit: revenuePerSqFtPerYearINR === null ? null : 'INR/sq_ft/year'
  };
}

function selectComparableBenchmarks(benchmarks, target) {
  if (!Array.isArray(benchmarks)) throw new TypeError('benchmarks must be an array');
  if (!target || typeof target !== 'object') throw new TypeError('target applicability is required');
  const minSizeRatio = target.minSizeRatio ?? 0.5;
  const maxSizeRatio = target.maxSizeRatio ?? 2;
  positive(minSizeRatio, 'minSizeRatio');
  positive(maxSizeRatio, 'maxSizeRatio');
  if (minSizeRatio > maxSizeRatio) throw new RangeError('minSizeRatio must not exceed maxSizeRatio');
  if (target.storeSizeSqFt != null) positive(target.storeSizeSqFt, 'target.storeSizeSqFt');
  const accepted = [], rejected = [];
  for (const raw of benchmarks) {
    const item = normalizeComparableBenchmark(raw);
    const reasons = [];
    for (const field of ['category', 'priceSegment', 'ownershipModel']) {
      if (target[field] && item[field].toLowerCase() !== String(target[field]).toLowerCase()) reasons.push(`${field} mismatch`);
    }
    if (target.format && item.format.toLowerCase() !== String(target.format).toLowerCase()) reasons.push('format mismatch');
    if (target.geographyTier && item.geography.tier.toLowerCase() !== String(target.geographyTier).toLowerCase()) reasons.push('geography tier mismatch');
    if (target.storeSizeSqFt && item.storeSizeSqFt) {
      const ratio = item.storeSizeSqFt / target.storeSizeSqFt;
      if (ratio < minSizeRatio || ratio > maxSizeRatio) reasons.push(`store size ratio ${ratio.toFixed(3)} outside ${minSizeRatio}–${maxSizeRatio}`);
    } else if (target.storeSizeSqFt && !item.storeSizeSqFt) reasons.push('store size unavailable');
    if (item.annualRevenueINR === null) reasons.push('annual revenue unavailable');
    (reasons.length ? rejected : accepted).push(reasons.length ? { benchmark: item, reasons } : item);
  }
  return { accepted, rejected };
}

function validateCostEvidence(evidence, name) {
  if (!evidence || !EVIDENCE_CLASSES.has(evidence.evidenceClass)) throw new TypeError(`${name}.evidence must identify evidenceClass`);
  if (evidence.evidenceClass === 'model_assumption') {
    if (typeof evidence.rationale !== 'string' || !evidence.rationale.trim()) throw new TypeError(`${name}.evidence.rationale is required for assumptions`);
  } else {
    if (typeof evidence.sourceUrl !== 'string') throw new TypeError(`${name}.evidence.sourceUrl is required for sourced costs`);
    let url;
    try { url = new URL(evidence.sourceUrl); } catch { throw new TypeError(`${name}.evidence.sourceUrl must be HTTPS`); }
    if (url.protocol !== 'https:') throw new TypeError(`${name}.evidence.sourceUrl must be HTTPS`);
    if (typeof evidence.reference !== 'string' || !evidence.reference.trim()) throw new TypeError(`${name}.evidence.reference is required for sourced costs`);
    if (evidence.evidenceClass === 'derived' && (typeof evidence.method !== 'string' || !evidence.method.trim())) throw new TypeError(`${name}.evidence.method is required for derived costs`);
  }
}

/** Sum only supplied setup-cost components; omitted components are reported as missing, never imputed. */
function estimateInvestmentRange(input) {
  const components = input?.components;
  if (!components || typeof components !== 'object' || Array.isArray(components) || !Object.keys(components).length) throw new TypeError('components must contain explicit investment inputs');
  const totals = { min: 0, recommended: 0, max: 0 }, evidence = [], rows = [];
  for (const [name, item] of Object.entries(components)) {
    if (!item || typeof item !== 'object' || item.unit !== 'INR') throw new TypeError(`${name} must provide INR costs`);
    for (const level of INVESTMENT_LEVELS) positive(item[level], `${name}.${level}`, true);
    if (!(item.min <= item.recommended && item.recommended <= item.max)) throw new RangeError(`${name} cost levels must be ordered min <= recommended <= max`);
    validateCostEvidence(item.evidence, name);
    for (const level of INVESTMENT_LEVELS) totals[level] += item[level];
    evidence.push({ component: name, ...item.evidence });
    rows.push({ component: name, ...Object.fromEntries(INVESTMENT_LEVELS.map(level => [level, item[level]])), unit: 'INR', evidence: { ...item.evidence } });
  }
  const evidenceClass = evidence.some(item => item.evidenceClass === 'model_assumption') ? 'model_assumption'
    : evidence.some(item => item.evidenceClass === 'derived') ? 'derived' : 'observed';
  return {
    status: 'estimated', unit: 'INR', evidenceClass, components: rows,
    totalsINR: { minimum: totals.min, recommended: totals.recommended, maximum: totals.max },
    missingComponents: Array.isArray(input.expectedComponents) ? input.expectedComponents.filter(name => !Object.hasOwn(components, name)) : []
  };
}

function blankScenarios() { return Object.fromEntries(SCENARIOS.map(name => [name, null])); }
function scenarioValues(raw, name, min, max) {
  if (!raw || typeof raw !== 'object') return null;
  const values = {};
  for (const scenario of SCENARIOS) {
    if (!finite(raw[scenario])) return null;
    values[scenario] = bounded(raw[scenario], `${name}.${scenario}`, min, max);
  }
  return values;
}

/** Produce two independent annual revenue ranges. They are deliberately not blended or added. */
function estimateRevenueScenarios(input = {}) {
  const tamAnnualRevenueINR = blankScenarios(), tamMonthlyRevenueINR = blankScenarios();
  const footfallAnnualRevenueINR = blankScenarios(), footfallMonthlyRevenueINR = blankScenarios();
  const tam = input.tam;
  if (tam && finite(tam.annualMarketINR) && tam.annualMarketINR >= 0) {
    const serviceableShare = bounded(tam.serviceableShare, 'tam.serviceableShare', 0, 1);
    const captures = scenarioValues(tam.captureRates, 'tam.captureRates', 0, 1);
    if (captures) for (const scenario of SCENARIOS) {
      const annual = tam.annualMarketINR * serviceableShare * captures[scenario];
      tamAnnualRevenueINR[scenario] = Number.isFinite(annual) ? annual : null;
      tamMonthlyRevenueINR[scenario] = Number.isFinite(annual) ? annual / 12 : null;
    }
  } else if (tam?.annualMarketINR !== undefined && tam.annualMarketINR !== null && (!finite(tam.annualMarketINR) || tam.annualMarketINR < 0)) {
    throw new RangeError('tam.annualMarketINR must be finite and non-negative');
  }
  const footfall = input.footfall;
  if (footfall && finite(footfall.monthlyPassingPeople) && footfall.monthlyPassingPeople >= 0) {
    const entryRate = bounded(footfall.entryRate, 'footfall.entryRate', 0, 1);
    const conversionRate = bounded(footfall.conversionRate, 'footfall.conversionRate', 0, 1);
    const averageOrderValueINR = positive(footfall.averageOrderValueINR, 'footfall.averageOrderValueINR', true);
    const factors = scenarioValues(footfall.scenarioFactors, 'footfall.scenarioFactors', 0, Number.MAX_VALUE);
    if (factors) for (const scenario of SCENARIOS) {
      const monthly = footfall.monthlyPassingPeople * factors[scenario] * entryRate * conversionRate * averageOrderValueINR;
      footfallMonthlyRevenueINR[scenario] = Number.isFinite(monthly) ? monthly : null;
      footfallAnnualRevenueINR[scenario] = Number.isFinite(monthly * 12) ? monthly * 12 : null;
    }
  } else if (footfall?.monthlyPassingPeople !== undefined && footfall.monthlyPassingPeople !== null && (!finite(footfall.monthlyPassingPeople) || footfall.monthlyPassingPeople < 0)) {
    throw new RangeError('footfall.monthlyPassingPeople must be finite and non-negative');
  }
  const tamComplete = Object.values(tamAnnualRevenueINR).every(finite);
  const footfallComplete = Object.values(footfallAnnualRevenueINR).every(finite);
  const hasInputs = tamComplete || footfallComplete;
  if (hasInputs && !EVIDENCE_CLASSES.has(input.evidenceClass)) throw new TypeError(`evidenceClass must be one of ${[...EVIDENCE_CLASSES].join(', ')} when revenue scenarios are calculable`);
  return {
    tamAnnualRevenueINR, tamMonthlyRevenueINR, footfallAnnualRevenueINR, footfallMonthlyRevenueINR,
    tamStatus: tamComplete ? 'scenario_estimate' : 'unavailable',
    footfallStatus: footfallComplete ? 'scenario_estimate' : 'unavailable',
    inputEvidenceClass: hasInputs ? input.evidenceClass : null,
    methodsAreIndependent: true,
    warning: 'The TAM and site-footfall methods are independent scenarios. Do not add them; compare assumptions and reconcile against observed store performance.'
  };
}

function irrMonthly(cashFlows) {
  if (!cashFlows.some(value => value < 0) || !cashFlows.some(value => value > 0)) return null;
  const npvAt = rate => cashFlows.reduce((sum, value, index) => sum + value / (1 + rate) ** index, 0);
  let low = -0.999999, high = 1;
  while (npvAt(high) > 0 && high < 1e8) high *= 2;
  if (npvAt(low) * npvAt(high) > 0) return null;
  for (let index = 0; index < 160; index++) {
    const middle = (low + high) / 2;
    if (npvAt(middle) > 0) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

/** Constant monthly operating cash-flow helper; excludes financing, tax, depreciation and terminal value. */
function calculateFinancialMetrics(input = {}) {
  const required = ['initialInvestmentINR', 'monthlyRevenueINR', 'grossMargin', 'operatingCostRate', 'monthlyFixedCostsINR', 'annualDiscountRate', 'months'];
  const missingInputs = required.filter(name => input[name] === undefined || input[name] === null);
  if (missingInputs.length) return {
    status: 'unavailable', missingInputs,
    breakEvenRevenueMonthlyINR: null, monthlyOperatingCashFlowINR: null,
    simplePaybackMonths: null, paybackStatus: 'unavailable', roiPercent: null, npvINR: null, irrAnnualPercent: null,
    cashFlowDefinition: 'Operating cash flow = revenue × (gross margin − operating cost rate) − fixed costs; no tax, debt, depreciation or terminal value.'
  };
  if (!EVIDENCE_CLASSES.has(input.evidenceClass)) throw new TypeError(`evidenceClass must be one of ${[...EVIDENCE_CLASSES].join(', ')}`);
  const investment = positive(input.initialInvestmentINR, 'initialInvestmentINR', true);
  const revenue = positive(input.monthlyRevenueINR, 'monthlyRevenueINR', true);
  const grossMargin = bounded(input.grossMargin, 'grossMargin', 0, 1);
  const operatingCostRate = bounded(input.operatingCostRate, 'operatingCostRate', 0, 1);
  const fixed = positive(input.monthlyFixedCostsINR, 'monthlyFixedCostsINR', true);
  const discount = input.annualDiscountRate;
  if (!finite(discount) || discount <= -1) throw new RangeError('annualDiscountRate must be finite and greater than -1');
  const months = input.months;
  if (!Number.isInteger(months) || months < 1 || months > 600) throw new RangeError('months must be an integer from 1 to 600');
  const contributionMargin = grossMargin - operatingCostRate;
  const breakEvenRevenueMonthlyINR = contributionMargin > 0 ? fixed / contributionMargin : null;
  const monthlyOperatingCashFlowINR = revenue * contributionMargin - fixed;
  const simplePaybackMonths = monthlyOperatingCashFlowINR > 0 ? Math.ceil(investment / monthlyOperatingCashFlowINR) : null;
  const monthlyDiscount = (1 + discount) ** (1 / 12) - 1;
  const cashFlows = [-investment, ...Array(months).fill(monthlyOperatingCashFlowINR)];
  const npvINR = monthlyDiscount === 0 ? cashFlows.reduce((sum, flow) => sum + flow, 0)
    : cashFlows.reduce((sum, flow, index) => sum + flow / (1 + monthlyDiscount) ** index, 0);
  const monthlyIrr = irrMonthly(cashFlows);
  const netOperatingCashFlow = monthlyOperatingCashFlowINR * months;
  const paybackReached = simplePaybackMonths !== null && simplePaybackMonths <= months;
  return {
    status: 'calculated', missingInputs: [], evidenceClass: input.evidenceClass, contributionMargin,
    breakEvenRevenueMonthlyINR: Number.isFinite(breakEvenRevenueMonthlyINR) ? breakEvenRevenueMonthlyINR : null,
    monthlyOperatingCashFlowINR,
    simplePaybackMonths,
    paybackStatus: simplePaybackMonths === null ? 'not_reached' : paybackReached ? 'reached_within_horizon' : 'not_reached_within_horizon',
    roiPercent: investment > 0 ? (netOperatingCashFlow / investment - 1) * 100 : null,
    npvINR: Number.isFinite(npvINR) ? npvINR : null,
    irrAnnualPercent: monthlyIrr === null ? null : ((1 + monthlyIrr) ** 12 - 1) * 100,
    forecastMonths: months,
    cashFlowDefinition: 'Operating cash flow = revenue × (gross margin − operating cost rate) − fixed costs; NPV discounts monthly flows at the supplied annual rate; excludes financing, tax, depreciation, lease principal and terminal value.'
  };
}

module.exports = {
  EVIDENCE_CLASSES: Object.freeze([...EVIDENCE_CLASSES]),
  ABFRL_FY26_PANTALOONS_CONTEXT,
  validateBenchmark,
  normalizeComparableBenchmark,
  selectComparableBenchmarks,
  estimateInvestmentRange,
  estimateRevenueScenarios,
  calculateFinancialMetrics
};
