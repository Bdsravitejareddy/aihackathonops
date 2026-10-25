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
