import {createAccountCore} from './account-core.mjs';
import {createProtectedStorage} from './protected-storage.mjs';
import {createAccountMailer,loadMailConfig} from './account-mail.mjs';
import {loadGoogleConfig} from './google-auth.mjs';
import {fileURLToPath} from 'node:url';
export {validateEmail} from './account-core.mjs';
export async function createAccountService(file=fileURLToPath(new URL('../../work/private/taskpilot-accounts.json',import.meta.url)),options={}){
 return createAccountCore({...options,storage:options.storage||await createProtectedStorage(file),mailer:options.mailer||createAccountMailer(await loadMailConfig()),googleConfig:options.googleConfig||await loadGoogleConfig(),requireMail:process.env.NODE_ENV==='production'});
}
