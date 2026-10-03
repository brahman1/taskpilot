import {createHash,randomBytes} from 'node:crypto';

export const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
export const randomToken=()=>randomBytes(32).toString('hex');
export const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
export async function readJson(request,maxBytes=2000000){
 const reader=request.body?.getReader();if(!reader)throw fail('Requête JSON invalide.');
 const parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw fail('Données trop volumineuses.',413);}parts.push(value);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('Requête JSON invalide.');}
}
export function publicOrigin(env){const url=new URL(env.PUBLIC_URL||'https://task-pilot.net');if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('PUBLIC_URL doit être une origine HTTPS.');return url.origin;}
export function secureResponse(response){
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','no-referrer');
 headers.set('Strict-Transport-Security','max-age=31536000');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://geo.api.gouv.fr https://data.geopf.fr; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}
export function nodeRequest(request,bytes){
 const headers=Object.fromEntries(request.headers);headers.host=new URL(request.url).host;
 return {method:request.method,headers,socket:{remoteAddress:headers['cf-connecting-ip']||'unknown'},async *[Symbol.asyncIterator](){if(bytes?.length)yield bytes;}};
}
export function nodeResponse(){let status=200;const headers=new Headers();let result;
 return {setHeader(name,value){headers.set(name,value);},writeHead(code,values={}){status=code;for(const [key,value]of Object.entries(values)){headers.delete(key);for(const item of Array.isArray(value)?value:[value])headers.append(key,item);}},end(body=''){result=new Response(body,{status,headers});},get response(){if(!result)throw Error('Réponse absente.');return result;}};
}
