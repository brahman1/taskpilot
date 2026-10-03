import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import path from 'node:path';
export function protectWindows(value,decrypt=false){
 if(process.platform!=='win32')throw Error('Le coffre local nécessite Windows.');
 return new Promise((resolve,reject)=>{
  const script="[System.Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$raw=[Console]::In.ReadToEnd();"+(decrypt?"$b=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($raw),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))":"$b=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($raw),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($b))");
  const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:100000},(error,stdout)=>error?reject(Error('Coffre Windows indisponible.')):resolve(stdout.trim()));child.stdin.end(value);
 });
}
// The AES key is never saved in plaintext: Windows DPAPI binds it to the current OS user.
export async function createProtectedStorage(file,{key}={}){
 if(!key){const keyFile=file+'.key.dpapi';try{key=Buffer.from(await protectWindows(await readFile(keyFile,'utf8'),true),'base64');}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);await mkdir(path.dirname(file),{recursive:true});await writeFile(keyFile,await protectWindows(key.toString('base64')),{flag:'wx',mode:0o600});}}
 if(key.length!==32)throw Error('Clé de chiffrement invalide.');
 async function save(data){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('TaskPilot accounts v1'));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify({format:'taskpilot-encrypted-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')}),{mode:0o600});await rename(file+'.tmp',file);}
 async function load(){let text;try{text=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}const envelope=JSON.parse(text);if(envelope.format!=='taskpilot-encrypted-v1'){
   // One-time migration of existing local accounts, without resetting any user data.
   if(!Array.isArray(envelope.users)||!envelope.sessions)throw Error('Base des comptes invalide.');await save(envelope);return envelope;
  }const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from('TaskPilot accounts v1'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
 }
 return {load,save};
}
