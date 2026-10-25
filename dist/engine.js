(function(root){
'use strict';
const fields=['id','name','city','state','pin','investment','experience','business','space','area','floor','launch','language','notes'];
const numeric=['investment','experience','area','launch'];
const cities={'Bengaluru':['560','Tier 1'],'Mysuru':['570','Tier 2'],'Mangaluru':['575','Tier 2'],'Hubballi-Dharwad':['580','Tier 2'],'Belagavi':['590','Tier 2'],'Tumakuru':['572','Tier 3'],'Davanagere':['577','Tier 3']};
const labels={id:'Application ID',name:'Applicant name',city:'City',state:'State',pin:'Pin code',investment:'Investment capacity (₹ lakh)',experience:'Retail experience (years)',business:'Current / past business',space:'Space available',area:'Space size (sq ft)',floor:'Floor',launch:'Target launch (months)',language:'Preferred language',notes:'Notes from applicant'};
function normalize(raw,key){const r={key,raw:{...raw},pending:[],...Object.fromEntries(fields.map(f=>[f,null]))};
for(const f of fields){let v=raw[f];if(v===null||v===undefined||String(v).trim()==='')continue;
 if(numeric.includes(f)){if(typeof v==='number'&&Number.isFinite(v)&&v>=0){r[f]=v;continue;}let s=String(v).trim();if(/^\d+(\.\d+)?$/.test(s)){r[f]=Number(s);continue;}let m=s.replace(/,/g,'').match(/^(?:₹|rs\.?\s*)?\s*(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l|sq\.?\s*ft\.?|sqft|square feet|years?|yrs?|months?|mos?)?$/i);if(m)r.pending.push({field:f,raw:v,proposed:Number(m[1])});else r.pending.push({field:f,raw:v,proposed:null});
 }else{let s=String(v).trim();if(f==='pin'&&/^\d{6}(\.0)?$/.test(s))s=String(Number(s));r[f]=s;}}
return r;}
function percentile(v,values){let a=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!Number.isFinite(v)||a.length<5||new Set(a).size<2)return null;let lo=a.filter(x=>x<v).length,eq=a.filter(x=>x===v).length;return Math.max(0,Math.min(1,(lo+Math.max(0,eq-1)/2)/(a.length-1)));}
function band(p){return p===null?null:p>=.9?3:p>=.5?2:p>=.3?1:0;}
function benchmarks(apps){let all={},tiers={};for(let f of numeric)all[f]=apps.map(a=>a[f]).filter(Number.isFinite);for(let tier of ['Tier 1','Tier 2','Tier 3']){tiers[tier]={};for(let f of numeric)tiers[tier][f]=apps.filter(a=>cities[a.city]?.[1]===tier).map(a=>a[f]).filter(Number.isFinite);}return {all,tiers};}
function businessPoints(s){if(!s)return null;if(/^(no|none|na|n\/a|nil|not applicable)\b|no (previous |prior )?business|never (owned|run)|first.time entrepreneur|only (an? )?employee/i.test(s))return 0;return /\b(runs?|ran|owns?|owned|founded|operat(?:es?|ed|ing)|business owner|proprietor|self.employed)\b/i.test(s)?1:null;}
function assess(apps,territories,stores,reference,settings={}){let idCounts={};apps.forEach(a=>idCounts[a.id]=(idCounts[a.id]||0)+1);let out=apps.map(a=>{let reasons=[],missing=[],components=[],tier=cities[a.city]?.[1],pending=a.pending||[];
const comp=(key,points,max,weight,detail)=>{components.push({key,label:labels[key]||key,points,max,weight,contribution:points===null?0:points/max*weight,detail});};
for(let [f,w] of [['investment',22.5],['area',22.5],['experience',15],['launch',10]]){let local=reference?.tiers?.[tier]?.[f], vals=local?.length>=5&&new Set(local).size>=2?local:reference?.all?.[f]||reference?.[f]||[];let p=percentile(a[f],vals);let pts=band(p===null?null:f==='launch'?1-p:p);if(a[f]===0&&f!=='launch')pts=0;comp(f,pts,3,w,p===null?'Insufficient reference data or missing value':`${Math.round(p*100)}th percentile${f==='launch'?' · fewer months scores higher':''} · ${local===vals?tier:'whole upload'}`);}
comp('space',a.space==='Owned'?2:a.space==='Rented'?1:a.space==='Not yet identified'?0:null,2,15,'Owned 2 · rented 1 · no space 0');
comp('floor',a.floor==='Ground'?2:a.floor==='First'?1:a.floor==='Other confirmed'?0:null,2,10,'Ground 2 · confirmed first 1 · other confirmed 0');
comp('business',businessPoints(a.business),1,5,'Awarded for explicit evidence of running or owning a business');
let score=components.reduce((s,c)=>s+c.contribution,0),high=score+components.filter(c=>c.points===null).reduce((s,c)=>s+c.weight,0);
for(let f of ['id','name','city','state','pin','investment','experience','space'])if(a[f]===null||a[f]===undefined||a[f]==='')missing.push(labels[f]);
if(a.id&&idCounts[a.id]>1)reasons.push('Duplicate application ID; resolve the identity before allocation.');
if(a.city&&!cities[a.city])reasons.push('City is outside the supported city list.');
if(a.state&&a.state!=='Karnataka')reasons.push('State must be Karnataka for these territories.');
if(a.pin&&(!/^\d{6}$/.test(a.pin)||(cities[a.city]&&!a.pin.startsWith(cities[a.city][0]))))reasons.push('Pin code does not match the selected city.');
if(a.space&&!['Owned','Rented','Not yet identified'].includes(a.space))reasons.push('Space ownership value needs clarification.');
if(a.language&&!['Kannada','English','Hindi'].includes(a.language))reasons.push('Confirm Kannada, English or Hindi for training.');
if(a.space!=='Not yet identified'&&/still (searching|looking)|not (yet )?(found|identified)|no (shop|space|premises)/i.test(a.notes||''))reasons.push('Space status conflicts with the notes. Confirm the premises and update the notes.');
if(a.space==='Not yet identified'&&(a.area>0||['Ground','First'].includes(a.floor)))reasons.push('Site details are present although space is not yet identified.');
if(pending.length)reasons.push(`${pending.length} proposed data correction${pending.length>1?'s':''} awaiting confirmation.`);
if(missing.length)reasons.push('Missing: '+missing.join(', ')+'.');
const matches=territories.filter(t=>t.pins?.includes(a.pin));let t=matches.length===1?matches[0]:null,status='Eligible';
if(reasons.length)status='Clarification needed';
else if(stores.some(s=>String(s.pin)===a.pin)){status='Location unavailable';reasons.push('An existing store already occupies this pin code. Choose a different pin code.');}
else if(!t||matches.length>1){status='Territory review';reasons.push(matches.length>1?'Pin code appears in more than one territory. Resolve territory overlap.':'Pin code is not covered by an uploaded territory.');}
else if(t.issues?.length||t.city!==a.city||t.state!==a.state||!Number.isInteger(t.slots)||t.slots<0){status='Territory review';reasons.push('Territory details are incomplete, invalid or conflict with the application.');}
else if(a.space==='Not yet identified'||!a.area||!['Ground','First','Other confirmed'].includes(a.floor)){status='Site needed';reasons.push('Confirm an identified site, positive usable area and actual floor.');}
else if((settings.minInvestment!==''&&settings.minInvestment!=null&&a.investment<Number(settings.minInvestment))||(settings.minArea!==''&&settings.minArea!=null&&a.area<Number(settings.minArea))){status='Requirements not met';reasons.push('Investment or area is below the configured brand minimum.');}
else if(settings.minLaunch!==''&&settings.minLaunch!=null&&(!Number.isFinite(a.launch)||a.launch<Number(settings.minLaunch))){status='Timeline review';reasons.push('Confirm a target launch that meets the configured minimum preparation time.');}
return {...a,tier,territory:t?.id||null,components,score:+score.toFixed(1),high:+high.toFixed(1),status,reasons,missing};});
let usedPins=new Set(stores.map(s=>String(s.pin))),counts={};let candidates=out.filter(a=>a.status==='Eligible').sort((a,b)=>b.score-a.score||(Number.isFinite(a.launch)?a.launch:Infinity)-(Number.isFinite(b.launch)?b.launch:Infinity)||String(a.id).localeCompare(String(b.id))||a.key.localeCompare(b.key));
for(let a of candidates){let t=territories.find(t=>t.id===a.territory);if(usedPins.has(a.pin)){a.status='Waitlisted';a.reasons.push('A higher-ranked or tie-break-winning candidate is recommended for this pin code.');}else if((counts[t.id]||0)>=t.slots){a.status='Waitlisted';a.reasons.push('All available slots in this territory have provisional recommendations.');}else{a.status='Recommended';usedPins.add(a.pin);counts[t.id]=(counts[t.id]||0)+1;a.reasons.push('Complete application and identified site; ranked within the available territory capacity. Recommendation is subject to funding and site verification.');}}
return out;}
function parseUpdate(text,apps){let id=text.match(/APP[- ]?\d+/i)?.[0]?.toUpperCase().replace(' ','-');let matches=apps.filter(a=>a.id?.toUpperCase()===id);if(matches.length!==1)return {error:matches.length?'Resolve duplicate application IDs first.':'Include a unique application ID, for example APP-012.'};let a=matches[0],t=text.toLowerCase(),field,value;
if(/\b(why|explain|status|score|next|what|how)\b/.test(t)&&!/(change|update|now|has found)/.test(t))return {explain:true,key:a.key};
if(/ground[ -]?floor/.test(t)){field='floor';value='Ground';}else if(/first[ -]?floor/.test(t)){field='floor';value='First';}else if(/\b(owned|owns)\b/.test(t)){field='space';value='Owned';}else if(/\brented\b/.test(t)){field='space';value='Rented';}else if(/\b(investment|invest|capacity|budget)\b/.test(t)){field='investment';let m=t.match(/(?:₹\s*)?(\d+(?:\.\d+)?)\s*(?:lakh|lac)/)||t.match(/(?:investment|capacity|budget)(?:\s+(?:is|to|of|now))?\s*[:=]?\s*(\d+(?:\.\d+)?)/);if(m)value=Number(m[1]);}else if(/\b(area|sqft|sq ft|square feet)\b/.test(t)){field='area';let m=t.match(/(\d+(?:\.\d+)?)\s*(?:sqft|sq ft|square feet)/)||t.match(/area(?:\s+(?:is|to|of|now))?\s*[:=]?\s*(\d+(?:\.\d+)?)/);if(m)value=Number(m[1]);}else if(/\b(launch|open|months?)\b/.test(t)){field='launch';let m=t.match(/(\d+(?:\.\d+)?)\s*months?/);if(m)value=Number(m[1]);}else if(/\b(experience|years?)\b/.test(t)){field='experience';let m=t.match(/(\d+(?:\.\d+)?)\s*years?/);if(m)value=Number(m[1]);}else if(/\bpin\b/.test(t)){field='pin';value=t.match(/\b\d{6}\b/)?.[0];}
if(field&&value!==undefined)return {key:a.key,id:a.id,field,value};return {error:'I can explain decisions or propose changes to floor, ownership, investment, area, launch months, experience or pin. For other changes, use Edit application.'};}
function invalidateTasks(tasks,patch){let start=7;if(['id','name','investment'].some(k=>k in patch))start=0;else if(['city','state','pin','space','area','floor','launch'].some(k=>k in patch))start=1;else if(['language','experience','business'].some(k=>k in patch))start=5;let next={...tasks};for(let i=start;i<7;i++)next[i]=false;return next;}
function validState(s){try{
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x), str=x=>typeof x==='string', num=x=>Number.isFinite(x)&&x>=0;
if(!obj(s)||!str(s.source)||!Array.isArray(s.apps)||s.apps.length>20000||!Array.isArray(s.territories)||!obj(s.reference)||!obj(s.settings)||!obj(s.tasks)||!obj(s.taskDates)||!Array.isArray(s.audit)||!Array.isArray(s.warnings)||!s.warnings.every(str))return false;
let keys=new Set();for(let a of s.apps){if(!obj(a)||!str(a.key)||!/^[-a-zA-Z0-9_]+$/.test(a.key)||['__proto__','constructor','prototype'].includes(a.key)||keys.has(a.key)||!obj(a.raw)||!Array.isArray(a.pending))return false;keys.add(a.key);for(let f of fields)if(a[f]!==null&&a[f]!==undefined&&!(numeric.includes(f)?num(a[f]):str(a[f])))return false;for(let p of a.pending)if(!obj(p)||!numeric.includes(p.field)||!(p.proposed===null||num(p.proposed))||!(str(p.raw)||Number.isFinite(p.raw)))return false;}
for(let t of s.territories){if(!obj(t)||!str(t.id)||!str(t.city)||!str(t.state)||!Array.isArray(t.pins)||!t.pins.every(str)||!(t.slots===null||Number.isFinite(t.slots))||(t.issues!==undefined&&(!Array.isArray(t.issues)||!t.issues.every(str))))return false;}
if(!obj(s.reference.all)||!obj(s.reference.tiers))return false;for(let group of [s.reference.all,...Object.values(s.reference.tiers)]){if(!obj(group))return false;for(let f of numeric)if(!Array.isArray(group[f])||!group[f].every(num))return false;}
for(let v of Object.values(s.settings))if(v!==''&&!(typeof v==='number'?num(v):str(v)&&/^\d+(\.\d+)?$/.test(v)))return false;
for(let [key,task] of Object.entries(s.tasks)){if(!keys.has(key)||!obj(task)||Object.entries(task).some(([k,v])=>!/^([0-6])$/.test(k)||typeof v!=='boolean'))return false;}
for(let [key,dates] of Object.entries(s.taskDates)){if(!keys.has(key)||!obj(dates)||Object.entries(dates).some(([k,v])=>!/^([0-6])$/.test(k)||!str(v)||!/^$|^\d{4}-\d{2}-\d{2}$/.test(v)))return false;}
if(s.audit.some(a=>!obj(a)||!str(a.text)||!str(a.at)||!Number.isFinite(Date.parse(a.at))))return false;return true;
}catch(e){return false;}}
const api={invalidateTasks,validState,fields,numeric,cities,labels,normalize,percentile,band,benchmarks,assess,parseUpdate,businessPoints};if(typeof module!=='undefined')module.exports=api;root.Engine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
