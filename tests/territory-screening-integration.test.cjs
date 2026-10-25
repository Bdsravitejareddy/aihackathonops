'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');

async function appHarness(t){
  const dom=new JSDOM(html,{url:'http://localhost/#overview',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,requests=[];let applicants=[];
  w.fetch=async(url,options={})=>{
    const route=String(url);requests.push({url:route,options});
    const data=route==='demo.json'?JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8')):
      route.includes('/api/market/map/geographies/pin%3A560026')?{geography:{id:'pin:560026',name:'Government Electric Factory S.O · Bengaluru',level:'pin',pin:'560026',state:'Karnataka',postOffices:[{name:'Government Electric Factory S.O',delivery:'Delivery'}],metrics:{population:{value:null,unit:'people',evidenceClass:'unavailable',warnings:['No PIN population crosswalk.']},monthlyPerCapitaSpend:{value:374.22,unit:'INR/person/month',status:'available',evidenceClass:'official_survey_estimate',geographicResolution:'state_sector',referencePeriod:'2023-24',geography:{level:'state_sector',state:'Karnataka',sector:'urban'},evidence:[{sourceId:'hces-karnataka',title:'HCES 2023-24 Karnataka urban',referenceYear:2024,url:'https://mospi.gov.in/hces.pdf'}]},annualPerCapitaSpend:{value:4490.64,unit:'INR/person/year',status:'derived',evidenceClass:'derived_estimate',referencePeriod:'2023-24',evidence:[{sourceId:'hces-karnataka',title:'HCES 2023-24 Karnataka urban',referenceYear:2024,url:'https://mospi.gov.in/hces.pdf'}]},tam:{value:null,unit:'INR/year',evidenceClass:'unavailable'}},evidence:[{sourceId:'india-post',title:'India Post Karnataka PIN directory',referenceYear:2020,url:'https://indiapost.gov.in/pincode.pdf'},{sourceId:'hces-karnataka',title:'HCES 2023-24 Karnataka urban',referenceYear:2024,url:'https://mospi.gov.in/hces.pdf'}],benchmarkComparison:{urban:{value:374.22,unit:'INR/person/month',referencePeriod:'2023-24'},rural:{value:273.17,unit:'INR/person/month',referencePeriod:'2023-24'}},warnings:['PIN population is unavailable.']},sourceVersion:'test-v1'}:
      route.includes('/api/market/forecast')?{modelVersion:'india-fashion-market-v1',economics:{footfall:{passingPedestrianTraffic:{value:30000}},economics:{breakEvenRevenueMonthly:333333.333,breakEvenTransactionsMonthly:500},scenarios:Object.fromEntries([['conservative',900000],['base',1200000],['optimistic',1500000]].map(([name,revenue])=>[name,{years:[{nominalRevenue:revenue}],months:Array.from({length:12},(_,i)=>({month:i+1,operatingCashFlow:10000})),roiPercent:5,paybackMonths:48,npv:100000,irrAnnual:3}]))}}:
      route.includes('/api/screening/applications')?{applications:applicants}:
      route.includes('/api/market/assessments')?{assessments:[]}:
      route.includes('/api/market/sources')?{sources:[]}:
      route.includes('/api/market/benchmarks')?{observations:[]}:
      route.includes('/api/market/map/search')?{results:[]}:
      route==='api/health'?{ok:true}:{};
    return {ok:!route.includes('/api/workspaces/'),status:route.includes('/api/workspaces/')?404:200,json:async()=>data};
  };
  for(const file of ['engine.js','xlsx.js','bot.js','persistence.js','market-map.js','market-intelligence.js','territory-screening.js','app.js'])w.eval(fs.readFileSync(path.join(root,'dist',file),'utf8'));
  for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
  return {dom,w,requests,setApplicants(rows){applicants=rows;}};
}

test('screening entry queries Neon by selected PIN, ranks using unchanged eligibility results, and opens existing assessment',async t=>{
  const h=await appHarness(t);const {w,requests}=h;
  w.document.querySelector('[data-tab="screening"]').click();await new Promise(r=>setImmediate(r));
  const input=w.document.querySelector('#ts-pin');assert.ok(input,'screening page is mounted');input.value='560101';
  const demo=JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8')).apps.filter(a=>a.pin==='560101');
  h.setApplicants(demo.slice(0,2));
  w.document.querySelector('[data-pin-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.ok(requests.some(r=>r.url.includes('/api/screening/applications')&&r.url.includes('pin=560101')));
  const ids=[...w.document.querySelectorAll('.ts-applicant')].map(x=>x.dataset.applicantId);
  const source=JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8'));
  const expected=source.apps.map((a,i)=>w.Engine.normalize(a,`demo-${i}`)).filter(a=>a.pin==='560101');
  const allApps=source.apps.map((a,i)=>w.Engine.normalize(a,`demo-${i}`));
  const reference=w.Engine.benchmarks(allApps);
  const ranked=w.Engine.assess(expected,source.territories,[],reference,w.Engine.defaultPolicy).sort((a,b)=>b.score-a.score||a.launch-b.launch||a.id.localeCompare(b.id)).map(a=>a.id);
  assert.deepEqual(ids,ranked);
  w.document.querySelector('.ts-open').click();
  assert.equal(w.document.querySelector('#overlay').hidden,false);
  assert.match(w.document.querySelector('#overlay').textContent,/Why this decision\?/);
});

test('map PIN selection and Territories view preserve the chosen location into screening',async t=>{
  const h=await appHarness(t),{w}=h;
  w.dispatchEvent(new w.CustomEvent('franchiseos:location-selected',{detail:{id:'pin:570009',name:'570009',level:'pin',pin:'570009',city:'Mysuru',state:'Karnataka',metrics:{},evidence:[]}}));
  await new Promise(r=>setImmediate(r));
  assert.equal(w.location.hash,'#screening');assert.equal(w.document.querySelector('#ts-pin').value,'570009');
  w.document.querySelector('[data-tab="territories"]').click();await new Promise(r=>setImmediate(r));
  const button=w.document.querySelector('[data-screen-pin="570101"]');
  assert.ok(button,'territory PIN is directly selectable');button.click();await new Promise(r=>setImmediate(r));
  assert.equal(w.location.hash,'#screening');assert.equal(w.document.querySelector('#ts-pin').value,'570101');
});

test('PIN 560026 loads postal and HCES evidence into the integrated territory snapshot without inventing TAM',async t=>{
  const h=await appHarness(t),{w,requests}=h;
  w.document.querySelector('[data-tab="screening"]').click();
  await new Promise(r=>setImmediate(r));
  w.document.querySelector('#ts-pin').value='560026';
  w.document.querySelector('[data-pin-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));
  assert.ok(requests.some(r=>r.url.includes('/api/market/map/geographies/pin%3A560026')),'selected PIN should resolve its sourced market context');
  const market=w.document.querySelector('[data-market]');
  assert.match(w.document.querySelector('[data-location]').textContent,/Government Electric Factory S\.O/);
  assert.match(market.textContent,/374\.22/);
  assert.match(w.document.querySelector('[data-evidence]').textContent,/HCES 2023-24 Karnataka urban/);
  const tam=[...market.querySelectorAll('.ts-metric')].find(card=>/TAM/.test(card.textContent));
  assert.match(tam.textContent,/Unavailable/);
  assert.match(market.textContent,/No substitute city or regional population/);
  w.document.querySelector('[data-tab="market"]').click();
  for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
  assert.equal(w.document.querySelector('#market-form [name="pin"]').value,'560026');
  assert.equal(w.document.querySelector('#market-form [name="regionalSpend"]').value,'374.22');
});

test('a transient market-detail outage is retried when the same PIN is selected again',async t=>{
  const h=await appHarness(t),{w}=h,originalFetch=w.fetch;let attempts=0;
  w.fetch=async(url,options)=>{
    if(String(url).includes('/api/market/map/geographies/pin%3A560026')&&++attempts===1)
      return {ok:false,status:503,json:async()=>({error:'temporary outage'})};
    return originalFetch(url,options);
  };
  w.document.querySelector('[data-tab="screening"]').click();
  await new Promise(r=>setImmediate(r));
  const selectPin=()=>{w.document.querySelector('#ts-pin').value='560026';w.document.querySelector('[data-pin-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
  selectPin();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(attempts,1);
  selectPin();for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
  assert.equal(attempts,2);
  assert.match(w.document.querySelector('[data-market]').textContent,/374\.22/);
});

test('territory screening sends calculator assumptions to the forecast API and renders its nested results',async t=>{
  const h=await appHarness(t),{w,requests}=h;
  w.document.querySelector('[data-tab="screening"]').click();await new Promise(r=>setImmediate(r));
  w.document.querySelector('#ts-pin').value='560026';
  w.document.querySelector('[data-pin-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setImmediate(r));
  const form=w.document.querySelector('[data-financial-scenario]');
  form.elements.monthlyFixedCosts.value='120000';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));
  const request=requests.find(row=>row.url==='/api/market/forecast');
  assert.ok(request,'scenario should call existing deterministic forecast endpoint');
  const payload=JSON.parse(request.options.body);
  assert.equal(payload.store.monthlyFixedCosts,120000);
  assert.equal(payload.store.trafficEvidenceClass,'model_assumption');
  const output=w.document.querySelector('[data-financial-results]').textContent;
  assert.match(output,/Conservative/);
  assert.match(output,/₹3,33,333/);
  assert.match(output,/No supported PIN TAM was supplied/);
});
