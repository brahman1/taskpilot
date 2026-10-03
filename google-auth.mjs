import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {protectWindows} from './protected-storage.mjs';
export {createGoogleAuth,cookieValue} from './google-auth-core.mjs';
export async function loadGoogleConfig(){
 let saved={};try{saved=JSON.parse(await protectWindows(await readFile(fileURLToPath(new URL('../../work/private/taskpilot-google.dpapi',import.meta.url)),'utf8'),true));}catch(e){if(e.code!=='ENOENT')throw e;}
 return {clientId:process.env.GOOGLE_CLIENT_ID||saved.clientId||'',clientSecret:process.env.GOOGLE_CLIENT_SECRET||saved.clientSecret||''};
}
