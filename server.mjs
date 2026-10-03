import {createAccountService} from './account-server.mjs';
const accounts=await createAccountService();
import {portalApi} from './portal-server.mjs';
import {transitApi} from './transit-server.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.md':'text/plain; charset=utf-8','.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json'};
http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://geo.api.gouv.fr https://data.geopf.fr; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)){res.writeHead(403);return res.end('Hôte non autorisé');}
 try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/account/'))return await accounts.api(req,res,url);if(url.pathname.startsWith('/api/')){const user=accounts.authenticated(req),bridgeUpload=url.pathname==='/api/portal/snapshot'&&req.method==='POST';if(!user&&!bridgeUpload){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({error:'Connectez-vous à TaskPilot.'}));}if(url.pathname.startsWith('/api/portal/'))return await portalApi(req,res,url,user?.id);return await transitApi(req,res,url,user.id);}const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(root,name);if(!file.startsWith(root)||!['.html','.css','.mjs','.js','.json','.md','.svg'].includes(path.extname(file)))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}catch{res.writeHead(404);res.end('Introuvable');}}).listen(4173,'127.0.0.1',()=>console.log('TaskPilot : http://127.0.0.1:4173'));
