'use strict';

// Automatic cost-based store analysis for a selected geography: tier-based cost range,
// downside/base/upside economics (ROI, payback, break-even, 5-year projection) and the
// state per-capita income trend. Every assumption carries its evidence class and sources.

const costCatalog = require('../data/india-store-cost-benchmarks.json');
const tierCatalog = require('../data/india-city-tiers.json');
const incomeCatalog = require('../data/india-state-per-capita-income.json');

const MODEL_VERSION = 'store-cost-analysis-v1';
const LEVELS = ['low', 'mid', 'high'];
const CLASS_RANK = { Z: 0, Y: 1, X: 2 };
const FRACTION_KEYS = new Set(['grossMargin', 'employerOnCostRate', 'marketingRate', 'royaltyRate', 'initialRampFraction']);
const RATE_KEYS = new Set(['costInflation', 'discountRate', 'revenueGrowth']);
const EXTRA_OVERRIDES = new Set(['annualRevenue', 'revenueGrowth']);
const PROJECTION_MONTHS = 60;

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function normalizeName(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/\b(nct of|urban|city|district|m\.?\s?corpn\.?|ua)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
}
function stateKeys(value) { return String(value || '').split('/').map(normalizeName).filter(Boolean); }
function round(value, digits = 0) { if (!finite(value)) return null; const f = 10 ** digits; return Math.round(value * f) / f; }

function sourceRef(source) {
  if (!source) return null;
  const { title, publisher, url, referencePeriod, publicationDate, supportingPassage, usage, page } = source;
  return Object.fromEntries(Object.entries({ title, publisher, url, referencePeriod, publicationDate, supportingPassage, usage, page }).filter(([, v]) => v !== undefined && v !== null));
}

/** Resolve the HRA city class (X/Y/Z → Tier 1/2/3) for a geography; PINs inherit their city/district. */
function resolveTier(geography = {}) {
  const level = geography.level || 'unknown';
  const state = geography.state || (level === 'state' ? geography.name : null);
  const stateKey = normalizeName(state);
  const inState = city => !stateKey || stateKeys(city.state).includes(stateKey);
  const evidence = { ...sourceRef(tierCatalog.source), evidenceClass: tierCatalog.evidenceClass };
  const tierLabel = cls => tierCatalog.tierMapping[cls];
  if (level === 'state' || level === 'national') {
    const present = new Set(['Z']);
    for (const city of tierCatalog.cities) if (level === 'national' || inState(city)) present.add(city.class);
    const classes = [...present].sort((a, b) => CLASS_RANK[a] - CLASS_RANK[b]);
    return { tierClass: classes.length === 1 ? classes[0] : 'mixed', tier: classes.length === 1 ? tierLabel(classes[0]) : 'Mixed', classesPresent: classes,
      levels: { low: classes[0], mid: classes.includes('Y') ? 'Y' : classes.at(-1), high: classes.at(-1) }, matchedCity: null,
      basis: `${level === 'state' ? state : 'India'} contains ${classes.map(cls => `${cls} (${tierLabel(cls)})`).join(', ')} areas; cost levels span the lowest to the highest class present.`,
      evidence, warnings: ['Costs for a whole state span several city tiers. Select a city, district or PIN for a narrower range.'] };
  }
  const candidates = [geography.city, geography.postalCity, geography.district, level === 'pin' ? null : geography.name,
    ...(Array.isArray(geography.ancestors) ? geography.ancestors.map(item => typeof item === 'string' ? item : item?.name) : [])]
    .filter(Boolean).map(name => normalizeName(String(name).split('·').at(-1)));
  for (const candidate of candidates) {
    const match = tierCatalog.cities.find(city => inState(city) && city.names.some(name => normalizeName(name) === candidate));
    if (match) {
      const inherited = level === 'pin' || level === 'catchment';
      return { tierClass: match.class, tier: tierLabel(match.class), classesPresent: [match.class], levels: { low: match.class, mid: match.class, high: match.class },
        matchedCity: match.printedName, basis: `${inherited ? 'PIN inherits its city class: ' : ''}${match.printedName}, ${match.state} — HRA class ${match.class}.`, evidence,
        warnings: match.note ? [match.note] : [] };
    }
  }
  return { tierClass: 'Z', tier: tierLabel('Z'), classesPresent: ['Z'], levels: { low: 'Z', mid: 'Z', high: 'Z' }, matchedCity: null,
    basis: `No X or Y class city matched ${candidates[0] ? `"${candidates[0]}"` : 'this area'}; the HRA order classifies all remaining cities/towns as Z.`, evidence,
    warnings: [`City class defaulted to Z (${tierLabel('Z')}) because no X/Y city name matched. If this area is part of a larger city, override rent to that city's level.`] };
}

/** State per-capita NSDP (current prices) trend with CAGR and a labelled 5-year extrapolation. */
function estimateIncomeTrend(geography = {}) {
  const level = geography.level || 'unknown';
  const state = geography.state || (level === 'state' ? geography.name : null);
  const source = { ...sourceRef(incomeCatalog.source), vintage: incomeCatalog.source.vintage, evidenceClass: incomeCatalog.evidenceClass };
  const key = Object.keys(incomeCatalog.states).find(name => normalizeName(name) === normalizeName(state));
  if (!key) return { status: 'unavailable', state: state || null, series: [], growth: [], cagr: null, projection: [], evidenceClass: 'unavailable', source,
    warnings: [state ? `No per-capita NSDP series is available for ${state}.` : 'The selected area has no state, so the state income series cannot be applied.'] };
  const series = Object.entries(incomeCatalog.states[key]).sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => ({ year, value }));
  const growth = series.slice(1).map((row, index) => ({ year: row.year, rate: row.value / series[index].value - 1 }));
  const cagrOver = years => {
    if (series.length <= years) return null;
    const last = series.at(-1), first = series.at(-1 - years);
    return { years, from: first.year, to: last.year, rate: (last.value / first.value) ** (1 / years) - 1 };
  };
  const longRun = cagrOver(series.length - 1), recent = cagrOver(5);
  const startYear = Number(series.at(-1).year.slice(0, 4));
  const projection = Array.from({ length: 5 }, (_, index) => {
    const y = startYear + index + 1;
    return { year: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, value: Math.round(series.at(-1).value * (1 + longRun.rate) ** (index + 1)) };
  });
  const inherited = level !== 'state';
  return { status: 'available', state: key, appliedAs: inherited ? 'inherited_from_state' : 'state', unit: incomeCatalog.unit, priceBasis: incomeCatalog.priceBasis,
    series, growth, cagr: { longRun, recent5Year: recent }, latest: series.at(-1),
    projection, projectionMethod: `Latest value × (1 + ${series[0].year}–${series.at(-1).year} CAGR)^n; extrapolation, not a forecast.`,
    evidenceClass: inherited ? 'derived_estimate' : incomeCatalog.evidenceClass, projectionEvidenceClass: 'derived_estimate', source,
    warnings: [...(inherited ? [`State-level ${key} income applied to ${geography.name || 'this area'}; local income levels and growth can differ substantially.`] : []),
      'Per-capita NSDP is state income per resident at current prices (includes inflation), not household disposable income.',
      'Projected values are an estimate extrapolated from the historical growth rate.'] };
}

function validateOverrides(overrides) {
  if (overrides === undefined || overrides === null) return {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new RangeError('overrides must be an object');
  const out = {};
  for (const [key, raw] of Object.entries(overrides)) {
    if (!Object.hasOwn(costCatalog.assumptions, key) && !EXTRA_OVERRIDES.has(key)) throw new RangeError(`Unknown assumption: ${key}`);
    const values = finite(raw) ? { low: raw, mid: raw, high: raw } : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    if (!values || Object.keys(values).some(level => !LEVELS.includes(level))) throw new RangeError(`${key} must be a number or an object with low, mid and high`);
    const level = {};
    for (const name of LEVELS) {
      const value = values[name];
      if (value === undefined) continue;
      if (!finite(value) || value < 0) throw new RangeError(`${key}.${name} must be a finite non-negative number`);
      if (FRACTION_KEYS.has(key) && value > 1) throw new RangeError(`${key}.${name} must be a fraction from 0 to 1`);
      if (RATE_KEYS.has(key) && value > 1) throw new RangeError(`${key}.${name} must be an annual rate from 0 to 1`);
      if (['areaSqFt', 'sqFtPerEmployee', 'inventoryTurnsPerYear', 'revenuePerSqFtYear'].includes(key) && value === 0) throw new RangeError(`${key}.${name} must be positive`);
      if (key === 'rampMonths' && (!Number.isInteger(value) || value < 1 || value > 36)) throw new RangeError('rampMonths must be an integer from 1 to 36');
      level[name] = value;
    }
    if (!Object.keys(level).length) throw new RangeError(`${key} must supply at least one level`);
    out[key] = level;
  }
  return out;
}

function buildAssumptions(tier, income, overrides) {
  const assumptions = {};
  for (const [key, item] of Object.entries(costCatalog.assumptions)) {
    const value = item.byTierClass ? Object.fromEntries(LEVELS.map(level => [level, item.byTierClass[tier.levels[level]][level]])) : { ...item.value };
    assumptions[key] = { label: item.label, unit: item.unit, favorable: item.favorable, value, evidenceClass: item.evidenceClass,
      sources: (item.sources || []).map(sourceRef), method: item.method || item.rationale || null, caveat: item.caveat || null,
      ...(item.byTierClass ? { tierBasis: Object.fromEntries(LEVELS.map(level => [level, tier.levels[level]])) } : {}), overridden: false };
  }
  const growth = costCatalog.revenueGrowth, cpi = 0.04;
  const incomeRate = income.status === 'available' ? income.cagr.longRun.rate : null;
  assumptions.revenueGrowth = { label: growth.label, unit: growth.unit, favorable: 'high',
    value: incomeRate !== null && incomeRate > cpi ? { low: cpi, mid: (cpi + incomeRate) / 2, high: incomeRate } : { low: 0.04, mid: 0.05, high: 0.06 },
    evidenceClass: incomeRate !== null ? 'derived_estimate' : 'model_assumption', sources: [...growth.sources.map(sourceRef), ...(incomeRate !== null ? [income.source] : [])],
    method: growth.method, caveat: 'Assumes same-store sales track prices (low) up to full state income growth (high).', overridden: false };
  for (const [key, levels] of Object.entries(overrides)) {
    if (key === 'annualRevenue') continue;
    assumptions[key] = { ...assumptions[key], value: { ...assumptions[key].value, ...levels }, evidenceClass: 'user_assumption', overridden: true };
  }
  return assumptions;
}

/** Cost-level value: costs ordered cheap → expensive (low ≤ mid ≤ high in INR). */
function costLevel(assumption, level) {
  const flip = assumption.favorable === 'high';
  const order = flip ? { low: 'high', mid: 'mid', high: 'low' } : { low: 'low', mid: 'mid', high: 'high' };
  return assumption.value[assumption.favorable === 'neutral' ? 'mid' : order[level]];
}
/** Scenario value: downside takes the unfavourable end, upside the favourable end. */
function scenarioLevel(assumption, scenario) {
  if (assumption.favorable === 'neutral' || scenario === 'mid') return assumption.value.mid;
  const favorableEnd = assumption.favorable === 'high' ? 'high' : 'low', unfavorableEnd = favorableEnd === 'high' ? 'low' : 'high';
  return assumption.value[scenario === 'high' ? favorableEnd : unfavorableEnd];
}

function costsAt(a, pick) {
  const area = pick(a.areaSqFt), rentMonthly = area * pick(a.rentPerSqFtMonth);
  const headcount = Math.max(1, Math.ceil(area / pick(a.sqFtPerEmployee)));
  const staffMonthly = headcount * pick(a.staffMonthlyWage) * (1 + pick(a.employerOnCostRate));
  const utilitiesMonthly = area * pick(a.utilitiesPerSqFtMonth);
  const fixedMonthly = rentMonthly + staffMonthly + utilitiesMonthly;
  const capacityRevenue = area * a.revenuePerSqFtYear.value.mid;
  const components = {
    fitOut: area * pick(a.fitOutPerSqFt),
    securityDeposit: rentMonthly * pick(a.depositMonthsOfRent),
    openingInventory: capacityRevenue * (1 - a.grossMargin.value.mid) / pick(a.inventoryTurnsPerYear),
    franchiseFee: pick(a.franchiseFee),
    preOpeningCosts: pick(a.preOpeningCosts),
    cashReserve: fixedMonthly * pick(a.cashReserveMonths)
  };
  return { area, headcount, rentMonthly, staffMonthly, utilitiesMonthly, fixedMonthly, components,
    investment: Object.values(components).reduce((sum, value) => sum + value, 0) };
}

const COMPONENT_META = {
  fitOut: { label: 'Fit-out and interiors', formula: 'area × fit-out per sq ft', from: ['areaSqFt', 'fitOutPerSqFt'] },
  securityDeposit: { label: 'Security deposit', formula: 'monthly rent × deposit months', from: ['rentPerSqFtMonth', 'depositMonthsOfRent'] },
  openingInventory: { label: 'Opening inventory', formula: 'area × benchmark sales density × (1 − gross margin) / inventory turns', from: ['revenuePerSqFtYear', 'grossMargin', 'inventoryTurnsPerYear'] },
  franchiseFee: { label: 'Upfront franchise fee', formula: 'brand fee', from: ['franchiseFee'] },
  preOpeningCosts: { label: 'Pre-opening costs', formula: 'launch marketing, training, licences', from: ['preOpeningCosts'] },
  cashReserve: { label: 'Opening cash reserve', formula: 'monthly fixed costs × reserve months', from: ['cashReserveMonths', 'rentPerSqFtMonth', 'staffMonthlyWage', 'utilitiesPerSqFtMonth'] }
};
const weakestClass = classes => ['model_assumption', 'user_assumption', 'derived_estimate', 'official_survey_estimate', 'official_observed'].find(cls => classes.includes(cls)) || 'model_assumption';

function estimateCostRange(assumptions) {
  const at = Object.fromEntries(LEVELS.map(level => [level, costsAt(assumptions, item => costLevel(item, level))]));
  const components = Object.entries(COMPONENT_META).map(([key, meta]) => ({ component: key, label: meta.label, unit: 'INR', formula: meta.formula,
    ...Object.fromEntries(LEVELS.map(level => [level, Math.round(at[level].components[key])])),
    evidenceClass: weakestClass(meta.from.map(name => assumptions[name].evidenceClass)), assumptions: meta.from }));
  const monthly = ['rentMonthly', 'staffMonthly', 'utilitiesMonthly', 'fixedMonthly'].map(key => ({ item: key, ...Object.fromEntries(LEVELS.map(level => [level, Math.round(at[level][key])])) }));
  return { unit: 'INR', components, monthlyFixedCosts: monthly,
    investmentTotal: Object.fromEntries(LEVELS.map(level => [level, Math.round(at[level].investment)])),
    headcount: Object.fromEntries(LEVELS.map(level => [level, at[level].headcount])),
    evidenceClass: weakestClass(components.map(row => row.evidenceClass)) };
}

function revenueBase(geography, assumptions, override) {
  const metrics = geography.metrics || {}, capacity = assumptions.areaSqFt.value.mid * assumptions.revenuePerSqFtYear.value.mid;
  if (override) return { value: override.mid ?? override.low ?? override.high, levels: override, basis: 'user_override', evidenceClass: 'user_assumption', label: 'User-entered annual revenue', capacity };
  for (const [key, label] of [['potentialRevenue', 'Potential revenue for this area (map model)'], ['som', 'Serviceable obtainable market (SOM)']]) {
    const metric = metrics[key];
    if (finite(metric?.value) && metric.value > 0) return { value: metric.value, basis: key, evidenceClass: metric.evidenceClass || 'derived_estimate', label, capacity, evidence: metric.evidence || [] };
  }
  return { value: capacity, basis: 'store_capacity_benchmark', evidenceClass: 'derived_estimate', label: 'Store capacity at benchmark sales density (area × sales per sq ft)', capacity };
}

function projectScenario({ investment, annualRevenue, fixedMonthly, contributionMargin, growth, inflation, discountRate, initialRamp, rampMonths }) {
  let cumulative = -investment, paybackMonths = null, npv = -investment;
  const monthlyDiscount = (1 + discountRate) ** (1 / 12) - 1, years = [];
  for (let month = 1; month <= PROJECTION_MONTHS; month++) {
    const ramp = month >= rampMonths ? 1 : initialRamp + (1 - initialRamp) * ((month - 1) / Math.max(1, rampMonths - 1));
    const revenue = annualRevenue / 12 * ramp * (1 + growth) ** ((month - 1) / 12);
    const fixed = fixedMonthly * (1 + inflation) ** Math.floor((month - 1) / 12);
    const cashFlow = revenue * contributionMargin - fixed;
    cumulative += cashFlow; npv += cashFlow / (1 + monthlyDiscount) ** month;
    if (paybackMonths === null && cumulative >= 0) paybackMonths = month;
    const y = Math.ceil(month / 12);
    if (!years[y - 1]) years[y - 1] = { year: y, revenue: 0, operatingCashFlow: 0, fixedCosts: 0 };
    years[y - 1].revenue += revenue; years[y - 1].operatingCashFlow += cashFlow; years[y - 1].fixedCosts += fixed; years[y - 1].cumulativeCashFlow = cumulative;
  }
  const totalCashFlow = years.reduce((sum, row) => sum + row.operatingCashFlow, 0);
  return { paybackMonths, npv, totalCashFlow, roi5YearPercent: investment > 0 ? (totalCashFlow - investment) / investment * 100 : null,
    years: years.map(row => ({ year: row.year, revenue: Math.round(row.revenue), fixedCosts: Math.round(row.fixedCosts), operatingCashFlow: Math.round(row.operatingCashFlow), cumulativeCashFlow: Math.round(row.cumulativeCashFlow) })) };
}

/** Full analysis for one geography. Throws RangeError for invalid overrides. */
function analyzeLocation({ geography, overrides } = {}) {
  if (!geography || typeof geography !== 'object') throw new TypeError('geography is required');
  const checked = validateOverrides(overrides);
  const tier = resolveTier(geography), incomeTrend = estimateIncomeTrend(geography);
  const assumptions = buildAssumptions(tier, incomeTrend, checked);
  const costRange = estimateCostRange(assumptions);
  const base = revenueBase(geography, assumptions, checked.annualRevenue);
  const warnings = [...tier.warnings];
  const scenarios = {};
  for (const scenario of LEVELS) {
    const pick = item => scenarioLevel(item, scenario);
    const costs = costsAt(assumptions, pick);
    const annualRevenue = base.basis === 'user_override' ? (base.levels[scenario] ?? base.value) : base.value * pick(assumptions.revenueScenarioFactor);
    const contributionMargin = pick(assumptions.grossMargin) - pick(assumptions.royaltyRate) - pick(assumptions.marketingRate);
    const breakEvenRevenueAnnual = contributionMargin > 0 ? costs.fixedMonthly * 12 / contributionMargin : null;
    const projection = projectScenario({ investment: costs.investment, annualRevenue, fixedMonthly: costs.fixedMonthly, contributionMargin,
      growth: pick(assumptions.revenueGrowth), inflation: pick(assumptions.costInflation), discountRate: pick(assumptions.discountRate),
      initialRamp: pick(assumptions.initialRampFraction), rampMonths: pick(assumptions.rampMonths) });
    const steady = projection.years[1];
    scenarios[scenario] = {
      label: { low: 'Downside', mid: 'Base', high: 'Upside' }[scenario],
      pairing: { low: 'low revenue with high costs', mid: 'mid revenue with mid costs', high: 'high revenue with low costs' }[scenario],
      investment: Math.round(costs.investment), annualRevenue: Math.round(annualRevenue), monthlyFixedCosts: Math.round(costs.fixedMonthly),
      contributionMargin: round(contributionMargin, 4), breakEvenRevenueAnnual: breakEvenRevenueAnnual === null ? null : Math.round(breakEvenRevenueAnnual),
      paybackMonths: projection.paybackMonths, paybackStatus: projection.paybackMonths === null ? 'not_within_5_years' : 'within_5_years',
      roi5YearPercent: round(projection.roi5YearPercent, 1), annualRoiPercent: costs.investment > 0 ? round(steady.operatingCashFlow / costs.investment * 100, 1) : null,
      npv: Math.round(projection.npv), projection: projection.years, unit: 'INR', evidenceClass: 'derived_estimate'
    };
    if (contributionMargin <= 0) warnings.push(`${scenarios[scenario].label}: gross margin does not cover royalty and marketing, so break-even is unavailable.`);
  }
  // Sanity checks are surfaced as warnings; values are never clamped.
  for (const row of costRange.components) if (!(row.low <= row.mid && row.mid <= row.high)) warnings.push(`${row.label} costs are not ordered low ≤ mid ≤ high (${row.low} / ${row.mid} / ${row.high}); check overrides.`);
  const inv = costRange.investmentTotal;
  if (!(inv.low <= inv.mid && inv.mid <= inv.high)) warnings.push('Total investment is not ordered low ≤ mid ≤ high; check overrides.');
  for (const s of Object.values(scenarios)) {
    if (s.paybackMonths !== null && s.paybackMonths < 1) warnings.push(`${s.label}: payback under one month is implausible.`);
    if (s.paybackMonths === 1) warnings.push(`${s.label}: payback in the first month is implausible; check revenue and investment inputs.`);
    if (s.roi5YearPercent !== null && s.roi5YearPercent > 500) warnings.push(`${s.label}: 5-year ROI of ${s.roi5YearPercent}% is outside the plausible range for apparel retail; check revenue and cost inputs.`);
    if (s.annualRoiPercent !== null && s.annualRoiPercent > 150) warnings.push(`${s.label}: annual ROI of ${s.annualRoiPercent}% is implausibly high.`);
    if (s.roi5YearPercent !== null && s.roi5YearPercent < -100) warnings.push(`${s.label}: operating losses exceed the initial investment over 5 years.`);
  }
  const density = scenarios.mid.annualRevenue / assumptions.areaSqFt.value.mid, bench = assumptions.revenuePerSqFtYear.value;
  if (density > bench.high * 2.5) warnings.push(`Base revenue implies ₹${Math.round(density).toLocaleString('en-IN')} per sq ft per year, over 2.5× the highest benchmark (₹${bench.high.toLocaleString('en-IN')}). The revenue input may be an area-wide market figure rather than one store.`);
  if (density < bench.low * 0.25) warnings.push(`Base revenue implies ₹${Math.round(density).toLocaleString('en-IN')} per sq ft per year, under a quarter of the lowest benchmark; the store may be oversized for this area.`);
  const categorySpend = geography.metrics?.apparelExpenditure?.value;
  if (finite(categorySpend) && categorySpend > 0 && scenarios.mid.annualRevenue > categorySpend * 0.1) warnings.push(`Base revenue would be ${round(scenarios.mid.annualRevenue / categorySpend * 100, 1)}% of the area's annual clothing and footwear spend; check capture.`);
  if (base.basis === 'store_capacity_benchmark') warnings.push('No area revenue potential is available, so revenue is the store capacity at benchmark sales density — a supply-side estimate, not demand evidence for this area.');
  warnings.push('Cash flows exclude tax, depreciation, financing and terminal value; the refundable deposit and inventory are not recovered within the 5-year horizon.');
  warnings.push(...incomeTrend.warnings);
  const modelAssumptions = Object.entries(assumptions).filter(([, item]) => item.evidenceClass === 'model_assumption').map(([key]) => key);
  if (modelAssumptions.length) warnings.push(`Model assumptions without a sourced benchmark: ${modelAssumptions.map(key => assumptions[key].label).join(', ')}. Replace them with quotes or brand terms.`);
  const evidence = [];
  const add = item => { if (item?.url && !evidence.some(existing => existing.url === item.url)) evidence.push(item); };
  add(tier.evidence); add(incomeTrend.source);
  for (const item of Object.values(assumptions)) for (const s of item.sources || []) add(s);
  return { modelVersion: MODEL_VERSION, geography: { id: geography.id || null, name: geography.name || null, level: geography.level || null, state: geography.state || null, city: geography.city || null },
    tier: { tierClass: tier.tierClass, tier: tier.tier, classesPresent: tier.classesPresent, levels: tier.levels, matchedCity: tier.matchedCity, basis: tier.basis },
    revenueBasis: { basis: base.basis, label: base.label, annualValue: Math.round(base.value), evidenceClass: base.evidenceClass, storeCapacity: Math.round(base.capacity) },
    assumptions, costRange, scenarios, incomeTrend, warnings: [...new Set(warnings)], evidence };
}

module.exports = { MODEL_VERSION, resolveTier, estimateIncomeTrend, validateOverrides, buildAssumptions, estimateCostRange, projectScenario, analyzeLocation };
