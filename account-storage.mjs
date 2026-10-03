let values={},revision=0,timer,inFlight=null,dirty=false,enabled=false;
function syncStatus(message,error=false){const el=document.querySelector('#accountSync');if(el){el.textContent=message;el.classList.toggle('sync-error',error);}}
export const accountStorage={
 async initialize(){const response=await fetch('/api/account/state');if(!response.ok)throw Error('Impossible de charger votre compte.');const data=await response.json();values=data.state;revision=data.revision;enabled=true;syncStatus('Enregistré sur cet ordinateur');},
 getItem(key){return values[key]??null;},
 setItem(key,value){if(values[key]===String(value))return;values[key]=String(value);dirty=true;syncStatus('Enregistrement…');clearTimeout(timer);timer=setTimeout(()=>this.flush().catch(e=>syncStatus(e.message,true)),200);},
 async flush(){clearTimeout(timer);if(inFlight)await inFlight;if(!dirty||!enabled)return;const state={...values};dirty=false;inFlight=(async()=>{const response=await fetch('/api/account/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,revision})});const data=await response.json();if(!response.ok)throw Error(data.error||'Enregistrement impossible.');revision=data.revision;syncStatus('Enregistré sur cet ordinateur');})();try{await inFlight;}catch(e){dirty=true;syncStatus(e.message,true);throw e;}finally{inFlight=null;}if(dirty)await this.flush();},
 get hasPending(){return dirty||!!inFlight;}
};
