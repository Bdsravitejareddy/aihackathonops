'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateFeatures } = require('./validate-india-geography.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
const CENSUS_EXCLUSIONS = new Set(['andhrapradesh','telangana','jammmuandkashmir','jammuandkashmir','ladakh']);
const SOURCES = {
  hces: { sourceId:'mospi-hces-2023-24-report-592', title:'Household Consumption Expenditure Survey 2023-24, NSS Report No. 592, Statements 3R/3U', publisher:'Ministry of Statistics and Programme Implementation', url:'https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf', referencePeriod:'2023-24', geographicResolution:'State/UT by rural/urban sector', evidenceClass:'official_survey_estimate', uncertainty:'Survey estimate; state/sector sample errors are not available in these summary statements.' },
  census: { sourceId:'census-of-india-2011-state-sector', title:'State-wise Rural and Urban Population as per 2001 and 2011 Census, Table 2', publisher:'Ministry of Health and Family Welfare; source data: Office of the Registrar General & Census Commissioner, India', url:'https://nhm.gov.in/images/pdf/monitoring/rhs/rhs-march-2011-tables-final-9-4-2012.pdf', referencePeriod:'Census 2011', geographicResolution:'State/UT, rural/urban', evidenceClass:'official_observed', uncertainty:'Historical 2011 count; no current population projection applied.' },
  boundary: { sourceId:'geoboundaries-ind-adm1', title:'geoBoundaries India ADM1, simplified geometry', publisher:'geoBoundaries; underlying source: DataMeet India community / Election Commission of India', url:'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/', downloadUrl:'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson', referencePeriod:'2011 boundary vintage; source data updated 2023-01-19; build 2023-12-12', geographicResolution:'State / Union Territory', evidenceClass:'derived_geometry', uncertainty:'Simplified cartographic geometry; suitable for overview mapping, not cadastral or legal boundary determination.' }
};

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function assembleIndiaStates({ rootDir = path.resolve(__dirname, '..'), write = true } = {}) {
  const sourceBoundaryPath = path.join(rootDir, 'data/india-geography/sources/geoBoundaries-IND-ADM1-simplified.geojson');
  const hcesPath = path.join(rootDir, 'data/india-geography/hces-state-sector.json');
  const censusPath = path.join(rootDir, 'data/india-geography/census-state-population-2011.json');
  const sourceCollection = readJson(sourceBoundaryPath), hcesData = readJson(hcesPath), censusData = readJson(censusPath);
  if (sourceCollection.type !== 'FeatureCollection' || sourceCollection.features.length !== 36) throw new Error('Expected the 36-feature pinned geoBoundaries ADM1 dataset.');
  if (hcesData.observations.length !== 36 || hcesData.observations.some(row => !row.sectors?.rural || !row.sectors?.urban)) throw new Error('HCES state/sector values are incomplete.');
  const censusSum = censusData.observations.reduce((s, row) => s + row.total, 0);
  const ruralSum = censusData.observations.reduce((s, row) => s + row.rural, 0);
  const urbanSum = censusData.observations.reduce((s, row) => s + row.urban, 0);
  if (censusSum !== censusData.source.sourcePopulationTotal || ruralSum !== censusData.source.sourceRuralTotal || urbanSum !== censusData.source.sourceUrbanTotal || ruralSum + urbanSum !== censusSum) throw new Error('Census rural/urban source totals do not reconcile.');
  const hces = new Map(hcesData.observations.map(row => [norm(row.state), row]));
  hces.set(norm('A & N Island'), hces.get(norm('Andaman and Nicobar Islands')));
  const census = new Map(censusData.observations.map(row => [norm(row.state), row]));
  // These 2011 census units cover different later administrative geographies. Never split them by area or assume equal populations.
  const censusFor = name => {
    const key = norm(name);
    if (CENSUS_EXCLUSIONS.has(key)) return null;
    if (key === norm('Dadra and Nagar Haveli and Daman and Diu')) {
      const dnh = census.get(norm('Dadra and Nagar Haveli')), dd = census.get(norm('Daman and Diu'));
      return { state:name, rural:dnh.rural + dd.rural, urban:dnh.urban + dd.urban, total:dnh.total + dd.total, crosswalk:'sum of the two 2011 Census UTs now represented as one geoBoundaries UT' };
    }
    return census.get(key) || null;
  };
  const features = sourceCollection.features.map((sourceFeature, index) => {
    const sourceProps = sourceFeature.properties || {}, sourceName = sourceProps.shapeName;
    const name = sourceName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const stateHces = hces.get(norm(name));
    if (!stateHces) throw new Error(`No official HCES state/UT record for ${sourceName}`);
    const population = censusFor(name), rural = population?.rural ?? null, urban = population?.urban ?? null, total = population?.total ?? null;
    const ruralSpend = stateHces.sectors.rural.combinedINRPerPersonMonth;
    const urbanSpend = stateHces.sectors.urban.combinedINRPerPersonMonth;
    const spend = total ? (rural * ruralSpend + urban * urbanSpend) / total : null;
    const evidence = [
      { ...SOURCES.boundary, metric:'geometry', license:'CC BY 2.5 India', sourceBoundaryId:sourceProps.shapeID, sourceISO:sourceProps.shapeISO },
      { ...SOURCES.hces, metric:'apparelSpendPerPersonMonthly', method:'Sum of HCES row 28 clothing and bedding and row 29 footwear, separately for rural and urban. State blended value uses Census 2011 sector population weights where both compatible counts are available.', tables:[stateHces.sectors.rural.statement,stateHces.sectors.urban.statement], pages:[stateHces.sectors.rural.reportPage,stateHces.sectors.urban.reportPage], imputation:'without imputation' }
    ];
    if (population) evidence.push({ ...SOURCES.census, metric:'population', method:'Published rural and urban Census 2011 counts; no projection applied.', ...(population.crosswalk ? { crosswalk:population.crosswalk } : {}) });
    const warnings = [];
    if (!population) warnings.push('Population and total annual expenditure are unavailable because the 2011 Census geography does not map to this later state/UT boundary without a sub-state crosswalk.');
    else warnings.push('Annual expenditure combines Census 2011 population with HCES 2023-24 consumption expenditure; this is a dated hybrid estimate, not a current-year population projection or actual sales.');
    warnings.push('Income, full age distribution, households, PIN mapping, local competition and footfall are unavailable at state resolution.');
    const annual = total !== null && spend !== null ? total * spend * 12 : null;
    return { type:'Feature', id:sourceProps.shapeISO || `state-${index + 1}`, geometry:sourceFeature.geometry, properties:{
      code:sourceProps.shapeISO || `state-${index + 1}`, sourceCode:sourceProps.shapeISO || null, sourceBoundaryId:sourceProps.shapeID || null,
      sourceName, name, level:'state', population:total, ruralPopulation:rural, urbanPopulation:urban, households:null,
      populationReferenceYear:population ? 2011 : null,
      apparelSpendPerPersonMonthly:spend, apparelSpendEvidenceClass:spend === null ? null : 'derived_estimate',
      ruralApparelSpendPerPersonMonthly:ruralSpend, urbanApparelSpendPerPersonMonthly:urbanSpend,
      apparelSpendReferencePeriod:'2023-24', annualApparelExpenditure:annual,
      annualExpenditureEvidenceClass:annual === null ? null : 'derived_estimate',
      demographics:{ ruralPopulation:rural, urbanPopulation:urban, ruralShare:total ? rural / total : null, urbanShare:total ? urban / total : null, apparelSpendBySector:{ rural:ruralSpend, urban:urbanSpend, unit:'INR/person/month', referencePeriod:'2023-24' }, ageGroups:null },
      evidence, evidenceClass:annual === null ? 'unavailable' : 'derived_estimate', confidence:annual === null ? 'insufficient geographic match' : 'low; mixed reference vintages',
      uncertainty:annual === null ? 'high; population crosswalk missing' : 'high; 2011 population multiplied by 2023-24 HCES survey estimates', warnings
    }};
  });
  const mapped = features.filter(feature => feature.properties.population !== null);
  const mappedPopulation = mapped.reduce((sum, feature) => sum + feature.properties.population, 0);
  const collection = { type:'FeatureCollection', name:'India state and UT boundaries with sourced Census/HCES indicators', crs:{ type:'name', properties:{ name:'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features };
  const validation = validateFeatures(collection, { level:'state', expectedCount:36, expectedPopulationTotal:mappedPopulation });
  const reconciliation = { censusSourcePopulation:censusSum, censusSourceRural:ruralSum, censusSourceUrban:urbanSum, censusRuralUrbanReconciles:ruralSum+urbanSum===censusSum, mappedGeographies:mapped.length, missingPopulationGeographies:features.length-mapped.length, mappedPopulation, hcesStateSectorRows:hcesData.observations.length, geometryFeatureCount:sourceCollection.features.length, geometryCoordinateReferenceSystem:'WGS 84 longitude/latitude (EPSG:4326)' };
  if (write) {
    const artifactPath = path.join(rootDir, 'data/india-geography/india-state-features.geojson');
    const bytes = Buffer.from(`${JSON.stringify(collection)}\n`);
    fs.writeFileSync(artifactPath, bytes);
    const manifestPath = path.join(rootDir, 'data/india-geography/manifest.json');
    const manifest = readJson(manifestPath);
    manifest.version = '1.1.2';
    manifest.retrievedAt = '2026-10-25';
    const hcesManifestRow = manifest.datasets.find(row => row.id === 'hces-2023-24-state-sector');
    if (hcesManifestRow) hcesManifestRow.knownGaps = ['State/sector clothing+bedding and footwear values are now extracted into the versioned HCES artifact and benchmark catalog. They are joined to the state map only; the source table is non-spatial and supplies no district, city or PIN observations. The separately named state_sector geography level is therefore not populated in market_geographies.'];
    manifest.datasets = manifest.datasets.filter(row => row.id !== 'geoboundaries-india-adm1');
    manifest.datasets.push({
      id:'geoboundaries-india-adm1', sourceId:SOURCES.boundary.sourceId, title:SOURCES.boundary.title, publisher:SOURCES.boundary.publisher,
      sourceUrl:SOURCES.boundary.url, downloadUrl:SOURCES.boundary.downloadUrl, sourceVintage:SOURCES.boundary.referencePeriod, level:'state', featureLevel:'state', codeScheme:'ISO 3166-2 shapeISO; source shapeID retained',
      license:{ status:'verified', url:'https://creativecommons.org/licenses/by/2.5/in/', note:'Underlying DataMeet India community / Election Commission of India boundary data is marked CC BY 2.5 India. Attribute geoBoundaries and the underlying source; see the linked API metadata. Geometry is a simplified derivative.' },
      status:'available', artifact:'data/india-geography/india-state-features.geojson', sha256:hash(bytes), coverage:{ featureCount:36, rowCount:36, populationTotal:mappedPopulation, mappedPopulationGeographies:mapped.length, sourcePopulationTotal:censusSum, hcesStateSectorRows:36 },
      knownGaps:['Boundary is simplified and is for cartographic display, not cadastral/legal determination.','Population coverage is partial: legacy Andhra Pradesh and Jammu and Kashmir cannot be split into later boundaries from the state-level table; their successor geographies remain missing.','Population is Census 2011, while apparel expenditure is HCES 2023-24; annual estimates are hybrid and high uncertainty.','Households, age bands, income proxies, district and PIN mappings, local competition and observed footfall are not integrated.'],
      variables:['state/UT geometry','Census 2011 population rural/urban where geography matches','HCES 2023-24 rural/urban clothing+bedding and footwear MPCE','derived annual clothing/footwear expenditure']
    });
    const evidenceFiles = [
      { id:'geoboundaries-ind-adm1-source', title:'Pinned geoBoundaries India ADM1 simplified source GeoJSON', publisher:'geoBoundaries; underlying source: DataMeet India / Election Commission of India', path:'data/india-geography/sources/geoBoundaries-IND-ADM1-simplified.geojson', sourceUrl:SOURCES.boundary.downloadUrl, license:'CC BY 2.5 India', sha256:hash(fs.readFileSync(sourceBoundaryPath)) },
      { id:'census-state-population-2011', title:censusData.source.title, publisher:censusData.source.publisher, path:'data/india-geography/census-state-population-2011.json', sourceUrl:censusData.source.url, referencePeriod:'2011', license:censusData.source.license, sha256:hash(fs.readFileSync(censusPath)) },
      { id:'hces-state-sector-2023-24', title:hcesData.source.title, publisher:hcesData.source.publisher, path:'data/india-geography/hces-state-sector.json', sourceUrl:hcesData.source.url, referencePeriod:'2023-24', license:hcesData.source.licence, sha256:hash(fs.readFileSync(hcesPath)) }
    ];
    manifest.evidence = evidenceFiles;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { features:collection.features, reconciliation, validation };
}

if (require.main === module) {
  try { const result = assembleIndiaStates(); process.stdout.write(`${JSON.stringify({reconciliation:result.reconciliation,validation:result.validation},null,2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
module.exports = { assembleIndiaStates, norm };
