import {createAccountMailer} from './account-mail-core.mjs';
import {createGoogleAuth,cookieValue} from './google-auth-core.mjs';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {defaults,validatePrefs,normalizeTasks} from './model.mjs';
const scrypt=promisify(scryptCallback),sessionLifetime=7*24*3600000;
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const allowedKeys=['taskpilot-v1','taskpilot-requests','taskpilot-alerts'];
export function validateEmail(value,optional=false){const email=String(value||'').trim().toLowerCase();if(optional&&!email)return '';if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Renseignez une adresse e-mail valide.');return email;}
function publicUser(user){return {id:user.id,email:user.email,name:user.name,taskrabbitEmail:user.taskrabbitEmail,emailVerified:user.emailVerified===true,taskrabbitSetupDone:!!user.taskrabbitEmail||user.taskrabbitSetupDone===true,hasPassword:!!user.passwordHash,googleLinked:!!user.googleSubject};}
function validateState(state){if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).some(k=>!allowedKeys.includes(k)))throw fail('Données du compte invalides.');for(const [key,value]of Object.entries(state)){if(typeof value!=='string')throw fail('Données du compte invalides.');try{const parsed=JSON.parse(value);if(key==='taskpilot-v1'){if(!parsed||typeof parsed!=='object')throw Error();validatePrefs({...defaults,...parsed.prefs});if(parsed.tasks)normalizeTasks(parsed.tasks);}else if(key==='taskpilot-alerts'){if(typeof parsed!=='boolean')throw Error();}else if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();}catch{throw fail('Données du compte invalides.');}}return state;}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2000000)throw fail('Données trop volumineuses.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('Requête JSON invalide.');}}
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
export async function createAccountCore(options){
 const storage=options.storage;
 if(!storage)throw Error('Stockage des comptes requis.');
 const origins=options.allowedOrigins||['http://127.0.0.1:4173','http://localhost:4173'];
 const hosts=origins.map(origin=>new URL(origin).host);
 const cookieSecurity=options.public?' Secure;':'';
 let database=await storage.load()||{users:[],sessions:{}};
 if(!Array.isArray(database.users)||!database.sessions)throw Error('Base des comptes invalide.');
 database.accountTokens||={};
 const mailer=options.mailer||createAccountMailer({});
 if(options.requireMail&&!mailer.configured)throw Error('Configurez le service e-mail avant un lancement public.');
 const mailJobs=new Set(),mailCooldowns=options.mailCooldowns||new Map();
 const google=createGoogleAuth(options.googleConfig||{},options.googleOptions);
 let writes=Promise.resolve();const failures=new Map(),attempts=new Map();
 async function throttle(req){if(options.rateLimiter)return options.rateLimiter(req);const key=req.socket?.remoteAddress||'local',now=Date.now();for(const [id,item]of attempts)if(item.until<=now)attempts.delete(id);const item=attempts.get(key);if(item&&item.count>=30)throw fail('Trop de tentatives. Réessayez dans quelques minutes.',429);attempts.set(key,{count:(item?.count||0)+1,until:item?.until||now+600000});}
 function persist(){const save=writes.then(()=>storage.save(database));writes=save.catch(()=>{});return save;}
 function authenticated(req){const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('taskpilot_session='));const token=cookie?.slice('taskpilot_session='.length);if(!/^[a-f0-9]{64}$/.test(token||''))return null;const session=database.sessions[hash(token)];if(!session||session.expiresAt<=Date.now())return null;const user=database.users.find(u=>u.id===session.userId);if(!user||mailer.configured&&!user.emailVerified&&!session.googleVerified)return null;return user;}
 const cookie=token=>'taskpilot_session='+token+'; HttpOnly;'+cookieSecurity+' SameSite=Strict; Path=/; Max-Age='+sessionLifetime/1000;
 async function signIn(user,res,req,redirect=false){const previous=cookieValue(req,'taskpilot_session');if(previous)delete database.sessions[hash(previous)];const token=randomBytes(32).toString('hex');for(const [id,session]of Object.entries(database.sessions))if(session.expiresAt<=Date.now())delete database.sessions[id];database.sessions[hash(token)]={userId:user.id,expiresAt:Date.now()+sessionLifetime,googleVerified:redirect};await persist();if(redirect){res.writeHead(303,{'Location':'/','Cache-Control':'no-store','Set-Cookie':[cookie(token),google.clearCookie]});return res.end();}send(res,200,{user:publicUser(user)},{'Set-Cookie':cookie(token)});}
 async function googleCallback(req,res,url){try{
  const {identity,context}=await google.finish(req,url);const email=validateEmail(identity.email);
  let owner=database.users.find(u=>u.googleSubject===identity.subject);
  if(context.linkUserId){
   const session=database.sessions[context.sessionHash];const target=database.users.find(u=>u.id===context.linkUserId);
   if(!target||!session||session.userId!==target.id||session.expiresAt<=Date.now())throw Error('Expired link session');
   if(owner&&owner.id!==target.id)throw Object.assign(Error(),{authCode:'google_conflict'});
   if(target.googleSubject&&target.googleSubject!==identity.subject)throw Object.assign(Error(),{authCode:'google_conflict'});
   target.googleSubject=identity.subject;if(target.email===email)target.emailVerified=true;owner=target;
  }else if(!owner){
   // Email equality alone must never grant access to an unverified local account.
   if(database.users.some(u=>u.email===email))throw Object.assign(Error(),{authCode:'google_existing'});
   if(database.users.length>=1000)throw Error('Account limit');
   owner={id:randomUUID(),email,name:identity.name,googleSubject:identity.subject,emailVerified:true,taskrabbitEmail:context.taskrabbitEmail||'',state:context.state||{},revision:0,createdAt:Date.now()};database.users.push(owner);
  }
  if(owner.email===email)owner.emailVerified=true;await signIn(owner,res,req,true);
 }catch(e){const code=['google_cancelled','google_existing','google_conflict'].includes(e.authCode)?e.authCode:'google_failed';res.writeHead(303,{'Location':'/?authError='+code,'Cache-Control':'no-store','Set-Cookie':google.clearCookie});res.end();}}

 function removeTokens(userId,purpose){for(const [key,t]of Object.entries(database.accountTokens))if(t.userId===userId&&(!purpose||t.purpose===purpose))delete database.accountTokens[key];}
 function tokenRecord(raw,purpose){if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw fail('Lien invalide ou expiré. Demandez un nouveau lien.',400);const key=hash(raw),record=database.accountTokens[key];if(!record||record.purpose!==purpose||record.expiresAt<=Date.now())throw fail('Lien invalide ou expiré. Demandez un nouveau lien.',400);const target=database.users.find(u=>u.id===record.userId);if(!target||record.passwordVersion!==hash(target.passwordHash||''))throw fail('Lien invalide ou expiré. Demandez un nouveau lien.',400);return {key,record,target};}
 function queueMail(target,purpose){if(!target||!mailer.configured||(purpose==='verify'&&target.emailVerified)||(purpose==='reset'&&!target.passwordHash))return;
  const now=Date.now(),cooldown=target.id+':'+purpose;for(const [key,until]of mailCooldowns)if(until<=now)mailCooldowns.delete(key);if(mailCooldowns.has(cooldown)||mailJobs.size>=25)return;mailCooldowns.set(cooldown,now+60000);
  const job=(async()=>{const raw=randomBytes(32).toString('hex'),key=hash(raw);for(const [id,t]of Object.entries(database.accountTokens))if(t.expiresAt<=now)delete database.accountTokens[id];removeTokens(target.id,purpose);database.accountTokens[key]={userId:target.id,purpose,expiresAt:now+(purpose==='reset'?15:60)*60000,passwordVersion:hash(target.passwordHash||'')};await persist();try{await mailer.send({to:target.email,purpose,token:raw});}catch{delete database.accountTokens[key];await persist();throw Error('Envoi e-mail échoué.');}})();mailJobs.add(job);job.catch(()=>{(options.onMailError||(()=>console.warn('Envoi e-mail échoué : vérifiez la configuration du service.')))();}).finally(()=>mailJobs.delete(job));
 }
 async function api(req,res,url){try{
  if(!hosts.includes(req.headers.host))throw fail('Hôte non autorisé.',403);
  if(req.method!=='GET'&&(!origins.includes(req.headers.origin)||!req.headers['content-type']?.startsWith('application/json')))throw fail('Requête non autorisée.',403);
  const action=url.pathname.slice('/api/account/'.length),user=authenticated(req);
  if(action==='email/config'&&req.method==='GET')return send(res,200,{configured:mailer.configured,verificationRequired:options.public||mailer.configured});
  if(['resend-verification','forgot-password'].includes(action)&&req.method==='POST'){await throttle(req);const data=await body(req),email=validateEmail(data.email);if(!mailer.configured)throw fail('L’envoi d’e-mails doit être configuré par le propriétaire de TaskPilot.',503);const target=database.users.find(u=>u.email===email);queueMail(target,action==='forgot-password'?'reset':'verify');return send(res,200,{message:'Si cette adresse correspond à un compte concerné, vous recevrez un lien par e-mail. Vérifiez aussi vos courriers indésirables. Patientez une minute avant une nouvelle demande.'});}
  if(action==='verify-email'&&req.method==='POST'){await throttle(req);const data=await body(req),{key,target}=tokenRecord(data.token,'verify');delete database.accountTokens[key];target.emailVerified=true;await persist();return send(res,200,{ok:true});}
  if(action==='reset-password'&&req.method==='POST'){await throttle(req);const data=await body(req);if(typeof data.password!=='string')throw fail('Mot de passe invalide.');const password=data.password;if(password.length<10||password.length>128)throw fail('Choisissez un mot de passe entre 10 et 128 caractères.');const {key,target}=tokenRecord(data.token,'reset');delete database.accountTokens[key];const salt=randomBytes(16).toString('hex'),passwordHash=(await scrypt(password,salt,64)).toString('hex');target.salt=salt;target.passwordHash=passwordHash;target.emailVerified=true;removeTokens(target.id);for(const [key,session]of Object.entries(database.sessions))if(session.userId===target.id)delete database.sessions[key];await persist();return send(res,200,{ok:true},{'Set-Cookie':'taskpilot_session=; HttpOnly;'+cookieSecurity+' SameSite=Strict; Path=/; Max-Age=0'});}
  if(action==='google/config'&&req.method==='GET')return send(res,200,{configured:google.configured});
  if(action==='google/callback'&&req.method==='GET')return await googleCallback(req,res,url);
  if(action==='google/start'&&req.method==='POST'){
   await throttle(req);const data=await body(req);let context={};
   if(data.link){if(!user)throw fail('Connectez-vous avant d’associer Google.',401);if(!user.passwordHash)throw fail('Google est déjà votre méthode de connexion.',409);const candidate=await scrypt(String(data.password||'').slice(0,128),user.salt,64);if(!timingSafeEqual(candidate,Buffer.from(user.passwordHash,'hex')))throw fail('Mot de passe incorrect.',401);context={linkUserId:user.id,sessionHash:hash(cookieValue(req,'taskpilot_session'))};}
   else{context={state:validateState(data.state||{}),taskrabbitEmail:validateEmail(data.taskrabbitEmail,true)};}
   const flow=google.start(req,context);return send(res,200,{url:flow.url},{'Set-Cookie':flow.cookie});
  }
  if(action==='me'&&req.method==='GET')return send(res,200,{user:user?publicUser(user):null});
  if(['register','login'].includes(action)&&req.method==='POST'){
   if(options.public&&!mailer.configured)throw fail('Les inscriptions et connexions par mot de passe ouvriront après activation du service e-mail.',503);
   await throttle(req);const data=await body(req),email=validateEmail(data.email),password=String(data.password||'');if(password.length>128)throw fail('Mot de passe trop long.');
   const address=req.socket?.remoteAddress||'local',rateKey=address+':'+email,rate=failures.get(rateKey);if(rate&&rate.until>Date.now()&&rate.count>=10)throw fail('Trop de tentatives. Réessayez dans quelques minutes.',429);
   if(action==='register'){
    if(password.length<10)throw fail('Choisissez un mot de passe d’au moins 10 caractères.');
    if(database.users.length>=1000)throw fail('Limite de comptes locaux atteinte.',409);
    if(database.users.some(u=>u.email===email))throw fail('Un compte existe déjà avec cette adresse. Connectez-vous.',409);
    const salt=randomBytes(16).toString('hex'),passwordHash=(await scrypt(password,salt,64)).toString('hex');
    const taskrabbitEmail=validateEmail(data.taskrabbitEmail,true),state=validateState(data.state||{});
    // Recheck after the asynchronous password hash to prevent duplicate concurrent signups.
    if(database.users.some(u=>u.email===email))throw fail('Un compte existe déjà avec cette adresse.',409);
    const created={id:randomUUID(),email,name:String(data.name||'').trim().slice(0,80),taskrabbitEmail,salt,passwordHash,emailVerified:false,state,revision:0,createdAt:Date.now()};database.users.push(created);if(mailer.configured){await persist();queueMail(created,'verify');return send(res,202,{requiresVerification:true,message:'Votre compte est créé. Un lien de vérification vous sera envoyé par e-mail. Confirmez votre adresse avant de vous connecter.'});}return await signIn(created,res,req);
   }
   const existing=database.users.find(u=>u.email===email),salt=existing?.salt||'taskpilot-dummy-salt';const candidate=await scrypt(password,salt,64);if(!existing?.passwordHash||!timingSafeEqual(candidate,Buffer.from(existing.passwordHash,'hex'))){failures.set(rateKey,{count:rate&&rate.until>Date.now()?rate.count+1:1,until:Date.now()+600000});throw fail('E-mail ou mot de passe incorrect.',401);}failures.delete(rateKey);if(mailer.configured&&!existing.emailVerified)throw Object.assign(fail('Vérifiez votre adresse e-mail avant de vous connecter. Vous pouvez demander un nouveau lien.',403),{code:'email_verification_required'});return await signIn(existing,res,req);
  }
  if(!user)throw fail('Connectez-vous pour accéder à votre compte.',401);
  if(action==='logout'&&req.method==='POST'){for(const token of String(req.headers.cookie||'').split(';'))if(token.trim().startsWith('taskpilot_session='))delete database.sessions[hash(token.trim().slice('taskpilot_session='.length))];await persist();return send(res,200,{ok:true},{'Set-Cookie':'taskpilot_session=; HttpOnly;'+cookieSecurity+' SameSite=Strict; Path=/; Max-Age=0'});}
  if(action==='profile'&&req.method==='POST'){const data=await body(req);if(Object.hasOwn(data,'taskrabbitSetupDone')&&typeof data.taskrabbitSetupDone!=='boolean')throw fail('Choix de configuration invalide.');const email=Object.hasOwn(data,'taskrabbitEmail')?validateEmail(data.taskrabbitEmail,true):user.taskrabbitEmail||'';user.taskrabbitEmail=email;if(email||data.taskrabbitSetupDone===true)user.taskrabbitSetupDone=true;user.name=String(data.name??user.name).trim().slice(0,80);await persist();return send(res,200,{user:publicUser(user)});}
  if(action==='state'&&req.method==='GET')return send(res,200,{state:user.state||{},revision:user.revision||0});
  if(action==='state'&&req.method==='PUT'){const data=await body(req);if(data.revision!==(user.revision||0))throw fail('Vos données ont changé dans un autre onglet. Rechargez avant de continuer.',409);user.state=validateState(data.state);user.revision=(user.revision||0)+1;await persist();return send(res,200,{revision:user.revision});}
  throw fail('Action introuvable.',404);
 }catch(e){send(res,e.status||500,{error:e.status?e.message:'Impossible d’enregistrer le compte. Réessayez.',...(e.code==='email_verification_required'?{code:e.code}:{})});}}
 return {api,authenticated,waitForMail:()=>Promise.allSettled([...mailJobs])};
}
