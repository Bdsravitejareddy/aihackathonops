'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

const geographyId='state:IN-KA', workspaceId='f28e574b-6f52-4f24-97c6-69e0c28bb54f', assessmentId='d18b6324-2abc-4f24-97c6-69e0c28bb54f';
function setup({ service, researchStore }={}) {
  let context, lastStored;
  const store={async load(){return null},async save(){return 1}};
  const marketStore={async getAssessment(owner,id){return owner===workspaceId&&id===assessmentId?{id,workspaceId:owner,version:2,snapshot:{name:'Karnataka pilot',inputs:{},results:{metrics:{tam:{value:42}}}}}:null}};
  const geo={id:geographyId,name:'Karnataka',level:'state',metrics:{population:{value:61130704,unit:'people'},monthlyPerCapitaSpend:{value:312.14,unit:'INR/person/month'},apparelExpenditure:{value:228979787945.16,unit:'INR/year'},sam:{value:null}},demographics:{ruralPopulation:37552529,urbanPopulation:23578175},evidence:[{sourceId:'census',metric:'population',referenceYear:2011,url:'https://example.org/census'},{sourceId:'hces',metric:'apparelSpendPerPersonMonthly',referencePeriod:'2023-24',url:'https://example.org/hces'}],warnings:['Hybrid estimate']};
  const marketMapStore={sourceVersion:'india-geography-1.1.1',async getMapGeography(){return geo},async getMapEvidence(){return {evidence:geo.evidence,warnings:geo.warnings}}};
  const records=new Map();
  const defaultResearchStore={async getCached(input){return records.get(`${input.recordType||'cards'}:${input.promptHash||''}`)||null},async save(input){lastStored=input;records.set(`${input.recordType}:${input.promptHash||''}`,{result:input.result,citations:input.citations,retrievedAt:'2026-10-25T00:00:00.000Z'});return {id:'record'}} ,async markStale(){return 1}};
  let researchCalls=0, answerCalls=0;
  const defaultService={modelVersion:'gemini-2.5-flash',async researchLocation(value){researchCalls++;context=value;return {ok:true,cards:[{headline:'Market evidence',insight:'Regional evidence supports further local checks.',implication:'Validate local prices.',evidenceUrls:['https://example.org/hces'],confidence:'medium',referenceDate:'Retrieved 2026-10-25'}],citations:[{url:'https://example.org/hces',title:'HCES source',retrievedAt:'2026-10-25T00:00:00.000Z'}],retrievedAt:'2026-10-25T00:00:00.000Z',usage:{totalTokenCount:10}}},async answerQuestion(value){answerCalls++;context=value.context;return {ok:true,answer:'The current forecast is based on supplied inputs; change assumptions in the scenario panel to recalculate.',citations:[{url:'https://example.org/hces',title:'HCES'}],retrievedAt:'2026-10-25T00:00:00.000Z'}}};
  const handler=createHandler({store,marketStore,marketMapStore,marketResearchStore:researchStore||defaultResearchStore,marketResearchService:service||defaultService,marketSources:{sources:[]},marketBenchmarks:{observations:[]}});
  async function call(url,body){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url=url;req.headers={host:'127.0.0.1:8080','content-type':'application/json'};req.socket={remoteAddress:'127.0.0.1'};let status,payload;const res={writeHead(code){status=code},end(data){payload=JSON.parse(data)}};await handler(req,res);return {status,json:payload}}
  return {call,get context(){return context},get lastStored(){return lastStored},get researchCalls(){return researchCalls},get answerCalls(){return answerCalls}};
}

test('selected location research is grounded, cached in the research store, and linked to source evidence',async()=>{
 const h=setup();const path=`/api/market/map/geographies/${encodeURIComponent(geographyId)}/research`;
 const first=await h.call(path,{segment:'value-fashion',assumptions:{elasticity:1}});
 assert.equal(first.status,200);assert.equal(first.json.cached,false);assert.equal(first.json.cards.length,1);
 assert.equal(h.context.targetApparelSegment,'value-fashion');assert.equal(h.lastStored.modelVersion,'gemini-2.5-flash');
 assert.equal(h.lastStored.contextHash.length,64);assert.equal(h.lastStored.recordType,'cards');
 const second=await h.call(path,{segment:'value-fashion',assumptions:{elasticity:1}});
 assert.equal(second.json.cached,true);assert.equal(h.researchCalls,1);
});

test('manual refresh bypasses cache; Market Intelligence answers receive selected assessment context',async()=>{
 const h=setup(), path=`/api/market/map/geographies/${encodeURIComponent(geographyId)}`;
 await h.call(`${path}/research`,{segment:'premium-fashion'});
 const refreshed=await h.call(`${path}/research`,{segment:'premium-fashion',refresh:true});
 assert.equal(refreshed.json.cached,false);assert.equal(h.researchCalls,2);
 const answer=await h.call(`${path}/ask`,{segment:'mass-market-family-apparel',workspaceId,assessmentId,question:'Why is the payback forecast uncertain?',assumptions:{aov:1000,areaSqFt:1000,investment:500000,workingCapital:0,monthlyFixedCosts:100000,grossMargin:0.5,royaltyRate:0.05,conversionRate:0.1,monthlyPassingPedestrianTraffic:3000,entryRate:0.2,salesRampMonths:6,initialRampFraction:0.4,annualNominalGrowth:0.05,annualInflation:0.04,discountRate:0.12}});
 assert.equal(answer.status,200);assert.equal(h.answerCalls,1);assert.equal(h.context.deterministicAssessment.version,2);
 assert.ok(h.context.deterministicAssessment.financialForecast.breakEvenRevenueMonthly > 0);
 assert.match(answer.json.answer,/supplied inputs/);
});

test('research API validates questions and gracefully disables Gemini when not configured',async()=>{
 const path=`/api/market/map/geographies/${encodeURIComponent(geographyId)}/ask`;
 const bad=await setup().call(path,{question:' '.repeat(3)});assert.equal(bad.status,400);
 const h=setup({service:null,researchStore:null});
 // Explicitly simulate missing backend services; no request body or key is reflected.
 const disabled=createHandler({store:{async load(){return null},async save(){return 1}},marketMapStore:{async getMapGeography(){return null}},marketResearchService:null,marketResearchStore:null,marketSources:{},marketBenchmarks:{}});
 const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.url=`/api/market/map/geographies/${encodeURIComponent(geographyId)}/research`;req.headers={host:'127.0.0.1:8080','content-type':'application/json'};let status,payload;const res={writeHead(code){status=code},end(data){payload=JSON.parse(data)}};await disabled(req,res);
 assert.equal(status,503);assert.match(payload.error,/configure Gemini/i);assert.equal(JSON.stringify(payload).includes('API_KEY'),false);assert.equal(h.researchCalls,0);
});
