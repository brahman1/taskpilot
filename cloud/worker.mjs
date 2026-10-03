import {publicOrigin,secureResponse,json} from './security.mjs';
export {AccountAuthority} from './accounts.mjs';
export {TransitPlanner} from './transit.mjs';
export default {async fetch(request,env){try{
 const url=new URL(request.url),origin=publicOrigin(env);
 if(url.origin!==origin){
  if(url.hostname==='www.'+new URL(origin).hostname)return secureResponse(Response.redirect(origin+url.pathname+url.search,308));
  return secureResponse(json({error:'Adresse du site non autorisée.'},403));
 }
 if(url.pathname==='/api/health')return secureResponse(json({ok:true,accountsConfigured:Boolean(env.DATA_ENCRYPTION_KEY),emailConfigured:Boolean(env.RESEND_API_KEY&&env.MAIL_FROM),googleConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)}));
 if(url.pathname.startsWith('/api/')){
  if(!env.DATA_ENCRYPTION_KEY)return secureResponse(json({error:'Le propriétaire doit terminer la configuration sécurisée du site.'},503));
  const upload=url.pathname==='/api/portal/snapshot'&&request.method==='POST';
  if(!['GET','HEAD'].includes(request.method)&&(!request.headers.get('content-type')?.startsWith('application/json')||!upload&&request.headers.get('origin')!==origin))return secureResponse(json({error:'Origine ou format de requête refusé.'},403));
  // The root Worker is the only public entry point. Bindings cannot be fetched publicly.
  const authority=env.ACCOUNTS.getByName('taskpilot-accounts-v1',{locationHint:'weur'});
  return secureResponse(await authority.fetch(request));
 }
 if(!['GET','HEAD'].includes(request.method))return secureResponse(new Response('Méthode refusée',{status:405}));
 return secureResponse(await env.ASSETS.fetch(request));
 }catch{return secureResponse(json({error:'Service momentanément indisponible.'},503));}}};
