import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {defaults,tomorrow} from './model.mjs';
import {encryptedStorage} from './cloud/encrypted-storage.mjs';

const origin='https://task-pilot.net',password='Cloud-tests-only-123!',emails=[];
const persist=await mkdtemp(path.join(os.tmpdir(),'taskpilot-cloud-test-'));
const key=randomBytes(32).toString('hex');
let mf;
function createRuntime(bindings={}){
 const outboundService=async request=>{
  const url=new URL(request.url);
  if(url.origin==='https://api.resend.com'&&url.pathname==='/emails'&&request.method==='POST'){emails.push(await request.json());return new Response(JSON.stringify({id:'mock-mail-'+emails.length}),{headers:{'Content-Type':'application/json'}});}
  if(url.origin==='https://prim.iledefrance-mobilites.fr')return new Response('{}',{status:400});
  throw Error('Appel réseau externe non simulé refusé : '+url.origin);
 };
 return new Miniflare(convertV4MiniflareOptions({name:'taskpilot',modules:true,scriptPath:'.wrangler/cloud-test/worker.js',compatibilityDate:'2026-10-03',compatibilityFlags:['nodejs_compat'],cf:false,outboundService,durableObjects:{ACCOUNTS:{className:'AccountAuthority',useSQLite:true},TRANSIT:{className:'TransitPlanner',useSQLite:true},BOT:{className:'BookingCoordinator',useSQLite:true}},resourcePersistencePath:persist,assets:{directory:'public',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},bindings:{PUBLIC_URL:origin,DATA_ENCRYPTION_KEY:key,RESEND_API_KEY:'test-only',MAIL_FROM:'connexion@mail.task-pilot.net',GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only',PRIM_API_KEY:'test-prim-only',...bindings}}));
}
async function request(route,{method='GET',cookie,body,headers={}}={}){
 const h={...headers,'CF-Connecting-IP':'192.0.2.'+Math.floor(Math.random()*250)};
 if(cookie)h.Cookie=cookie;if(body!==undefined){h['Content-Type']='application/json';h.Origin??=origin;}
 const res=await mf.dispatchFetch(origin+route,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:res.status,headers:res.headers,data};
}
const post=(route,body,cookie)=>request(route,{method:'POST',body,cookie});
async function waitFor(check){const until=Date.now()+10000;while(Date.now()<until){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Résultat non reçu dans le délai de test.');}
async function signup(email){
 const created=await post('/api/account/register',{email,password,taskrabbitEmail:'taskrabbit-'+email});assert.equal(created.status,202,JSON.stringify(created.data));assert.equal(created.headers.get('set-cookie'),null);
 const message=await waitFor(()=>emails.find(m=>m.to[0]===email));const token=message.text.match(/#verify-email=([a-f0-9]{64})/)[1];
 assert.equal((await post('/api/account/login',{email,password})).status,403);
 assert.equal((await post('/api/account/reset-password',{token,password})).status,400);
 assert.equal((await post('/api/account/verify-email',{token})).status,200);
 assert.equal((await post('/api/account/verify-email',{token})).status,400);
 const login=await post('/api/account/login',{email,password});assert.equal(login.status,200,JSON.stringify(login.data));
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 return {cookie:cookie.split(';')[0],user:login.data.user};
}
let a,b,googleFlow;
mf=createRuntime();
after(async()=>{await mf?.dispose();const resolved=path.resolve(persist);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.match(path.basename(resolved),/^taskpilot-cloud-test-/);await rm(resolved,{recursive:true,force:true});});

test('Cloud : HTTPS, domaine canonique, CSRF et aucun fichier serveur public',async()=>{
 const home=await request('/');assert.equal(home.status,200);assert.match(home.data,/public-site/);assert.ok(home.headers.get('content-security-policy'));assert.ok(home.headers.get('strict-transport-security'));
 assert.equal((await mf.dispatchFetch('https://www.task-pilot.net/',{redirect:'manual'})).status,308);
 assert.equal((await mf.dispatchFetch('https://evil.example/api/health')).status,403);
 assert.equal((await request('/api/account/register',{method:'POST',body:{},headers:{Origin:'https://evil.example'}})).status,403);
 for(const route of ['/server.mjs','/cloud/accounts.mjs','/.dev.vars','/GOOGLE-SETUP.md','/node_modules/jose/package.json'])assert.equal((await request(route)).status,404,route);
});
test('Cloud : inscription vérifiée, envoi durable, cookies sécurisés et séparation des comptes',async()=>{
 a=await signup('cloud-a@taskpilot.invalid');b=await signup('cloud-b@taskpilot.invalid');assert.notEqual(a.user.id,b.user.id);
 const state={'taskpilot-alerts':'true'};assert.equal((await request('/api/account/state',{method:'PUT',body:{state,revision:0},cookie:a.cookie})).status,200);
 assert.deepEqual((await request('/api/account/state',{cookie:b.cookie})).data.state,{});
 assert.equal((await request('/api/account/state',{method:'PUT',body:{state,revision:0},cookie:a.cookie})).status,409);
 assert.equal((await request('/api/transit/status')).status,401);
});
test('Cloud : association du compagnon propre à chaque compte et révocation',async()=>{
 const pairA=await post('/api/portal/pair',{},a.cookie),pairB=await post('/api/portal/pair',{},b.cookie);assert.equal(pairA.status,200);assert.notEqual(pairA.data.token,pairB.data.token);
 assert.equal((await post('/api/account/monitoring',{enabled:true,mode:'scheduled',times:['15:00','11:00'],beforeMinutes:5,afterMinutes:20},a.cookie)).status,200);
 const config=await request('/api/portal/config',{headers:{'X-TaskPilot-Token':pairA.data.token}});assert.equal(config.status,200);assert.deepEqual(config.data.monitoring.times,['11:00','15:00']);assert.equal(config.data.capabilities.autoReserve,false);assert.equal(JSON.stringify(config.data).includes(a.user.email),false);
 assert.equal((await request('/api/portal/config')).status,403);
 assert.equal((await request('/api/portal/config',{headers:{'X-TaskPilot-Token':pairB.data.token}})).data.monitoring.enabled,false);
 const tasks=[{id:'test-offer',title:'Mission de test',date:'2026-10-05',time:'09:00',duration:60,pay:100,lat:48.85,lon:2.35,department:'Paris',status:'available'}];
 assert.equal((await request('/api/portal/snapshot',{method:'POST',body:{source:'taskrabbit-board',tasks},headers:{'X-TaskPilot-Token':pairA.data.token,Origin:'chrome-extension://test'}})).status,200);
 const firstRevision=(await request('/api/portal/status',{cookie:a.cookie})).data.revision;
 await request('/api/portal/snapshot',{method:'POST',body:{source:'taskrabbit-board',tasks},headers:{'X-TaskPilot-Token':pairA.data.token}});
 assert.equal((await request('/api/portal/status',{cookie:a.cookie})).data.revision,firstRevision,'Une lecture identique ne doit pas interrompre le calcul des trajets');
 assert.equal((await request('/api/portal/status',{cookie:a.cookie})).data.count,1);assert.equal((await request('/api/portal/status',{cookie:b.cookie})).data.count,0);
 await post('/api/portal/pair',{},a.cookie);
 assert.equal((await request('/api/portal/snapshot',{method:'POST',body:{source:'taskrabbit-board',tasks},headers:{'X-TaskPilot-Token':pairA.data.token}})).status,403);
});
test('Cloud : OAuth utilise HTTPS, PKCE et une session persistante',async()=>{
 const start=await post('/api/account/google/start',{state:{},taskrabbitEmail:''});assert.equal(start.status,200,JSON.stringify(start.data));
 const url=new URL(start.data.url);assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/account/google/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(start.headers.get('set-cookie'),/Secure/);
 googleFlow={state:url.searchParams.get('state'),cookie:start.headers.get('set-cookie').split(';')[0]};
});
test('Cloud : comptes, préférences et OAuth conservés après redémarrage',async()=>{
 await mf.dispose();mf=createRuntime();
 assert.equal((await request('/api/account/me',{cookie:a.cookie})).data.user.id,a.user.id);
 assert.deepEqual((await request('/api/account/state',{cookie:a.cookie})).data.state,{'taskpilot-alerts':'true'});
 const callback=await request('/api/account/google/callback?state='+googleFlow.state+'&error=access_denied',{cookie:googleFlow.cookie});assert.equal(callback.status,303);assert.match(callback.headers.get('location'),/google_cancelled/);
 assert.equal((await request('/api/account/me',{cookie:a.cookie})).data.user.monitoring.enabled,true);
 assert.match((await request('/api/account/google/callback?state='+googleFlow.state+'&error=access_denied',{cookie:googleFlow.cookie})).headers.get('location'),/google_failed/);
});
test('Cloud : calculs réels persistants, jours off et isolation du transport',async()=>{
 const p={...defaults,mobility:'transit',zoneMode:'all',lunch:false,minPay:0,minRate:0,maxPending:12,overrun:0,gap:20,maxFirst:60,maxTravel:60,returnHome:false};
 const tasks=[{id:'a',title:'Montage',date:'2026-10-05',time:'09:00',duration:60,pay:100,lat:48.85,lon:2.35,department:'Paris',status:'available'}];
 assert.equal((await post('/api/transit/jobs',{p:{...p,workDays:[]},tasks,date:'2026-10-05'},a.cookie)).status,409);
 const start=await post('/api/transit/jobs',{p,tasks,date:'2026-10-05'},a.cookie);assert.equal(start.status,202,JSON.stringify(start.data));
 await mf.dispose();mf=createRuntime();
 assert.equal((await request('/api/transit/jobs/'+start.data.id,{cookie:b.cookie})).status,404);
 const done=await waitFor(async()=>{const res=await request('/api/transit/jobs/'+start.data.id,{cookie:a.cookie});if(res.data.state==='error')throw Error(res.data.error);return res.data.state==='done'?res.data:null;});
 assert.equal(done.completed,1);assert.equal(done.result.unavailable,1);assert.ok(!JSON.stringify(done).includes('test-prim-only'));
 await mf.dispose();mf=createRuntime();assert.equal((await request('/api/transit/jobs/'+start.data.id,{cookie:a.cookie})).data.state,'done');
});
test('Cloud : chiffrement fragmenté, altération et mauvaise clé refusées',async()=>{
 const map=new Map();const storage={get:async key=>map.get(key),put:async(key,val)=>map.set(key,val),delete:async key=>map.delete(key),transaction:async fn=>fn(storage)};
 const vault=await encryptedStorage(storage,key,'test'),value={secret:'mail-personnel@taskpilot.invalid',large:'x'.repeat(150000)};await vault.save(value);assert.deepEqual(await vault.load(),value);assert.ok(!JSON.stringify([...map]).includes(value.secret));
 await assert.rejects((await encryptedStorage(storage,'ab'.repeat(32),'test')).load());
 const part=map.get('encrypted:test:0');part.data='A'+part.data.slice(1);await assert.rejects(vault.load());
});
test('Cloud : aucun compte local transféré et aucune clé dans les ressources publiques',async()=>{
 async function inspect(dir){for(const name of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,name.name);if(name.isDirectory())await inspect(file);else {const text=await readFile(file,'utf8');assert.ok(!text.includes(key));assert.ok(!text.includes('test-prim-only'));assert.ok(!/\.dpapi$|^client_secret/.test(name.name));}}}
 await inspect('public');
});
test('Cloud bot : statut privé, version gratuite et activation bloquée sans autorisation',async()=>{
 assert.equal((await request('/api/bot/status')).status,401);
 const status=await request('/api/bot/status',{cookie:a.cookie});assert.equal(status.status,200,JSON.stringify(status.data));assert.equal(status.data.available,false);assert.equal(status.data.limitSeconds,450);assert.equal(status.data.remainingSeconds,450);
 assert.ok(!JSON.stringify(status.data).includes(b.user.email));
 assert.equal((await post('/api/account/automation',{enabled:true,acceptTerms:true},a.cookie)).status,409);
 const ns=await mf.getDurableObjectNamespace('BOT'),stub=ns.get(ns.idFromName('taskpilot-bot-v1'));
 const tick=await stub.fetch('https://taskpilot.internal/tick');assert.equal((await tick.json()).reason,'taskrabbit-authorization');
 assert.equal((await request('/api/bot/context',{cookie:a.cookie})).status,404);
 const forbidden=await mf.dispatchFetch('https://taskpilot.internal/bot/users');assert.equal(forbidden.status,403);
});
test('Cloud bot : vérification Taskrabbit distincte et invalidation après changement',async()=>{
 const response=await post('/api/account/taskrabbit-verification',{},a.cookie);assert.equal(response.status,200);
 const mail=await waitFor(()=>emails.find(m=>m.to[0]===a.user.taskrabbitEmail&&m.text.includes('#verify-taskrabbit=')));
 const token=mail.text.match(/#verify-taskrabbit=([a-f0-9]{64})/)[1];
 assert.equal((await post('/api/account/verify-taskrabbit',{token})).status,200);
 assert.equal((await request('/api/account/me',{cookie:a.cookie})).data.user.taskrabbitVerified,true);
 assert.equal((await post('/api/account/verify-taskrabbit',{token})).status,400);
 await post('/api/account/profile',{taskrabbitEmail:'another@taskpilot.invalid'},a.cookie);
 assert.equal((await request('/api/account/me',{cookie:a.cookie})).data.user.taskrabbitVerified,false);
});
test('Cloud bot : demandes atomiques, reprise conservée et confirmation utilisateur préservée',async()=>{
 await mf.dispose();mf=createRuntime({TASKRABBIT_AUTOMATION_APPROVED:'true'});
 await post('/api/account/profile',{taskrabbitEmail:a.user.email},a.cookie);
 await post('/api/account/monitoring',{enabled:true,mode:'all'},a.cookie);
 const p={...defaults,workDays:[1,2,3,4,5,6,7],lunch:false,returnHome:false,minPay:0,minRate:0,overrun:0,zoneMode:'all'},date=tomorrow();
 const task={id:'1234567',date,time:'09:00',duration:60,pay:100,lat:p.lat,lon:p.lon,status:'available',brand:'IKEA',address:'12 rue Test, 69001'};
 const matrix={'home>1234567':{provider:'ign',mode:'car',available:true,minutes:10,km:1,signature:JSON.stringify(['car',p.lat,p.lon,task.lat,task.lon]),fetchedAt:Date.now()}};
 let state=(await request('/api/account/state',{cookie:a.cookie})).data;
 const saved={prefs:p,tasks:[task],matrix,transitMatrix:{}};
 assert.equal((await request('/api/account/state',{method:'PUT',cookie:a.cookie,body:{revision:state.revision,state:{...state.state,'taskpilot-v1':JSON.stringify(saved)}}})).status,200);
 assert.equal((await post('/api/account/automation',{enabled:true,acceptTerms:true},a.cookie)).status,200);
 const ns=await mf.getDurableObjectNamespace('ACCOUNTS'),stub=ns.get(ns.idFromName('taskpilot-accounts-v1'));
 const internal=async(action,body)=>{const response=await stub.fetch('https://taskpilot.internal/bot/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const context=(await internal('context',{ownerId:a.user.id})).data;
 assert.equal((await internal('begin',{ownerId:a.user.id,revision:context.revision-1,taskId:task.id})).status,409);
 const starts=await Promise.all([internal('begin',{ownerId:a.user.id,revision:context.revision,taskId:task.id}),internal('begin',{ownerId:a.user.id,revision:context.revision,taskId:task.id})]);assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
 state=(await request('/api/account/state',{cookie:a.cookie})).data;let plan=JSON.parse(state.state['taskpilot-v1']);assert.equal(plan.tasks[0].status,'pending');assert.equal(plan.tasks[0].requestUncertain,true);
 plan.tasks[0].status='confirmed';await request('/api/account/state',{method:'PUT',cookie:a.cookie,body:{revision:state.revision,state:{...state.state,'taskpilot-v1':JSON.stringify(plan)}}});
 assert.equal((await internal('finish',{ownerId:a.user.id,taskId:task.id,outcome:'submitted'})).status,200);
 plan=JSON.parse((await request('/api/account/state',{cookie:a.cookie})).data.state['taskpilot-v1']);assert.equal(plan.tasks[0].status,'confirmed');assert.equal(plan.tasks[0].requestUncertain,false);
 await post('/api/account/automation',{enabled:false},a.cookie);assert.equal((await internal('context',{ownerId:a.user.id})).status,409);
 await mf.dispose();mf=createRuntime();assert.equal((await request('/api/account/me',{cookie:a.cookie})).data.user.automationEnabled,false);
});
