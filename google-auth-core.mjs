import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const digest=value=>createHash('sha256').update(value).digest('hex');
export const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const cookie=(value,age=600)=>'taskpilot_oauth='+value+'; HttpOnly; SameSite=Lax; Path=/api/account/google; Max-Age='+age;
export function createGoogleAuth(config,{fetcher=fetch,keySet=jwks,pending=new Map(),publicOrigin}={}){
 const verify=token=>jwtVerify(token,keySet,{issuer:['https://accounts.google.com','accounts.google.com'],audience:config.clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce','email','email_verified'],maxTokenAge:'10 minutes',clockTolerance:5});
 const configured=Boolean(config.clientId&&config.clientSecret);
 function start(req,context){
  if(!configured)throw Object.assign(Error('La connexion Google doit être configurée par le propriétaire de la plateforme.'),{status:503});
  for(const [key,p]of pending)if(p.expires<Date.now())pending.delete(key);
  if(pending.size>=100)throw Object.assign(Error('Trop de connexions en cours. Réessayez bientôt.'),{status:429});
  const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
  const redirectUri=(publicOrigin||'http://'+req.headers.host)+'/api/account/google/callback';
  pending.set(digest(state),{...context,browser:digest(browser),nonce,verifier,redirectUri,host:req.headers.host,expires:Date.now()+600000});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();return {url:url.href,cookie:cookie(browser)+(publicOrigin?'; Secure':'')};
 }
 async function finish(req,url){
  const state=url.searchParams.get('state')||'',browser=cookieValue(req,'taskpilot_oauth'),key=digest(state),p=pending.get(key);
  if(!/^[a-f0-9]{64}$/.test(state)||!p||p.host!==req.headers.host||p.expires<Date.now()||!browser||!timingSafeEqual(Buffer.from(p.browser,'hex'),Buffer.from(digest(browser),'hex')))throw Error('Invalid OAuth state');
  pending.delete(key); // Consume once, including failed exchanges and denied consent.
  if(url.searchParams.has('error'))throw Object.assign(Error('Consent cancelled'),{authCode:'google_cancelled'});
  const code=url.searchParams.get('code');if(!code||code.length>4096)throw Error('Invalid authorization code');
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:p.redirectUri,grant_type:'authorization_code',code_verifier:p.verifier}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Google exchange failed');const tokens=await response.json();
  const {payload}=await verify(tokens.id_token);if(payload.nonce!==p.nonce||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||typeof payload.email!=='string'||(payload.azp&&payload.azp!==config.clientId))throw Error('Invalid Google identity');
  return {identity:{subject:payload.sub,email:payload.email,name:String(payload.name||'').slice(0,80)},context:p};
 }
 return {configured,start,finish,clearCookie:cookie('',0)+(publicOrigin?'; Secure':'')};
}
