export function parisDay(now=Date.now()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
// Configuration comes exclusively from a Worker secret, never from account preferences.
export function privatePilot(raw,user,now=Date.now()) {
 let p;try{p=JSON.parse(raw||'null');}catch{return null;}
 if(!p||!user?.emailVerified||p.ownerEmail!==user.email||p.taskrabbitEmail!==user.taskrabbitEmail||p.maxRequests!==1||!/^\d{4}-\d{2}-\d{2}$/.test(p.runDate)||!/^\d{4}-\d{2}-\d{2}$/.test(p.targetDate)||p.targetDate<=p.runDate||!p.id||!Number.isFinite(Date.parse(p.expiresAt))||now>=Date.parse(p.expiresAt))return null;
 return {id:p.id,runDate:p.runDate,targetDate:p.targetDate,expiresAt:p.expiresAt,maxRequests:1,used:Number(user.pilotAttempts?.[p.id]||0)};
}
