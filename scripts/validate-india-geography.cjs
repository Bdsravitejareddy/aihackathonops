'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LEVELS = new Set(['country','state','district','subdistrict','city','village','ward','pin','catchment','census_state_district','state_district_age_sex','state_district','state_sector']);
const REQUIRED = ['id','sourceId','publisher','sourceUrl','downloadUrl','sourceVintage','level','codeScheme','license','status','artifact','coverage','knownGaps','variables'];
function resolveArtifact(rootDir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw new Error('Artifact path must be relative');
  const base = path.resolve(rootDir), target = path.resolve(base, relativePath);
  if (!target.startsWith(base + path.sep)) throw new Error('Artifact path escapes repository root');
  return target;
}
function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1 || !manifest.version || !Array.isArray(manifest.datasets)) errors.push('manifest schema/version/datasets are required');
  const ids = new Set();
  for (const row of manifest.datasets || []) {
    for (const key of REQUIRED) if (!(key in row)) errors.push(`${row.id || 'dataset'} missing ${key}`);
    if (ids.has(row.id)) errors.push(`duplicate dataset id ${row.id}`); ids.add(row.id);
    if (!LEVELS.has(row.level)) errors.push(`${row.id} has unsupported geography level`);
    if (!/^https:\/\//.test(row.sourceUrl || '')) errors.push(`${row.id} sourceUrl must be HTTPS`);
    if (!['available','unavailable'].includes(row.status)) errors.push(`${row.id} has invalid status`);
    if (!row.license || !['verified','unverified','restricted'].includes(row.license.status)) errors.push(`${row.id} license status is invalid`);
    if (!Array.isArray(row.knownGaps) || !Array.isArray(row.variables)) errors.push(`${row.id} gaps and variables must be arrays`);
    if (!row.coverage || !Number.isInteger(row.coverage.featureCount) || !Number.isInteger(row.coverage.rowCount)) errors.push(`${row.id} coverage counts must be integers`);
    if (row.status === 'unavailable' && (row.artifact !== null || row.coverage.featureCount !== 0 || row.coverage.rowCount !== 0 || !row.knownGaps?.length)) errors.push(`${row.id} unavailable status must have zero coverage, no artifact and a reason`);
    if (row.status === 'available' && (row.license.status !== 'verified' || !row.artifact || row.coverage.featureCount < 1)) errors.push(`${row.id} available data requires verified license, artifact and nonzero coverage`);
  }
  if (!Array.isArray(manifest.geographies) || !Array.isArray(manifest.relationships) || !Array.isArray(manifest.evidence)) errors.push('geographies, relationships and evidence arrays are required');
  const geoKeys = new Set((manifest.geographies || []).map(row => `${row.kind}:${row.externalId}`));
  if (geoKeys.size !== (manifest.geographies || []).length) errors.push('duplicate geography identifiers');
  for (const relation of manifest.relationships || []) if (!geoKeys.has(`${relation.parentKind}:${relation.parentId}`) || !geoKeys.has(`${relation.childKind}:${relation.childId}`)) errors.push('relationship references absent parent or child geography');
  if (errors.length) throw new Error(`Geography manifest invalid:\n- ${errors.join('\n- ')}`);
  return { datasetCount: manifest.datasets.length, featureCount: manifest.geographies.length, relationshipCount: manifest.relationships.length };
}
function coordValid(point) { return Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= 67 && point[0] <= 98 && point[1] >= 5 && point[1] <= 38; }
function ringValid(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(coordValid)) return false;
  const first = ring[0], last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  let area = 0;
  for (let i=0;i<ring.length-1;i++) area += ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
  return Math.abs(area) > 1e-10;
}
function validateFeatures(collection, context = {}) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Expected a GeoJSON FeatureCollection');
  const seen = new Set(); let populationTotal = 0, populationObserved = false;
  for (const feature of collection.features) {
    const props = feature?.properties || {}, id = String(feature?.id ?? props.code ?? '');
    if (!id || seen.has(id)) throw new Error(`Missing or duplicate geography code: ${id}`); seen.add(id);
    if (props.level !== context.level) throw new Error('Feature level does not match dataset level');
    if (context.level === 'pin' && !/^[1-9]\d{5}$/.test(String(props.code || id))) throw new Error(`Invalid PIN code ${id}`);
    if (Array.isArray(context.parentIds) && props.parentId && !context.parentIds.includes(props.parentId)) throw new Error(`Invalid hierarchy parent ${props.parentId}`);
    const geometry = feature.geometry;
    if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) throw new Error(`Invalid polygon geometry for ${id}`);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!polygons.length) throw new Error(`Empty polygon for ${id}`);
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length || !polygon.every(ringValid)) throw new Error(`Invalid polygon ring for ${id}`);
    }
    const pop = props.population;
    if (pop !== undefined && pop !== null) {
      if (!Number.isFinite(pop) || pop < 0) throw new Error(`Invalid population for ${id}`);
      if (context.level === 'pin' && !(props.evidenceClass === 'derived_estimate' && props.allocationMethod)) throw new Error('PIN population cannot be attached without a validated spatial allocation');
      populationTotal += pop; populationObserved = true;
    }
    if (context.level === 'pin' && [props.income,props.spend].some(value => value !== undefined && value !== null) && props.evidenceClass !== 'derived_estimate') throw new Error('PIN income/spend must not be inferred as observed data');
  }
  if (Number.isInteger(context.expectedCount) && collection.features.length !== context.expectedCount) throw new Error('Feature count does not match expected coverage');
  if (context.expectedPopulationTotal !== undefined && populationObserved && Math.abs(populationTotal-context.expectedPopulationTotal) > Math.max(1,context.expectedPopulationTotal*1e-6)) throw new Error('Population total does not match source total');
  return { featureCount: collection.features.length, populationTotal: populationObserved ? populationTotal : null };
}
function validateDemographics(rows, expected = {}) {
  if (!Array.isArray(rows)) throw new Error('Demographic rows must be an array');
  const byKey = new Map(rows.map(row => [`${row.level}:${row.id}`,row]));
  const levels = {}; let populationTotal=0;
  for (const row of rows) {
    if (!Number.isFinite(row.population) || row.population < 0) throw new Error(`Missing/invalid population for ${row.id}`);
    if (Number.isFinite(row.male) && Number.isFinite(row.female) && row.male+row.female !== row.population) throw new Error(`Sex total mismatch for ${row.id}`);
    if (row.parentId && !rows.some(parent => parent.id === row.parentId && parent.level !== row.level)) throw new Error(`Missing parent ${row.parentId}`);
    levels[row.level] = (levels[row.level] || 0)+1;
    if (row.level === 'country') populationTotal = row.population;
  }
  if (expected.countryPopulation !== undefined && populationTotal !== expected.countryPopulation) throw new Error('Country population does not match source total');
  if (expected.stateCount !== undefined && levels.state !== expected.stateCount) throw new Error('State count mismatch');
  if (expected.districtCount !== undefined && levels.district !== expected.districtCount) throw new Error('District count mismatch');
  for (const parent of rows.filter(row => ['country','state'].includes(row.level))) {
    const children = rows.filter(row => row.parentId === parent.id);
    if (children.length && children.reduce((sum,row)=>sum+row.population,0) !== parent.population) throw new Error(`Population parent conservation mismatch for ${parent.id}`);
  }
  return { populationTotal, counts: levels };
}
function validateRepository({ rootDir = ROOT } = {}) {
  const manifestPath = path.join(rootDir,'data/india-geography/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const summary = validateManifest(manifest);
  const checksums = [];
  for (const dataset of manifest.datasets) {
    if (dataset.status !== 'available') continue;
    if (dataset.license.status !== 'verified') throw new Error(`License is not verified for ${dataset.id}`);
    const file = resolveArtifact(rootDir,dataset.artifact), bytes = fs.readFileSync(file);
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (dataset.sha256 && checksum !== dataset.sha256) throw new Error(`Checksum mismatch for ${dataset.artifact}`);
    const collection = JSON.parse((file.endsWith('.gz') ? require('node:zlib').gunzipSync(bytes) : bytes).toString('utf8'));
    const measured = validateFeatures(collection,{level:dataset.featureLevel || dataset.level,expectedCount:dataset.coverage.featureCount,expectedPopulationTotal:dataset.coverage.populationTotal});
    if (dataset.coverage.populationTotal !== null && measured.populationTotal !== dataset.coverage.populationTotal) throw new Error(`Population coverage total mismatch for ${dataset.id}`);
    checksums.push({path:dataset.artifact,sha256:checksum});
  }
  for (const evidence of manifest.evidence || []) {
    const file = resolveArtifact(rootDir,evidence.path);
    const bytes = fs.readFileSync(file), checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (checksum !== evidence.sha256) throw new Error(`Checksum mismatch for ${evidence.path}`);
    checksums.push({ path:evidence.path, sha256:checksum });
  }
  return { ...summary, coverage: { features: manifest.geographies.length, relationships: manifest.relationships.length, populationTotal: manifest.datasets.reduce((sum,row)=>sum+(row.coverage.populationTotal||0),0) || null }, checksums, unavailable: manifest.datasets.filter(row=>row.status==='unavailable').map(row=>({id:row.id,knownGaps:row.knownGaps})) };
}
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(validateRepository(),null,2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
module.exports = { resolveArtifact, validateManifest, validateFeatures, validateDemographics, validateRepository };
