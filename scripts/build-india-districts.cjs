'use strict';

// Builds district features (geoBoundaries ADM2) with WorldPop 2020 population, a Census-calibrated urban share and
// HCES-based apparel spend, plus matching 2020 state totals so every map level uses the same population vintage.
// Usage: node scripts/build-india-districts.cjs --grid <ind_ppp_2020_1km_Aggregated_UNadj.tif>

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readPopulationGrid, cellAreaKm2, rasterize, pixelZones, calibrateUrban, zonalStats, gridTotal } = require('./india-population-grid.cjs');
const { validateFeatures } = require('./validate-india-geography.cjs');

const GRID_SOURCE = {
  sourceId: 'worldpop-2020-1km-unadj-ind', title: 'WorldPop India 2020 population counts, 1 km, UN-adjusted (ind_ppp_2020_1km_Aggregated_UNadj.tif)',
  publisher: 'WorldPop, University of Southampton', url: 'https://hub.worldpop.org/geodata/summary?id=31527',
  downloadUrl: 'https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/IND/ind_ppp_2020_1km_Aggregated_UNadj.tif',
  referencePeriod: '2020', license: 'CC BY 4.0', evidenceClass: 'derived_estimate'
};
const DISTRICT_SOURCE = {
  sourceId: 'geoboundaries-ind-adm2', title: 'geoBoundaries India ADM2 (districts), simplified geometry',
  publisher: 'geoBoundaries; underlying source: Pathways Data Pvt. Ltd. / Local Government Directory (lgdirectory.gov.in)',
  url: 'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/',
  downloadUrl: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2_simplified.geojson',
  referencePeriod: '2021 boundaries; source updated 2023-01-19', license: 'ODbL 1.0'
};
// CareEdge Ratings (FY25), as reported by IBEF: organised retail ≈ 41% of apparel retail; online ≈ 22% of organised.
const ORGANISED_STORE_SHARE = { value: 0.41 * (1 - 0.22), organisedShare: 0.41, onlineShareOfOrganised: 0.22,
  source: { sourceId: 'careedge-apparel-retail-fy25', title: "India's apparel retail market poised to reach US$ 193 billion by FY30: CareEdge", publisher: 'IBEF (India Brand Equity Foundation), reporting CareEdge Ratings',
    url: 'https://www.ibef.org/news/india-s-apparel-retail-market-poised-to-reach-us-193-billion-by-fy30-careedge', referencePeriod: 'FY25', evidenceClass: 'derived_estimate' } };

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const round = (value, digits = 0) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

const districtKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, 'and').replace(/\b(district|dist|urban)\b/g, '').replace(/bengaluru/g, 'bangalore').replace(/mysuru/g, 'mysore').replace(/belagavi/g, 'belgaum')
  .replace(/kalaburagi/g, 'gulbarga').replace(/vijayapura/g, 'bijapur').replace(/shivamogga/g, 'shimoga').replace(/[^a-z0-9]/g, '');
const stateKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/^nctof/, '').replace(/[^a-z0-9]/g, '').replace(/^nctof/, '');
// 2011 Census units that were later split: the successor states' districts are matched within the 2011 parent.
const CENSUS_PARENT = { telangana: 'andhrapradesh', ladakh: 'jammuandkashmir', dadraandnagarhavelianddamananddiu: ['dadraandnagarhaveli', 'damananddiu'] };

// Compares modelled 2020 district populations with same-named Census 2011 districts, scaled by state growth on the same grid.
// Dense urban cores that WorldPop under-allocates are corrected to Census × state growth; the state's other districts are
// rescaled so the state total on the grid is preserved. Other large gaps usually mean a boundary change and are only flagged.
function validateAgainstCensus(rootDir, features, states) {
  const census = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/india-geography/census-district-population-2011.json'), 'utf8'));
  const warnings = [], checks = [];
  for (const state of states) {
    const p = state.properties, key = stateKey(p.name), parents = [].concat(CENSUS_PARENT[key] || key);
    const candidates = census.districts.filter(row => parents.includes(stateKey(row.state)));
    const own = features.filter(f => f.properties.parentId === p.code);
    const modelTotal = own.reduce((sum, f) => sum + f.properties.population, 0);
    const growth = p.population > 0 ? modelTotal / p.population : null;
    if (!growth) continue;
    const corrections = [];
    for (const feature of own) {
      const fp = feature.properties, match = candidates.find(row => districtKey(row.name) === districtKey(fp.name));
      if (!match) { fp.censusValidation = { status: 'no_2011_match', note: 'No same-named 2011 district (new or renamed district).' }; continue; }
      const expected = match.total * growth, ratio = fp.population / expected;
      fp.households = Math.round(match.totalHouseholds * fp.population / match.total);
      fp.householdsMethod = `Census 2011 households for ${match.name} scaled by the modelled 2020 population ratio.`;
      const check = { district: fp.name, state: p.name, model2020: fp.population, census2011: match.total, expectedAtStateGrowth: Math.round(expected), ratio: round(ratio, 3) };
      if (ratio < 0.8 && fp.demographics.urbanShare >= 0.9) {
        corrections.push({ feature, corrected: Math.round(expected), before: fp.population });
        check.status = 'corrected_dense_core_undercount';
      } else if (Math.abs(ratio - 1) > 0.35) {
        check.status = 'flagged_possible_boundary_change';
        fp.warnings.push(`Modelled population differs ${round((ratio - 1) * 100)}% from Census 2011 ${match.name} grown at the state rate; the district boundary may have changed since 2011.`);
      } else check.status = 'consistent';
      fp.censusValidation = check; checks.push(check);
    }
    if (!corrections.length) continue;
    // A same-named district far above its 2011 size means the state redrew boundaries (e.g. Delhi in 2012): low ratios
    // there are boundary effects, not undercounts, so nothing is corrected.
    const redrawn = checks.filter(check => check.state === p.name && check.ratio > 1.5);
    if (redrawn.length) {
      for (const c of corrections) { c.feature.properties.censusValidation.status = 'flagged_possible_boundary_change'; c.feature.properties.warnings.push('Not corrected: this state redrew district boundaries after 2011, so the 2011 comparison is not like-for-like.'); }
      warnings.push(`${p.name}: no dense-core correction because district boundaries were redrawn after 2011 (${redrawn.map(c => c.district.trim()).join(', ')} grew more than 1.5×).`);
      continue;
    }
    const added = corrections.reduce((sum, c) => sum + c.corrected - c.before, 0);
    const others = own.filter(f => !corrections.some(c => c.feature === f)), otherTotal = others.reduce((sum, f) => sum + f.properties.population, 0);
    const scale = otherTotal > 0 ? (otherTotal - added) / otherTotal : 1;
    for (const c of corrections) applyPopulation(c.feature, c.corrected, `Corrected from ${c.before.toLocaleString('en-IN')} (WorldPop) to Census 2011 × ${p.name} growth on the grid (${round(growth, 3)}); WorldPop under-allocates very dense urban cores.`);
    for (const f of others) applyPopulation(f, Math.round(f.properties.population * scale), null);
    warnings.push(`${p.name}: corrected ${corrections.map(c => c.feature.properties.name).join(', ')} for dense-core undercount; other districts rescaled by ${round(scale, 4)} to keep the state total.`);
  }
  return { warnings, checks };
}

function applyPopulation(feature, population, note) {
  const p = feature.properties, factor = p.population > 0 ? population / p.population : 0;
  p.urbanPopulation = Math.round(p.urbanPopulation * factor); p.population = population; p.ruralPopulation = population - p.urbanPopulation;
  p.demographics = { ...p.demographics, ruralPopulation: p.ruralPopulation, urbanPopulation: p.urbanPopulation, ruralShare: population ? p.ruralPopulation / population : null, urbanShare: population ? p.urbanPopulation / population : null };
  if (p.households) p.households = Math.round(p.households * factor);
  p.annualApparelExpenditure = round(population * p.apparelSpendPerPersonMonthly * 12);
  if (note) { p.populationCorrection = note; p.warnings.push(note); }
}

function arg(name) { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; }

async function buildDistricts({ rootDir = path.resolve(__dirname, '..'), gridPath, write = true } = {}) {
  if (!gridPath || !fs.existsSync(gridPath)) throw new Error(`WorldPop grid not found. Download ${GRID_SOURCE.downloadUrl} and pass --grid <path>.`);
  const states = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/india-geography/india-state-features.geojson'), 'utf8')).features;
  const adm2Path = path.join(rootDir, 'data/india-geography/sources/geoBoundaries-IND-ADM2-simplified.geojson');
  const adm2Bytes = fs.readFileSync(adm2Path), districts = JSON.parse(adm2Bytes.toString('utf8')).features;
  const grid = await readPopulationGrid(gridPath);

  // State pixels and urban calibration to the Census 2011 urban share of each state.
  const zones = pixelZones(grid, states);
  const targetShares = states.map(f => f.properties.population > 0 ? f.properties.urbanPopulation / f.properties.population : NaN);
  const { urban, thresholds } = calibrateUrban(grid, zones, targetShares);
  const stateStats = zonalStats(grid, states, { urban, subdivisions: 4 });

  // Parent state = the state holding most of the district's population (boundary sources differ slightly).
  const parentOf = feature => {
    const weights = new Map();
    rasterize(grid, feature.geometry, 2, (row, col, weight) => { const i = row * grid.width + col, zone = zones[i]; if (zone >= 0) weights.set(zone, (weights.get(zone) || 0) + grid.values[i] * weight + weight * 1e-6); });
    return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const districtStats = zonalStats(grid, districts, { urban, subdivisions: 4 });
  const warnings = [];
  const usedIds = new Set();
  const features = districts.map((feature, index) => {
    const stateIndex = parentOf(feature);
    if (stateIndex === null) { warnings.push(`District ${feature.properties.shapeName} does not overlap any state boundary; skipped.`); return null; }
    const state = states[stateIndex].properties, stats = districtStats[index];
    const population = Math.round(stats.population), urbanPopulation = Math.round(stats.urbanPopulation), ruralPopulation = population - urbanPopulation;
    const spend = population > 0 ? (urbanPopulation * state.urbanApparelSpendPerPersonMonthly + ruralPopulation * state.ruralApparelSpendPerPersonMonthly) / population : null;
    const annual = spend === null ? null : population * spend * 12;
    const base = `${state.code}-${String(feature.properties.shapeName).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    let code = base; for (let n = 2; usedIds.has(code); n++) code = `${base}-${n}`; usedIds.add(code);
    return { type: 'Feature', id: `district:${code}`, geometry: feature.geometry, properties: {
      code: `district:${code}`, sourceCode: feature.properties.shapeID, sourceName: feature.properties.shapeName, name: feature.properties.shapeName, level: 'district',
      parentId: state.code, parentLevel: 'state', state: state.name, mappingMethod: 'state holding the largest share of the district population on the WorldPop grid',
      population, urbanPopulation, ruralPopulation, populationReferenceYear: 2020, evidenceClass: 'derived_estimate',
      allocationMethod: 'WorldPop 2020 1 km UN-adjusted counts summed over the district polygon on a 4×4 sub-pixel grid (area-weighted)',
      urbanMethod: `Densest grid cells in ${state.name} marked urban until the state's Census 2011 urban share (${round(targetShares[stateIndex] * 100, 1)}%) is reached; density threshold ≈ ${thresholds[stateIndex]} people/km².`,
      apparelSpendPerPersonMonthly: round(spend, 2), apparelSpendEvidenceClass: 'derived_estimate',
      ruralApparelSpendPerPersonMonthly: state.ruralApparelSpendPerPersonMonthly, urbanApparelSpendPerPersonMonthly: state.urbanApparelSpendPerPersonMonthly,
      apparelSpendReferencePeriod: '2023-24', annualApparelExpenditure: round(annual), annualExpenditureEvidenceClass: 'derived_estimate',
      organisedStoreShare: round(ORGANISED_STORE_SHARE.value, 4),
      demographics: { ruralPopulation, urbanPopulation, ruralShare: population ? ruralPopulation / population : null, urbanShare: population ? urbanPopulation / population : null, ageGroups: null },
      evidence: [
        { ...DISTRICT_SOURCE, metric: 'geometry', sourceBoundaryId: feature.properties.shapeID },
        { ...GRID_SOURCE, metric: 'population', allocationMethod: 'area-weighted zonal sum' },
        ...(state.evidence || []).filter(e => e.metric === 'apparelSpendPerPersonMonthly'),
        { ...ORGANISED_STORE_SHARE.source, metric: 'organisedStoreShare' }
      ],
      confidence: 'medium for population; low for spend (state HCES rates applied to modelled urban/rural mix)',
      uncertainty: 'WorldPop 2020 modelled counts; urban split calibrated to 2011 state shares; spend uses state-level HCES 2023-24 rates',
      warnings: ['District population is a modelled 2020 estimate, not a Census count.', 'Apparel spend uses state rural/urban HCES rates; district differences come only from the urban/rural mix.']
    } };
  }).filter(Boolean);

  const validation = validateAgainstCensus(rootDir, features, states);
  warnings.push(...validation.warnings);

  // Consistency: district totals must match the state totals from the same grid within boundary-mismatch tolerance.
  const byState = new Map();
  for (const f of features) byState.set(f.properties.parentId, (byState.get(f.properties.parentId) || 0) + f.properties.population);
  const reconciliation = states.map((f, i) => {
    const stateModel = stateStats[i].population, districtSum = byState.get(f.properties.code) || 0;
    return { code: f.properties.code, name: f.properties.name, statePopulation2020: Math.round(stateModel), districtSum, gapPercent: stateModel ? round((districtSum - stateModel) / stateModel * 100, 2) : null };
  });
  const national = gridTotal(grid), stateSum = stateStats.reduce((s, x) => s + x.population, 0), districtSum = features.reduce((s, f) => s + f.properties.population, 0);
  for (const row of reconciliation) if (row.gapPercent === null || Math.abs(row.gapPercent) > 5) warnings.push(`${row.name}: districts sum to ${row.districtSum.toLocaleString('en-IN')} vs state ${row.statePopulation2020.toLocaleString('en-IN')} on the same grid (${row.gapPercent}% gap).`);
  const statusCounts = {};
  for (const f of features) { const status = f.properties.censusValidation?.status || 'unchecked'; statusCounts[status] = (statusCounts[status] || 0) + 1; }
  const summary = { censusValidation: statusCounts, gridTotal: Math.round(national), stateTotal: Math.round(stateSum), districtTotal: districtSum, stateCoveragePercent: round(stateSum / national * 100, 2), districtCoveragePercent: round(districtSum / national * 100, 2), districts: features.length, gridSha256: grid.sha256 };
  const collection = { type: 'FeatureCollection', name: 'India districts with WorldPop 2020 population and HCES-based apparel spend', features };
  validateFeatures(collection, { level: 'district', expectedCount: features.length, parentIds: states.map(f => f.properties.code) });

  const statePopulation = { source: GRID_SOURCE, organisedStoreShare: ORGANISED_STORE_SHARE, gridSha256: grid.sha256, states: Object.fromEntries(states.map((f, i) => [f.properties.code, {
    population2020: Math.round(stateStats[i].population), urbanPopulation2020: Math.round(stateStats[i].urbanPopulation), urbanDensityThreshold: thresholds[i] ?? null }])) };
  if (write) {
    const dir = path.join(rootDir, 'data/india-geography');
    fs.writeFileSync(path.join(dir, 'india-district-features.geojson'), `${JSON.stringify(collection)}\n`);
    fs.writeFileSync(path.join(dir, 'india-state-population-2020.json'), `${JSON.stringify(statePopulation, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'india-district-reconciliation.json'), `${JSON.stringify({ summary, reconciliation, censusChecks: validation.checks, warnings, adm2Sha256: hash(adm2Bytes) }, null, 2)}\n`);
  }
  return { collection, statePopulation, summary, reconciliation, warnings, cellAreaKm2: cellAreaKm2(grid, 0) };
}

if (require.main === module) {
  buildDistricts({ gridPath: arg('--grid') })
    .then(result => process.stdout.write(`${JSON.stringify({ summary: result.summary, warnings: result.warnings }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
module.exports = { buildDistricts, ORGANISED_STORE_SHARE, GRID_SOURCE, DISTRICT_SOURCE };
