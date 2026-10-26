const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js'),Bot=require('../dist/bot.js');
const raws=[{id:'APP-101',name:'Asha Test',city:'Mysuru',state:'Karnataka',pin:'570101',investment:30,experience:4,business:'Runs a shop',space:'Owned',area:500,floor:'Ground',launch:3,language:'English'},{id:'APP-102',name:'Bala Test',city:'Mysuru',state:'Karnataka',pin:'570101',investment:null,experience:0,business:'No previous business',space:'Rented',area:400,floor:'Ground',launch:4,language:null}];
const make=()=>{let apps=raws.map((r,i)=>E.normalize(r,'qa-'+i));return {apps,territories:[{id:'T1',city:'Mysuru',state:'Karnataka',pins:['570101'],slots:1}],reference:{all:{investment:[10,20,30,40,50],area:[200,300,400,500,600],experience:[0,2,4,6,8],launch:[1,2,3,4,5]},tiers:{}},settings:{minInvestment:'',minArea:'',minLaunch:''},tasks:{},taskDates:{},audit:[],warnings:[],source:'QA'};};
function ask(t,context){let s=make();let r=E.assess(s.apps,s.territories,[],s.reference,s.settings);return Bot.answer(t,{state:s,results:r,stores:[],contextKey:context});}
test('general score questions do not require an applicant ID',()=>{let r=ask('How are scores calculated?');assert.match(r.text,/60%/);assert.match(r.text,/30%/);assert.equal(r.proposal,undefined);});
test('portfolio summary is grounded in current counts',()=>assert.match(ask('Who should move forward?').text,/APP-101/));
test('missing facts generate applicant-specific clarification',()=>{let r=ask('What is missing for APP-102?');assert.match(r.text,/investment/i);assert.match(r.text,/language/i);assert.equal(r.contextKey,'qa-1');});
test('contextual follow-up works without repeating ID',()=>assert.match(ask('What should I ask them?', 'qa-1').text,/investment/i));
test('comparison covers both candidates and eligibility',()=>{let r=ask('Compare APP-101 and APP-102');assert.match(r.text,/APP-101/);assert.match(r.text,/APP-102/);assert.match(r.text,/Clarification needed/);});
test('what-if returns preview without a proposal or mutation',()=>{let s=make(),before=JSON.stringify(s),r=Bot.answer('What if APP-102 investment is 60 lakh?',{state:s,results:E.assess(s.apps,s.territories,[],s.reference,s.settings),stores:[]});assert.match(r.text,/Preview/);assert.equal(r.proposal,undefined);assert.equal(JSON.stringify(s),before);});
test('explicit multi-field update requires a confirmation proposal',()=>{let r=ask('APP-102 now has a rented ground-floor space of 650 sq ft');assert.equal(r.proposal.patch.area,650);assert.equal(r.proposal.patch.space,'Rented');assert.match(r.text,/confirm/i);});
test('negative update never proposes a positive value',()=>assert.equal(ask('APP-102 investment is -5 lakh').proposal,undefined));
test('unrecognised request does not invent an answer',()=>assert.match(ask('What is the current rent in Mysuru?').text,/cannot|do not|not available|don.t have/i));
test('simulations identify affected competing recommendations',()=>assert.match(ask('What if APP-102 investment is 100 lakh?').text,/APP-101|Other recommendations/));
test('space evidence conflicts are explicitly explained',()=>assert.match(ask('Why is APP-102 on hold?').text,/Missing.*Investment|investment/i));
test('no query mutates the original data',()=>{let s=make(),r=E.assess(s.apps,s.territories,[],s.reference,s.settings),b=JSON.stringify(s);for(let q of ['How are scores calculated?','Compare APP-101 and APP-102','Why is APP-102 on hold?'])Bot.answer(q,{state:s,results:r,stores:[]});assert.equal(JSON.stringify(s),b);});

test('where questions resolve deterministically to a safe registered navigation action',()=>{
 let r=ask('Where do I review applications?');
 assert.equal(r.navigation.type,'navigate');
 assert.equal(r.navigation.route,'applications');
 assert.equal(r.navigation.sectionId,'applications');
 assert.equal(r.navigation.label,'Applications');
 assert.equal(r.navigation.execute,false);
});
test('navigation registry documents context and caution metadata for sensitive routes',()=>{
 const applicant=Bot.routes.find(route=>route.id==='applications');
 const review=Bot.routes.find(route=>route.id==='review');
 assert.equal(applicant.context.applicant,'optional');
 assert.equal(review.permission,'review_only');
 assert.match(review.caution,/human/i);
 assert.ok(applicant.intents.includes('where'));
});
test('training completion is reported as unavailable as a standalone route',()=>{
 const r=ask('Where do I complete training?');
 assert.equal(r.navigation.type,'unavailable');
 assert.equal(r.navigation.route,null);
 assert.match(r.text,/no standalone.*training/i);
 assert.match(r.text,/Onboarding/i);
});
test('approval and deletion requests can only return navigation, never execute actions',()=>{
 for(const prompt of ['How do I approve an application?','Where can I delete an application?']){
  const r=ask(prompt);
  assert.equal(r.navigation.type,'navigate');
  assert.equal(r.navigation.execute,false);
  assert.match(r.navigation.caution,/cannot.*(approve|delete)|human/i);
 }
});
test('parent integration receives navigation only through the documented custom event',()=>{
 let received=null;
 const target={CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent(event){received=event;}};
 const action=Bot.resolveNavigation('Where are the territories?',{state:make()});
 assert.equal(Bot.emitNavigation(action,target),true);
 assert.equal(received.type,'franchiseos:navigate');
 assert.equal(received.detail.sectionId,'territories');
});
