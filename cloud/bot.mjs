import {DurableObject} from 'cloudflare:workers';
import {encryptedStorage} from './encrypted-storage.mjs';
import {json} from './security.mjs';
import {captureOffers,requestOffer,browserSession} from './portal-browser.mjs';
import {freeBudget,reserveBrowser,releaseBrowser,prepareBotOffers,botSettings,safeGeocode,botEdges,chooseBotTask,FREE_BROWSER_SECONDS} from '../bot-policy.mjs';
import {monitoringActive} from '../portal-reader/schedule.mjs';
import {geocodeAddress} from '../offers.mjs';
import {roadJourney} from '../road-routes.mjs';
import {reasons} from '../model.mjs';
import {routeKey} from '../transit-core.mjs';
import {queryTransit} from '../transit-provider.mjs';

export class BookingCoordinator extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.tail=Promise.resolve();ctx.blockConcurrencyWhile(async()=>{
  this.vault=await encryptedStorage(ctx.storage,env.DATA_ENCRYPTION_KEY,'bot');this.data=await this.vault.load()||{users:{},claims:{},budget:null,job:null};
  if(this.data.job&&await ctx.storage.getAlarm()===null)await ctx.storage.setAlarm(Date.now()+1000);
 });}
 serialize(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 approved(){return this.env.TASKRABBIT_AUTOMATION_APPROVED==='true';}
 async save(){await this.vault.save(this.data);}
 authority(){return this.env.ACCOUNTS.getByName('taskpilot-accounts-v1',{locationHint:'weur'});}
 async account(action,data){const response=await this.authority().fetch(new Request('https://taskpilot.internal/bot/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})}));const body=await response.json();if(!response.ok)throw Error(body.error||'Compte indisponible.');return body;}
 note(owner,message){const item=this.data.users[owner]||={};item.message=message;item.updatedAt=Date.now();item.history=[{at:Date.now(),message},...(item.history||[])].slice(0,20);}
 async fetch(request){return this.serialize(async()=>{
  const url=new URL(request.url);if(url.origin!=='https://taskpilot.internal')return json({error:'Accès refusé.'},403);
  if(url.pathname==='/status'){
   const owner=request.headers.get('x-taskpilot-user');if(!owner)return json({error:'Compte requis.'},401);
   const budget=freeBudget(this.data.budget);
   return json({available:this.approved(),autonomous:true,free:true,limitSeconds:FREE_BROWSER_SECONDS,remainingSeconds:Math.max(0,FREE_BROWSER_SECONDS-budget.used),reset:'00:00 UTC',...(this.data.users[owner]||{}),phase:this.data.job?.ownerId===owner?this.data.job.phase:null});
  }
  if(url.pathname!=='/tick')return json({error:'Route inconnue.'},404);
  if(!this.approved())return json({paused:true,reason:'taskrabbit-authorization'});
  if(this.data.job)return json({running:true});
  const now=Date.now(),{users}=await this.account('users');
  const eligible=users.filter(u=>monitoringActive(u.monitoring,now)&&now-(this.data.users[u.id]?.lastCheck||0)>=300000).sort((a,b)=>(this.data.users[a.id]?.lastCheck||0)-(this.data.users[b.id]?.lastCheck||0)||a.id.localeCompare(b.id));
  const user=eligible[0];if(!user)return json({idle:true});
  try{reserveBrowser(this.data.budget,now);}catch{this.note(user.id,'Quota gratuit partagé atteint : prochain essai après renouvellement du quota.');await this.save();return json({paused:true});}
  this.data.users[user.id]||={};this.data.users[user.id].lastCheck=now;
  this.data.job={ownerId:user.id,phase:'capture',createdAt:now};await this.save();await this.ctx.storage.setAlarm(now+500);return json({scheduled:true});
 });}
 async browse(fn){this.data.budget=reserveBrowser(this.data.budget);await this.save();return browserSession(this.env.BROWSER,fn,async(seconds,closed)=>{this.data.budget=releaseBrowser(this.data.budget,seconds,closed);await this.save();});}
 async alarm(){return this.serialize(async()=>{
  const job=this.data.job;if(!job)return;
  try{
   if(!this.approved())throw Error('L’autorisation Taskrabbit n’est pas activée.');
   const context=await this.account('context',{ownerId:job.ownerId});botSettings(context);
   if(Date.now()-job.createdAt>600000)throw Error('Calcul expiré : aucune nouvelle demande envoyée.');
   if(job.phase!=='capture'&&context.revision!==job.revision)throw Error('Vos critères ou missions ont changé : contrôle reporté.');
   if(job.phase==='capture'){
    const offers=await this.browse(browser=>captureOffers(browser,context.email));if(!offers.length)throw Error('Aucune offre lisible. Les missions précédentes sont conservées.');
    Object.assign(job,prepareBotOffers(context,offers),{revision:context.revision,phase:'geocode',index:0});
    this.note(job.ownerId,offers.length+' offres reçues. Vérification des adresses et du planning.');
   }else if(job.phase==='geocode'){
    const task=job.eligible[job.index++];
    if(task){if(task.lat===null||task.lon===null){const point=safeGeocode(task.address,await geocodeAddress(task.address));if(point){Object.assign(task,{lat:point.lat,lon:point.lon,locationPrecision:point.type});Object.assign(job.tasks.find(t=>t.id===task.id),task);}}}
    else{
     const candidates=job.tasks.filter(t=>!reasons(t,job.p,job.date).length),fixed=candidates.filter(t=>['pending','confirmed'].includes(t.status)),available=candidates.filter(t=>t.status==='available'&&!this.data.claims[t.id]).sort((a,b)=>b.pay/b.duration-a.pay/a.duration).slice(0,6);
     job.edges=botEdges([...fixed,...available],job.p,job.date);job.index=0;job.matrix={};job.transitMatrix={};job.phase='routes';
    }
   }else if(job.phase==='routes'){
    const edge=job.edges[job.index];
    if(edge){
     const permit=await this.authority().fetch('https://taskpilot.internal/transit-permit');if(permit.status===429){await this.ctx.storage.setAlarm((await permit.json()).retryAt);return;}if(!permit.ok)throw Error('Calculateur indisponible.');
     if(job.p.mobility==='transit'){
      const token=job.p.transitProvider==='idfm'?this.env.PRIM_API_KEY:this.env.SNCF_API_KEY;if(!token)throw Error('Transport non configuré par la plateforme.');
      const leg=await queryTransit({...edge,p:job.p,date:job.date,token,signal:AbortSignal.timeout(15000)});leg.fetchedAt=Date.now();job.transitMatrix[routeKey(edge.from,edge.to,job.p,job.date,edge)]=leg;
     }else{const key=edge.from.id+'>'+edge.to.id;try{const leg=await roadJourney(edge.from,edge.to,job.p.mobility);leg.minutes+=10;job.matrix[key]=leg;}catch{job.matrix[key]={available:false,minutes:0,km:0,provider:'ign',mode:job.p.mobility,fetchedAt:Date.now()};}}
     job.index++;
    }else{
     const updated=await this.account('offers',{ownerId:job.ownerId,revision:job.revision,tasks:job.tasks,matrix:job.matrix,transitMatrix:job.transitMatrix});job.revision=updated.revision;
     const task=chooseBotTask(job.tasks,job.p,job.date,{...job.matrix,...job.transitMatrix},this.data.claims);
     if(!task){this.note(job.ownerId,'Contrôle terminé : aucune nouvelle mission avec un planning compatible et des trajets calculés.');this.data.job=null;}
     else{job.task=task;job.phase='request';}
    }
   }else if(job.phase==='request'){
    const nextLaunch=(this.data.budget?.lastLaunch||0)+20000;if(Date.now()<nextLaunch){await this.ctx.storage.setAlarm(nextLaunch);return;}
    const task=job.task;if(this.data.claims[task.id])throw Error('Cette mission fait déjà l’objet d’une demande TaskPilot.');
    const started=Date.now();let begun=false;
    let outcome;
    try{outcome=await this.browse(browser=>requestOffer(browser,context.email,task,async()=>{
     if(Date.now()-started>20000||this.data.job!==job||!this.approved())throw Error('Délai dépassé avant envoi.');
     // Claim globally before persisting the pending request. An interrupted operation stays held.
     this.data.claims[task.id]={ownerId:job.ownerId,at:Date.now(),state:'uncertain'};await this.save();
     const updated=await this.account('begin',{ownerId:job.ownerId,revision:job.revision,taskId:task.id,claimed:{...this.data.claims,[task.id]:undefined}});job.revision=updated.revision;begun=true;
    }));}catch(error){if(!begun)throw error;outcome='uncertain';}
    if(!begun)throw Error('La demande n’a pas été préparée.');this.data.claims[task.id].state=outcome;
    await this.account('finish',{ownerId:job.ownerId,taskId:task.id,outcome});
    this.note(job.ownerId,outcome==='submitted'?'Demande envoyée pour la mission '+task.id+'. Attribution à vérifier dans Taskrabbit.':'Envoi incertain pour la mission '+task.id+'. Vérifiez Taskrabbit : aucun renvoi automatique.');this.data.job=null;
   }
  }catch(error){this.note(job.ownerId,job.phase==='request'&&this.data.claims[job.task?.id]?.state==='uncertain'?'Demande '+job.task.id+' à vérifier dans Taskrabbit : état incertain, aucun renvoi automatique.':error.message||'Contrôle indisponible. Aucune nouvelle demande.');this.data.job=null;}
  await this.save();if(this.data.job)await this.ctx.storage.setAlarm(Date.now()+500);
 });}
}
