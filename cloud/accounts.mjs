import {DurableObject} from 'cloudflare:workers';
import {randomUUID} from 'node:crypto';
import {createAccountCore} from '../account-core.mjs';
import {createAccountMailer} from '../account-mail-core.mjs';
import {normalizeTasks} from '../model.mjs';
import {encryptedStorage} from './encrypted-storage.mjs';
import {publicOrigin,json,fail,readJson,digest,nodeRequest,nodeResponse} from './security.mjs';
import {botSettings,chooseBotTask} from '../bot-policy.mjs';

export class AccountAuthority extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.tail=Promise.resolve();
  ctx.blockConcurrencyWhile(async()=>{
   this.origin=publicOrigin(env);
   this.vault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'accounts');
   this.flowVault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'google-flows');
   this.cooldownVault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'mail-cooldowns');
   this.outboxVault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'mail-outbox');
   this.portalIndexVault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'portal-index');
   this.pending=new Map(await this.flowVault.load()||[]);
   this.cooldowns=new Map(await this.cooldownVault.load()||[]);
   this.outbox=await this.outboxVault.load()||{};
   this.portalIndex=await this.portalIndexVault.load()||{};
   this.realMailer=createAccountMailer({apiKey:env.RESEND_API_KEY,from:env.MAIL_FROM,publicUrl:this.origin});
   const mailer={configured:this.realMailer.configured,send:async message=>{
    const id=digest(message.token+message.purpose);
    if(Object.keys(this.outbox).length>=100)throw Error('File e-mail pleine.');
    this.outbox[id]={...message,expiresAt:Date.now()+(message.purpose==='reset'?15:60)*60000,attempts:0,nextAttempt:Date.now()};
    await this.outboxVault.save(this.outbox);await this.schedule();return {id};
   }};
   this.accounts=await createAccountCore({storage:this.vault,mailer,public:true,automationAvailable:env.TASKRABBIT_AUTOMATION_APPROVED==='true',allowedOrigins:[this.origin],googleConfig:{clientId:env.GOOGLE_CLIENT_ID||'',clientSecret:env.GOOGLE_CLIENT_SECRET||''},googleOptions:{pending:this.pending,publicOrigin:this.origin},mailCooldowns:this.cooldowns,rateLimiter:req=>this.rateLimit(req),onMailError:()=>console.warn('Impossible de placer un e-mail dans la file sécurisée.')});
   if(Object.keys(this.outbox).length&&await ctx.storage.getAlarm()===null)await this.schedule();
  });
 }
 serialize(action){const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;}
 async rateLimit(req){
  const key='rate:'+digest(req.socket.remoteAddress),now=Date.now();
  let item=await this.ctx.storage.get(key);if(!item||item.until<=now)item={count:0,until:now+600000};
  if(item.count>=30)throw fail('Trop de tentatives. Réessayez dans quelques minutes.',429);
  item.count++;await this.ctx.storage.put(key,item);await this.schedule();
 }
 async schedule(){
  const now=Date.now(),times=Object.values(this.outbox||{}).map(m=>m.nextAttempt);
  const next=Math.max(now+500,Math.min(now+600000,...times));const current=await this.ctx.storage.getAlarm();
  if(current===null||current>next)await this.ctx.storage.setAlarm(next);
 }
 async fetch(request){const result=await this.serialize(async()=>{try{
  if(new URL(request.url).origin==='https://taskpilot.internal'&&new URL(request.url).pathname.startsWith('/bot/')){
   if(this.env.TASKRABBIT_AUTOMATION_APPROVED!=='true')throw fail('L’autorisation Taskrabbit doit être configurée par le propriétaire.',403);
   const action=new URL(request.url).pathname.slice(5),data=request.method==='POST'?await readJson(request):{};
   if(action==='users')return json({users:this.accounts.botUsers()});
   const context=this.accounts.botContext(data.ownerId);if(!context)throw fail('Demandes automatiques désactivées.',409);
   if(action==='context')return json(context);
   if(action==='offers'){
    if(data.revision!==context.revision)throw fail('Critères modifiés : calcul à recommencer.',409);
    const current=JSON.parse(context.state['taskpilot-v1']);current.tasks=normalizeTasks(data.tasks);current.matrix=data.matrix||{};current.transitMatrix=data.transitMatrix||{};
    const revision=await this.accounts.botSave(context.id,context.revision,{...context.state,'taskpilot-v1':JSON.stringify(current)});return json({revision});
   }
   if(action==='begin'){
    if(data.revision!==context.revision)throw fail('Critères ou missions modifiés.',409);
    const {p,date,saved,tasks}=botSettings(context),task=chooseBotTask(tasks,p,date,{...saved.matrix,...saved.transitMatrix},data.claimed||{});
    if(!task||task.id!==data.taskId)throw fail('Mission non compatible avec le planning actuel.',409);
    const ledger=JSON.parse(context.state['taskpilot-requests']||'{}');if(['submitted','uncertain','sent'].includes(ledger[task.id]?.state))throw fail('Cette demande existe déjà.',409);
    ledger[task.id]={id:task.id,title:task.title,date:task.date,time:task.time,state:'uncertain',automation:true,sentAt:Date.now()};saved.tasks=tasks.map(t=>t.id===task.id?{...t,status:'pending',requestUncertain:true}:t);
    const revision=await this.accounts.botSave(context.id,context.revision,{...context.state,'taskpilot-v1':JSON.stringify(saved),'taskpilot-requests':JSON.stringify(ledger)});return json({revision});
   }
   if(action==='finish'){
    const saved=JSON.parse(context.state['taskpilot-v1']),ledger=JSON.parse(context.state['taskpilot-requests']||'{}'),item=ledger[data.taskId];
    if(!item?.automation||!['submitted','uncertain'].includes(data.outcome))throw fail('Demande inconnue.');
    // Merge into the latest state without changing the user's subsequent confirmation/cancellation.
    item.state=data.outcome;saved.tasks=saved.tasks.map(t=>t.id===data.taskId?{...t,requestUncertain:data.outcome==='uncertain'}:t);
    await this.accounts.botSave(context.id,context.revision,{...context.state,'taskpilot-v1':JSON.stringify(saved),'taskpilot-requests':JSON.stringify(ledger)});return json({ok:true});
   }
   throw fail('Action interne inconnue.',404);
  }
  if(request.url==='https://taskpilot.internal/transit-permit'&&request.method==='GET'){
   const now=Date.now();let budget=await this.ctx.storage.get('shared-transit-budget');
   if(!budget||budget.until<=now)budget={count:0,until:now+60000};
   const limit=Math.max(1,Math.min(120,Number(this.env.TRANSIT_REQUESTS_PER_MINUTE)||30));
   if(budget.count>=limit)return json({retryAt:budget.until+500},429);
   budget.count++;await this.ctx.storage.put('shared-transit-budget',budget);return json({allowed:true});
  }
  const url=new URL(request.url),req=nodeRequest(request);
  if(url.origin!==this.origin)throw fail('Adresse refusée.',403);
  if(url.pathname.startsWith('/api/account/')){
   if(!['GET','HEAD'].includes(request.method)){const data=await readJson(request);req[Symbol.asyncIterator]=async function*(){yield Buffer.from(JSON.stringify(data));};}
   const res=nodeResponse();await this.accounts.api(req,res,url);await this.accounts.waitForMail();
   await this.flowVault.save([...this.pending]);await this.cooldownVault.save([...this.cooldowns]);
   return res.response;
  }
  const user=this.accounts.authenticated(req);
  const upload=url.pathname==='/api/portal/snapshot'&&request.method==='POST'||url.pathname==='/api/portal/config'&&request.method==='GET';
  if(!user&&!upload)throw fail('Connectez-vous à TaskPilot.',401);
  if(url.pathname.startsWith('/api/portal/'))return await this.portal(request,user?.id);
  if(url.pathname.startsWith('/api/transit/')){
   const headers=new Headers(request.headers);headers.set('x-taskpilot-user',user.id);
   return {ownerId:user.id,request:new Request(request,{headers})};
  }
  if(url.pathname==='/api/bot/status'&&request.method==='GET')return {bot:true,ownerId:user.id,request};
  throw fail('API introuvable.',404);
 }catch(error){return json({error:error.status?error.message:'Service indisponible. Réessayez.'},error.status||503);}});
 // Release the account lock before transit calls: alarms request the shared API budget.
 if(result instanceof Response)return result;
 if(result.bot)return this.env.BOT.getByName('taskpilot-bot-v1',{locationHint:'weur'}).fetch(new Request('https://taskpilot.internal/status',{headers:{'x-taskpilot-user':result.ownerId}}));
 return this.env.TRANSIT.getByName('user:'+result.ownerId,{locationHint:'weur'}).fetch(result.request);
 }
 async portal(request,ownerId){
  const url=new URL(request.url);
  if(url.pathname==='/api/portal/snapshot'&&request.method==='POST'||url.pathname==='/api/portal/config'&&request.method==='GET'){
   const token=request.headers.get('x-taskpilot-token')||'';if(!/^[a-f0-9-]{72}$/.test(token))throw fail('Associez de nouveau le compagnon.',403);
   const hash=digest(token),owner=this.portalIndex[hash];if(!owner)throw fail('Associez de nouveau le compagnon.',403);
   const vault=await encryptedStorage(this.ctx.storage,this.env.DATA_ENCRYPTION_KEY,'portal:'+owner),record=await vault.load();
   if(!record||record.tokenHash!==hash||record.expiresAt<Date.now())throw fail('Associez de nouveau le compagnon.',403);
   if(url.pathname==='/api/portal/config')return json({monitoring:this.accounts.monitoringFor(owner),capabilities:{readOffers:true,autoReserve:false}});
   const rateKey='rate:portal:'+digest(owner),now=Date.now();let budget=await this.ctx.storage.get(rateKey);
   if(!budget||budget.until<=now)budget={count:0,until:now+60000};
   if(budget.count>=10)throw fail('Trop de synchronisations. Réessayez dans une minute.',429);
   budget.count++;await this.ctx.storage.put(rateKey,budget);await this.schedule();
   const data=await readJson(request,1000000);
   if(data.source!=='taskrabbit-board'||!Array.isArray(data.tasks)||!data.tasks.length||data.tasks.length>1000)throw fail('Liste vide ou source invalide : les offres précédentes sont conservées.');
   const tasks=normalizeTasks(data.tasks);if(JSON.stringify(record.snapshot?.tasks)!==JSON.stringify(tasks))record.revision++;
   record.snapshot={tasks,seenAt:Date.now(),scope:'visible-board'};
   await vault.save(record);return json({received:tasks.length,revision:record.revision});
  }
  const vault=await encryptedStorage(this.ctx.storage,this.env.DATA_ENCRYPTION_KEY,'portal:'+ownerId);
  let record=await vault.load();
  if(url.pathname==='/api/portal/pair'&&request.method==='POST'){
   if(request.headers.get('origin')!==this.origin)throw fail('Origine refusée.',403);
   const req=nodeRequest(request);await this.rateLimit(req);
   if(record?.tokenHash)delete this.portalIndex[record.tokenHash];
   const token=randomUUID()+randomUUID(),tokenHash=digest(token);record={tokenHash,expiresAt:Date.now()+90*86400000,revision:0,snapshot:null};
   this.portalIndex[tokenHash]=ownerId;await vault.save(record);await this.portalIndexVault.save(this.portalIndex);return json({token});
  }
  const paired=!!record&&record.expiresAt>Date.now();
  if(url.pathname==='/api/portal/status'&&request.method==='GET')return json({paired,revision:record?.revision||0,lastSeenAt:record?.snapshot?.seenAt,count:record?.snapshot?.tasks.length||0});
  if(url.pathname==='/api/portal/snapshot'&&request.method==='GET')return json({revision:record?.revision||0,snapshot:paired&&record.revision>Number(url.searchParams.get('after')||0)?record.snapshot:null});
  throw fail('Route inconnue.',404);
 }
 async alarm(){return this.serialize(async()=>{
  const now=Date.now();
  for(const [key,item]of await this.ctx.storage.list({prefix:'rate:'}))if(item.until<=now)await this.ctx.storage.delete(key);
  for(const [key,item]of this.pending)if(item.expires<=now)this.pending.delete(key);
  for(const [key,until]of this.cooldowns)if(until<=now)this.cooldowns.delete(key);
  for(const [id,message]of Object.entries(this.outbox)){
   if(message.expiresAt<=now||message.attempts>=6){delete this.outbox[id];continue;}
   if(message.nextAttempt>now)continue;
   try{await this.realMailer.send({...message,idempotencyKey:'taskpilot-'+id});delete this.outbox[id];}
   catch{message.attempts++;message.nextAttempt=Date.now()+Math.min(300000,10000*2**message.attempts);console.warn('Envoi e-mail à réessayer.');}
  }
  await this.outboxVault.save(this.outbox);await this.flowVault.save([...this.pending]);await this.cooldownVault.save([...this.cooldowns]);
  if(Object.keys(this.outbox).length||this.pending.size||this.cooldowns.size||(await this.ctx.storage.list({prefix:'rate:',limit:1})).size)await this.schedule();
 });}
}
