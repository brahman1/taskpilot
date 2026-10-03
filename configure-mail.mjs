import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {protectWindows} from './protected-storage.mjs';
import {validateMailConfig} from './account-mail.mjs';
if(!process.argv[2])throw Error('Usage : node configure-mail.mjs chemin-vers-configuration-privee.json');
const config=validateMailConfig(JSON.parse(await readFile(process.argv[2],'utf8')));if(!config.apiKey||!config.from)throw Error('Renseignez apiKey et from.');
const file=fileURLToPath(new URL('../../work/private/taskpilot-mail.dpapi',import.meta.url));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,await protectWindows(JSON.stringify(config)),{mode:0o600});console.log('Configuration e-mail protégée. Supprimez le JSON privé contenant la clé, puis redémarrez TaskPilot.');
