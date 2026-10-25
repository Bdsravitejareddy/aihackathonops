'use strict';

const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Allocate historical parent counts to children using area-weighted intersections.
 * This is a modeled areal interpolation, not a claim that residents are uniformly distributed.
 */
function allocateParentPopulation({ parents = [], children = [], intersections = [] } = {}) {
  const childById = new Map(children.map(child => [child.id, child]));
  const parentById = new Map(parents.map(parent => [parent.id, parent]));
  const allocated = new Map(children.map(child => [child.id, { id: child.id, population: 0, hasValue: false, sourceIds: new Set(), referenceYears: new Set(), allocationMethod: 'areal_interpolation', evidenceClass: 'derived_estimate', uncertainty: 'high' }]));
  const intersectionsByParent = new Map();
  for (const overlap of intersections) {
    const parent = parentById.get(overlap.parentId);
    const child = childById.get(overlap.childId);
    if (!parent || !child || !finiteNonnegative(overlap.areaKm2) || overlap.areaKm2 === 0) continue;
    if (!intersectionsByParent.has(parent.id)) intersectionsByParent.set(parent.id, []);
    intersectionsByParent.get(parent.id).push({ child, areaKm2: overlap.areaKm2 });
  }
  for (const parent of parents) {
    const overlaps = intersectionsByParent.get(parent.id) || [];
    const totalArea = overlaps.reduce((sum, item) => sum + item.areaKm2, 0);
    if (!finiteNonnegative(parent.population) || totalArea <= 0) continue;
    // Round only at presentation. Full precision here preserves parent totals.
    for (const { child, areaKm2 } of overlaps) {
      const target = allocated.get(child.id);
      target.population += parent.population * areaKm2 / totalArea;
      target.hasValue = true;
      if (parent.evidence?.sourceId) target.sourceIds.add(parent.evidence.sourceId);
      if (Number.isInteger(parent.referenceYear)) target.referenceYears.add(parent.referenceYear);
    }
  }
  return [...allocated.values()].map(item => {
    const child = childById.get(item.id);
    const years = [...item.referenceYears];
    const population = item.hasValue ? item.population : null;
    return {
      id: item.id,
      population,
      populationDensityPerKm2: population !== null && finiteNonnegative(child?.areaKm2) && child.areaKm2 > 0 ? population / child.areaKm2 : null,
      referenceYear: years.length === 1 ? years[0] : null,
      sourceIds: [...item.sourceIds],
      allocationMethod: item.allocationMethod,
      evidenceClass: item.evidenceClass,
      uncertainty: item.uncertainty
    };
  });
}

/** Aggregate additive totals and population-weighted per-capita metrics. */
function aggregateGeography({ children = [], metric = {} } = {}) {
  const warnings = [];
  const populationKey = metric.population || 'population';
  const availablePopulation = children.filter(row => finiteNonnegative(row[populationKey]));
  const result = { population: availablePopulation.length === children.length && children.length ? availablePopulation.reduce((sum, row) => sum + row[populationKey], 0) : null };
  if (populationKey !== 'population') result[populationKey] = result.population;
  for (const key of metric.totals || []) {
    const rows = children.filter(row => finiteNonnegative(row[key]));
    result[key] = rows.length === children.length && children.length ? rows.reduce((sum, row) => sum + row[key], 0) : null;
  }
  for (const key of (Array.isArray(metric.perCapita) ? metric.perCapita : metric.perCapita ? [metric.perCapita] : [])) {
    const rows = children.filter(row => finiteNonnegative(row[populationKey]) && finiteNonnegative(row[key]));
    const population = rows.reduce((sum, row) => sum + row[populationKey], 0);
    result[key] = rows.length === children.length && children.length && population > 0
      ? rows.reduce((sum, row) => sum + row[populationKey] * row[key], 0) / population
      : null;
  }
  const vintages = [...new Set(children.map(row => row.referenceYear).filter(Number.isInteger))];
  const mixed = vintages.length > 1;
  if (mixed) warnings.push('Source vintages differ across child geographies; aggregate combines mixed reference years.');
  const sourceIds = [...new Set(children.flatMap(row => row.sourceIds || []))].sort();
  return { ...result, sourceIds, sourceVintage: { referenceYear: vintages.length === 1 ? vintages[0] : null, mixed }, warnings };
}

module.exports = { allocateParentPopulation, aggregateGeography };
