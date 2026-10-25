'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/india-geography/manifest.json')));
test('geography manifest exposes only validated state records and marks unresolved sources',()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.deepEqual(manifest.geographies,[]);
 assert.deepEqual(manifest.relationships,[]);
 assert.equal(manifest.datasets.length,10);
 const states=manifest.datasets.find(d=>d.id==='geoboundaries-india-adm1');
 assert.equal(states.status,'available');assert.equal(states.coverage.featureCount,36);
 for(const d of manifest.datasets){
  if(d.status==='available'){
   assert.equal(d.license.status,'verified');assert.ok(d.coverage.featureCount>0);assert.ok(d.artifact);
   continue;
  }
  assert.equal(d.status,'unavailable');assert.equal(d.artifact,null);
  assert.deepEqual(d.coverage,{featureCount:0,rowCount:0,populationTotal:null});
  assert.ok(d.knownGaps.length && d.publisher && d.sourceVintage && d.codeScheme);
  assert.match(d.sourceUrl,/^https:\/\//);
  assert.ok(['unverified','restricted'].includes(d.license.status));
 }
});
test('unavailable postal geography cannot supply observed PIN population, income or spend',()=>{
 const pin=manifest.datasets.find(d=>d.level==='pin');
 assert.equal(pin.coverage.populationTotal,null);
 assert.equal(pin.artifact,null);
 assert.deepEqual(manifest.geographies,[]);
 assert.ok(manifest.backendContract.properties.includes('apparelSpendPerPersonMonthly'));
});
