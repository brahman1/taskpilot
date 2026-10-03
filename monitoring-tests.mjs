import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMonitoring,monitoringActive} from './portal-reader/schedule.mjs';
import {zipFiles} from './scripts/zip.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('Compagnon : conserve le code postal nécessaire à la localisation',async()=>{
 const card={innerText:'5 Oct 2026 09:00\nIKEA\nParis\nRue exemple\n75012\nDuration1:05\nMontage\n€80.50',querySelectorAll:()=>[{}]};
 const gen={innerText:'IKEA\nParis\nRue exemple\n75012\nDuration1:05',parentElement:card},scope={innerText:'Montage de test'};
 const doc={querySelectorAll:()=>[{id:'p-single_task_link',href:'https://taskrabbitlimited.outsystemsenterprise.com/TaskPortal/task_page?taskid=123'}],getElementById:id=>id==='p-geninfo'?gen:id==='p-scope'?scope:null};
 const context={document:doc,URL};vm.createContext(context);vm.runInContext(await readFile(new URL('./portal-reader/reader.js',import.meta.url),'utf8'),context);const [offer]=context.readTaskPilotOffers();assert.equal(offer.address,'Rue exemple, 75012');assert.equal(offer.duration,65);assert.equal(offer.id,'123');
});
test('Créneaux Paris : limites, été et hiver',()=>{
 const v={enabled:true,mode:'scheduled',times:['11:00','15:00'],beforeMinutes:5,afterMinutes:20};
 for(const [stamp,active]of [['2026-10-03T08:54:59Z',false],['2026-10-03T08:55:00Z',true],['2026-10-03T09:19:59Z',true],['2026-10-03T09:20:00Z',false],['2026-10-03T13:00:00Z',true],['2026-12-03T10:00:00Z',true],['2026-12-03T09:00:00Z',false]])assert.equal(monitoringActive(v,Date.parse(stamp)),active,stamp);
 assert.equal(monitoringActive({...v,enabled:false},Date.parse('2026-10-03T09:00:00Z')),false);
});
test('Créneaux à minuit et changement d’heure',()=>{
 const v={enabled:true,mode:'scheduled',times:['00:00'],beforeMinutes:5,afterMinutes:20};
 assert.equal(monitoringActive(v,Date.parse('2026-10-03T21:56:00Z')),true);
 assert.equal(monitoringActive(v,Date.parse('2026-10-03T22:20:00Z')),false);
 const repeated={...v,times:['02:30']};
 assert.equal(monitoringActive(repeated,Date.parse('2026-10-25T00:30:00Z')),true);
 assert.equal(monitoringActive(repeated,Date.parse('2026-10-25T01:30:00Z')),true);
});
test('Validation serveur des horaires et normalisation',()=>{
 assert.deepEqual(normalizeMonitoring({times:['15:00','11:00','11:00']}).times,['11:00','15:00']);
 for(const v of [{enabled:'true'},{mode:'other'},{times:['24:00']},{times:[]},{beforeMinutes:-1},{afterMinutes:0},{afterMinutes:200},null])assert.throws(()=>normalizeMonitoring(v));
 assert.equal(monitoringActive({enabled:true,mode:'all',times:[]}),true);
});
test('Archive du compagnon : CRC ZIP et chemins bornés',()=>{
 const zip=zipFiles([{name:'manifest.json',data:'123456789'}]);assert.equal(zip.readUInt32LE(14),0xcbf43926);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.throws(()=>zipFiles([{name:'../secret',data:'x'}]));
});
test('Compagnon : applique les horaires, échoue fermé et restaure après redémarrage',async()=>{
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch,originalNow=Date.now;
 let data={watching:true,pairCode:'a'.repeat(72),serverUrl:'https://task-pilot.net'},alarm,listener,installed,reloads=0,configError=false,schedule={enabled:true,mode:'scheduled',times:['11:00'],beforeMinutes:5,afterMinutes:20};
 globalThis.chrome={storage:{local:{get:async()=>({...data}),set:async v=>{Object.assign(data,v);}}},tabs:{query:async()=>[{id:1}],reload:async()=>{reloads++;}},alarms:{create:async(n,v)=>{assert.equal(v.periodInMinutes,.5);},clear:async()=>{},onAlarm:{addListener:fn=>alarm=fn}},runtime:{onMessage:{addListener:fn=>listener=fn},onStartup:{addListener:fn=>installed=fn},onInstalled:{addListener:()=>{}}}};
 globalThis.fetch=async()=>new Response(JSON.stringify({monitoring:schedule}),{status:configError?503:200});
 try{await import('./portal-reader/background.js');const tick=async()=>{alarm({name:'refresh-board'});for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
  Date.now=()=>Date.parse('2026-10-03T08:00:00Z');await tick();assert.equal(reloads,0);
  Date.now=()=>Date.parse('2026-10-03T09:00:00Z');await tick();assert.equal(reloads,1);
  schedule={...schedule,enabled:false};await tick();assert.equal(reloads,1);
  schedule={...schedule,enabled:true};configError=true;await tick();assert.equal(reloads,1);
  configError=false;await installed();assert.equal(reloads,2);
  const result=await new Promise(resolve=>listener({type:'snapshot',tasks:[]},{url:'https://evil.example'},resolve));assert.match(result.error,/Page inconnue/);
 }finally{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;Date.now=originalNow;}
});
