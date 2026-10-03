import {DurableObject} from 'cloudflare:workers';
import {randomUUID} from 'node:crypto';
import {isWorkingDate} from '../workdays.mjs';
import {defaults,validatePrefs,normalizeTasks,reasons,mins} from '../model.mjs';
import {routeKey} from '../transit-core.mjs';
import {queryTransit} from '../transit-provider.mjs';
import {encryptedStorage} from './encrypted-storage.mjs';
import {json,fail,readJson} from './security.mjs';

export function transitEdges(tasks,p){
 const home={id:'home',lat:p.lat,lon:p.lon},edges=[],finish=t=>mins(t.time)+Math.ceil(t.duration*(1+p.overrun/100));
 for(const target of tasks){const arrivalBy=mins(target.time)-p.transitBuffer;edges.push({from:home,to:target,arrivalBy,ready:mins(p.start),maxMinutes:p.maxFirst});for(const source of tasks)if(source.id!==target.id&&finish(source)+p.gap<=arrivalBy)edges.push({from:source,to:target,arrivalBy,ready:finish(source)+p.gap,maxMinutes:p.maxTravel});}
 if(p.returnHome)for(const source of tasks)edges.push({from:source,to:home,departureAt:finish(source),ready:finish(source),maxMinutes:p.maxTravel});
 return edges;
}
export class TransitPlanner extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.tail=Promise.resolve();ctx.blockConcurrencyWhile(async()=>{
  this.vault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'transit');
  this.data=await this.vault.load()||{credentials:{},job:null,cache:{}};
  if(this.data.job?.state==='running'&&await ctx.storage.getAlarm()===null)await ctx.storage.setAlarm(Date.now()+500);
 });}
 serialize(action){const task=this.tail.then(action);this.tail=task.catch(()=>{});return task;}
 token(provider){return this.data.credentials[provider]||(provider==='idfm'?this.env.PRIM_API_KEY:this.env.SNCF_API_KEY)||'';}
 async fetch(request){return this.serialize(async()=>{try{
  const url=new URL(request.url),ownerId=request.headers.get('x-taskpilot-user');if(!ownerId)throw fail('Utilisateur absent.',401);
  if(this.data.ownerId&&this.data.ownerId!==ownerId)throw fail('Calcul introuvable.',404);
  this.data.ownerId=ownerId;
  if(url.pathname==='/api/transit/status'&&request.method==='GET')return json({idfm:!!this.token('idfm'),sncf:!!this.token('sncf'),protectedStorage:true,managed:true});
  if(url.pathname==='/api/transit/credentials'&&request.method==='POST'){
   const data=await readJson(request,2000);if(!['idfm','sncf'].includes(data.provider)||typeof data.token!=='string'||data.token.length>300||/[\r\n]/.test(data.token))throw fail('Clé ou fournisseur invalide.');
   if(this.data.job?.state==='running')throw fail('Arrêtez le calcul avant de modifier votre clé.',409);
   this.data.credentials[data.provider]=data.token;this.data.cache={};await this.vault.save(this.data);return json({configured:!!this.token(data.provider)});
  }
  if(url.pathname==='/api/transit/jobs'&&request.method==='POST'){
   const data=await readJson(request,500000),p={...defaults,...data.p};validatePrefs(p);
   if(p.mobility!=='transit')throw fail('Sélectionnez les transports en commun.');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date||'')||!Number.isFinite(Date.parse(data.date))||new Date(data.date).toISOString().slice(0,10)!==data.date)throw fail('Date invalide.');
   if(!isWorkingDate(data.date,p))throw fail('Jour de repos : la planification est désactivée pour cette date.',409);
   if(!this.token(p.transitProvider))throw fail('Le fournisseur de transport doit être configuré.',409);
   if(this.data.job?.state==='running')throw fail('Un calcul est déjà en cours. Attendez sa fin ou arrêtez-le.',409);
   if(this.data.lastStartedAt>Date.now()-60000)throw fail('Patientez une minute avant de relancer un calcul.',429);
   const tasks=normalizeTasks(data.tasks).filter(t=>!reasons(t,p,data.date).length);if(!tasks.length)throw fail('Aucune mission ne respecte les critères.');if(tasks.length>20)throw fail('Limitez vos filtres à 20 missions.');
   const edges=transitEdges(tasks,p),now=Date.now();for(const [key,value]of Object.entries(this.data.cache))if(now-value.fetchedAt>=600000)delete this.data.cache[key];
   this.data.job={id:randomUUID(),state:'running',completed:0,total:edges.length,cached:0,unavailable:0,createdAt:now,ownerId,p,date:data.date,edges,matrix:{},missionCount:tasks.length};
   this.data.lastStartedAt=now;await this.vault.save(this.data);await this.ctx.storage.setAlarm(now+500);return json({id:this.data.job.id},202);
  }
  const match=url.pathname.match(/^\/api\/transit\/jobs\/([a-f0-9-]+)(\/cancel)?$/),job=this.data.job;
  if(!match||!job||job.id!==match[1]||job.ownerId!==ownerId)throw fail('Calcul introuvable.',404);
  if(match[2]&&request.method==='POST'){if(job.state==='running'){job.state='cancelled';job.finishedAt=Date.now();await this.vault.save(this.data);await this.ctx.storage.deleteAlarm();}return json({cancelled:true});}
  if(!match[2]&&request.method==='GET'){
   const {p,date,edges,matrix,...status}=job;
   if(job.state==='done')status.result={matrix,unavailable:job.unavailable,missionCount:job.missionCount,completed:job.completed};return json(status);
  }
  throw fail('API introuvable.',404);
 }catch(error){return json({error:error.status?error.message:'Calcul indisponible. Réessayez.'},error.status||503);}});}
 async alarm(){return this.serialize(async()=>{
  const job=this.data.job;if(!job||job.state!=='running')return;
  if(Date.now()-job.createdAt>3600000){job.state='error';job.error='Le calcul a expiré. Réduisez le nombre de missions et réessayez.';await this.vault.save(this.data);return;}
  const edge=job.edges[job.completed];if(!edge){job.state='done';job.finishedAt=Date.now();await this.vault.save(this.data);return;}
  const key=routeKey(edge.from,edge.to,job.p,job.date,edge),cached=this.data.cache[key];
  try{
   let leg;
   if(cached&&Date.now()-cached.fetchedAt<600000){leg=cached;job.cached++;}
   else{
    if(!this.data.credentials[job.p.transitProvider]){
     const authority=this.env.ACCOUNTS.getByName('taskpilot-accounts-v1',{locationHint:'weur'});
     const permit=await authority.fetch('https://taskpilot.internal/transit-permit');
     if(permit.status===429){const {retryAt}=await permit.json();await this.ctx.storage.setAlarm(retryAt);return;}
     if(!permit.ok)throw Error('Quota du calculateur momentanément indisponible.');
    }
    leg=await queryTransit({...edge,p:job.p,date:job.date,token:this.token(job.p.transitProvider),signal:AbortSignal.timeout(20000)});leg.fetchedAt=Date.now();this.data.cache[key]=leg;
   }
   job.matrix[key]=leg;if(!leg.available)job.unavailable++;job.completed++;
   if(job.completed===job.total){job.state='done';job.finishedAt=Date.now();}
  }catch(error){job.state='error';job.finishedAt=Date.now();job.error=error.name==='TimeoutError'?'Le fournisseur n’a pas répondu à temps.':error.message||'Calcul indisponible.';}
  await this.vault.save(this.data);
  if(job.state==='running')await this.ctx.storage.setAlarm(Date.now()+500);
 });}
}
