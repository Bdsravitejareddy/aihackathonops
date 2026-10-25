'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const api = require('../dist/territory-screening.js');

function harness(options = {}) {
  const dom = new JSDOM('<main id="screen"></main>', { url: 'http://localhost/' });
  const root = dom.window.document.querySelector('#screen');
  const events = [];
  const opened = [];
  const controller = api.mount({ root, ...options, onOpenApplicant: (value, context) => { events.push(value); opened.push(context); }, onLocationChange: value => events.push(value) });
  return { dom, root, controller, events, opened };
}

test('renders supplied market evidence and explicit missing values without deriving unsupported figures', t => {
  const h = harness({ location: { id:'pin:560001', name:'Bengaluru · 560001', level:'pin', pin:'560001' }, marketContext: {
    metrics: { population:{value:12000,evidenceClass:'modeled_estimate',referenceYear:2011}, monthlyPerCapitaSpend:{value:340,evidenceClass:'survey_estimate',referenceYear:2024}, tam:{value:48960000,evidenceClass:'derived_estimate'}, som:null },
    spend: { rural:{value:240,referenceYear:2024}, urban:{value:340,referenceYear:2024}, incomeAdjustment:{formula:'regional spend × (local proxy / regional proxy)^1',evidenceClass:'modelled_estimate'} },
    footfall: { status:'scenario', low:1000, base:1800, high:2600, unit:'visits/month' },
    evidence:[{title:'HCES',url:'https://example.org/hces',referenceYear:2024}]
  } });
  t.after(() => h.dom.window.close());
  assert.match(h.root.textContent, /₹4,89,60,000/);
  assert.match(h.root.textContent, /modelled estimate/i);
  assert.match(h.root.textContent, /Unavailable/);
  assert.match(h.root.textContent, /scenario/i);
  assert.match(h.root.textContent, /HCES/);
  h.root.querySelector('.ts-details summary').click();
  assert.match(h.root.textContent,/local proxy \/ regional proxy/);
  assert.doesNotMatch(h.root.textContent, /₹48,96,000/);
});

test('ranks applicants by confirmed score then supplied tie-break fields and ID', t => {
  const h = harness({ location:{pin:'560001'}, applicants:[
    {id:'B',pin:'560001',confirmedEligibilityScore:80,launchMonths:4,status:'Eligible'},
    {id:'C',pin:'560001',confirmedEligibilityScore:80,launchMonths:3,status:'Clarification needed'},
    {id:'A',pin:'560001',confirmedEligibilityScore:80,launchMonths:3,status:'Eligible'},
    {id:'D',pin:'560001',confirmedEligibilityScore:92,status:'Recommended'}
  ], tieBreakFields:[{key:'launchMonths',direction:'asc'}] });
  t.after(() => h.dom.window.close());
  const ids = [...h.root.querySelectorAll('[data-applicant-id]')].map(row => row.dataset.applicantId);
  assert.deepEqual(ids, ['D','A','C','B']);
});

test('preserves incomplete score ranges and marks verification, allocation and funding without approval language', t => {
  const h = harness({ location:{pin:'560001'}, marketContext:{ investment:{minimum:1000000,recommended:1500000,maximum:2000000} }, applicants:[
    {id:'INCOMPLETE',pin:'560001',name:'Incomplete',confirmedEligibilityScore:52,possibleEligibilityScore:87,scoreRange:{low:52,high:87},status:'Clarification needed',verificationStatus:'Pending',allocationStatus:'Unassigned',declaredInvestment:800000,verifiedFunds:600000,conditionalLoan:200000,blockingConditions:['Verify funds']}
  ] });
  t.after(() => h.dom.window.close());
  assert.match(h.root.textContent, /52–87/);
  assert.match(h.root.textContent, /Pending/);
  assert.match(h.root.textContent, /Unassigned/);
  assert.match(h.root.textContent, /funding gap/i);
  assert.match(h.root.textContent, /₹7,00,000/);
  assert.match(h.root.textContent, /not an approval/i);
  assert.equal(h.root.querySelector('[data-applicant-id]').dataset.applicantId, 'INCOMPLETE');
});

test('Actionable filter excludes blocked applicants and callback opens selected record', t => {
  const h = harness({ location:{pin:'560001'}, applicants:[
    {id:'A1',pin:'560001',confirmedEligibilityScore:90,status:'Eligible'},
    {id:'A2',pin:'560001',confirmedEligibilityScore:88,status:'Clarification needed',blockingConditions:['Missing documents']}
  ] });
  t.after(() => h.dom.window.close());
  h.root.querySelector('[data-filter="actionable"]').click();
  assert.deepEqual([...h.root.querySelectorAll('[data-applicant-id]')].map(row => row.dataset.applicantId), ['A1']);
  h.root.querySelector('[data-open-applicant="A1"]').click();
  assert.equal(h.events[0].id, 'A1');
  assert.equal(h.opened[0].location.pin,'560001');
  assert.equal(h.opened[0].marketContext,null);
});

test('PIN form validates six digits and shared location event updates the screen', t => {
  const h = harness(); t.after(() => h.dom.window.close());
  const input = h.root.querySelector('[name="pin"]'); input.value='123';
  h.root.querySelector('[data-pin-form]').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(h.root.textContent, /six-digit/i);
  h.dom.window.dispatchEvent(new h.dom.window.CustomEvent('franchiseos:location-selected',{detail:{id:'pin:560001',name:'Bengaluru 560001',level:'pin',pin:'560001'}}));
  assert.match(h.root.textContent, /Bengaluru 560001/);
  assert.equal(h.root.querySelector('[name="pin"]').value, '560001');
  let broadcast; h.dom.window.addEventListener('franchiseos:location-selected',event=>broadcast=event.detail);
  input.value='570001'; h.root.querySelector('[data-pin-form]').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(broadcast.pin,'570001');
});

test('uploaded State to City to PIN selectors cascade to a sourced workspace territory', t => {
  const h=harness({territories:[
    {id:'blr',state:'Karnataka',city:'Bengaluru',pins:['560001','560002']},
    {id:'mys',state:'Karnataka',city:'Mysuru',pins:['570001']},
    {id:'mh',state:'Maharashtra',city:'Pune',pins:['411001']}
  ]});t.after(()=>h.dom.window.close());
  const state=h.root.querySelector('[data-cascade-state]');assert.ok(state);
  state.value='Karnataka';state.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
  assert.deepEqual([...h.root.querySelectorAll('[data-cascade-city] option')].map(option=>option.value).filter(Boolean),['Bengaluru','Mysuru']);
  h.root.querySelector('[data-cascade-city]').value='Mysuru';h.root.querySelector('[data-cascade-city]').dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
  h.root.querySelector('[data-cascade-pin]').value='570001';h.root.querySelector('[data-cascade-pin]').dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
  assert.equal(h.events.at(-1).pin,'570001');assert.equal(h.events.at(-1).city,'Mysuru');assert.equal(h.events.at(-1).state,'Karnataka');
  assert.equal(h.root.querySelector('[data-market]').textContent.includes('unavailable'),true,'workspace territory selection does not imply demographic coverage');
});

test('existing-store restriction and funding compatibility are informational only', t => {
  const h = harness({ location:{pin:'560001'}, marketContext:{existingStore:{present:true,description:'Brand store on this PIN'},investment:{recommended:1000000}}, applicants:[
    {id:'A1',pin:'560001',confirmedEligibilityScore:90,status:'Recommended',declaredInvestment:1200000}
  ] });
  t.after(() => h.dom.window.close());
  assert.match(h.root.textContent, /existing franchise store/i);
  assert.match(h.root.textContent, /Recommended status is not final approval/i);
  assert.match(h.root.textContent, /above the supplied recommended investment/i);
});

test('does not rank applicants without an explicit matching PIN', t => {
  const h = harness({ location:{pin:'560001'}, applicants:[{id:'LINKED',pin:'560001',confirmedEligibilityScore:70},{id:'UNLINKED',confirmedEligibilityScore:99}] });
  t.after(() => h.dom.window.close());
  assert.deepEqual([...h.root.querySelectorAll('[data-applicant-id]')].map(row => row.dataset.applicantId), ['LINKED']);
});

test('existing franchise store leaves applicants ranked but blocks actionable allocation', t => {
  const h = harness({ location:{pin:'560001'}, marketContext:{existingStore:true}, applicants:[{id:'A',pin:'560001',confirmedEligibilityScore:90,status:'Eligible'}] });
  t.after(() => h.dom.window.close());
  assert.equal(h.root.querySelectorAll('[data-applicant-id]').length,1);
  h.root.querySelector('[data-filter="actionable"]').click();
  assert.equal(h.root.querySelectorAll('[data-applicant-id]').length,0);
  assert.match(h.root.textContent,/no new applicant is actionable/i);
});

test('changing PIN clears prior market context until matching evidence is supplied', t => {
  const h = harness({ location:{pin:'560001'}, marketContext:{metrics:{tam:{value:100000,evidenceClass:'derived_estimate'}}} });
  t.after(() => h.dom.window.close());
  assert.match(h.root.textContent,/1,00,000/);
  h.controller.updateLocation({pin:'570001',name:'Mysuru'});
  assert.doesNotMatch(h.root.textContent,/1,00,000/);
  assert.match(h.root.textContent,/unavailable/i);
  h.controller.updateMarketContext({metrics:{tam:{value:200000,evidenceClass:'derived_estimate'}}});
  assert.match(h.root.textContent,/2,00,000/);
});

test('illustrative financial scenario sends editable assumptions to the deterministic forecast and shows three cases', async t => {
  let submitted;
  const h = harness({location:{pin:'560026'},onRunScenario:async payload=>{
    submitted=payload;
    return {modelVersion:'india-fashion-market-v1',economics:{footfall:{passingPedestrianTraffic:{value:30000}},economics:{breakEvenRevenueMonthly:200000,breakEvenTransactionsMonthly:200},scenarios:{
      conservative:{years:[{nominalRevenue:1200000}],months:Array.from({length:12},(_,i)=>({month:i+1,revenue:100000,grossProfit:50000,royalty:5000,operatingCashFlow:10000})),totalOperatingCashFlow:100000,roiPercent:-50,paybackMonths:null,npv:-500000,irrAnnual:null},
      base:{years:[{nominalRevenue:1800000}],months:Array.from({length:12},(_,i)=>({month:i+1,revenue:150000,grossProfit:75000,royalty:7500,operatingCashFlow:25000})),totalOperatingCashFlow:300000,roiPercent:0,paybackMonths:60,npv:10000,irrAnnual:4},
      optimistic:{years:[{nominalRevenue:2400000}],months:Array.from({length:12},(_,i)=>({month:i+1,revenue:200000,grossProfit:100000,royalty:10000,operatingCashFlow:50000})),totalOperatingCashFlow:700000,roiPercent:100,paybackMonths:24,npv:500000,irrAnnual:24}
    }}};
  }});
  t.after(() => h.dom.window.close());
  assert.match(h.root.textContent,/editable demo assumptions/i);
  assert.match(h.root.textContent,/not observed PIN footfall/i);
  const form=h.root.querySelector('[data-financial-scenario]');
  form.elements.monthlyFixedCosts.value='120000';
  form.dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(submitted.store.monthlyFixedCosts,120000);
  assert.equal(submitted.store.trafficEvidenceClass,'model_assumption');
  assert.equal(submitted.forecast.years,5);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/Conservative/);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/₹18,00,000/);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/₹2,00,000/);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/Operating costs · year 1/);
  const breakEvenCells=[...h.root.querySelectorAll('[data-financial-results] tr')].find(row=>row.querySelector('th')?.textContent==='Break-even sales · monthly').querySelectorAll('td');
  assert.equal(breakEvenCells.length,3);
  assert.deepEqual([...breakEvenCells].map(cell=>cell.textContent),['₹2,00,000','₹2,00,000','₹2,00,000']);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/assumes 30,000 passing pedestrians\/month/);
  assert.match(h.root.querySelector('[data-financial-results]').textContent,/cash flow excludes taxes, debt service, depreciation, lease accounting and terminal value/i);
});
