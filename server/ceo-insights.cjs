'use strict';

// CEO cue cards. Every number comes from the same map features (as served by /api/market/map/levels)
// and the same analyzeLocation / estimateIncomeTrend functions behind the Analysis panel.

const { analyzeLocation, estimateIncomeTrend } = require('./market-analysis.cjs');

const BADGE = { official_observed: 'official', official_survey_estimate: 'official', derived_estimate: 'estimate', model_assumption: 'assumption', user_assumption: 'assumption' };
const BADGE_RANK = { assumption: 0, estimate: 1, official: 2 };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const badgeOf = cls => BADGE[cls] || 'assumption';
const tierText = tier => tier.tierClass === 'mixed' ? 'state-wide mixed city-tier' : `${tier.tier} city`;
const weakest = (...badges) => badges.sort((a, b) => BADGE_RANK[a] - BADGE_RANK[b])[0];

/** The ranking metric: potentialRevenue where the map supplies it, otherwise annual clothing & footwear spend. */
function rankingMetric(features, sector = null) {
  // A researched sector never falls back to apparel spend: without its potential revenue the areas are unranked.
  if (sector && !sector.builtIn) return 'potentialRevenue';
  return features.some(f => finite(f.metrics?.potentialRevenue?.value)) ? 'potentialRevenue' : 'apparelExpenditure';
}

function rankAreas(features, metric) {
  const ranked = [], insufficient = [];
  for (const f of features) {
    const value = f.metrics?.[metric]?.value, population = f.metrics?.population?.value;
    if (finite(value) && value > 0 && finite(population) && population > 0) ranked.push({ id: f.id, name: f.name, level: f.level, value, evidenceClass: f.metrics[metric].evidenceClass || 'derived_estimate' });
    else insufficient.push({ id: f.id, name: f.name, missing: [...(!finite(population) || population <= 0 ? ['population'] : []), ...(!finite(value) || value <= 0 ? [metric] : [])] });
  }
  ranked.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { ranked, insufficient };
}

/**
 * @param features   map features for one level (same call as the map layer)
 * @param loadGeography  async id → geography, the same loader the Analysis endpoint uses
 * @param stores     number of stores for the capital card
 */
async function buildCeoInsights({ features, loadGeography, stores = 5, topN = 5, sector = null }) {
  if (!Array.isArray(features)) throw new TypeError('features must be an array');
  if (!Number.isInteger(stores) || stores < 1 || stores > 100) throw new RangeError('stores must be an integer from 1 to 100');
  const metric = rankingMetric(features, sector), metricLabel = metric === 'potentialRevenue' ? `${sector && !sector.builtIn ? sector.name.toLowerCase() + ' ' : ''}potential revenue` : 'annual clothing & footwear spend';
  const { ranked, insufficient } = rankAreas(features, metric);
  const top = ranked.slice(0, topN), cards = [], warnings = [];

  if (top.length) {
    const share = top.reduce((sum, item) => sum + item.value, 0) / ranked.reduce((sum, item) => sum + item.value, 0);
    cards.push({ id: 'top-markets', title: 'Biggest markets',
      headline: `${top[0].name} is the largest market by ${metricLabel}.`,
      value: { value: top[0].value, unit: 'INR/year', kind: 'money' },
      detail: `Top ${top.length}: ${top.map(item => item.name).join(', ')} — ${Math.round(share * 100)}% of the ${ranked.length} ranked states.`,
      action: `Focus site search in ${top.slice(0, 2).map(item => item.name).join(' and ')} first.`,
      badge: badgeOf(top[0].evidenceClass), evidenceClass: top[0].evidenceClass, geographyId: top[0].id, geographyName: top[0].name,
      items: top.map(item => ({ id: item.id, name: item.name, value: item.value, unit: 'INR/year' })), metric });
  } else cards.push({ id: 'top-markets', title: 'Biggest markets', headline: 'Insufficient data to rank markets.', value: null, action: 'Load population and spend data for at least one state.', badge: 'assumption', geographyId: null });

  // Best return among the biggest markets, from the same analysis as the side panel.
  const analysed = [];
  for (const item of top) {
    const geography = await loadGeography(item.id);
    if (geography) analysed.push({ item, analysis: analyzeLocation({ geography, sector }) });
  }
  const byReturn = [...analysed].sort((a, b) => {
    const pa = a.analysis.scenarios.mid.paybackMonths ?? Infinity, pb = b.analysis.scenarios.mid.paybackMonths ?? Infinity;
    return pa - pb || b.analysis.scenarios.mid.roi5YearPercent - a.analysis.scenarios.mid.roi5YearPercent;
  });
  const best = byReturn[0];
  if (best) {
    const mid = best.analysis.scenarios.mid, capacityOnly = analysed.every(a => a.analysis.revenueBasis.basis === 'store_capacity_benchmark' || a.analysis.scenarios.mid.revenueConstraint === 'store_capacity_limited');
    const limit = { demand_limited: 'limited by area demand', store_capacity_limited: 'limited by store size', no_demand_data: 'store-capacity benchmark (no demand data)' }[mid.revenueConstraint] || '';
    const badge = weakest(badgeOf(best.analysis.costRange.evidenceClass), badgeOf(best.analysis.revenueBasis.evidenceClass));
    cards.push({ id: 'best-return', title: 'Best return (base case)',
      headline: mid.paybackMonths === null ? `None of the top markets pays back within 5 years at base-case costs; ${best.item.name} comes closest.` : `${best.item.name} pays back fastest among the top markets.`,
      value: mid.paybackMonths === null ? { value: mid.roi5YearPercent, unit: '% ROI over 5 years', kind: 'percent' } : { value: mid.paybackMonths, unit: 'months to pay back', kind: 'months' },
      detail: `Base case: ${mid.roi5YearPercent}% ROI over 5 years on ${tierText(best.analysis.tier)} costs; store revenue ${limit}.${capacityOnly ? ' Every top market fills one store to capacity, so this ranks costs, not demand.' : ''}`,
      action: 'Confirm rent and expected sales with a site visit before committing.',
      badge, evidenceClass: best.analysis.costRange.evidenceClass, geographyId: best.item.id, geographyName: best.item.name,
      analysis: { paybackMonths: mid.paybackMonths, roi5YearPercent: mid.roi5YearPercent, investment: mid.investment, annualRevenue: mid.annualRevenue, revenueConstraint: mid.revenueConstraint, revenueBasis: best.analysis.revenueBasis.basis } });
    if (capacityOnly) warnings.push('Store revenue in every top market is set by store capacity (no demand data, or demand above one store); return rankings reflect city-tier costs only.');

    const inv = best.analysis.costRange.investmentTotal;
    cards.push({ id: 'capital', title: `Capital for ${stores} store${stores > 1 ? 's' : ''}`,
      headline: `Opening ${stores} store${stores > 1 ? 's' : ''} in ${best.item.name} needs about this much capital.`,
      value: { value: mid.investment * stores, unit: 'INR', kind: 'money' },
      range: { low: inv.low * stores, high: inv.high * stores, unit: 'INR' },
      detail: `Per store: base case on ${tierText(best.analysis.tier)} costs, including fit-out, deposit, stock, fees and a cash reserve.`,
      action: 'Plan funding at the base figure and keep the high end as the ceiling.',
      badge: badgeOf(best.analysis.costRange.evidenceClass), evidenceClass: best.analysis.costRange.evidenceClass, geographyId: best.item.id, geographyName: best.item.name,
      perStore: { low: inv.low, mid: mid.investment, high: inv.high }, stores });
  }

  // Fastest-growing incomes across the same state features.
  const trends = features.map(f => ({ f, trend: estimateIncomeTrend({ level: 'state', name: f.name, state: f.state || f.name }) }))
    .filter(row => row.trend.status === 'available');
  trends.sort((a, b) => b.trend.cagr.longRun.rate - a.trend.cagr.longRun.rate);
  if (trends.length) {
    const lead = trends[0], cagr = lead.trend.cagr.longRun, ranks = Object.fromEntries(ranked.map((item, index) => [item.id, index + 1]));
    cards.push({ id: 'income-growth', title: 'Fastest-rising incomes',
      headline: `${lead.f.name} has the fastest growth in income per person.`,
      value: { value: cagr.rate * 100, unit: '% a year', kind: 'percent' },
      detail: `${cagr.from} to ${cagr.to}, current prices (includes inflation).${ranks[lead.f.id] ? ` Market size rank: #${ranks[lead.f.id]}.` : ''} Next: ${trends.slice(1, 3).map(row => `${row.f.name} ${(row.trend.cagr.longRun.rate * 100).toFixed(1)}%`).join(', ')}.`,
      action: !ranks[lead.f.id] ? 'Its market size is missing from the data; fill that gap before deciding.' : ranks[lead.f.id] <= topN ? 'A large and fast-growing market: shortlist sites here.' : 'Watch this market; growth may outpace its current size.',
      badge: 'official', evidenceClass: 'official_observed', geographyId: lead.f.id, geographyName: lead.f.name,
      source: lead.trend.source });
  }

  // Biggest data gap.
  const sample = analysed[0]?.analysis;
  const unsourced = sample ? Object.values(sample.assumptions).filter(a => a.evidenceClass === 'model_assumption').map(a => a.label) : [];
  if (insufficient.length) cards.push({ id: 'data-gap', title: 'Biggest data gap',
    headline: `${insufficient.length} of ${features.length} states have no population or market figure.`,
    value: { value: insufficient.length, unit: 'states left out of rankings', kind: 'count' },
    detail: `Missing: ${insufficient.map(item => item.name).join(', ')}.${unsourced.length ? ` Also, ${unsourced.length} cost inputs (for example ${unsourced.slice(0, 3).join('; ')}) are assumptions.` : ''}`,
    action: 'Treat rankings as partial until these states have data.', badge: 'assumption', evidenceClass: 'unavailable',
    geographyId: insufficient[0].id, geographyName: insufficient[0].name, items: insufficient });
  else if (unsourced.length) cards.push({ id: 'data-gap', title: 'Biggest data gap',
    headline: 'Store cost inputs are not yet backed by quotes.', value: { value: unsourced.length, unit: 'cost inputs are assumptions', kind: 'count' },
    detail: unsourced.join(', '), action: 'Replace rent, fit-out and fees with real quotes for shortlisted sites.', badge: 'assumption', evidenceClass: 'model_assumption', geographyId: top[0]?.id || null, geographyName: top[0]?.name || null });

  return { generatedAt: new Date().toISOString(), level: features[0]?.level || 'state', rankingMetric: metric, rankedCount: ranked.length,
    insufficientData: insufficient, cards, warnings };
}

module.exports = { buildCeoInsights, rankAreas, rankingMetric };
