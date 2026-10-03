import {parisDay} from './pilot-policy.mjs';
import {defaults,validatePrefs,normalizeTasks,reasons,optimize,tomorrow,mins} from './model.mjs';
import {monitoringActive} from './portal-reader/schedule.mjs';
import {isWorkingDate} from './workdays.mjs';
import {mergeOffers} from './offers.mjs';
export const FREE_BROWSER_SECONDS=450,SESSION_RESERVE_SECONDS=90;
export const protectedTestEmail='memmoudkamel01@gmail.com';
export function utcDay(now=Date.now()){return new Date(now).toISOString().slice(0,10);}
export function freeBudget(previous,now=Date.now()){return previous?.day===utcDay(now)?previous:{day:utcDay(now),used:0,lastLaunch:0};}
export function reserveBrowser(previous,now=Date.now()){
 const budget=freeBudget(previous,now);
 if(budget.used+SESSION_RESERVE_SECONDS>FREE_BROWSER_SECONDS)throw Error('quota');
 if(budget.lastLaunch&&now-budget.lastLaunch<20000)throw Error('launch-spacing');
 return {...budget,used:budget.used+SESSION_RESERVE_SECONDS,lastLaunch:now};
}
export function releaseBrowser(budget,seconds,closed,now=Date.now()){
 if(!closed||budget.day!==utcDay(now))return budget;
 return {...budget,used:Math.max(0,budget.used-SESSION_RESERVE_SECONDS+Math.min(SESSION_RESERVE_SECONDS,Math.max(1,Math.ceil(seconds))))};
}
export function botSettings(context,now=Date.now()){
 if(!context||context.email===protectedTestEmail&&!context.pilot||!monitoringActive(context.monitoring,now))throw Error('Surveillance en pause.');
 if(context.pilot&&(parisDay(now)!==context.pilot.runDate||now>=Date.parse(context.pilot.expiresAt)||context.pilot.used>=context.pilot.maxRequests))throw Error('Essai personnel hors créneau ou terminé.');
 const saved=JSON.parse(context.state?.['taskpilot-v1']||'{}');
 if(!saved.prefs||saved.isDemo)throw Error('Enregistrez des critères réels.');
 const p={...defaults,...saved.prefs};validatePrefs(p);const date=context.pilot?.targetDate||tomorrow();
 if(!isWorkingDate(date,p))throw Error('Demain est un jour de repos.');
 if(p.maxPending===0)throw Error('Le plafond des demandes en attente est à zéro.');
 if(p.mobility==='bike')throw Error('Le calcul de trajets vélo doit être connecté avant les demandes automatiques.');
 return {p,date,saved,tasks:normalizeTasks(saved.tasks||[])};
}
export function prepareBotOffers(context,incoming){
 const settings=botSettings(context),merged=mergeOffers(settings.tasks,normalizeTasks(incoming).map(t=>({...t,status:'available'})),{complete:true});
 // A missing pending mission still occupies its slot; disappearance never means cancellation.
 const eligible=merged.tasks.filter(t=>t.date===settings.date&&!reasons(t,settings.p,settings.date).filter(r=>r!=='Coordonnées à renseigner').length);
 if(eligible.length>20)throw Error('Plus de 20 missions correspondent : précisez votre zone ou vos critères.');
 return {...settings,tasks:merged.tasks,eligible};
}
export function safeGeocode(address,options){
 const postcode=address.match(/\b\d{5}\b/)?.[0],top=options[0];
 return top&&postcode&&top.postcode===postcode&&top.score>=.8&&['housenumber','street'].includes(top.type)&&(!options[1]||top.score-options[1].score>=.08)?top:null;
}
export function botEdges(tasks,p,date){
 const home={id:'home',lat:p.lat,lon:p.lon},edges=[],finish=t=>mins(t.time)+Math.ceil(t.duration*(1+p.overrun/100));
 for(const to of tasks){edges.push({from:home,to,arrivalBy:mins(to.time)-p.transitBuffer,ready:mins(p.start),maxMinutes:p.maxFirst});
  for(const from of tasks)if(from.id!==to.id&&finish(from)+p.gap<=mins(to.time)-p.transitBuffer)edges.push({from,to,arrivalBy:mins(to.time)-p.transitBuffer,ready:finish(from)+p.gap,maxMinutes:p.maxTravel});
  if(p.returnHome)edges.push({from:to,to:home,departureAt:finish(to),ready:finish(to),maxMinutes:p.maxTravel});
 }return edges;
}
export function chooseBotTask(tasks,p,date,matrix,claimed={}){
 const candidates=tasks.filter(t=>['pending','confirmed'].includes(t.status)||!claimed[t.id]&&(p.mobility==='transit'||matrix['home>'+t.id]?.provider));
 const result=optimize(candidates,p,date,matrix);
 if(result.approximate||result.fixedConflict)return null;
 const plan=result.plans[0];if(!plan)return null;
 // Reject missing routes: the shared optimizer's distance/speed fallback is for previews only.
 if(plan.seq.some((x,i)=>p.mobility!=='transit'&&!matrix[(i?plan.seq[i-1].task.id:'home')+'>'+x.task.id]?.provider)||p.returnHome&&p.mobility!=='transit'&&!matrix[plan.seq.at(-1).task.id+'>home']?.provider)return null;
 return plan.seq.find(x=>x.task.status==='available')?.task||null;
}
export function sameOffer(expected,fresh,email){const street=s=>String(s||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');return !!fresh&&fresh.id===expected.id&&fresh.email===email&&fresh.date===expected.date&&fresh.time===expected.time&&fresh.duration===expected.duration&&Math.abs(fresh.pay-expected.pay)<.005&&fresh.brand===expected.brand&&fresh.postcode===expected.address.match(/\b\d{5}\b/)?.[0]&&!!fresh.street&&street(expected.address.split(',')[0])===street(fresh.street);}
