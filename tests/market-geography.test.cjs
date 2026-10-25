'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateParentPopulation, aggregateGeography } = require('../server/market-geography.cjs');
const { normalizeFeature, createMarketMapStore } = require('../server/market-map-store.cjs');

test('areal allocation conserves parent population and discloses historical estimate provenance', () => {
  const result = allocateParentPopulation({
    parents: [{ id: 'district-a', population: 1000, referenceYear: 2011, evidence: { sourceId: 'census-pca' } }],
    children: [{ id: 'pin-a', areaKm2: 2 }, { id: 'pin-b', areaKm2: 3 }],
    intersections: [{ parentId: 'district-a', childId: 'pin-a', areaKm2: 2 }, { parentId: 'district-a', childId: 'pin-b', areaKm2: 3 }]
  });
  assert.deepEqual(result.map(item => item.population), [400, 600]);
  assert.equal(result.reduce((sum, item) => sum + item.population, 0), 1000);
  assert.deepEqual(result.map(item => item.populationDensityPerKm2), [200, 200]);
  assert.equal(result[0].evidenceClass, 'derived_estimate');
  assert.equal(result[0].uncertainty, 'high');
  assert.equal(result[0].referenceYear, 2011);
  assert.equal(result[0].allocationMethod, 'areal_interpolation');
});

test('missing parent value or no valid intersection stays unavailable', () => {
  const result = allocateParentPopulation({
    parents: [{ id: 'district-a', population: null, referenceYear: 2011 }],
    children: [{ id: 'pin-a', areaKm2: 2 }, { id: 'pin-b', areaKm2: 3 }],
    intersections: [{ parentId: 'district-a', childId: 'pin-a', areaKm2: 2 }]
  });
  assert.equal(result.find(item => item.id === 'pin-a').population, null);
  assert.equal(result.find(item => item.id === 'pin-b').population, null);
});

test('population-weighted aggregation conserves totals and retains the common source vintage', () => {
  const result = aggregateGeography({
    children: [
      { id: 'a', population: 100, populationDensityPerKm2: 50, apparelSpendPerPersonMonthly: 100, tamAnnual: 120000, referenceYear: 2011, sourceIds: ['census', 'hces'] },
      { id: 'b', population: 300, populationDensityPerKm2: 150, apparelSpendPerPersonMonthly: 200, tamAnnual: 720000, referenceYear: 2011, sourceIds: ['census', 'hces'] }
    ],
    metric: { population: 'population', perCapita: 'apparelSpendPerPersonMonthly', totals: ['tamAnnual'] }
  });
  assert.equal(result.population, 400);
  assert.equal(result.apparelSpendPerPersonMonthly, 175);
  assert.equal(result.tamAnnual, 840000);
  assert.equal(result.sourceVintage.referenceYear, 2011);
  assert.deepEqual(result.sourceIds.sort(), ['census', 'hces']);
});

test('mixed vintages are explicitly marked instead of blended without warning', () => {
  const result = aggregateGeography({
    children: [
      { id: 'a', population: 100, apparelSpendPerPersonMonthly: 100, tamAnnual: 120000, referenceYear: 2011, sourceIds: ['census'] },
      { id: 'b', population: 100, apparelSpendPerPersonMonthly: 200, tamAnnual: 240000, referenceYear: 2023, sourceIds: ['census', 'hces'] }
    ],
    metric: { population: 'population', perCapita: 'apparelSpendPerPersonMonthly', totals: ['tamAnnual'] }
  });
  assert.equal(result.apparelSpendPerPersonMonthly, 150);
  assert.equal(result.sourceVintage.referenceYear, null);
  assert.equal(result.sourceVintage.mixed, true);
  assert.ok(result.warnings.some(warning => /vintage/i.test(warning)));
});

test('map metrics apply configurable income elasticity and preserve missing evidence', () => {
  const row = { external_id: '560001', kind: 'pin', name: 'Bengaluru', area_km2: 5,
    properties: { population: 1000, incomeProxy: 30000, regionalIncomeProxy: 40000, regionalApparelSpendMonthly: 1200,
      households: 250, evidence: [{ sourceId: 'HCES', referenceYear: 2024, geographicResolution: 'state' }] } };
  const base = normalizeFeature(row, 'tam', { elasticity: 1 });
  const lowElasticity = normalizeFeature(row, 'tam', { elasticity: 0.5 });
  assert.equal(base.metrics.monthlyPerCapitaSpend.value, 900);
  assert.equal(base.metrics.tam.value, 10800000);
  assert.equal(base.metrics.tam.evidenceClass, 'derived_estimate');
  assert.equal(base.metrics.monthlyPerCapitaSpend.warnings[0].includes('not observed'), true);
  assert.ok(lowElasticity.metrics.monthlyPerCapitaSpend.value > base.metrics.monthlyPerCapitaSpend.value);
  const missing = normalizeFeature({ external_id: 'X', kind: 'pin', properties: {} }, 'tam');
  assert.equal(missing.metrics.population.value, null);
  assert.equal(missing.metrics.tam.value, null);
  assert.equal(missing.metrics.incomeProxy.value, null);
});

test('capture and investment assumptions recalculate projected SOM without relabeling market spend as sales', () => {
  const row={external_id:'560001',kind:'pin',area_km2:2,properties:{population:500,apparelSpendPerPersonMonthly:1000,addressabilityFactor:0.4,accessibilityFactor:0.5}};
  const low=normalizeFeature(row,'revenue',{captureRate:0.02});
  const high=normalizeFeature(row,'revenue',{captureRate:0.04});
  assert.equal(low.metrics.tam.value,6000000);
  assert.equal(low.metrics.sam.value,1200000);
  assert.equal(low.metrics.som.value,24000);
  assert.equal(high.metrics.revenue.value,48000);
  assert.match(low.metrics.tam.warnings[0],/not store sales/i);
  assert.match(low.metrics.revenue.warnings[0],/not observed sales/i);
});

test('PostGIS catalog seeding is additive and links typed parent-child identifiers', async () => {
  const queries=[];
  const client={async query(sql,params=[]){queries.push({sql,params});if(sql.includes('RETURNING (xmax=0)'))return {rows:[{inserted:true}],rowCount:1};if(sql.includes('RETURNING child_id'))return {rows:[{child_id:'child'}],rowCount:1};return {rows:[],rowCount:0};},release(){}};
  const pool={connect:async()=>client};
  const store=createMarketMapStore(pool);
  const geometry={type:'Polygon',coordinates:[[[77,12],[78,12],[78,13],[77,13],[77,12]]]};
  const result=await store.seedMapCatalog([{kind:'state',externalId:'IN:29',name:'Karnataka',properties:{},geometry},{kind:'district',externalId:'C11:291',name:'Bengaluru',properties:{population:100},geometry}],[{parentKind:'state',parentId:'IN:29',childKind:'district',childId:'C11:291',relationship:'contains'}]);
  assert.deepEqual(result,{geographiesInserted:2,relationshipsInserted:1});
  assert.ok(queries.some(q=>/ST_GeomFromGeoJSON/.test(q.sql)));
  const relationQuery=queries.find(q=>q.sql.includes('INSERT INTO market_geo_relationships'));
  assert.deepEqual(relationQuery.params.slice(0,4),['state:IN:29','district:C11:291','state','district']);
  await assert.rejects(()=>store.seedMapCatalog([{kind:'unknown',externalId:'x',name:'bad',properties:{}}]),/Invalid geography/i);
});

test('priority Karnataka city aliases resolve to sourced points without invented demographics', async () => {
  const store=createMarketMapStore({query:async()=>({rows:[]})});
  const aliases={Bangalore:'Bengaluru',banglore:'Bengaluru',Mysore:'Mysuru',Mangalore:'Mangaluru',Hubli:'Hubballi-Dharwad',Belgaum:'Belagavi',Tumkur:'Tumakuru',Davanagere:'Davanagere'};
  for (const [query,name] of Object.entries(aliases)) {
    const results=await store.searchMapGeographies(query);
    const city=results.find(row=>row.level==='city'&&row.name===name);
    assert.ok(city,`${query} resolves ${name}`);
    assert.equal(results[0].name,name,`${query} ranks the intended city before an identically named district`);
    assert.equal(city.geometry.type,'Point');
    assert.equal(city.metrics.population.value,null);
    assert.ok(city.evidence.some(row=>row.url?.startsWith('https://www.geonames.org/')));
    assert.equal(city.state,'Karnataka');
  }
  assert.equal((await store.searchMapGeographies('560001')).length,0,'an unsupported PIN is not invented');
});

test('Karnataka priority district polygons and city points follow state to district to city hierarchy', async () => {
  const store=createMarketMapStore({query:async()=>({rows:[]})});
  const districts=await store.listMapGeographies({parentId:'state:IN-KA',level:'district',metric:'population'});
  assert.equal(districts.length,7);
  assert.ok(districts.every(row=>row.geometry && ['Polygon','MultiPolygon'].includes(row.geometry.type)));
  const bengaluru=await store.searchMapGeographies('Bengaluru');
  const city=bengaluru.find(row=>row.level==='city');
  assert.equal(await store.getMapLevel(city.parentId),'city');
  const child=await store.listMapGeographies({parentId:city.parentId,level:'city',metric:'population'});
  assert.ok(child.some(row=>row.id===city.id));
  assert.ok(districts.every(row=>row.metrics.population.value===null));
});
