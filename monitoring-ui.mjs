import {normalizeMonitoring,monitoringActive,monitoringLabel} from './portal-reader/schedule.mjs';
export function setupMonitoring({getUser,saveProfile,saveMonitoring,showAccount}) {
  const $=s=>document.querySelector(s);let config=normalizeMonitoring(getUser().monitoring),lastStatus=null,busy=false;
  function renderTimes(){ $('#watchTimes').replaceChildren(...config.times.map(time=>{const chip=document.createElement('button');chip.type='button';chip.className='watch-time';chip.textContent=time+' ×';chip.setAttribute('aria-label','Retirer '+time);chip.onclick=()=>{config.times=config.times.filter(t=>t!==time);renderTimes();};return chip;})); }
  function draw(){const user=getUser();config=normalizeMonitoring(user.monitoring);$('#taskrabbitSettingsEmail').value=user.taskrabbitEmail||'';$('#taskrabbitEmailSummary').textContent=user.taskrabbitEmail||'Votre adresse Taskrabbit n’est pas encore renseignée.';$('#watchEnabled').checked=config.enabled;$('#watchMode').value=config.mode;$('#watchBefore').value=config.beforeMinutes;$('#watchAfter').value=config.afterMinutes;$('#watchWindows').hidden=config.mode==='all';renderTimes();renderStatus();}
  function renderStatus(){ const paired=lastStatus?.paired,fresh=lastStatus?.lastSeenAt&&Date.now()-lastStatus.lastSeenAt<90000;
    $('#monitorStatus').textContent=!getUser().taskrabbitEmail?'Adresse Taskrabbit à renseigner':!paired?'Portail à connecter':!config.enabled?'Surveillance en pause':!monitoringActive(config)?'Prochain contrôle aux horaires choisis':fresh?'Offres synchronisées':'En attente du navigateur Taskrabbit';
    $('#monitorScheduleSummary').textContent=monitoringLabel(config);
    $('#monitorLastSeen').textContent=lastStatus?.lastSeenAt?'Dernière liste reçue : '+new Date(lastStatus.lastSeenAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})+' · '+lastStatus.count+' offres visibles.':'Aucune liste reçue pour le moment.';
    $('#sourceLabel').textContent=lastStatus?.lastSeenAt?'Vos offres Taskrabbit':'Connectez votre compte Taskrabbit';
    $('#sourceDetail').textContent=lastStatus?.lastSeenAt?$('#monitorLastSeen').textContent:'Renseignez votre adresse et associez le portail une seule fois. Les offres seront ensuite synchronisées.';
  }
  $('#watchMode').onchange=()=>{$('#watchWindows').hidden=$('#watchMode').value==='all';};
  $('#addWatchTime').onclick=()=>{const input=$('#newWatchTime');if(!input.value||!input.reportValidity())return;if(config.times.length>=12){$('#monitorMessage').textContent='12 horaires maximum.';return;}config.times=[...new Set([...config.times,input.value])].sort();renderTimes();};
  $('#monitoringForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('#saveMonitoring').disabled=true;$('#monitorMessage').textContent='';try{const next=normalizeMonitoring({enabled:$('#watchEnabled').checked,mode:$('#watchMode').value,times:config.times,beforeMinutes:Number($('#watchBefore').value),afterMinutes:Number($('#watchAfter').value)});if(next.enabled&&!getUser().taskrabbitEmail)throw Error('Enregistrez d’abord votre e-mail Taskrabbit ci-dessus.');await saveMonitoring(next);draw();$('#monitorMessage').textContent='Horaires enregistrés. Le compagnon les applique automatiquement lorsqu’il est connecté.';}catch(e){$('#monitorMessage').textContent=e.message;}finally{busy=false;$('#saveMonitoring').disabled=false;}};
  $('#taskrabbitSettingsForm').onsubmit=async e=>{e.preventDefault();const button=$('#saveTaskrabbitSettings');button.disabled=true;$('#taskrabbitSettingsMessage').textContent='';try{await saveProfile({taskrabbitEmail:$('#taskrabbitSettingsEmail').value});draw();$('#taskrabbitSettingsMessage').textContent='Adresse enregistrée pour vos prochaines connexions.';}catch(e){$('#taskrabbitSettingsMessage').textContent=e.message;}finally{button.disabled=false;}};
  $('#editTaskrabbitAccount').onclick=()=>showAccount();
  $('#connectFromMonitoring').onclick=()=>$('#connectDialog').showModal();
  window.addEventListener('taskpilot-profile-updated',draw);
  window.addEventListener('taskpilot-portal-status',e=>{lastStatus=e.detail;renderStatus();});
  draw();const timer=setInterval(renderStatus,30000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
