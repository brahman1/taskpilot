export function parisDay(now=Date.now()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function trialDates(pilot){
 const start=pilot?.targetDate,end=pilot?.targetEndDate||start;
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end))return [];
 const days=(Date.parse(end)-Date.parse(start))/86400000;if(!Number.isInteger(days)||days<0||days>6)return [];
 return Array.from({length:days+1},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10));
}
// Configuration comes exclusively from a Worker secret, never from account preferences.
export function privatePilot(raw,user,now=Date.now()) {
 let p;try{p=JSON.parse(raw||'null');}catch{return null;}
 if(!p||!user?.emailVerified||p.ownerEmail!==user.email||p.taskrabbitEmail!==user.taskrabbitEmail||![1,2,3,4].includes(p.maxRequests)||!/^\d{4}-\d{2}-\d{2}$/.test(p.runDate)||!trialDates(p).length||p.targetDate<=p.runDate||!p.id||!Number.isFinite(Date.parse(p.expiresAt))||now>=Date.parse(p.expiresAt))return null;
 return {id:p.id,runDate:p.runDate,targetDate:p.targetDate,targetEndDate:p.targetEndDate||p.targetDate,expiresAt:p.expiresAt,maxRequests:p.maxRequests,used:Number(user.pilotAttempts?.[p.id]||0)};
}
