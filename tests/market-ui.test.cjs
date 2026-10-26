'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dist/style.css'), 'utf8');

test('Market Intelligence is a separate view with transparent evidence and comparison controls', () => {
  assert.match(app, /market:\s*'Market Intelligence'/);
  assert.match(app, /Market viability score/);
  assert.match(app, /Official survey estimate/);
  assert.match(app, /directoryStatus/);
  assert.match(app, /assessments\/compare/);
  assert.match(app, /monthlyPerCapitaSpend/);
  assert.match(app, /pinIncomeProxy/);
  assert.match(app, /regionalIncomeProxy/);
  assert.match(app, /regionalSpend\*\(pinIncomeProxy\/regionalIncomeProxy\)\*\*elasticity/);
  assert.match(app, /\[0\.5,0\.75,1,1\.25\]/);
  assert.match(app, /api\/market\/forecast/);
  assert.match(app, /breakEvenRevenue/);
  assert.match(css, /\.market-grid/);
});

test('market assumptions use dedicated market API and never enter applicant scoring', () => {
  assert.match(app, /\/api\/market\/assessments/);
  assert.match(app, /\/recalculate/);
  assert.match(app, /Market assessment is separate from franchisee eligibility/);
  assert.match(app, /\/api\/market\/pins\/validate/);
  assert.match(app, /Market assessment is separate from franchisee eligibility/);
  assert.doesNotMatch(app, /market[^\n]{0,100}E\.assess/i);
  assert.match(html, /id="nav"/);
});

function snapshotHarness(options = {}) {
  assert.ok(fs.existsSync(path.join(root, 'dist/market-intelligence.js')), 'Market Intelligence presentation module must exist');
  const MarketIntelligence = require('../dist/market-intelligence.js');
  const dom = new JSDOM(`<main><section class="panel"><form id="market-form"><div class="market-grid">
    <label>Assessment name<input name="name" value=""></label><label>Country<input name="country" value="India"></label>
    <label>State<input name="state"></label><label>City<input name="city"></label><label>PIN code<input name="pin"></label>
    <label>Catchment method<select name="catchment"><option value="user_defined">User supplied</option></select></label>
    <label>Catchment population<input name="population"></label><label>Regional spend<input name="regionalSpend"></label>
    <label>Gross margin<input name="grossMargin"></label><label>Initial investment<input name="investment"></label>
    <label>Elasticity<input name="elasticity" value="1"></label><label>Demand score<input name="scoreDemand"></label>
    <label>Competitors<textarea name="competitors"></textarea></label>
    </div><button type="submit">Save assessment & calculate</button></form></section>
    <section class="panel"><div id="market-comparison"></div></section><section class="panel">Old source inventory</section></main>`, { url:'http://localhost/' });
  const rootElement = dom.window.document.querySelector('main');
  const controller = MarketIntelligence.mount({ root:rootElement, ...options });
  return { dom, rootElement, controller, form:rootElement.querySelector('#market-form') };
}

test('initial market screen exposes only location, category, optional format and Analyse', t => {
  const h = snapshotHarness(); t.after(() => h.dom.window.close());
  const visible = [...h.form.querySelectorAll('input,select,textarea')].filter(el => !el.closest('[hidden],details:not([open])'));
  assert.deepEqual(visible.map(el => el.name), ['locationQuery','category','storeFormat']);
  assert.match(h.form.textContent, /Analyse Market/);
  assert.equal(h.rootElement.querySelector('[data-mi-results]').hidden, true);
  assert.ok(h.form.elements.scoreDemand, 'expert scoring field remains available');
});

test('selected geography updates location fields and prefills only a sourced regional spend benchmark', t => {
  const h = snapshotHarness(); t.after(() => h.dom.window.close());
  h.controller.setLocation({ id:'ka', name:'Karnataka', level:'state', state:'Karnataka', sourceVersion:'geo-v1',
    metrics:{ population:{value:61130704,evidenceClass:'official_observed'}, monthlyPerCapitaSpend:{value:312.14,evidenceClass:'derived_estimate'} },
    evidence:[{sourceId:'census-2011',title:'Census 2011',referenceYear:2011,url:'https://example.org/census'}] });
  assert.equal(h.form.elements.state.value, 'Karnataka');
  assert.equal(h.form.elements.population.value, '');
  assert.equal(h.form.elements.regionalSpend.value, '312.14');
  assert.match(h.rootElement.textContent, /6,11,30,704/);
  assert.match(h.rootElement.textContent, /Census 2011/);
});

test('PIN assessment reuses the applicant callback and ranks confirmed eligibility descending', async t => {
  const calls=[];
  const h=snapshotHarness({analyzed:true,selectedLocation:{id:'pin:560026',name:'Government Electric Factory · Bengaluru',level:'pin',pin:'560026',state:'Karnataka'},
    loadApplicants:async location=>{calls.push(location.pin);return [
      {id:'APP-002',name:'Second',confirmedEligibilityScore:70,key:'k2'},
      {id:'APP-001',name:'First',confirmedEligibilityScore:88,key:'k1'}
    ];}});
  t.after(()=>h.dom.window.close());await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['560026']);
  const rows=[...h.rootElement.querySelectorAll('[data-mi-applicants] .mi-applicant button')].map(button=>button.textContent);
  assert.match(rows[0],/1\. First · 88/);
  assert.match(rows[1],/2\. Second · 70/);
});

test('analysed snapshot names missing dimensions and deduplicates relevant evidence', t => {
  const evidence = {sourceId:'hces',title:'HCES 2023–24',referenceYear:2024,url:'https://example.org/hces'};
  const h = snapshotHarness({ analyzed:true, selectedLocation:{name:'Karnataka',level:'state',state:'Karnataka',
    metrics:{population:{value:61130704,unit:'people',evidenceClass:'official_observed'},apparelExpenditure:{value:228979787945,unit:'INR/year',evidenceClass:'derived_estimate'}},evidence:[evidence,evidence]},
    result:{metrics:{tam:{value:null,status:'unavailable'},sam:{value:null,status:'unavailable'},som:{value:null,status:'unavailable'}}} });
  t.after(() => h.dom.window.close());
  assert.equal(h.rootElement.querySelector('[data-mi-results]').hidden,false);
  assert.match(h.rootElement.textContent, /market expenditure, not store revenue/i);
  assert.match(h.rootElement.textContent, /unscored/i);
  assert.match(h.rootElement.textContent, /Key opportunities/);
  assert.match(h.rootElement.textContent, /Key risks/);
  assert.equal(h.rootElement.querySelectorAll('[data-mi-evidence] li').length,1);
  assert.equal(h.rootElement.querySelector('a[href="https://example.org/hces"]').textContent.includes('HCES'),true);
});

test('missing market evidence shows its cause and a practical next action while preserving null', t => {
  const h = snapshotHarness({analyzed:true,selectedLocation:{name:'560026',level:'pin',metrics:{
    population:{value:null,missing:{cause:'geography_mismatch',nextAction:'Use a supported census geography or add a validated PIN-to-population crosswalk.'}},
    monthlyPerCapitaSpend:{value:null,missing:{cause:'source_unavailable',nextAction:'Select a region with a published benchmark.'}}
  }},result:{metrics:{tam:{value:null,status:'unavailable',missing:{cause:'missing_calculation_dependency',nextAction:'Supply population and spend inputs.'}}}}});
  t.after(()=>h.dom.window.close());
  const text=h.rootElement.querySelector('[data-mi-results]').textContent;
  assert.match(text,/geography mismatch/i);
  assert.match(text,/validated PIN-to-population crosswalk/i);
  assert.match(text,/source unavailable/i);
  assert.match(text,/supply population and spend inputs/i);
});

test('commercial and advanced controls retain existing field names for the API', t => {
  const h = snapshotHarness({ analyzed:true }); t.after(() => h.dom.window.close());
  assert.ok(h.rootElement.querySelector('[data-mi-commercial] [name="investment"]'));
  assert.ok(h.rootElement.querySelector('[data-mi-advanced] [name="elasticity"]'));
  assert.ok(h.rootElement.querySelector('[data-mi-advanced] [name="scoreDemand"]'));
  assert.ok(h.rootElement.querySelector('#market-comparison'));
});

test('commercial snapshot presents saved forecast revenue as a scenario', t => {
  const h=snapshotHarness({analyzed:true,snapshot:{location:{state:'Karnataka'},forecast:{economics:{breakEvenRevenueMonthly:225000,scenarios:{base:{years:[{nominalRevenue:4000000}],paybackMonths:27,roiPercent:18.5}}}}}});
  t.after(()=>h.dom.window.close());
  const results=h.rootElement.querySelector('[data-mi-results]').textContent;
  assert.match(results,/Projected year-one revenue/);
  assert.match(results,/₹40,00,000/);
  assert.match(results,/27 months/);
  assert.match(results,/scenario projection, not observed sales/i);
});

test('grounded research cards display cited context without changing numeric snapshot', async t => {
  const h=snapshotHarness({analyzed:true,selectedLocation:{id:'ka',name:'Karnataka',level:'state',metrics:{apparelExpenditure:{value:120000000,unit:'INR/year'}}},
    research:async()=>({cards:[{headline:'Value pricing context',insight:'Local price positioning needs store checks.',implication:'Compare nearby formats.',confidence:'medium',referenceDate:'Retrieved 2026-10-26',evidenceUrls:['https://example.org/report']}],citations:[{title:'Retail report',url:'https://example.org/report'}]})});
  t.after(()=>h.dom.window.close());await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.rootElement.querySelector('[data-mi-research]').textContent,/Value pricing context/);
  assert.equal(h.rootElement.querySelector('[data-mi-research] a').href,'https://example.org/report');
  assert.match(h.rootElement.querySelector('[data-mi-results]').textContent,/₹12,00,00,000/);
});

test('research outage leaves the deterministic snapshot usable', async t => {
  const h=snapshotHarness({analyzed:true,selectedLocation:{id:'ka',name:'Karnataka',level:'state'},research:async()=>{throw Error('Research unavailable');}});
  t.after(()=>h.dom.window.close());await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.rootElement.querySelector('[data-mi-research]').textContent,/API\/database failure/i);
  assert.match(h.rootElement.querySelector('[data-mi-research]').textContent,/retry the research service/i);
  assert.equal(h.rootElement.querySelector('[data-mi-results]').hidden,false);
});

test('manual place edits clear the previous sourced selection before analysis', t => {
  const h = snapshotHarness({snapshot:{name:'Karnataka review',location:{state:'Karnataka',city:'Bengaluru'}}}); t.after(()=>h.dom.window.close());
  const input=h.form.elements.locationQuery; input.value='570001';
  input.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));
  assert.equal(h.form.elements.state.value,'');
  assert.equal(h.form.elements.city.value,'');
  assert.equal(h.form.elements.pin.value,'570001');
  assert.equal(h.form.elements.name.value,'570001 apparel assessment');
});

test('running application accepts map selection and keeps the snapshot form concise', async t => {
  const dom = new JSDOM(html, {url:'http://localhost/#overview',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = async url => ({ok:true,status:200,json:async () => {
    const pathName = String(url);
    if (pathName === 'demo.json') return JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8'));
    if (pathName.includes('/api/market/sources')) return {sources:[]};
    if (pathName.includes('/api/market/benchmarks')) return {observations:[]};
    if (pathName.includes('/api/market/assessments')) return {assessments:[]};
    return {};
  }});
  for (const file of ['engine.js','bot.js','persistence.js','market-map.js','market-intelligence.js','app.js']) w.eval(fs.readFileSync(path.join(root,'dist',file),'utf8'));
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  w.document.querySelector('[data-tab="market"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...w.document.querySelectorAll('#market-form input,#market-form select,#market-form textarea')]
    .filter(el => !el.closest('[hidden],details:not([open])')).map(el => el.name),['locationQuery','category','storeFormat']);
  w.dispatchEvent(new w.CustomEvent('franchiseos:location-selected',{detail:{id:'ka',name:'Karnataka',level:'state',state:'Karnataka',sourceVersion:'geo-v1',metrics:{population:{value:61130704}},evidence:[]}}));
  assert.equal(w.document.querySelector('#market-form [name="state"]').value,'Karnataka');
});

test('Analyse saves a versioned assessment and shows the deterministic snapshot', async t => {
  const dom = new JSDOM(html, {url:'http://localhost/#market',runScripts:'outside-only'});
  t.after(() => dom.window.close()); const w = dom.window;
  w.crypto.randomUUID = () => '11111111-1111-4111-8111-111111111111';
  const requests = []; let savedSnapshot;
  w.fetch = async (url, options = {}) => {
    const pathName = String(url); requests.push({pathName,method:options.method || 'GET'});
    let data = {};
    if (pathName === 'demo.json') data = JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8'));
    else if (pathName.includes('/api/market/sources')) data = {sources:[]};
    else if (pathName.includes('/api/market/benchmarks')) data = {observations:[]};
    else if (pathName.endsWith('/recalculate')) data = {snapshot:{results:{metrics:{tam:{value:null,status:'unavailable'},sam:{value:null,status:'unavailable'},som:{value:null,status:'unavailable'}}}}};
    else if (options.method === 'PUT' && pathName.includes('/api/market/assessments/')) { savedSnapshot = JSON.parse(options.body).snapshot; data = {version:1}; }
    else if (pathName.includes('/api/market/assessments?')) data = {assessments:savedSnapshot ? [{id:'11111111-1111-4111-8111-111111111111',version:2,snapshot:savedSnapshot}] : []};
    return {ok:true,status:200,json:async()=>data};
  };
  for (const file of ['engine.js','bot.js','persistence.js','market-map.js','market-intelligence.js','app.js']) w.eval(fs.readFileSync(path.join(root,'dist',file),'utf8'));
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  w.dispatchEvent(new w.CustomEvent('franchiseos:location-selected',{detail:{id:'ka',name:'Karnataka',level:'state',state:'Karnataka',sourceVersion:'geo-v1',metrics:{population:{value:61130704}},evidence:[]}}));
  const form = w.document.querySelector('#market-form'); form.elements.storeFormat.value='Value fashion';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(savedSnapshot.location.state,'Karnataka');
  assert.equal(savedSnapshot.storeFormat,'Value fashion');
  assert.ok(requests.some(item => item.pathName.endsWith('/recalculate')));
  assert.equal(w.document.querySelector('[data-mi-results]').hidden,false);
  assert.match(w.document.querySelector('[data-mi-results]').textContent,/Store catchment TAM/);
});

test('saved assessment selection restores its location and deterministic results', async t => {
  const dom = new JSDOM(html,{url:'http://localhost/#market',runScripts:'outside-only'}); t.after(()=>dom.window.close()); const w=dom.window;
  const assessments=['Bengaluru','Mysuru'].map((city,index)=>({id:`saved-${index}`,version:3,snapshot:{name:`${city} review`,location:{country:'India',state:'Karnataka',city},inputs:{demand:{},segmentation:{},economics:{}},results:{metrics:{tam:{value:index?500:100,unit:'INR/year'}}}}}));
  w.fetch=async url=>({ok:true,status:200,json:async()=>{
    const p=String(url); if(p==='demo.json')return JSON.parse(fs.readFileSync(path.join(root,'dist/demo.json'),'utf8'));
    if(p.includes('/api/market/sources'))return {sources:[]};if(p.includes('/api/market/benchmarks'))return {observations:[]};
    if(p.includes('/api/market/assessments'))return {assessments};return {};
  }});
  for(const file of ['engine.js','bot.js','persistence.js','market-map.js','market-intelligence.js','app.js'])w.eval(fs.readFileSync(path.join(root,'dist',file),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  w.document.querySelector('[data-mi-saved="saved-1"]').click();
  assert.equal(w.document.querySelector('#market-form [name="city"]').value,'Mysuru');
  assert.equal(w.document.querySelector('[data-mi-results]').hidden,false);
  assert.match(w.document.querySelector('[data-mi-results]').textContent,/₹500/);
});
