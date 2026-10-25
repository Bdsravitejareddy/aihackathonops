(function(root){
'use strict';
const fields=['id','name','city','state','pin','investment','experience','business','space','area','floor','launch','language','notes'];
const numeric=['investment','experience','area','launch'];
const cities={'Bengaluru':['560','Tier 1'],'Mysuru':['570','Tier 2'],'Mangaluru':['575','Tier 2'],'Hubballi-Dharwad':['580','Tier 2'],'Belagavi':['590','Tier 2'],'Tumakuru':['572','Tier 3'],'Davanagere':['577','Tier 3']};
const labels={id:'Application ID',name:'Applicant name',city:'City',state:'State',pin:'Pin code',investment:'Investment capacity (₹ lakh)',experience:'Retail experience (years)',business:'Current / past business',space:'Space available',area:'Space size (sq ft)',floor:'Floor',launch:'Target launch (months)',language:'Preferred language',notes:'Notes from applicant'};
function parseNumber(field,input){
 if(input===null||input===undefined||String(input).trim()==='')return {value:null,proposed:null,reason:'Missing value'};
 if(typeof input==='number')return Number.isFinite(input)&&input>=0?{value:input}:{value:null,proposed:null,reason:'Use a non-negative finite number'};
 let text=String(input).trim(),clean=text.replace(/,/g,'').trim();
 if(/^\d+(\.\d+)?$/.test(text)&&Number.isFinite(Number(text)))return {value:Number(text)};
 let m,proposed=null,reason='Confirm the value and its units';
 if(field==='investment'){
  m=clean.match(/^(?:(₹|rs\.?|inr)\s*)?(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|crores?|cr|rupees?|inr|rs\.?)?$/i);
  if(m){let n=Number(m[2]),unit=(m[3]||'').toLowerCase();proposed=/^(crore|cr)/.test(unit)?n*100:/^(lakh|lac|l$)/.test(unit)?n:m[1]||/^(rupee|inr|rs)/.test(unit)?n/100000:n;reason='Confirm amount in lakh';}
 }else{const units={area:'sq\\.?\\s*ft\\.?|sqft|square feet',experience:'years?|yrs?',launch:'months?|mos?'};m=clean.match(new RegExp('^(\\d+(?:\\.\\d+)?)\\s*(?:'+units[field]+')?$','i'));if(m){proposed=Number(m[1]);reason='Confirm '+labels[field];}}
 if(!Number.isFinite(proposed)||proposed<0)proposed=null;return {value:null,proposed,reason};
}
function normalize(raw,key){const r={key,raw:{...raw},pending:[],...Object.fromEntries(fields.map(f=>[f,null]))};
for(const f of fields){let v=raw[f];if(v===null||v===undefined||String(v).trim()==='')continue;
 if(numeric.includes(f)){let p=parseNumber(f,v);r[f]=p.value;if(p.value===null)r.pending.push({field:f,raw:v,proposed:p.proposed,reason:p.reason});}
 else{let v2=String(v).trim();if(f==='pin'&&/^\d{6}(\.0)?$/.test(v2))v2=String(Number(v2));r[f]=v2;}}
return r;}
function percentile(v,values){let a=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!Number.isFinite(v)||a.length<5||new Set(a).size<2)return null;
 let groups=[];for(let i=0;i<a.length;){let j=i;while(j+1<a.length&&a[j+1]===a[i])j++;groups.push({value:a[i],rank:(i+j)/2/(a.length-1)});i=j+1;}
 let equal=groups.find(g=>g.value===v);if(equal)return equal.rank;if(v<groups[0].value)return 0;if(v>groups.at(-1).value)return 1;
 for(let i=1;i<groups.length;i++)if(v<groups[i].value){let l=groups[i-1],h=groups[i];return l.rank+(v-l.value)/(h.value-l.value)*(h.rank-l.rank);}return 1;
}
function band(p){return p===null?null:p>=.9?3:p>=.5?2:p>=.3?1:0;}
function benchmarks(apps){let counts=Object.create(null);for(let a of apps){let id=String(a.id||'').trim().toUpperCase();counts[id]=(counts[id]||0)+1;}apps=apps.filter(a=>a.id&&counts[String(a.id).trim().toUpperCase()]===1&&cities[a.city]);let all={},tiers={};for(let f of numeric)all[f]=apps.map(a=>a[f]).filter(Number.isFinite);for(let tier of ['Tier 1','Tier 2','Tier 3']){tiers[tier]={};for(let f of numeric)tiers[tier][f]=apps.filter(a=>cities[a.city]?.[1]===tier).map(a=>a[f]).filter(Number.isFinite);}return {all,tiers};}
function businessPoints(s){if(!s)return null;
if(/^(?:no|none|na|n\/a|nil|not applicable)\b|\bno (?:previous |prior )?business\b|\bnever (?:owned|run)\b|first.time entrepreneur|only (?:an? )?employee|\b(?:do not|don't|never)\s+(?:own|run|operate)(?:\s+\w+){0,3}\s+(?:business|shop|store)\b/i.test(s))return 0;
if(/\b(?:father|mother|brother|sister|spouse|family|friend)\b/i.test(s)&&! /\bI (?:own|run|operate|founded)|\bmy (?:own |previous |past )?(?:business|shop|store)\b/i.test(s))return null;
return /\b(?:runs?|ran|owns?|owned|founded|operat(?:es?|ed|ing))\b.{0,45}\b(?:shop|store|business|retail|outlet|restaurant|cafe|agency|company|firm|enterprise)\b|\bbusiness owner|\bproprietor|\bself.employed/i.test(s)?1:null;}
function territoryCapacity(territories,stores=[]){let occupied=new Set(stores.map(s=>String(s.pin))),byTerritory={};let total=0;for(let t of territories){let valid=Array.isArray(t.pins)&&!t.issues?.length&&t.city in cities&&t.state==='Karnataka'&&Number.isInteger(t.slots)&&t.slots>=0&&territories.filter(x=>x.id===t.id).length===1;let pins=valid?[...new Set(t.pins)].filter(p=>/^\d{6}$/.test(p)&&p.startsWith(cities[t.city][0])&&!occupied.has(p)&&territories.filter(x=>x.pins?.includes(p)).length===1):[];let available=valid?Math.min(t.slots,pins.length):0;Object.defineProperty(byTerritory,t.id,{value:available,enumerable:true,configurable:true});total+=available;}return {total,byTerritory};}
function policyErrors(p){let errors=[];for(let f of ['minInvestment','minArea','minLaunch','targetLaunch'])if(!(Number(p[f])>0)||!Number.isFinite(Number(p[f])))errors.push(labels[f]||f);if(Number(p.targetLaunch)<Number(p.minLaunch))errors.push('Target latest launch must be at least the minimum feasible launch.');return errors;}
const defaultPolicy={model:'industry-v2',minInvestment:30,minArea:400,minLaunch:3,targetLaunch:6};
function assess(apps,territories,stores,reference,settings={}){let v2=settings.model==='industry-v2';let idCounts=Object.create(null);apps.forEach(a=>{let id=String(a.id||'').trim().toUpperCase();idCounts[id]=(idCounts[id]||0)+1;});let out=apps.map(a=>{let reasons=[],missing=[],components=[],tier=cities[a.city]?.[1],pending=a.pending||[];
const comp=(key,points,max,weight,detail)=>{components.push({key,label:labels[key]||key,points,max,weight,contribution:points===null?0:points/max*weight,detail});};
if(v2){
 let budget=Number(settings.minInvestment),areaMin=Number(settings.minArea),minTime=Number(settings.minLaunch),target=Number(settings.targetLaunch);
 comp('investment',Number.isFinite(a.investment)&&budget>0?Math.min(a.investment/budget,1):null,1,35,`Declared funds / illustrative requirement ₹${budget||'?'} lakh, capped at 100%; funds not verified`);
 comp('space',a.space==='Owned'||a.space==='Rented'?1:a.space==='Not yet identified'?0:null,1,15,'Identified premises 15; owned and rented receive equal points; legal control still needs verification');
 comp('area',Number.isFinite(a.area)&&areaMin>0?Math.min(a.area/areaMin,1):null,1,15,`Area / configured minimum ${areaMin||'?'} sq ft, capped at 100%; bigger is not automatically better`);
 comp('experience',a.experience===null?null:a.experience===0?0:a.experience<1?1:a.experience<3?2:a.experience<5?3:4,4,20,'Proposed anchors: 0 years 0; under 1 year 5; 1–under 3 years 10; 3–under 5 years 15; 5+ years 20');
 comp('business',businessPoints(a.business),1,5,'Explicit prior operation or ownership 5; none 0; unclear remains unknown');
 comp('launch',Number.isFinite(a.launch)&&minTime>0&&target>=minTime?(a.launch<minTime?0:a.launch<=target?2:1):null,2,10,`Illustrative feasible window ${minTime||'?'}–${target||'?'} months: 10; later 5; too soon 0 and timeline review`);
}else{
for(let [f,w] of [['investment',22.5],['area',22.5],['experience',15],['launch',10]]){let local=reference?.tiers?.[tier]?.[f], vals=local?.length>=5&&new Set(local).size>=2?local:reference?.all?.[f]||reference?.[f]||[];let p=percentile(a[f],vals);let pts=band(p===null?null:f==='launch'?1-p:p);if(a[f]===0&&f!=='launch')pts=0;comp(f,pts,3,w,p===null?'Insufficient reference data or missing value':`${Math.round(p*100)}th percentile${f==='launch'?' · fewer months scores higher':''} · ${local===vals?tier:'whole upload'}`);}
comp('space',a.space==='Owned'?2:a.space==='Rented'?1:a.space==='Not yet identified'?0:null,2,15,'Owned 2 · rented 1 · no space 0');
comp('floor',a.floor==='Ground'?2:a.floor==='First'?1:a.floor==='Other confirmed'?0:null,2,10,'Ground 2 · confirmed first 1 · other confirmed 0');
comp('business',businessPoints(a.business),1,5,'Awarded for explicit evidence of running or owning a business');
}
let score=components.reduce((s,c)=>s+c.contribution,0),high=score+components.filter(c=>c.points===null).reduce((s,c)=>s+c.weight,0);
for(let f of ['id','name','city','state','pin','investment','experience','space'])if(a[f]===null||a[f]===undefined||a[f]==='')missing.push(labels[f]);
if(a.id&&idCounts[String(a.id).trim().toUpperCase()]>1)reasons.push('Duplicate application ID; resolve the identity before allocation.');
if(a.city&&!cities[a.city])reasons.push('City is outside the supported city list.');
if(a.state&&a.state!=='Karnataka')reasons.push('State must be Karnataka for these territories.');
if(a.pin&&(!/^\d{6}$/.test(a.pin)||(cities[a.city]&&!a.pin.startsWith(cities[a.city][0]))))reasons.push('Pin code does not match the selected city.');
if(a.space&&!['Owned','Rented','Not yet identified'].includes(a.space))reasons.push('Space ownership value needs clarification.');
if(a.language&&!['Kannada','English','Hindi'].includes(a.language))reasons.push('Confirm Kannada, English or Hindi for training.');
if(a.space!=='Not yet identified'&&/still (searching|looking)|not (yet )?(found|identified)|no (shop|space|premises)/i.test(a.notes||''))reasons.push('Space status conflicts with the notes. Confirm the premises and update the notes.');
if(a.floor==='Ground'&&/\b(?:shop|space|premises|unit)\b.{0,30}\b(?:first|upper|second)[ -]floor\b/i.test(a.notes||''))reasons.push('Floor conflicts with the site description in the notes. Confirm the actual floor.');
if(a.space==='Not yet identified'&&(a.area>0||['Ground','First'].includes(a.floor)))reasons.push('Site details are present although space is not yet identified.');
if(pending.length)reasons.push(`${pending.length} proposed data correction${pending.length>1?'s':''} awaiting confirmation.`);
if(missing.length)reasons.push('Missing: '+missing.join(', ')+'.');
const matches=territories.filter(t=>t.pins?.includes(a.pin));let t=matches.length===1?matches[0]:null,status='Eligible';
if(reasons.length)status='Clarification needed';
else if(stores.some(s=>String(s.pin)===a.pin)){status='Location unavailable';reasons.push('An existing store already occupies this pin code. Choose a different pin code.');}
else if(!t||matches.length>1){status='Territory review';reasons.push(matches.length>1?'Pin code appears in more than one territory. Resolve territory overlap.':'Pin code is not covered by an uploaded territory.');}
else if(t.issues?.length||t.city!==a.city||t.state!==a.state||!Number.isInteger(t.slots)||t.slots<0){status='Territory review';reasons.push('Territory details are incomplete, invalid or conflict with the application.');}
else if(v2&&(!(Number(settings.minInvestment)>0)||!(Number(settings.minArea)>0)||!(Number(settings.minLaunch)>0)||!(Number(settings.targetLaunch)>=Number(settings.minLaunch)))){status='Policy needed';reasons.push('Configure a positive investment requirement, area minimum and feasible launch window before allocating. These are brand assumptions, not universal standards.');}
else if(a.space==='Not yet identified'||!a.area||!['Ground','First','Other confirmed'].includes(a.floor)){status='Site needed';reasons.push('Confirm an identified site, positive usable area and actual floor.');}
else if((settings.minInvestment!==''&&settings.minInvestment!=null&&a.investment<Number(settings.minInvestment))||(settings.minArea!==''&&settings.minArea!=null&&a.area<Number(settings.minArea))){status='Requirements not met';reasons.push('Investment or area is below the configured brand minimum.');}
else if(settings.minLaunch!==''&&settings.minLaunch!=null&&(!Number.isFinite(a.launch)||a.launch<Number(settings.minLaunch))){status='Timeline review';reasons.push('Confirm a target launch that meets the configured minimum preparation time.');}
return {...a,tier,model:v2?'industry-v2':'legacy',grade:v2?(components.some(c=>c.points===null)?'U':score>=80?'A':score>=65?'B':score>=50?'C':'D'):null,territory:t?.id||null,components,score:+score.toFixed(1),high:+high.toFixed(1),status,reasons,missing};});
let usedPins=new Set(stores.map(s=>String(s.pin))),counts=Object.create(null);let candidates=out.filter(a=>a.status==='Eligible').sort((a,b)=>b.score-a.score||(Number.isFinite(a.launch)?a.launch:Infinity)-(Number.isFinite(b.launch)?b.launch:Infinity)||String(a.id).localeCompare(String(b.id))||a.key.localeCompare(b.key));
for(let a of candidates){let t=territories.find(t=>t.id===a.territory);if(usedPins.has(a.pin)){a.status='Waitlisted';a.reasons.push('A higher-ranked or tie-break-winning candidate is recommended for this pin code.');}else if((counts[t.id]||0)>=t.slots){a.status='Waitlisted';a.reasons.push('All available slots in this territory have provisional recommendations.');}else{a.status='Recommended';usedPins.add(a.pin);counts[t.id]=(counts[t.id]||0)+1;a.reasons.push('Screening requirements are satisfied and the partner ranks within available territory capacity. Declared funds and premises still require verification; this is not final approval.');}}
return out;}
function parseUpdate(text,apps){
 let t=String(text).trim(),lower=t.toLowerCase();
 const mentioned=apps.filter(a=>a.id&&new RegExp('(^|[^a-z0-9_-])'+String(a.id).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^a-z0-9_-])','i').test(t));
 let ids=[...new Set(mentioned.map(a=>a.id.toUpperCase()))];if(ids.length!==1||mentioned.length!==1)return {error:ids.length>1?'Please update one applicant at a time, or ask me to compare them.':mentioned.length?'Resolve duplicate application IDs first.':'Include a unique application ID, for example APP-012.'};
 let a=mentioned[0],hypothetical=/\bwhat if\b|\bsuppose\b|\bhypothetical\b/i.test(t),patch={};
 if(!hypothetical&&(/^(?:why|explain|what|how|is|does|can|which|who|where|when)\b/i.test(t)||/\?$/.test(t)))return {explain:true,key:a.key};
 let body=t.replace(new RegExp(String(a.id).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'').trim();
 if((body.match(/\b(?:investment(?:\s+capacity)?|budget|capacity|invest)\b/gi)||[]).length>1||(body.match(/\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|crores?|rupees?)\b/gi)||[]).length>1)return {error:'More than one investment amount was mentioned. Confirm one current usable amount.'};
 if(/(?:^|\s)[−-]\s*\d|\d\s*(?:[-–—]|to)\s*\d|\b(?:about|around|approximately|maybe|roughly|or|possibly|not|isn't|isnt|doesn't|don't|no longer)\b/i.test(body))return {error:'This statement is negative, approximate or ambiguous. Please give one confirmed non-negative value for each field. I have not changed anything.'};
 if(/\bground[ -]floor\b/i.test(body))patch.floor='Ground';if(/\bfirst[ -]floor\b/i.test(body)){if(patch.floor)return {error:'Two floors were mentioned. Confirm the actual floor.'};patch.floor='First';}
 if(/\b(?:upper|second|third)[ -]floor\b/i.test(body))return {error:'Please confirm the actual floor in Edit application. Upper does not necessarily mean first floor.'};
 if(/\b(?:owned|owns|own)\b/i.test(body))patch.space='Owned';if(/\b(?:rented|renting|leased)\b/i.test(body)){if(patch.space)return {error:'Both ownership and rental were mentioned. Which applies to this site?'};patch.space='Rented';}
 let inv=body.match(/\b(?:investment|invest|capacity|budget)\b(?:\s+(?:capacity|is|to|of|now|has|can|increased|available))*\s*[:=]?\s*((?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|lacs?|l\b|crores?|cr\b|rupees?|inr|rs\.?)?)/i);
 if(inv&&/^\s*(?:sq\.?\s*ft|sqft|square feet|months?|years?)\b/i.test(body.slice(inv.index+inv[0].length)))return {error:'That unit does not describe investment. Confirm the investment in lakh or rupees.'};
 if(inv){let p=parseNumber('investment',inv[1]);patch.investment=p.value??p.proposed;if(patch.investment===null)return {error:'Confirm the investment amount and units, for example 25 lakh or ₹25,00,000.'};}
 let areaValues=[...body.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square feet)\b/gi)];if(areaValues.length>1)return {error:'More than one area was mentioned. Confirm one usable site area.'};if(areaValues[0])patch.area=Number(areaValues[0][1].replace(/,/g,''));
 let launchValue=body.match(/\b(?:launch|open|opening)(?:\s+(?:is|in|to|now|target|time|of))*\s*[:=]?\s*(\d+(?:\.\d+)?)\s*months?\b/i);if(launchValue)patch.launch=Number(launchValue[1]);else if(!/\b(?:lease|loan|term|rent|agreement|tenure)\b/i.test(body)&&!(/\b(?:launch|open|opening)\b/i.test(body))){let vals=[...body.matchAll(/(\d+(?:\.\d+)?)\s*months?\b/gi)];if(vals.length===1)patch.launch=Number(vals[0][1]);}
 let experienceValue=body.match(/\bexperience(?:\s+(?:is|of|now|to|has))*\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i)||body.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s+(?:of\s+)?(?:retail\s+)?experience\b/i);if(experienceValue)patch.experience=Number(experienceValue[1]);else if(!/\b(?:lease|loan|term|rent|agreement|tenure|experience)\b/i.test(body)){let vals=[...body.matchAll(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/gi)];if(vals.length===1)patch.experience=Number(vals[0][1]);}

 let area=body.match(/\barea\s*(?:(?:is|to|of|now)\s*)?[:=]?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(sq\.?\s*ft\.?|sqft|square feet))?\s*(?=$|[,.!?])/i);if(area&&!('area'in patch))patch.area=Number(area[1].replace(/,/g,''));
 if(/\b(?:launch|open|opening)\b/i.test(body)&&!('launch'in patch))return {error:'Confirm launch time in months.'};
 if(/\bexperience\b/i.test(body)&&!('experience'in patch))return {error:'Confirm experience in years.'};
 if(/\barea\b/i.test(body)&&!('area'in patch))return {error:'Confirm the area in square feet; no part of this update has been applied.'};
 let pin=body.match(/\bpin(?:\s+code)?\s*(?:(?:is|to|now)\s*)?[:=]?\s*(\d{6})\b/i);if(pin)patch.pin=pin[1];
 for(let lang of ['English','Kannada','Hindi'])if(new RegExp('\\b'+lang+'\\b','i').test(body))patch.language=lang;
 if(!Object.keys(patch).length)return {error:'Please give a specific confirmed update, such as investment is 25 lakh, area is 500 sq ft, launch in 3 months, experience is 4 years, rented, ground floor, pin code or training language. I have not changed anything.'};
 if(/\b(?:investment|budget|capacity|invest)\b/i.test(body)&&!('investment'in patch))return {error:'The investment amount is unclear. Please give a number with lakh or rupee units.'};
 if(/\b(?:sq metres?|square met(?:er|re)s?|sqm)\b/i.test(body))return {error:'Please give the confirmed area in square feet. I have not converted or applied this update.'};
 const entries=Object.entries(patch);return {key:a.key,id:a.id,patch,hypothetical,...(entries.length===1?{field:entries[0][0],value:entries[0][1]}:{})};
}
function invalidateTasks(tasks,patch){let start=7;if(['id','name','investment'].some(k=>k in patch))start=0;else if(['city','state','pin','space','area','floor','launch','notes'].some(k=>k in patch))start=1;else if(['language','experience','business'].some(k=>k in patch))start=5;let next={...tasks};for(let i=start;i<7;i++)next[i]=false;return next;}
function validState(s){try{
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x), str=x=>typeof x==='string', num=x=>Number.isFinite(x)&&x>=0;
if(s.messages!==undefined&&(!Array.isArray(s.messages)||s.messages.length>100||s.messages.some(m=>!obj(m)||!str(m.text)||(m.user!==undefined&&typeof m.user!=='boolean'))))return false;
if(s.botContext!==undefined&&s.botContext!==null&&!str(s.botContext))return false;
if(!obj(s)||!str(s.source)||!Array.isArray(s.apps)||s.apps.length>20000||!Array.isArray(s.territories)||!obj(s.reference)||!obj(s.settings)||!obj(s.tasks)||!obj(s.taskDates)||!Array.isArray(s.audit)||!Array.isArray(s.warnings)||!s.warnings.every(str))return false;
let keys=new Set();for(let a of s.apps){if(!obj(a)||!str(a.key)||!/^[-a-zA-Z0-9_]+$/.test(a.key)||['__proto__','constructor','prototype'].includes(a.key)||keys.has(a.key)||!obj(a.raw)||!Array.isArray(a.pending))return false;keys.add(a.key);for(let f of fields)if(a[f]!==null&&a[f]!==undefined&&!(numeric.includes(f)?num(a[f]):str(a[f])))return false;for(let p of a.pending)if(!obj(p)||!numeric.includes(p.field)||!(p.proposed===null||num(p.proposed))||!(str(p.raw)||Number.isFinite(p.raw)))return false;}
for(let t of s.territories){if(!obj(t)||!str(t.id)||!str(t.city)||!str(t.state)||!Array.isArray(t.pins)||!t.pins.every(str)||!(t.slots===null||Number.isFinite(t.slots))||(t.issues!==undefined&&(!Array.isArray(t.issues)||!t.issues.every(str))))return false;}
if(!obj(s.reference.all)||!obj(s.reference.tiers))return false;for(let group of [s.reference.all,...Object.values(s.reference.tiers)]){if(!obj(group))return false;for(let f of numeric)if(!Array.isArray(group[f])||!group[f].every(num))return false;}
for(let [k,v] of Object.entries(s.settings))if(k!=='model'&&(v!==''&&!(typeof v==='number'?num(v):str(v)&&/^\d+(\.\d+)?$/.test(v))))return false;
for(let [key,task] of Object.entries(s.tasks)){if(!keys.has(key)||!obj(task)||Object.entries(task).some(([k,v])=>!/^([0-6])$/.test(k)||typeof v!=='boolean'))return false;}
for(let [key,dates] of Object.entries(s.taskDates)){if(!keys.has(key)||!obj(dates)||Object.entries(dates).some(([k,v])=>!/^([0-6])$/.test(k)||!str(v)||!/^$|^\d{4}-\d{2}-\d{2}$/.test(v)))return false;}
if(s.audit.some(a=>!obj(a)||!str(a.text)||!str(a.at)||!Number.isFinite(Date.parse(a.at))))return false;return true;
}catch(e){return false;}}
const api={territoryCapacity,policyErrors,defaultPolicy,parseNumber,invalidateTasks,validState,fields,numeric,cities,labels,normalize,percentile,band,benchmarks,assess,parseUpdate,businessPoints};if(typeof module!=='undefined')module.exports=api;root.Engine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
