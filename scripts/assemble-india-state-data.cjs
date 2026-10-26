'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateFeatures } = require('./validate-india-geography.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
const SOURCES = {
  hces: { sourceId:'mospi-hces-2023-24-report-592', title:'Household Consumption Expenditure Survey 2023-24, NSS Report No. 592, Statements 3R/3U', publisher:'Ministry of Statistics and Programme Implementation', url:'https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf', referencePeriod:'2023-24', geographicResolution:'State/UT by rural/urban sector', evidenceClass:'official_survey_estimate', uncertainty:'Survey estimate; state/sector sample errors are not available in these summary statements.' },
  census: { sourceId:'census-of-india-2011-final-pca', title:'Primary Census Abstract 2011, India & States/UTs, state and district level (DDW_PCA0000_2011_Indiastatedist.xlsx)', publisher:'Office of the Registrar General & Census Commissioner, India', url:'https://censusindia.gov.in/nada/index.php/catalog/6191', downloadUrl:'https://censusindia.gov.in/nada/index.php/catalog/6191/download/9268/DDW_PCA0000_2011_Indiastatedist.xlsx', referencePeriod:'Census 2011 (final)', geographicResolution:'State/UT; rural and urban', evidenceClass:'official_observed' },
  boundary: { sourceId:'geoboundaries-ind-adm1', title:'geoBoundaries India ADM1, simplified geometry', publisher:'geoBoundaries; underlying source: DataMeet India community / Election Commission of India', url:'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/', downloadUrl:'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson', referencePeriod:'2011 boundary vintage; source data updated 2023-01-19; build 2023-12-12', geographicResolution:'State / Union Territory', evidenceClass:'derived_geometry', uncertainty:'Simplified cartographic geometry; suitable for overview mapping, not cadastral or legal boundary determination.' }
};

function modelFields(row, ruralSpend, urbanSpend, model) {
  if (!row?.population2020) return {};
  const urban = row.urbanPopulation2020, rural = row.population2020 - urban, spend = (urban * urbanSpend + rural * ruralSpend) / row.population2020;
  return { modelPopulation:row.population2020, modelUrbanPopulation:urban, modelPopulationReferenceYear:2020, modelAnnualApparelExpenditure:Math.round(row.population2020 * spend * 12),
    organisedStoreShare:Math.round(model.organisedStoreShare.value * 10000) / 10000, modelPopulationSource:model.source.title };
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function assembleIndiaStates({ rootDir = path.resolve(__dirname, '..'), write = true } = {}) {
  const sourceBoundaryPath = path.join(rootDir, 'data/india-geography/sources/geoBoundaries-IND-ADM1-simplified.geojson');
  const hcesPath = path.join(rootDir, 'data/india-geography/hces-state-sector.json');
  const censusPath = path.join(rootDir, 'data/india-geography/census-state-population-2011-final.json');
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
  // States split after 2011 use official successor totals that reconcile exactly to their 2011 parent; never split by area.
  const crosswalk = censusData.successorCrosswalk;
  for (const [child, parent] of Object.entries(crosswalk.parents)) {
    const parts = crosswalk.rows.filter(row => crosswalk.parents[row.state] === parent), source = census.get(norm(parent));
    for (const key of ['total','rural','urban']) if (parts.reduce((sum, row) => sum + row[key], 0) !== source[key]) throw new Error(`Successor populations for ${parent} do not reconcile (${key}); checked via ${child}.`);
  }
  const successors = new Map(crosswalk.rows.map(row => [norm(row.state), { ...row, crosswalk:crosswalk.methods[row.state] }]));
  const censusFor = name => {
    const key = norm(name);
    if (successors.has(key)) return successors.get(key);
    if (key === norm('Dadra and Nagar Haveli and Daman and Diu')) {
      const dnh = census.get(norm('Dadra and Nagar Haveli')), dd = census.get(norm('Daman and Diu'));
      return { state:name, rural:dnh.rural + dd.rural, urban:dnh.urban + dd.urban, total:dnh.total + dd.total, crosswalk:'sum of the two 2011 Census UTs now represented as one geoBoundaries UT' };
    }
    return census.get(key) || null;
  };
  // Modelled 2020 population on the WorldPop grid (written by build-india-districts.cjs) gives states the same
  // population basis as districts and PINs for potential revenue; Census 2011 stays the official population.
  const model2020Path = path.join(rootDir, 'data/india-geography/india-state-population-2020.json');
  const model2020 = fs.existsSync(model2020Path) ? readJson(model2020Path) : null;
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
      ...modelFields(model2020?.states?.[sourceProps.shapeISO || `state-${index + 1}`], ruralSpend, urbanSpend, model2020),
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
    manifest.version = '1.2.0';
    manifest.retrievedAt = '2026-10-26';
    const hcesManifestRow = manifest.datasets.find(row => row.id === 'hces-2023-24-state-sector');
    if (hcesManifestRow) hcesManifestRow.knownGaps = ['State/sector clothing+bedding and footwear values are now extracted into the versioned HCES artifact and benchmark catalog. They are joined to the state map only; the source table is non-spatial and supplies no district, city or PIN observations. The separately named state_sector geography level is therefore not populated in market_geographies.'];
    manifest.datasets = manifest.datasets.filter(row => row.id !== 'geoboundaries-india-adm1');
    manifest.datasets.push({
      id:'geoboundaries-india-adm1', sourceId:SOURCES.boundary.sourceId, title:SOURCES.boundary.title, publisher:SOURCES.boundary.publisher,
      sourceUrl:SOURCES.boundary.url, downloadUrl:SOURCES.boundary.downloadUrl, sourceVintage:SOURCES.boundary.referencePeriod, level:'state', featureLevel:'state', codeScheme:'ISO 3166-2 shapeISO; source shapeID retained',
      license:{ status:'verified', url:'https://creativecommons.org/licenses/by/2.5/in/', note:'Underlying DataMeet India community / Election Commission of India boundary data is marked CC BY 2.5 India. Attribute geoBoundaries and the underlying source; see the linked API metadata. Geometry is a simplified derivative.' },
      status:'available', artifact:'data/india-geography/india-state-features.geojson', sha256:hash(bytes), coverage:{ featureCount:36, rowCount:36, populationTotal:mappedPopulation, mappedPopulationGeographies:mapped.length, sourcePopulationTotal:censusSum, hcesStateSectorRows:36 },
      knownGaps:['Boundary is simplified and is for cartographic display, not cadastral/legal determination.','Population is the final Census 2011 PCA. Andhra Pradesh, Telangana, Jammu and Kashmir and Ladakh use official successor totals (Telangana after the 2014 transfer of seven Khammam mandals; Ladakh = Leh + Kargil) that reconcile exactly to their 2011 parents.','Population is Census 2011, while apparel expenditure is HCES 2023-24; annual estimates are hybrid and high uncertainty.','Households, age bands, income proxies, district and PIN mappings, local competition and observed footfall are not integrated.'],
      variables:['state/UT geometry','Census 2011 final PCA population rural/urban for all 36 states/UTs','HCES 2023-24 rural/urban clothing+bedding and footwear MPCE','derived annual clothing/footwear expenditure']
    });
    const evidenceFiles = [
      { id:'geoboundaries-ind-adm1-source', title:'Pinned geoBoundaries India ADM1 simplified source GeoJSON', publisher:'geoBoundaries; underlying source: DataMeet India / Election Commission of India', path:'data/india-geography/sources/geoBoundaries-IND-ADM1-simplified.geojson', sourceUrl:SOURCES.boundary.downloadUrl, license:'CC BY 2.5 India', sha256:hash(fs.readFileSync(sourceBoundaryPath)) },
      { id:'census-state-population-2011-final-pca-source', title:censusData.source.title, publisher:censusData.source.publisher, path:'data/india-geography/sources/DDW_PCA0000_2011_Indiastatedist.xlsx', sourceUrl:censusData.source.url, referencePeriod:'2011', license:censusData.source.license, sha256:hash(fs.readFileSync(path.join(rootDir,'data/india-geography/sources/DDW_PCA0000_2011_Indiastatedist.xlsx'))) },
      { id:'census-state-population-2011', title:censusData.source.title, publisher:censusData.source.publisher, path:'data/india-geography/census-state-population-2011-final.json', sourceUrl:censusData.source.url, referencePeriod:'2011', license:censusData.source.license, sha256:hash(fs.readFileSync(censusPath)) },
      { id:'hces-state-sector-2023-24', title:hcesData.source.title, publisher:hcesData.source.publisher, path:'data/india-geography/hces-state-sector.json', sourceUrl:hcesData.source.url, referencePeriod:'2023-24', license:hcesData.source.licence, sha256:hash(fs.readFileSync(hcesPath)) }
    ];
    manifest.evidence = evidenceFiles;
    registerSubStateDatasets(rootDir, manifest);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { features:collection.features, reconciliation, validation };
}

if (require.main === module) {
  try { const result = assembleIndiaStates(); process.stdout.write(`${JSON.stringify({reconciliation:result.reconciliation,validation:result.validation},null,2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
// Registers the district and PIN artifacts (built by build-india-districts.cjs / build-india-pins.cjs) with checksums.
function registerSubStateDatasets(rootDir, manifest) {
  const dir = path.join(rootDir, 'data/india-geography');
  const add = row => { manifest.datasets = manifest.datasets.filter(existing => existing.id !== row.id); manifest.datasets.push(row); };
  const districtPath = path.join(dir, 'india-district-features.geojson');
  if (fs.existsSync(districtPath)) {
    const bytes = fs.readFileSync(districtPath), features = JSON.parse(bytes.toString('utf8')).features;
    add({ id:'geoboundaries-india-adm2-worldpop-2020', sourceId:'geoboundaries-ind-adm2', title:'India districts (geoBoundaries ADM2) with WorldPop 2020 population and HCES apparel spend', publisher:'geoBoundaries / Pathways Data / Local Government Directory; WorldPop; MoSPI',
      sourceUrl:'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/', downloadUrl:'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2_simplified.geojson',
      sourceVintage:'2021 boundaries; WorldPop 2020; HCES 2023-24', level:'district', featureLevel:'district', codeScheme:'district:<state ISO>-<slug>; geoBoundaries shapeID retained as sourceCode',
      license:{ status:'verified', url:'https://opendatacommons.org/licenses/odbl/1-0/', note:'Boundaries ODbL 1.0 (attribute geoBoundaries and Pathways Data / lgdirectory.gov.in; share-alike applies to the boundary database). WorldPop CC BY 4.0.' },
      status:'available', artifact:'data/india-geography/india-district-features.geojson', sha256:hash(bytes),
      coverage:{ featureCount:features.length, rowCount:features.length, populationTotal:features.reduce((sum, f) => sum + f.properties.population, 0) },
      knownGaps:['Population is a modelled 2020 estimate (WorldPop), validated against same-named Census 2011 districts; see india-district-reconciliation.json.','Apparel spend applies state HCES rural/urban rates to the modelled urban mix.','One source polygon is labelled "DATA NOT AVAILABLE" by geoBoundaries and has no PINs.'],
      variables:['district geometry','modelled 2020 population (total/urban/rural)','households scaled from Census 2011','apparel spend per person','annual apparel expenditure'] });
  }
  const pinPath = path.join(dir, 'india-pin-features.geojson.gz');
  if (fs.existsSync(pinPath)) {
    const bytes = fs.readFileSync(pinPath), report = readJson(path.join(dir, 'india-pin-quality-report.json'));
    add({ id:'india-post-pin-directory-areas', sourceId:'india-post-pin-directory', title:'Approximate PIN areas from the All India Pincode Directory with WorldPop 2020 population', publisher:'Department of Posts (directory); WorldPop; MoSPI',
      sourceUrl:'https://www.data.gov.in/catalog/all-india-pincode-directory', downloadUrl:'https://www.data.gov.in/catalog/all-india-pincode-directory', sourceVintage:'Directory downloaded 2026-10-26; WorldPop 2020', level:'pin', featureLevel:'pin',
      codeScheme:'pin:<6-digit PIN>', license:{ status:'verified', url:'https://data.gov.in/government-open-data-license-india', note:'Government Open Data License - India (directory); WorldPop CC BY 4.0.' },
      status:'available', ingest:'seed-script', artifact:'data/india-geography/india-pin-features.geojson.gz', sha256:hash(bytes),
      coverage:{ featureCount:report.pins.mapped, rowCount:report.pins.inDirectory, populationTotal:report.population.pinTotal },
      knownGaps:['PIN areas are approximate Voronoi cells of cleaned post-office locations, not official delivery boundaries; replace with the India Post PIN boundary GeoJSON when available.', `${report.pins.noValidLocation.length} PINs have no valid office location and are unmapped.`, 'PINs that the directory places at the same coordinates share one area and split its population equally.'],
      variables:['approximate PIN geometry','modelled 2020 population constrained to district totals','post offices','apparel spend per person','annual apparel expenditure'] });
  }
}

module.exports = { assembleIndiaStates, norm };
