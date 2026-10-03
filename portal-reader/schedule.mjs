export const defaultMonitoring = {enabled:false,mode:'scheduled',times:['11:00','15:00'],beforeMinutes:5,afterMinutes:20};
export function normalizeMonitoring(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Réglages de surveillance invalides.');
  const v={...defaultMonitoring,...value};
  if(typeof v.enabled!=='boolean'||!['scheduled','all'].includes(v.mode))throw Error('Mode de surveillance invalide.');
  if(!Array.isArray(v.times)||v.times.length>12||v.times.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('Choisissez jusqu’à 12 horaires valides.');
  if(v.mode==='scheduled'&&!v.times.length)throw Error('Ajoutez au moins un horaire.');
  if(!Number.isInteger(v.beforeMinutes)||v.beforeMinutes<0||v.beforeMinutes>60||!Number.isInteger(v.afterMinutes)||v.afterMinutes<1||v.afterMinutes>180)throw Error('La marge doit être entre 0 et 60 minutes avant, et 1 et 180 minutes après.');
  return {enabled:v.enabled,mode:v.mode,times:[...new Set(v.times)].sort(),beforeMinutes:v.beforeMinutes,afterMinutes:v.afterMinutes};
}
export function parisMinute(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
  return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
}
export function monitoringActive(value,now=Date.now()) {
  const v=normalizeMonitoring(value);
  if(!v.enabled)return false;if(v.mode==='all')return true;
  const minute=parisMinute(now);
  return v.times.some(time=>{const [h,m]=time.split(':').map(Number),start=h*60+m-v.beforeMinutes,width=v.beforeMinutes+v.afterMinutes;return ((minute-start+1440)%1440)<width;});
}
export function monitoringLabel(value) {
  const v=normalizeMonitoring(value);
  if(!v.enabled)return 'Surveillance en pause';
  return v.mode==='all'?'Toute la journée · heure de Paris':v.times.join(' et ')+' · heure de Paris';
}
