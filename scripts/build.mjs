import {readFile,mkdir,copyFile,rm,readdir,stat,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),output=path.join(root,'public');
// An explicit frontend allowlist prevents backend source, tests, OAuth config and vaults leaking.
const files=['index.html','style.css','journey.css','account-client.mjs','account-storage.mjs','email-account-client.mjs','app.mjs','model.mjs','workdays.mjs','department-data.mjs','department-list.json','departments.json','journey-view.mjs','line-palette.mjs','offers-ui.mjs','offers.mjs','request-queue.mjs','reservations.mjs','road-routes.mjs','transit-core.mjs','transit-ui.mjs','zone-model.mjs','zones.mjs'];
if(path.dirname(output)!==root||path.basename(output)!=='public')throw Error('Chemin de construction invalide.');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
for(const file of files)await copyFile(path.join(root,file),path.join(output,file));
let page=await readFile(path.join(output,'index.html'),'utf8');
page=page.replace('<body','<body class="public-site"').replace('Compte local : les données restent sur cet ordinateur.','Vos critères et missions sont sauvegardés dans votre compte TaskPilot.');
page=page.replace('Code local temporaire','Code d’association privé').replace('Le navigateur et le serveur local doivent rester ouverts. Le code devient invalide à l’arrêt du serveur.','Le navigateur avec le portail Taskrabbit doit rester ouvert. Le code est valable 90 jours ; une nouvelle association invalide le précédent. Sélectionnez la version publique dans le compagnon.');
await writeFile(path.join(output,'index.html'),page);
for(const file of ['app.mjs','offers-ui.mjs','account-client.mjs','email-account-client.mjs','account-storage.mjs','transit-ui.mjs']){
 let text=await readFile(path.join(output,file),'utf8');
 text=text.replaceAll('Serveur local indisponible.','Service indisponible. Réessayez.').replaceAll('le serveur local','le service TaskPilot').replaceAll('serveur local','service TaskPilot').replaceAll('redémarrez le service TaskPilot','réessayez dans quelques instants').replaceAll('liste locale','liste TaskPilot').replaceAll('Mission enregistrée localement.','Mission enregistrée dans votre compte.').replaceAll('Sur Windows, la clé est sauvegardée avec la protection du compte Windows.','Votre clé est chiffrée côté serveur et reste propre à votre compte. Effacer votre clé personnelle rétablit le fournisseur de la plateforme, s’il est configuré.');
 text=text.replaceAll('Mode local : l’envoi des e-mails de vérification et de récupération reste à configurer.','Les inscriptions par e-mail ouvriront après activation du service de vérification et de récupération de compte.');
 await writeFile(path.join(output,file),text);
}
await appendFile(path.join(output,'style.css'),'\n.public-site #googleSetupLink,.public-site #emailSetupLink{display:none!important}\n');
async function copyDir(relative){await mkdir(path.join(output,relative),{recursive:true});for(const entry of await readdir(path.join(root,relative))){const child=path.join(relative,entry);if((await stat(path.join(root,child))).isDirectory())await copyDir(child);else await copyFile(path.join(root,child),path.join(output,child));}}
await copyDir('vendor');
const html=await readFile(path.join(output,'index.html'),'utf8');if(!html.includes('account-client.mjs'))throw Error('Point d’entrée absent.');
for(const file of files.filter(name=>name.endsWith('.mjs'))){const content=await readFile(path.join(output,file),'utf8');for(const match of content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\/?[^'"]+)['"]/g)){const dependency=path.resolve(output,path.dirname(file),match[1]);if(!dependency.startsWith(output+path.sep))throw Error('Dépendance hors frontend : '+match[1]);await stat(dependency);}}
console.log('Frontend public construit : '+files.length+' fichiers et les ressources cartographiques.');
