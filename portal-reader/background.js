import {normalizeMonitoring,monitoringActive} from './schedule.mjs';
const allowedBases=['https://task-pilot.net','http://127.0.0.1:4173'];
const board='https://taskrabbitlimited.outsystemsenterprise.com/TaskPortal/board';
let busy=false,config=null;
async function connection(){const v=await chrome.storage.local.get(['pairCode','watching','serverUrl']);return {...v,serverUrl:allowedBases.includes(v.serverUrl)?v.serverUrl:allowedBases[0]};}
async function loadConfig(v){const response=await fetch(v.serverUrl+'/api/portal/config',{headers:{'X-TaskPilot-Token':v.pairCode},cache:'no-store'});if(!response.ok)throw Error(response.status===403?'Association expirée. Générez un nouveau code dans TaskPilot.':'TaskPilot indisponible. La surveillance reprendra à la prochaine vérification.');config=normalizeMonitoring((await response.json()).monitoring);return config;}
async function tick(){if(busy)return;busy=true;try{const v=await connection();if(!v.watching||!v.pairCode)return;const schedule=await loadConfig(v);if(!monitoringActive(schedule)){await chrome.storage.local.set({lastResult:schedule.enabled?'En attente de vos horaires · heure de Paris.':'Surveillance en pause dans TaskPilot.'});return;}
 const tabs=await chrome.tabs.query({url:board+'*'});if(!tabs.length){await chrome.storage.local.set({lastResult:'Ouvrez la liste des missions Taskrabbit pour surveiller les offres.'});return;}
 await chrome.tabs.reload(tabs[0].id);await chrome.storage.local.set({lastCheck:Date.now(),lastResult:'Surveillance active · liste vérifiée toutes les 30 secondes.'});
 }catch(e){config=null;await chrome.storage.local.set({lastResult:e.message});}finally{busy=false;}}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{(async()=>{
 if(message.type==='snapshot'){
  if(!sender.url?.startsWith(board))throw Error('Page inconnue.');
  const v=await connection();if(!v.watching||!v.pairCode)return {ignored:true};
  if(!config)await loadConfig(v);if(!monitoringActive(config))return {ignored:true};
  const r=await fetch(v.serverUrl+'/api/portal/snapshot',{method:'POST',headers:{'Content-Type':'application/json','X-TaskPilot-Token':v.pairCode},body:JSON.stringify({source:'taskrabbit-board',tasks:message.tasks})});
  const result=await r.json();await chrome.storage.local.set({lastResult:r.ok?result.received+' offres synchronisées.':result.error,...(r.ok?{lastSync:Date.now()}:{})});return r.ok?result:{error:result.error||'Synchronisation impossible.'};
 }
 if(message.type==='configure'){
  if(sender.tab)throw Error('Configuration refusée.');
  const pairCode=String(message.pairCode||'').trim(),serverUrl=String(message.serverUrl||allowedBases[0]);if(!allowedBases.includes(serverUrl))throw Error('Adresse TaskPilot refusée.');
  if(message.watching&&!/^[a-f0-9-]{72}$/.test(pairCode))throw Error('Collez le code généré dans TaskPilot.');
  config=null;await chrome.storage.local.set({pairCode,serverUrl,watching:!!message.watching});
  if(message.watching){await chrome.alarms.create('refresh-board',{periodInMinutes:.5});await tick();}else await chrome.alarms.clear('refresh-board');return {ok:true};
 }
 throw Error('Message inconnu.');
})().then(reply).catch(e=>reply({error:e.message}));return true;});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='refresh-board')tick();});
async function restore(){const v=await connection();if(v.watching&&v.pairCode){await chrome.alarms.create('refresh-board',{periodInMinutes:.5});await tick();}}
chrome.runtime.onStartup.addListener(restore);chrome.runtime.onInstalled.addListener(restore);
