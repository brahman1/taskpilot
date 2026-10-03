import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {protectWindows} from './protected-storage.mjs';
import {validateMailConfig} from './account-mail-core.mjs';
export {validateMailConfig,createAccountMailer} from './account-mail-core.mjs';
export async function loadMailConfig(){let saved={};try{saved=JSON.parse(await protectWindows(await readFile(fileURLToPath(new URL('../../work/private/taskpilot-mail.dpapi',import.meta.url)),'utf8'),true));}catch(e){if(e.code!=='ENOENT')throw e;}return validateMailConfig({apiKey:process.env.RESEND_API_KEY||saved.apiKey,from:process.env.MAIL_FROM||saved.from,publicUrl:process.env.MAIL_PUBLIC_URL||saved.publicUrl});}
