'use strict';

const LEVELS = ['state', 'district', 'city', 'pin', 'catchment'];
const CHILD = { state: 'district', district: 'city', city: 'pin', pin: 'catchment' };
const MAX_BY_LEVEL = { state: 40, district: 250, city: 750, pin: 1200, catchment: 500 };
const ALLOWED_METRICS = new Set(['population','populationDensity','households','monthlyPerCapitaSpend','incomeProxy','apparelExpenditure','tam','sam','som','competitorCount','saturation','revenue','revenuePerKm2','growthPotential3Year','growthPotential5Year','breakEvenRevenue','paybackMonths','viability']);
const canonicalId = (kind, id) => String(id).startsWith(`${kind}:`) ? String(id) : `${kind}:${id}`;
const priorityCatalog = require('../data/india-geography/karnataka-priority-places.json');
const priorityPlaces = priorityCatalog.places;
const priorityById = new Map(priorityPlaces.map(place => [place.id, place]));
const placeRow = place => ({ external_id:place.id, kind:place.level, name:place.name, parent_external_id:place.parentId,
  geometry:place.geometry, area_km2:null, properties:{ sourceCode:place.sourceCode, state:place.state, city:place.city,
    pin:place.pin, ancestors:place.ancestors, aliases:place.aliases, evidence:place.evidence, warnings:place.warnings,
    confidence:'location verified; economic data unavailable' } });
const normalizeSearch = value => String(value || '').normalize('NFKD').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
function editDistanceAtMostTwo(a,b) {
  if (Math.abs(a.length-b.length)>2) return false;
  const previous=Array.from({length:b.length+1},(_,i)=>i);
  for (let i=1;i<=a.length;i++) {
    const current=[i];
    for (let j=1;j<=b.length;j++) current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    if (Math.min(...current)>2) return false;
    previous.splice(0,previous.length,...current);
  }
  return previous[b.length]<=2;
}
function priorityMatches(query,limit) {
  const wanted=normalizeSearch(query);
  if (!wanted || /^\d{6}$/.test(wanted)) return [];
  return priorityPlaces.map(place=>{
    const names=[place.name,...(place.aliases||[])].map(normalizeSearch);
    const exact=names.some(name=>name===wanted), prefix=names.some(name=>name.startsWith(wanted)), fuzzy=wanted.length>=4&&names.some(name=>editDistanceAtMostTwo(name,wanted));
    return {place,rank:exact?0:prefix?1:fuzzy?2:Infinity};
  }).filter(row=>Number.isFinite(row.rank)).sort((a,b)=>a.rank-b.rank||(a.place.level==='city'?0:1)-(b.place.level==='city'?0:1)||a.place.name.localeCompare(b.place.name)).slice(0,limit).map(row=>row.place);
}

function metric(value, unit, evidenceClass, source = null, warnings = []) {
  const available = Number.isFinite(value);
  return { value: available ? value : null, unit, evidenceClass: available ? evidenceClass : 'unavailable', evidence: source ? [source] : [], warnings: available ? warnings : warnings.concat('Required source data or explicit scenario assumptions are unavailable.') };
}

function normalizeFeature(row, metricKey, scenario = {}) {
  const p = row.properties || {};
  const area = Number.isFinite(Number(row.area_km2)) && Number(row.area_km2) > 0 ? Number(row.area_km2) : null;
  const population = Number.isFinite(Number(p.population)) && p.population !== null ? Number(p.population) : null;
  const localIncome = Number.isFinite(Number(p.incomeProxy)) && p.incomeProxy !== null ? Number(p.incomeProxy) : null;
  const regionalIncome = Number.isFinite(Number(p.regionalIncomeProxy)) && p.regionalIncomeProxy !== null ? Number(p.regionalIncomeProxy) : null;
  const regionalSpend = Number.isFinite(Number(p.regionalApparelSpendMonthly)) && p.regionalApparelSpendMonthly !== null ? Number(p.regionalApparelSpendMonthly) : null;
  const elasticity = Number.isFinite(scenario.elasticity) && scenario.elasticity > 0 ? scenario.elasticity : 1;
  const incomeAdjustedSpend = localIncome !== null && regionalIncome !== null && regionalSpend !== null && localIncome > 0 && regionalIncome > 0 && regionalSpend > 0
    ? regionalSpend * (localIncome / regionalIncome) ** elasticity : null;
  const sourcedSpend = Number.isFinite(Number(p.apparelSpendPerPersonMonthly)) && p.apparelSpendPerPersonMonthly !== null ? Number(p.apparelSpendPerPersonMonthly) : null;
  const spend = incomeAdjustedSpend ?? sourcedSpend;
  const capture = Number.isFinite(scenario.captureRate) ? scenario.captureRate : null;
  const addressability = Number.isFinite(Number(p.addressabilityFactor)) ? Number(p.addressabilityFactor) : null;
  const accessibility = Number.isFinite(Number(p.accessibilityFactor)) ? Number(p.accessibilityFactor) : null;
  const tam = population !== null && spend !== null ? population * spend * 12 : null;
  const apparelExpenditure = Number.isFinite(Number(p.annualApparelExpenditure)) && p.annualApparelExpenditure !== null ? Number(p.annualApparelExpenditure) : tam;
  const sam = tam !== null && addressability !== null && accessibility !== null ? tam * addressability * accessibility : null;
  const som = sam !== null && capture !== null ? sam * capture : null;
  const sourceRows = Array.isArray(p.evidence) ? p.evidence : [];
  const evidenceClass = p.evidenceClass || 'derived_estimate';
  const sourceFor = key => sourceRows.find(item => item.metric === key) || sourceRows[0] || null;
  const density = population !== null && area !== null ? population / area : null;
  const income = localIncome;
  const revenue = Number.isFinite(Number(p.expectedRevenueAnnual)) ? Number(p.expectedRevenueAnnual) : som;
  const metrics = {
    population: metric(population, 'people', evidenceClass, sourceFor('population')),
    populationDensity: metric(density, 'people/km²', density === null ? null : 'derived_estimate', sourceFor('population'), ['Density is population divided by geodesic polygon area; population vintage follows its source.']),
    households: metric(Number.isFinite(Number(p.households)) && p.households !== null ? Number(p.households) : null, 'households', evidenceClass, sourceFor('households')),
    malePopulation: metric(Number.isFinite(Number(p.malePopulation)) && p.malePopulation !== null ? Number(p.malePopulation) : null, 'people', evidenceClass, sourceFor('malePopulation')),
    femalePopulation: metric(Number.isFinite(Number(p.femalePopulation)) && p.femalePopulation !== null ? Number(p.femalePopulation) : null, 'people', evidenceClass, sourceFor('femalePopulation')),
    ageGroups: p.demographics?.ageGroups ? { value: p.demographics.ageGroups, unit: 'people', evidenceClass, evidence: sourceFor('ageGroups') ? [sourceFor('ageGroups')] : [], warnings: [] } : metric(null, 'people', null),
    monthlyPerCapitaSpend: metric(spend, 'INR/person/month', incomeAdjustedSpend !== null ? 'derived_estimate' : p.apparelSpendEvidenceClass || evidenceClass, sourceFor(incomeAdjustedSpend !== null ? 'regionalApparelSpendMonthly' : 'apparelSpendPerPersonMonthly'), incomeAdjustedSpend !== null ? [`Regional spend ${regionalSpend} × (local income proxy ${localIncome} / regional income proxy ${regionalIncome})^${elasticity}; estimated, not observed at PIN level.`] : ['PIN-level income adjusted spend requires a local income proxy and a matching regional spend/income benchmark.']),
    incomeProxy: metric(income, 'INR/person/month', income === null ? null : 'derived_estimate', sourceFor('incomeProxy'), ['A PIN-level income proxy is not inferred from banking deposits.']),
    apparelExpenditure: { ...metric(apparelExpenditure, 'INR/year', p.annualExpenditureEvidenceClass || 'derived_estimate', sourceFor('apparelSpendPerPersonMonthly'), ['Estimated annual clothing, bedding and footwear expenditure = population × rural/urban-weighted monthly per-capita expenditure × 12. It is market expenditure, not actual store sales.']), evidence: sourceRows.filter(item => ['population','apparelSpendPerPersonMonthly'].includes(item.metric)) },
    tam: metric(tam, 'INR/year', 'derived_estimate', sourceFor('apparelSpendPerPersonMonthly'), ['Annual market expenditure = population × monthly per-capita apparel expenditure × 12; not store sales.']),
    sam: metric(sam, 'INR/year', 'derived_estimate', sourceFor('addressabilityFactor'), ['Requires evidenced category/brand addressability and accessibility factors.']),
    som: metric(som, 'INR/year', 'model_assumption', sourceFor('captureRate'), ['Scenario capture rate applied to SAM; not observed store revenue.']),
    competitorCount: metric(Number.isFinite(Number(p.competitorCount)) && p.competitorCount !== null ? Number(p.competitorCount) : null, 'stores', 'official_observed', sourceFor('competitorCount')),
    saturation: metric(Number.isFinite(Number(p.saturation)) && p.saturation !== null ? Number(p.saturation) : null, 'index', 'derived_estimate', sourceFor('saturation')),
    revenue: metric(revenue, 'INR/year', revenue === null ? null : 'model_assumption', sourceFor('expectedRevenueAnnual'), ['Expected franchise revenue is a scenario projection, not observed sales.']),
    revenuePerKm2: metric(revenue !== null && area !== null ? revenue / area : null, 'INR/year/km²', 'model_assumption', sourceFor('expectedRevenueAnnual')),
    growthPotential3Year: metric(p.growth3Year ?? null, '% nominal / 3 years', 'forecast', sourceFor('growth3Year')),
    growthPotential5Year: metric(p.growth5Year ?? null, '% nominal / 5 years', 'forecast', sourceFor('growth5Year')),
    breakEvenRevenue: metric(p.breakEvenRevenue ?? null, 'INR/year', 'model_assumption', sourceFor('breakEvenRevenue')),
    paybackMonths: metric(p.paybackMonths ?? null, 'months', 'model_assumption', sourceFor('paybackMonths')),
    viability: metric(p.viability ?? null, 'score / 100', 'derived_estimate', sourceFor('viability'))
  };
  return {
    id: row.external_id,
    sourceCode: p.sourceCode || row.external_id,
    name: row.name || row.external_id,
    level: row.kind,
    parentId: row.parent_external_id || null,
    state: p.state || (row.kind === 'state' ? row.name : null),
    city: p.city || (row.kind === 'city' ? row.name : null),
    pin: p.pin || (row.kind === 'pin' ? row.name : null),
    ancestors: p.ancestors || null,
    geometry: row.geometry || null,
    metrics,
    demographics: p.demographics || null,
    confidence: p.confidence || (population === null ? 'insufficient evidence' : 'source-dependent; vintage-specific'),
    evidence: sourceRows,
    warnings: p.warnings || (population === null ? ['No compatible population source is available at this geographic resolution.'] : []),
    areaKm2: area,
    metricValue: metricKey && ALLOWED_METRICS.has(metricKey) ? metrics[metricKey] : null
  };
}

function createMarketMapStore(pool) {
  const listCache = new Map();
  const cachedList = (key, compute) => {
    const cached=listCache.get(key);
    if (cached && Date.now()-cached.at<300000) { listCache.delete(key); listCache.set(key,cached); return cached.value; }
    const value=Promise.resolve().then(compute);
    listCache.set(key,{at:Date.now(),value});
    value.catch(()=>listCache.delete(key));
    while (listCache.size>48) listCache.delete(listCache.keys().next().value);
    return value;
  };
  return {
    async seedMapCatalog(geographies = [], relationships = []) {
      if (!Array.isArray(geographies) || !Array.isArray(relationships)) throw new TypeError('Map catalog rows must be arrays');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let inserted = 0;
        for (const geo of geographies) {
          if (!geo || typeof geo.externalId !== 'string' || !LEVELS.includes(geo.kind) || !geo.name || typeof geo.properties !== 'object' || Array.isArray(geo.properties)) throw new TypeError('Invalid geography catalog row');
          if (geo.geometry && !['Polygon','MultiPolygon','Point','MultiPoint','LineString','MultiLineString','GeometryCollection'].includes(geo.geometry.type)) throw new TypeError('Unsupported geography geometry');
          const properties = { ...geo.properties, sourceCode: geo.properties.sourceCode || geo.externalId };
          const result = await client.query(`INSERT INTO market_geographies (kind, external_id, name, properties, geom) VALUES ($1,$2,$3,$4::jsonb,CASE WHEN $5::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($5::jsonb::text),4326) END) ON CONFLICT (kind,external_id) DO UPDATE SET name=EXCLUDED.name, properties=EXCLUDED.properties, geom=COALESCE(EXCLUDED.geom,market_geographies.geom) RETURNING (xmax=0) AS inserted`, [geo.kind, canonicalId(geo.kind,geo.externalId), geo.name, JSON.stringify(properties), geo.geometry ? JSON.stringify(geo.geometry) : null]);
          if (result.rows[0]?.inserted) inserted++;
        }
        let relationshipsInserted = 0;
        for (const relation of relationships) {
          if (!relation || typeof relation.parentId !== 'string' || typeof relation.childId !== 'string' || !LEVELS.includes(relation.parentKind) || !LEVELS.includes(relation.childKind) || !['contains','postal_service','census_crosswalk'].includes(relation.relationship || 'contains')) throw new TypeError('Invalid geography relationship');
          const result = await client.query(`INSERT INTO market_geo_relationships (parent_id,child_id,relationship,properties) SELECT p.id,c.id,$5,$6::jsonb FROM market_geographies p JOIN market_geographies c ON c.external_id=$2 AND c.kind=$4 WHERE p.external_id=$1 AND p.kind=$3 ON CONFLICT DO NOTHING RETURNING child_id`, [canonicalId(relation.parentKind,relation.parentId), canonicalId(relation.childKind,relation.childId), relation.parentKind, relation.childKind, relation.relationship || 'contains', JSON.stringify(relation.properties || {})]);
          relationshipsInserted += result.rowCount;
        }
        await client.query('COMMIT');
        return { geographiesInserted: inserted, relationshipsInserted };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },

    async listMapGeographies({ parentId = null, level = null, bbox = null, metric: metricKey, scenario = {}, includeGeometry = true } = {}) {
      const cacheKey=JSON.stringify([this.sourceVersion,parentId,level,bbox,metricKey,scenario,includeGeometry]);
      return cachedList(cacheKey, async () => {
      const wanted = level || (parentId ? null : 'state');
      if (wanted && !LEVELS.includes(wanted)) return [];
      const params = [];
      const where = [];
      if (parentId) {
        params.push(parentId);
        where.push(`EXISTS (SELECT 1 FROM market_geo_relationships r JOIN market_geographies p ON p.id = r.parent_id WHERE r.child_id = g.id AND r.relationship = 'contains' AND p.external_id = $${params.length} AND g.kind = CASE p.kind WHEN 'state' THEN 'district' WHEN 'district' THEN 'city' WHEN 'city' THEN 'pin' WHEN 'pin' THEN 'catchment' ELSE 'unsupported' END)`);
      } else if (wanted) {
        params.push(wanted); where.push(`g.kind = $${params.length}`);
      }
      if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
        params.push(...bbox);
        const offset = params.length - 3;
        where.push(`g.geom && ST_MakeEnvelope($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, 4326)`);
      }
      params.push(MAX_BY_LEVEL[wanted || 'district']);
      const geometrySql=includeGeometry ? 'CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(g.geom)::jsonb END' : 'NULL::jsonb';
      const sql = `SELECT g.external_id, g.kind, g.name, g.properties, ${geometrySql} AS geometry, CASE WHEN g.geom IS NULL THEN NULL ELSE ST_Area(g.geom::geography) / 1000000 END AS area_km2, p.external_id AS parent_external_id FROM market_geographies g LEFT JOIN market_geo_relationships r ON r.child_id = g.id AND r.relationship='contains' LEFT JOIN market_geographies p ON p.id = r.parent_id WHERE ${where.length ? where.join(' AND ') : 'TRUE'} ORDER BY g.name, g.external_id LIMIT $${params.length}`;
      const result = await pool.query(sql, params);
      const rows=result.rows.map(row => normalizeFeature(row, metricKey, scenario));
      if (parentId) for (const place of priorityPlaces.filter(place=>place.parentId===parentId && (!wanted || place.level===wanted))) {
        if (!rows.some(row=>row.id===place.id)) rows.push(normalizeFeature({...placeRow(place),geometry:includeGeometry?place.geometry:null},metricKey,scenario));
      }
      return rows;
      });
    },

    async getMapGeography(externalId, metricKey, scenario = {}) {
      if (priorityById.has(externalId)) return normalizeFeature(placeRow(priorityById.get(externalId)),metricKey,scenario);
      const result = await pool.query(`SELECT g.external_id, g.kind, g.name, g.properties, CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(g.geom)::jsonb END AS geometry, CASE WHEN g.geom IS NULL THEN NULL ELSE ST_Area(g.geom::geography) / 1000000 END AS area_km2, p.external_id AS parent_external_id FROM market_geographies g LEFT JOIN market_geo_relationships r ON r.child_id=g.id AND r.relationship='contains' LEFT JOIN market_geographies p ON p.id=r.parent_id WHERE g.external_id=$1 LIMIT 1`, [externalId]);
      return result.rows.length ? normalizeFeature(result.rows[0], metricKey, scenario) : null;
    },

    async getMapLevel(parentId = null) {
      if (!parentId) return 'state';
      if (priorityById.has(parentId)) return CHILD[priorityById.get(parentId).level] || null;
      const result = await pool.query(`SELECT CASE kind WHEN 'state' THEN 'district' WHEN 'district' THEN 'city' WHEN 'city' THEN 'pin' WHEN 'pin' THEN 'catchment' ELSE NULL END AS child_level FROM market_geographies WHERE external_id=$1 LIMIT 1`, [parentId]);
      return result.rows[0]?.child_level || null;
    },

    async searchMapGeographies(query, limit = 20) {
      const result = await pool.query(`SELECT g.external_id, g.kind, g.name, g.properties, CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(g.geom)::jsonb END AS geometry, CASE WHEN g.geom IS NULL THEN NULL ELSE ST_Area(g.geom::geography)/1000000 END AS area_km2, p.external_id AS parent_external_id FROM market_geographies g LEFT JOIN market_geo_relationships r ON r.child_id=g.id AND r.relationship='contains' LEFT JOIN market_geographies p ON p.id=r.parent_id WHERE g.name ILIKE $1 OR g.external_id ILIKE $1 OR g.properties->>'sourceCode' ILIKE $1 ORDER BY CASE WHEN lower(g.name)=lower($2) OR lower(g.properties->>'sourceCode')=lower($2) THEN 0 ELSE 1 END, g.kind, g.name LIMIT $3`, [`%${query}%`, query, Math.min(20, Math.max(1, limit))]);
      const known=priorityMatches(query,limit).map(place=>normalizeFeature(placeRow(place),null));
      const database=result.rows.map(row=>normalizeFeature(row,null));
      return [...known,...database.filter(row=>!known.some(place=>place.id===row.id))].slice(0,limit);
    },

    async getMapEvidence(externalId) {
      if (priorityById.has(externalId)) { const p=priorityById.get(externalId); return {evidence:p.evidence,demographics:null,warnings:p.warnings}; }
      const result = await pool.query(`SELECT g.properties, g.kind, g.name FROM market_geographies g WHERE g.external_id=$1 LIMIT 1`, [externalId]);
      if (!result.rows.length) return null;
      const observations = await pool.query(`SELECT o.metric, o.value, o.unit, o.reference_period, o.evidence_class, o.provenance, s.manifest FROM market_observations o JOIN market_geographies g ON g.id=o.geography_id JOIN market_source_versions s ON s.id=o.source_id AND s.version=o.source_version WHERE g.external_id=$1 ORDER BY o.metric, o.reference_period DESC`, [externalId]);
      const p = result.rows[0].properties || {};
      const evidence = [...(p.evidence || []), ...observations.rows.map(row => ({ ...row.provenance, metric: row.metric, value: Number(row.value), unit: row.unit, referencePeriod: row.reference_period, evidenceClass: row.evidence_class, title: row.manifest?.title, publisher: row.manifest?.publisher, url: row.manifest?.url, geographicResolution: result.rows[0].kind }))];
      return { evidence, demographics: p.demographics || null, warnings: p.warnings || [] };
    }
  };
}

module.exports = { LEVELS, CHILD, MAX_BY_LEVEL, ALLOWED_METRICS, normalizeFeature, createMarketMapStore };
