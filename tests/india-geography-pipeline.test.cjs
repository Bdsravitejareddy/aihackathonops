'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateManifest, validateFeatures, validateDemographics, validateRepository } = require('../scripts/validate-india-geography.cjs');
const { ingest } = require('../scripts/ingest-india-geography.cjs');

const root = path.resolve(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'data/india-geography/manifest.json'),'utf8'));
const polygon = { type:'Polygon', coordinates:[[[77,12],[78,12],[78,13],[77,13],[77,12]]] };

test('repository geography manifest validates sourced state, district and PIN coverage and explicit remaining gaps', () => {
  const result = validateRepository({rootDir:root});
  assert.equal(result.datasetCount,12);
  assert.equal(result.featureCount,0);
  const coverage = id => manifest.datasets.find(item=>item.id===id).coverage;
  assert.equal(coverage('geoboundaries-india-adm1').populationTotal,1210854977);
  assert.equal(coverage('geoboundaries-india-adm1').featureCount,36);
  // Districts and PINs share the modelled 2020 population; PINs only miss districts with no mapped post office.
  const districts = coverage('geoboundaries-india-adm2-worldpop-2020').populationTotal, pins = coverage('india-post-pin-directory-areas').populationTotal;
  assert.ok(pins <= districts && pins > districts * 0.999);
  assert.equal(manifest.datasets.filter(item=>item.status==='unavailable').length,9);
});

test('feature validation checks PIN syntax, geometry, count and never accepts unsupported PIN metrics', () => {
  const make = (code='560001', properties={}) => ({type:'FeatureCollection',features:[{type:'Feature',id:code,properties:{code,level:'pin',...properties},geometry:structuredClone(polygon)}]});
  assert.equal(validateFeatures(make(),{level:'pin',expectedCount:1}).featureCount,1);
  for(const bad of ['012345','56000','abc123']) assert.throws(()=>validateFeatures(make(bad),{level:'pin'}),/PIN/i);
  const open=make();open.features[0].geometry.coordinates[0][4]=[77.5,12.5];
  assert.throws(()=>validateFeatures(open,{level:'pin'}),/ring/i);
  assert.throws(()=>validateFeatures(make('560001',{population:10}),{level:'pin'}),/PIN/i);
  assert.throws(()=>validateFeatures(make(),{level:'pin',expectedCount:2}),/count/i);
});

test('demographic totals conserve population by hierarchy and sex without filling missing rows', () => {
  const rows=[{id:'IN',level:'country',population:100,male:50,female:50},{id:'29',level:'state',parentId:'IN',population:100,male:50,female:50},{id:'001',level:'district',parentId:'29',population:100,male:50,female:50}];
  assert.equal(validateDemographics(rows,{countryPopulation:100,stateCount:1,districtCount:1}).populationTotal,100);
  const invalid=structuredClone(rows);invalid[2].population=99;
  assert.throws(()=>validateDemographics(invalid),/sex total|conservation/i);
});

test('ingestion creates a reproducible immutable snapshot and rejects changed outputs', () => {
  const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'india-geo-ingest-'));
  try {
    const first=ingest({rootDir:root,outputDir}), second=ingest({rootDir:root,outputDir});
    assert.equal(first.idempotent,false);assert.equal(second.idempotent,true);assert.deepEqual(first.coverage,second.coverage);
    const data=JSON.parse(fs.readFileSync(first.path,'utf8'));
    assert.equal(data.geographies.length,36+735);assert.equal(data.relationships.length,735);
    assert.ok(data.relationships.every(relation=>relation.parentKind==='state'&&relation.childKind==='district'));
    assert.equal(data.datasets.find(row=>row.id==='india-post-pin-directory-areas').ingest,'seed-script');
    fs.writeFileSync(first.path,'modified');
    assert.throws(()=>ingest({rootDir:root,outputDir}),/immutable/i);
  } finally { fs.rmSync(outputDir,{recursive:true,force:true}); }
});

test('verified GeoJSON artifacts become typed geography rows with provenance for Neon seeding', () => {
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'india-geo-source-'));
  try{
    fs.mkdirSync(path.join(repo,'data/india-geography'),{recursive:true});
    const candidate=structuredClone(manifest), dataset=candidate.datasets[0];
    candidate.datasets=[dataset];candidate.evidence=[];
    dataset.level='state';dataset.featureLevel='state';dataset.status='available';dataset.license.status='verified';dataset.artifact='data/india-geography/state.geojson';
    dataset.coverage={featureCount:1,rowCount:1,populationTotal:null};dataset.knownGaps=[];candidate.retrievedAt='2026-10-25';
    fs.writeFileSync(path.join(repo,'data/india-geography/manifest.json'),JSON.stringify(candidate));
    fs.writeFileSync(path.join(repo,'data/india-geography/state.geojson'),JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',id:'29',properties:{code:'29',name:'Karnataka',level:'state'},geometry:polygon}]}));
    const output=fs.mkdtempSync(path.join(os.tmpdir(),'india-geo-artifacts-'));
    try{
      const result=ingest({rootDir:repo,outputDir:output});
      assert.equal(result.geographies.length,1);assert.equal(result.geographies[0].kind,'state');assert.equal(result.geographies[0].externalId,'29');
      assert.equal(result.geographies[0].properties.evidence[0].sourceId,dataset.sourceId);
      assert.equal(result.coverage.features,1);
    }finally{fs.rmSync(output,{recursive:true,force:true});}
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('manifest validator fails closed on license, unsupported status and path traversal', () => {
  const altered=structuredClone(manifest);altered.datasets[0].status='available';
  assert.throws(()=>validateManifest(altered),/available data requires/i);
  const copied=structuredClone(manifest);copied.datasets[0].artifact='../secrets.json';
  assert.throws(()=>validateManifest(copied),/unavailable status/i);
  assert.throws(()=>require('../scripts/validate-india-geography.cjs').resolveArtifact(root,copied.datasets[0].artifact),/escapes/i);
});
