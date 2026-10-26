'use strict';

// Builds approximate PIN-code areas from the India Post All India Pincode Directory (post-office coordinates):
// each PIN's anchor is the median of its cleaned office locations, and its area is the Voronoi cell of that anchor
// clipped to its state. Populations come from the WorldPop grid and are scaled so PINs sum exactly to their district.
// Usage: node scripts/build-india-pins.cjs --grid <ind_ppp_2020_1km_Aggregated_UNadj.tif>

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const polygonClipping = require('polygon-clipping');
const { readPopulationGrid, rasterize, pixelZones, calibrateUrban, zonalStats, bboxOf } = require('./india-population-grid.cjs');
const { validateFeatures } = require('./validate-india-geography.cjs');
const { GRID_SOURCE, ORGANISED_STORE_SHARE } = require('./build-india-districts.cjs');

const DIRECTORY = 'data/india-geography/sources/pin-directory/all-india-pincode-directory.csv.gz';
const PIN_ARTIFACT = 'data/india-geography/india-pin-features.geojson.gz';
const DIRECTORY_SOURCE = {
  sourceId: 'india-post-pin-directory', title: 'All India Pincode Directory (post office name, PIN, office type, delivery status, district, state, latitude, longitude)',
  publisher: 'Department of Posts, Ministry of Communications', url: 'https://www.data.gov.in/catalog/all-india-pincode-directory',
  referencePeriod: 'Downloaded 2026-10-26', license: 'Government Open Data License - India', evidenceClass: 'official_observed'
};
const round = (value, digits = 0) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
const stateKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(header.map((key, i) => [key.replace(/^﻿/, ''), r[i]])));
}

const median = values => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Cleans office coordinates: swapped lat/long are repaired, points outside India or far from the declared state are dropped.
function cleanOffices(offices, grid, stateZones, states) {
  const codeByKey = new Map(states.map((f, i) => [stateKey(f.properties.name), i]));
  codeByKey.set('dadraandnagarhavelianddamananddiu', codeByKey.get(stateKey('Dadra and Nagar Haveli and Daman and Diu')));
  const zoneAt = (lon, lat, radius = 0) => {
    const col = Math.floor((lon - grid.west) / grid.dx), row = Math.floor((grid.north - lat) / grid.dy), found = new Set();
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const r = row + dr, c = col + dc; if (r < 0 || c < 0 || r >= grid.height || c >= grid.width) continue;
      const zone = stateZones[r * grid.width + c]; if (zone >= 0) found.add(zone);
    }
    return found;
  };
  const counts = { offices: offices.length, invalidPin: 0, missingCoordinates: 0, swappedRepaired: 0, outsideIndia: 0, wrongState: 0, stateInferred: 0, valid: 0 };
  const cleaned = [];
  for (const office of offices) {
    const pin = String(office.pincode || '').trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { counts.invalidPin++; continue; }
    const declared = codeByKey.has(stateKey(office.statename)) ? codeByKey.get(stateKey(office.statename)) : null;
    const lat = Number(office.latitude), lon = Number(office.longitude), record = { pin, declared, delivery: office.delivery === 'Delivery', district: office.district, office: office.officename, lon: null, lat: null };
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { counts.missingCoordinates++; cleaned.push(record); continue; }
    let point = null;
    for (const [x, y, swapped] of [[lon, lat, false], [lat, lon, true]]) {
      const near = zoneAt(x, y, 2);
      if (!near.size) continue;
      if (declared === null || near.has(declared)) { point = [x, y]; if (swapped) counts.swappedRepaired++; if (declared === null) { record.declared = [...zoneAt(x, y, 0)][0] ?? [...near][0]; counts.stateInferred++; } break; }
    }
    if (!point) { if (zoneAt(lon, lat, 2).size || zoneAt(lat, lon, 2).size) counts.wrongState++; else counts.outsideIndia++; cleaned.push(record); continue; }
    [record.lon, record.lat] = point; counts.valid++; cleaned.push(record);
  }
  return { cleaned, counts };
}

function anchorsFor(cleaned) {
  const byPin = new Map();
  for (const o of cleaned) { if (!byPin.has(o.pin)) byPin.set(o.pin, []); byPin.get(o.pin).push(o); }
  const pins = [], missing = [];
  for (const [pin, offices] of byPin) {
    const located = offices.filter(o => o.lon !== null), delivery = located.filter(o => o.delivery), use = delivery.length ? delivery : located;
    const stateVotes = new Map(); for (const o of (use.length ? use : offices)) if (o.declared !== null) stateVotes.set(o.declared, (stateVotes.get(o.declared) || 0) + 1);
    const state = [...stateVotes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const inState = use.filter(o => o.declared === state);
    if (!inState.length || state === null) { missing.push({ pin, offices: offices.length, reason: 'no office with a valid location in its state' }); continue; }
    const districtVotes = new Map(); for (const o of offices) districtVotes.set(o.district, (districtVotes.get(o.district) || 0) + 1);
    pins.push({ pin, state, lon: median(inState.map(o => o.lon)), lat: median(inState.map(o => o.lat)), offices: offices.length, locatedOffices: inState.length,
      deliveryOffices: offices.filter(o => o.delivery).length, postalDistrict: [...districtVotes].sort((a, b) => b[1] - a[1])[0][0], officeNames: offices.slice(0, 6).map(o => o.office) });
  }
  return { pins, missing };
}

// Rounds a ring to ~1 m, drops repeated points and returns null for slivers that rounding collapses.
function cleanRing(ring) {
  const out = [];
  for (const [x, y] of ring) { const point = [round(x, 5), round(y, 5)], last = out.at(-1); if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point); }
  if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push([...out[0]]);
  let area = 0; for (let i = 0; i < out.length - 1; i++) area += out[i][0] * out[i + 1][1] - out[i + 1][0] * out[i][1];
  return out.length >= 4 && Math.abs(area) > 1e-9 ? out : null;
}

// Voronoi cells of the PIN anchors within one state, clipped to the state's polygon.
function stateCells(pins, stateGeometry) {
  const { Delaunay } = require('d3-delaunay');
  const box = bboxOf(stateGeometry), pad = 0.5;
  // PINs whose offices carry identical coordinates (copied head-office locations) share one cell rather than
  // receiving slivers; their population is split equally later.
  const groups = new Map(), groupOf = pins.map(p => { const key = `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`; if (!groups.has(key)) groups.set(key, groups.size); return groups.get(key); });
  const points = []; pins.forEach((p, i) => { points[groupOf[i]] = [p.lon, p.lat]; });
  const clip = stateGeometry.type === 'Polygon' ? [stateGeometry.coordinates] : stateGeometry.coordinates;
  if (points.length === 1) return pins.map(() => ({ type: stateGeometry.type, coordinates: stateGeometry.coordinates }));
  const voronoi = Delaunay.from(points).voronoi([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]);
  const cells = points.map((_, g) => {
    const cell = voronoi.cellPolygon(g); if (!cell) return null;
    const clipped = polygonClipping.intersection([cell], clip);
    if (!clipped.length) return null;
    const rounded = clipped.map(poly => poly.map(cleanRing)).filter(poly => poly[0]).map(poly => poly.filter(Boolean));
    if (!rounded.length) return null;
    return rounded.length === 1 ? { type: 'Polygon', coordinates: rounded[0] } : { type: 'MultiPolygon', coordinates: rounded };
  });
  return pins.map((_, i) => cells[groupOf[i]]);
}

const PIN_DEFAULTS = {
  confidence: 'low-medium: approximate PIN boundary; population consistent with district totals',
  uncertainty: 'PIN area is approximated from post-office locations, not the official delivery boundary',
  warnings: ['PIN boundary is approximate (built from post-office locations), not the official India Post delivery boundary.', 'Population is a modelled 2020 estimate constrained to the district total.']
};
function expandPinFeature(collection, feature) {
  const p = feature.properties, { evidenceRefs = [], ...rest } = p;
  return { ...feature, properties: { ...collection.featureDefaults, ...rest, warnings: [...(collection.featureDefaults?.warnings || [])], evidence: evidenceRefs.flatMap(ref => collection.evidenceCatalog?.[ref] || []) } };
}

async function buildPins({ rootDir = path.resolve(__dirname, '..'), gridPath, write = true } = {}) {
  if (!gridPath || !fs.existsSync(gridPath)) throw new Error(`WorldPop grid not found. Download ${GRID_SOURCE.downloadUrl} and pass --grid <path>.`);
  const csvBytes = zlib.gunzipSync(fs.readFileSync(path.join(rootDir, DIRECTORY)));
  const states = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/india-geography/india-state-features.geojson'), 'utf8')).features;
  const districts = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/india-geography/india-district-features.geojson'), 'utf8')).features;
  const grid = await readPopulationGrid(gridPath);
  const stateZones = pixelZones(grid, states), districtZones = pixelZones(grid, districts);
  const { urban } = calibrateUrban(grid, stateZones, states.map(f => f.properties.urbanPopulation / f.properties.population));

  const { cleaned, counts } = cleanOffices(parseCsv(csvBytes.toString('utf8')), grid, stateZones, states);
  const { pins, missing } = anchorsFor(cleaned);

  const geometries = new Array(pins.length).fill(null);
  states.forEach((state, stateIndex) => {
    const members = pins.map((p, i) => [p, i]).filter(([p]) => p.state === stateIndex);
    if (!members.length) return;
    stateCells(members.map(([p]) => p), state.geometry).forEach((geometry, k) => { geometries[members[k][1]] = geometry; });
  });
  const located = pins.map((p, i) => ({ ...p, geometry: geometries[i] })).filter(p => p.geometry);
  const sharing = new Map(); for (const p of located) sharing.set(p.geometry, (sharing.get(p.geometry) || 0) + 1);
  const stats = zonalStats(grid, located.map(p => ({ geometry: p.geometry })), { urban, subdivisions: 4 })
    .map((row, i) => { const n = sharing.get(located[i].geometry); return { population: row.population / n, urbanPopulation: row.urbanPopulation / n, sharedWith: n - 1 }; });

  // Parent district = district holding most of the PIN's grid population; PIN populations then sum to the district total.
  const parentDistrict = located.map(p => {
    const weights = new Map();
    rasterize(grid, p.geometry, 4, (row, col, weight) => { const i = row * grid.width + col, zone = districtZones[i]; if (zone >= 0) weights.set(zone, (weights.get(zone) || 0) + grid.values[i] * weight + weight * 1e-6); });
    if (!weights.size) { const col = Math.floor((p.lon - grid.west) / grid.dx), row = Math.floor((grid.north - p.lat) / grid.dy), zone = districtZones[row * grid.width + col]; return zone >= 0 ? zone : null; }
    return [...weights].sort((a, b) => b[1] - a[1])[0][0];
  });
  const rawByDistrict = new Map();
  located.forEach((_, i) => { const d = parentDistrict[i]; if (d !== null) rawByDistrict.set(d, (rawByDistrict.get(d) || 0) + stats[i].population); });

  const features = [], orphaned = [];
  // Citations and caveats shared by every PIN are stored once; expandPinFeature restores them per feature.
  const evidenceCatalog = {
    'pin-directory': [{ ...DIRECTORY_SOURCE, metric: 'geometry', method: 'Voronoi of cleaned post-office locations' }],
    worldpop: [{ ...GRID_SOURCE, metric: 'population', allocationMethod: 'area-weighted zonal sum, district-constrained' }],
    'organised-share': [{ ...ORGANISED_STORE_SHARE.source, metric: 'organisedStoreShare' }]
  };
  located.forEach((p, i) => {
    const districtIndex = parentDistrict[i];
    if (districtIndex === null) { orphaned.push(p.pin); return; }
    const district = districts[districtIndex].properties, state = states[p.state].properties;
    const scale = rawByDistrict.get(districtIndex) > 0 ? district.population / rawByDistrict.get(districtIndex) : 0;
    const population = Math.round(stats[i].population * scale), urbanPopulation = Math.min(population, Math.round(stats[i].urbanPopulation * scale)), ruralPopulation = population - urbanPopulation;
    const spend = population > 0 ? (urbanPopulation * state.urbanApparelSpendPerPersonMonthly + ruralPopulation * state.ruralApparelSpendPerPersonMonthly) / population : null;
    features.push({ type: 'Feature', id: `pin:${p.pin}`, geometry: p.geometry, properties: {
      code: p.pin, sourceCode: p.pin, name: p.pin, pin: p.pin, level: 'pin', parentId: district.code, parentLevel: 'district', state: state.name, district: district.name,
      postalDistrict: p.postalDistrict, postOffices: p.offices, deliveryOffices: p.deliveryOffices, locatedOffices: p.locatedOffices, officeNames: p.officeNames,
      anchor: [round(p.lon, 5), round(p.lat, 5)], ...(stats[i].sharedWith ? { sharedArea: { pinsSharingLocation: stats[i].sharedWith + 1, note: `The directory gives this PIN the same location as ${stats[i].sharedWith} other PIN(s); they share one approximate area and its population is split equally.` } } : {}), mappingMethod: 'district holding the largest share of the PIN area population on the WorldPop grid',
      boundaryMethod: 'approximate: Voronoi cell of the median delivery-office location, clipped to the state boundary',
      population, urbanPopulation, ruralPopulation, populationReferenceYear: 2020, evidenceClass: 'derived_estimate',
      allocationMethod: 'WorldPop 2020 1 km counts summed over the approximate PIN area (4×4 sub-pixel), then scaled so the PINs in each district sum to the district population',
      households: district.households && district.population ? Math.round(district.households * population / district.population) : null,
      apparelSpendPerPersonMonthly: round(spend, 2), apparelSpendEvidenceClass: 'derived_estimate',
      ruralApparelSpendPerPersonMonthly: state.ruralApparelSpendPerPersonMonthly, urbanApparelSpendPerPersonMonthly: state.urbanApparelSpendPerPersonMonthly,
      apparelSpendReferencePeriod: '2023-24', annualApparelExpenditure: spend === null ? null : round(population * spend * 12), annualExpenditureEvidenceClass: 'derived_estimate',
      organisedStoreShare: round(ORGANISED_STORE_SHARE.value, 4),
      demographics: { ruralPopulation, urbanPopulation, ruralShare: population ? ruralPopulation / population : null, urbanShare: population ? urbanPopulation / population : null, ageGroups: null },
      evidenceRefs: ['pin-directory', 'worldpop', `hces:${state.code}`, 'organised-share']
    } });
    if (!evidenceCatalog[`hces:${state.code}`]) evidenceCatalog[`hces:${state.code}`] = (state.evidence || []).filter(e => e.metric === 'apparelSpendPerPersonMonthly');
  });

  const collection = { type: 'FeatureCollection', name: 'India PIN codes (approximate areas) with WorldPop 2020 population and HCES-based apparel spend',
    featureDefaults: PIN_DEFAULTS, evidenceCatalog, features };
  validateFeatures(collection, { level: 'pin', expectedCount: features.length, parentIds: districts.map(f => f.properties.code) });
  // Conservation check: PINs must sum to their district totals.
  const sums = new Map(); for (const f of features) sums.set(f.properties.parentId, (sums.get(f.properties.parentId) || 0) + f.properties.population);
  const districtGaps = districts.map(f => ({ district: f.properties.code, name: f.properties.name, population: f.properties.population, pinSum: sums.get(f.properties.code) || 0 }))
    .filter(row => Math.abs(row.pinSum - row.population) > Math.max(50, row.population * 0.001));
  const report = {
    source: { ...DIRECTORY_SOURCE, path: DIRECTORY, sha256: crypto.createHash('sha256').update(csvBytes).digest('hex') },
    officeQuality: counts, pins: { inDirectory: pins.length + missing.length, mapped: features.length, noValidLocation: missing, outsideDistricts: orphaned, emptyAfterClipping: pins.length - located.length },
    population: { pinTotal: features.reduce((s, f) => s + f.properties.population, 0), districtTotal: districts.reduce((s, f) => s + f.properties.population, 0), districtsWithoutPins: districtGaps.filter(r => r.pinSum === 0).map(r => r.name), districtGaps: districtGaps.filter(r => r.pinSum > 0) }
  };
  if (write) {
    const dir = path.join(rootDir, 'data/india-geography');
    fs.writeFileSync(path.join(rootDir, PIN_ARTIFACT), zlib.gzipSync(`${JSON.stringify(collection)}\n`, { level: 9 }));
    fs.writeFileSync(path.join(dir, 'india-pin-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return { collection, report };
}

if (require.main === module) {
  const index = process.argv.indexOf('--grid');
  buildPins({ gridPath: index > 0 ? process.argv[index + 1] : null })
    .then(({ report }) => process.stdout.write(`${JSON.stringify({ officeQuality: report.officeQuality, pins: { ...report.pins, noValidLocation: report.pins.noValidLocation.length, outsideDistricts: report.pins.outsideDistricts.length }, population: { ...report.population, districtGaps: report.population.districtGaps.length } }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
function readPinArtifact(rootDir = path.resolve(__dirname, '..')) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(rootDir, PIN_ARTIFACT))).toString('utf8')); }
module.exports = { PIN_ARTIFACT, readPinArtifact, buildPins, parseCsv, cleanOffices, anchorsFor, expandPinFeature };
