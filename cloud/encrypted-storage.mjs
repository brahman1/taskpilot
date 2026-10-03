// Cloudflare stores only ciphertext. The 256-bit key is a Worker secret, never an asset.
// Chunking permits preference snapshots larger than Durable Objects' per-value limit.
const encoder=new TextEncoder(),decoder=new TextDecoder(),chunkSize=48000;
export async function encryptedStorage(storage,secret,scope){
 if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))throw Error('Configurez DATA_ENCRYPTION_KEY (32 octets hexadécimaux).');
 const key=await crypto.subtle.importKey('raw',Buffer.from(secret,'hex'),'AES-GCM',false,['encrypt','decrypt']);
 const prefix='encrypted:'+scope+':';
 async function load(){
  const count=await storage.get(prefix+'count');if(count===undefined)return null;
  if(!Number.isInteger(count)||count<1||count>700)throw Error('Stockage chiffré invalide.');
  const parts=[];for(let i=0;i<count;i++){const item=await storage.get(prefix+i);if(!item)throw Error('Fragment manquant.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(item.iv,'base64'),additionalData:encoder.encode(prefix+i)},key,Buffer.from(item.data,'base64'));parts.push(new Uint8Array(plain));}
  return JSON.parse(decoder.decode(Buffer.concat(parts)));
 }
 async function save(value){
  const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>32000000)throw Error('Limite de stockage applicative atteinte.');
  const count=Math.max(1,Math.ceil(bytes.length/chunkSize)),records={};
  for(let i=0;i<count;i++){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(prefix+i)},key,bytes.slice(i*chunkSize,(i+1)*chunkSize));records[prefix+i]={iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')};}
  await storage.transaction(async txn=>{const old=await txn.get(prefix+'count')||0;for(const [key,record]of Object.entries(records))await txn.put(key,record);for(let i=count;i<old;i++)await txn.delete(prefix+i);await txn.put(prefix+'count',count);});
 }
 async function remove(){await storage.transaction(async txn=>{const count=await txn.get(prefix+'count')||0;for(let i=0;i<count;i++)await txn.delete(prefix+i);await txn.delete(prefix+'count');});}
 return {load,save,remove};
}
