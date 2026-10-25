const fs=require('node:fs'),E=require('../dist/engine.js'),data=require('../tests/fixtures/qa.json');
const apps=data.apps.map((r,i)=>E.normalize(r,'sheet-row-'+(i+4))),ref=E.benchmarks(apps),old=E.assess(apps,data.territories,data.stores,ref,{}),current=E.assess(apps,data.territories,data.stores,ref,E.defaultPolicy);
const rows=current.map((r,i)=>({id:r.id||'(missing ID)',name:r.name,oldScore:old[i].score,oldHigh:old[i].high,oldStatus:old[i].status,newScore:r.score,newHigh:r.high,grade:r.grade,newStatus:r.status,reason:r.reasons.join(' ')}));
fs.writeFileSync('dist/qa-rescoring.json',JSON.stringify({policy:E.defaultPolicy,rows},null,2));
fs.writeFileSync('dist/qa-rescoring.csv','Application ID,Legacy score,V2 score,V2 possible,Grade,Legacy status,V2 status\r\n'+rows.map(r=>[r.id,r.oldScore,r.newScore,r.newHigh,r.grade,r.oldStatus,r.newStatus].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'));
console.log('Rescored '+rows.length+' synthetic applications under '+E.defaultPolicy.model+'.');
