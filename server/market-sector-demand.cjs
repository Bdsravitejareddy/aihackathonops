'use strict';

// Sector-aware potential revenue. Consumer spend = Σ the sector's HCES 2023-24 item groups, per state and
// rural/urban sector, applied to each geography's modelled 2020 rural/urban population:
//   potentialRevenue = (rural pop × rural spend + urban pop × urban spend) × 12 × organisedShare × (1 − onlineShareOfOrganised)
// Apparel reproduces the existing map value (clothing & bedding + footwear, 41% × 78%).

const itemCatalog = require('../data/india-geography/hces-state-item-groups.json');

const ITEM_KEYS = itemCatalog.itemGroups.map(item => item.key);
const normalizeState = value => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/\bnct of\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
const byState = new Map(itemCatalog.observations.map(row => [normalizeState(row.state), row]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const SOURCE = { title: itemCatalog.source.title, publisher: itemCatalog.source.publisher, url: itemCatalog.source.url, referencePeriod: '2023-24', metric: 'sectorSpendPerPersonMonthly', evidenceClass: 'official_survey_estimate' };
// National modelled 2020 rural/urban split (WorldPop 2020, state urban shares) used only to scale the map legend.
const NATIONAL_URBAN_SHARE = 0.309;

/** Map loose names ("Clothing and bedding", "beverages & processed food") to HCES item-group keys. */
function matchItemGroup(name) {
  const loose = value => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, '');
  const wanted = loose(name);
  if (!wanted) return null;
  return ITEM_KEYS.find(key => loose(key) === wanted) || ITEM_KEYS.find(key => loose(key).startsWith(wanted) || wanted.startsWith(loose(key))) || null;
}

/** Per-capita monthly spend on the sector's item groups in one state, rural and urban. */
function sectorSpend(state, categories) {
  const row = byState.get(normalizeState(state));
  if (!row || !Array.isArray(categories) || !categories.length) return null;
  const pick = sector => categories.reduce((sum, key) => sum + (row.sectors[sector].items[key] ?? NaN), 0);
  const rural = pick('rural'), urban = pick('urban');
  if (!finite(rural) || !finite(urban)) return null;
  return { state: row.state, rural, urban, categories: [...categories], reportPages: { rural: row.sectors.rural.reportPage, urban: row.sectors.urban.reportPage } };
}

const storeShareOf = sector => finite(sector?.organisedShare) && finite(sector?.onlineShareOfOrganised) ? sector.organisedShare * (1 - sector.onlineShareOfOrganised) : null;

/** Ratio of national sector potential to apparel potential, to rescale apparel-tuned revenue legends. */
function legendScale(sector, reference) {
  const national = s => {
    const spend = categories => ['rural', 'urban'].map(key => categories.reduce((sum, item) => sum + (itemCatalog.allIndia[key][item] || 0), 0));
    const [rural, urban] = spend(s.hcesCategories || []);
    const share = storeShareOf(s);
    return share === null ? null : ((1 - NATIONAL_URBAN_SHARE) * rural + NATIONAL_URBAN_SHARE * urban) * share;
  };
  const a = national(sector), b = national(reference);
  return a && b ? a / b : null;
}

/** Return a copy of a normalized map feature whose potentialRevenue follows the sector. */
function applySectorDemand(feature, sector) {
  if (!feature?.metrics || !sector) return feature;
  const prior = feature.metrics.potentialRevenue || {};
  const population = prior.components?.population2020 ?? null;
  const urban = prior.components?.urbanPopulation2020 ?? null;
  const spend = sectorSpend(feature.state || (feature.level === 'state' ? feature.name : null), sector.hcesCategories);
  const share = storeShareOf(sector);
  const ready = finite(population) && finite(urban) && urban >= 0 && urban <= population && spend && share !== null;
  const annualSpend = ready ? ((population - urban) * spend.rural + urban * spend.urban) * 12 : null;
  const value = ready ? annualSpend * share : null;
  const categories = (sector.hcesCategories || []).join(' + ') || 'no HCES item groups';
  const potentialRevenue = {
    value, unit: 'INR/year', evidenceClass: value === null ? 'unavailable' : 'derived_estimate',
    evidence: [...(prior.evidence || []).filter(item => item.metric === 'population'), SOURCE, ...(sector.sources || []).slice(0, 3)],
    warnings: value === null
      ? [`Potential revenue for ${sector.name} needs the modelled 2020 rural/urban population, the state's HCES item groups (${categories}) and a sourced organised and online share.`]
      : [`Potential revenue (${sector.name}) = modelled 2020 rural (${Math.round(population - urban)}) and urban (${Math.round(urban)}) population × HCES 2023-24 ${spend.state} monthly spend on ${categories} (rural ₹${spend.rural.toFixed(2)}, urban ₹${spend.urban.toFixed(2)}) × 12 × organised physical-store share (${share.toFixed(4)}: ${Math.round(sector.organisedShare * 100)}% organised × ${Math.round((1 - sector.onlineShareOfOrganised) * 100)}% offline). Area-wide demand, not one store's sales.`],
    components: { population2020: population, urbanPopulation2020: urban, ruralSpendPerPersonMonthly: spend?.rural ?? null, urbanSpendPerPersonMonthly: spend?.urban ?? null,
      hcesCategories: sector.hcesCategories || [], annualCategoryExpenditure2020: annualSpend, organisedStoreShare: share, sectorId: sector.id },
    ...(value === null ? { missing: { reason: 'missing_calculation_dependency', action: 'Add the sector\'s HCES item groups and sourced organised/online shares, or select an area with modelled population.' } } : {})
  };
  const categoryExpenditure = { value: annualSpend, unit: 'INR/year', evidenceClass: annualSpend === null ? 'unavailable' : 'derived_estimate', evidence: [SOURCE],
    warnings: [`Annual household spend on ${categories} (HCES 2023-24 rates × modelled 2020 population); market spend, not store sales.`] };
  const metrics = { ...feature.metrics, potentialRevenue, categoryExpenditure };
  return { ...feature, metrics, sector: { id: sector.id, name: sector.name }, metricValue: feature.metricValue && feature.metricValue === feature.metrics.potentialRevenue ? potentialRevenue : feature.metricValue };
}

module.exports = { ITEM_KEYS, itemCatalog, matchItemGroup, sectorSpend, storeShareOf, legendScale, applySectorDemand, normalizeState };
