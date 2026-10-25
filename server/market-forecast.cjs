'use strict';

const DEFAULT_WEIGHTS = Object.freeze({ demand: 0.25, purchasingPower: 0.20, competition: 0.20, accessibility: 0.15, financial: 0.15, growth: 0.05 });

function isNumber(value) { return typeof value === 'number' && Number.isFinite(value); }

function scoreMarketViability(metrics, weights = DEFAULT_WEIGHTS, gates = {}) {
  const keys = Object.keys(DEFAULT_WEIGHTS);
  const totalWeight = keys.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (keys.some(key => !isNumber(weights[key]) || weights[key] < 0) || Math.abs(totalWeight - 1) > 1e-9) throw new RangeError('Market score weights must be non-negative and sum to 1');
  const factors = keys.map(key => ({ key, score: isNumber(metrics?.[key]) ? Math.max(0, Math.min(100, metrics[key])) : null, weight: weights[key], contribution: isNumber(metrics?.[key]) ? Math.max(0, Math.min(100, metrics[key])) * weights[key] : null }));
  const missing = factors.filter(item => item.score === null).map(item => item.key);
  if (gates.downsideCashFlowNegative || gates.criticalEvidenceMissing) return { score: missing.length ? null : factors.reduce((sum, item) => sum + item.contribution, 0), status: 'gated', recommendation: 'Do not approve on market score alone', reasons: [...(gates.downsideCashFlowNegative ? ['Downside scenario has negative cash flow'] : []), ...(gates.criticalEvidenceMissing ? ['Critical evidence is missing'] : []), ...(missing.length ? [`Missing factors: ${missing.join(', ')}`] : [])], factors, weights: { ...weights } };
  if (missing.length) return { score: null, status: 'incomplete', recommendation: 'Insufficient evidence', reasons: [`Missing factors: ${missing.join(', ')}`], factors, weights: { ...weights } };
  const score = factors.reduce((sum, item) => sum + item.contribution, 0);
  return { score: Math.round(score * 100) / 100, status: 'provisional', recommendation: score >= 70 ? 'Review for conditional approval' : 'Revise location or assumptions', reasons: ['Provisional policy weights; calibrate against observed store outcomes'], factors, weights: { ...weights } };
}

function requiredNumber(value, name, min = 0) {
  if (!isNumber(value) || value < min) throw new RangeError(`${name} must be a finite number >= ${min}`);
  return value;
}

function annualRate(value, name) {
  if (!isNumber(value) || value <= -1) throw new RangeError(`${name} must be a finite annual rate greater than -1`);
  return value;
}

function irrMonthly(cashFlows) {
  const npv = rate => cashFlows.reduce((sum, amount, index) => sum + amount / ((1 + rate) ** index), 0);
  if (!cashFlows.some(value => value < 0) || !cashFlows.some(value => value > 0)) return null;
  let lo = -0.9999, hi = 1;
  while (npv(hi) > 0 && hi < 1e6) hi *= 2;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 120; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
  return ((1 + (lo + hi) / 2) ** 12 - 1) * 100;
}

function projectStoreEconomics(input) {
  const s = input?.store || {}, m = input?.market || {}, f = input?.forecast || {};
  const years = requiredNumber(f.years, 'forecast.years', 1);
  if (!Number.isInteger(years) || years > 10) throw new RangeError('forecast.years must be an integer from 1 to 10');
  const initialInvestment = requiredNumber(s.initialInvestment, 'store.initialInvestment');
  const workingCapital = requiredNumber(s.workingCapital, 'store.workingCapital');
  const areaSqFt = requiredNumber(s.areaSqFt, 'store.areaSqFt', 0.01);
  const fixed = requiredNumber(s.monthlyFixedCosts, 'store.monthlyFixedCosts');
  const grossMargin = requiredNumber(s.grossMargin, 'store.grossMargin');
  const royaltyRate = requiredNumber(s.royaltyRate, 'store.royaltyRate');
  const aov = requiredNumber(s.aov, 'store.aov', 0.01);
  const conversion = requiredNumber(s.conversionRate, 'store.conversionRate');
  const rampMonths = requiredNumber(s.salesRampMonths, 'store.salesRampMonths', 1);
  const initialRamp = requiredNumber(s.initialRampFraction, 'store.initialRampFraction');
  const growth = annualRate(f.annualNominalGrowth, 'forecast.annualNominalGrowth');
  const inflation = annualRate(f.annualInflation, 'forecast.annualInflation');
  const discount = annualRate(f.discountRate, 'forecast.discountRate');
  if (!Number.isInteger(rampMonths)) throw new RangeError('store.salesRampMonths must be a positive integer');
  for (const [name, value] of Object.entries({ grossMargin, royaltyRate, conversion, initialRamp })) if (value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  const scenarios = input.scenarioFactors || { conservative: 0.75, base: 1, optimistic: 1.25 };
  const names = ['conservative', 'base', 'optimistic'];
  for (const name of names) requiredNumber(scenarios[name], `scenarioFactors.${name}`);
  const contributionMargin = grossMargin - royaltyRate;
  const breakEvenRevenueMonthly = contributionMargin > 0 ? fixed / contributionMargin : null;
  const sam = isNumber(m.samAnnual) && m.samAnnual > 0 ? m.samAnnual : null;
  const requiredAnnualCaptureRate = sam && breakEvenRevenueMonthly !== null ? breakEvenRevenueMonthly * 12 / sam : null;
  const captureBenchmark = isNumber(m.captureBenchmark) && m.captureBenchmark >= 0 && m.captureBenchmark <= 1 ? m.captureBenchmark : null;
  const footfallAvailable = isNumber(s.monthlyPassingPedestrianTraffic) && isNumber(s.entryRate) && s.monthlyPassingPedestrianTraffic >= 0 && s.entryRate >= 0 && s.entryRate <= 1;
  const steadyVisits = footfallAvailable ? s.monthlyPassingPedestrianTraffic * s.entryRate : null;
  const footfall = { evidenceClass: s.trafficEvidenceClass || (footfallAvailable ? 'model_assumption' : 'unavailable'), passingPedestrianTraffic: { value: footfallAvailable ? s.monthlyPassingPedestrianTraffic : null, unit: 'people/month' }, storeVisits: { value: steadyVisits, unit: 'visits/month' }, uniqueShoppers: { value: null, unit: 'people/month', reason: 'No deduplicated shopper count supplied' } };
  const scenarioResults = {};
  for (const name of names) {
    const factor = scenarios[name], months = [], flows = [-(initialInvestment + workingCapital)];
    let cumulative = flows[0], paybackMonths = null;
    for (let month = 1; month <= years * 12; month++) {
      const rampFactor = month >= rampMonths ? 1 : initialRamp + (1 - initialRamp) * ((month - 1) / Math.max(1, rampMonths - 1));
      const nominalGrowth = (1 + growth) ** ((month - 1) / 12);
      const passing = footfallAvailable ? s.monthlyPassingPedestrianTraffic : null;
      const storeVisits = steadyVisits === null ? null : steadyVisits * factor * nominalGrowth;
      const transactions = storeVisits === null ? null : storeVisits * conversion * rampFactor;
      const revenue = transactions === null ? null : transactions * aov;
      if ([storeVisits, transactions, revenue].some(value => value !== null && !Number.isFinite(value))) throw new RangeError('Forecast exceeds the supported numeric range');
      const grossProfit = revenue === null ? null : revenue * grossMargin;
      const royalty = revenue === null ? null : revenue * royaltyRate;
      const operatingCashFlow = revenue === null ? null : grossProfit - royalty - fixed;
      const netCashFlow = operatingCashFlow === null ? null : operatingCashFlow;
      if (netCashFlow !== null) { flows.push(netCashFlow); cumulative += netCashFlow; if (paybackMonths === null && cumulative >= 0) paybackMonths = month; }
      months.push({ month, rampFactor, passingPedestrianTraffic: passing, storeVisits, transactions, revenue, grossProfit, royalty, operatingCashFlow, cumulativeCashFlow: netCashFlow === null ? null : cumulative });
    }
    const annualDiscount = discount;
    const monthlyDiscount = (1 + annualDiscount) ** (1 / 12) - 1;
    const npv = flows.length === months.length + 1 ? flows.reduce((sum, amount, index) => sum + amount / ((1 + monthlyDiscount) ** index), 0) : null;
    const totalOperating = months.reduce((sum, row) => sum + (row.operatingCashFlow || 0), 0);
    const roiPercent = initialInvestment + workingCapital > 0 && months.every(row => row.revenue !== null) ? ((totalOperating - initialInvestment - workingCapital) / (initialInvestment + workingCapital)) * 100 : null;
    const irR = flows.length === months.length + 1 ? irrMonthly(flows) : null;
    const annual = Array.from({ length: years }, (_, index) => {
      const nominalRevenue = months.slice(index * 12, (index + 1) * 12).reduce((sum, row) => sum + (row.revenue || 0), 0);
      const annualSam = sam === null ? null : sam * ((1 + growth) ** index);
      const captureRate = annualSam ? nominalRevenue / annualSam : null;
      return { year: index + 1, nominalRevenue, realRevenue: nominalRevenue / ((1 + inflation) ** (index + 1)), samAnnual: annualSam, impliedCaptureRate: captureRate, exceedsCaptureBenchmark: captureRate !== null && captureBenchmark !== null ? captureRate > captureBenchmark : null };
    });
    scenarioResults[name] = { factor, months, years: annual, totalOperatingCashFlow: totalOperating, roiPercent, paybackMonths, npv, irrAnnual: irR };
  }
  return { footfall, economics: { contributionMargin, breakEvenRevenueMonthly, breakEvenTransactionsMonthly: contributionMargin > 0 ? fixed / (aov * contributionMargin) : null, requiredAnnualCaptureRate, captureBenchmark, revenuePerSqFtYearOne: scenarioResults.base.months.slice(0, 12).every(row => row.revenue !== null) ? scenarioResults.base.years[0].nominalRevenue / areaSqFt : null, base: { roiPercent: scenarioResults.base.roiPercent, paybackMonths: scenarioResults.base.paybackMonths, npv: scenarioResults.base.npv, irrAnnual: scenarioResults.base.irrAnnual } }, expansion: { years: scenarioResults.base.years, nominalGrowthRate: growth, inflationRate: inflation, evidenceClass: 'model_assumption' }, scenarios: scenarioResults, assumptions: { trafficEvidenceClass: footfall.evidenceClass, scenarioFactors: scenarios, annualGrowth: growth, inflation, discountRate: discount, cashFlowExcludesTaxesDebtAndTerminalValue: true } };
}

module.exports = { DEFAULT_WEIGHTS, scoreMarketViability, projectStoreEconomics };
