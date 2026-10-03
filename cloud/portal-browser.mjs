import puppeteer from '@cloudflare/puppeteer';
import {sameOffer,protectedTestEmail} from '../bot-policy.mjs';
const portal='https://taskrabbitlimited.outsystemsenterprise.com/TaskPortal/';
// Observed selectors from TaskPortal, not private endpoints or token replay.
export function readBoard(){const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};return [...document.querySelectorAll('a[id$="single_task_link"]')].map(a=>{const prefix=a.id.replace('single_task_link','');const gen=document.getElementById(prefix+'geninfo'),scope=document.getElementById(prefix+'scope');if(!gen||!scope)return null;let card=gen.parentElement;for(let i=0;i<4&&card;i++,card=card.parentElement)if(card.querySelectorAll('a[id$="single_task_link"]').length===1&&/\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(card.innerText))break;if(!card)return null;const dt=card.innerText.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})\s+(\d{2}:\d{2})/),dur=gen.innerText.match(/(?:Duration|Durée)\s*(\d+):(\d{2})/),pay=card.innerText.match(/€\s*([\d.,]+)|([\d.,]+)\s*€/);if(!dt||!months[dt[2]]||!dur||!pay)return null;const info=gen.innerText.split('\n').map(x=>x.trim()).filter(Boolean);return {id:new URL(a.href).searchParams.get('taskid'),date:`${dt[3]}-${months[dt[2]]}-${dt[1].padStart(2,'0')}`,time:dt[4],duration:Number(dur[1])*60+Number(dur[2]),pay:Number((pay[1]||pay[2]).replace(',','.')),brand:info[0],department:(info[1]||'').replace(/^[^\p{L}]+/u,''),address:info.slice(2).filter(line=>!/(?:Duration|Durée)/i.test(line)).join(', '),title:scope.innerText.replace(/^[^\p{L}]+/u,''),status:'available',lat:null,lon:null};}).filter(Boolean);}
export function readDetail(){
 const text=id=>document.getElementById(id)?.innerText||'',months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
 const dt=text('task_date_time').match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})\s+(\d{2}:\d{2})/),dur=text('task_duration').match(/(\d+):(\d{2})/),pay=text('task_payout').match(/€\s*([\d.,]+)/),terms=[...document.querySelectorAll('a')].find(a=>a.href.endsWith('/TaskPortal/tos'));
 if(!dt||!months[dt[2]]||!dur||!pay||!terms)return null;
 const button=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Demander la Task');
 return {id:text('title').match(/Task n°(\d+)/)?.[1],date:`${dt[3]}-${months[dt[2]]}-${dt[1].padStart(2,'0')}`,time:dt[4],duration:Number(dur[1])*60+Number(dur[2]),pay:Number(pay[1].replace(',','.')),brand:text('task_type').split('\n').at(-1).trim(),street:text('map').split('\n')[0]?.trim(),postcode:text('map').match(/\b\d{5}\b/)?.[0],email:terms.innerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase(),canRequest:!!button&&!button.disabled};
}
export async function browserSession(binding,operation,onAccounting,{client=puppeteer,timeoutMs=25000}={}){
 let browser,closed=false,expired=false;const started=Date.now();
 const launching=client.launch(binding,{keep_alive:10000});
 launching.then(async b=>{if(expired)await b.close().catch(()=>{});}).catch(()=>{});
 let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;browser?.close().catch(()=>{});reject(Error('Le navigateur a dépassé le délai gratuit.'));},timeoutMs);});
 try{return await Promise.race([(async()=>{browser=await launching;if(expired)throw Error('Lancement expiré.');return operation(browser);})(),deadline]);}
 finally{expired=true;clearTimeout(timer);if(browser){let closeTimer;try{await Promise.race([browser.close(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error()),5000);})]);closed=true;}catch{}finally{clearTimeout(closeTimer);}}
  await onAccounting((Date.now()-started)/1000,closed);
 }
}
async function login(browser,email){
 const page=await browser.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);
 await page.goto(portal+'?source=FR',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('input[type="email"], input[placeholder="Email"]');
 await page.type('input[type="email"], input[placeholder="Email"]',email);
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='→');if(!b)throw Error('Connexion introuvable.');b.click();});
 await page.waitForFunction(()=>location.pathname.endsWith('/board'));
 await page.waitForSelector('a[id$="single_task_link"]');return page;
}
export async function captureOffers(browser,email){const page=await login(browser,email);return page.evaluate(readBoard);}
export async function requestOffer(browser,email,task,beforeClick,options={}){
 if(email===protectedTestEmail&&!options.personalPilot||!/^\d+$/.test(task.id))throw Error('Compte ou mission de test : demande interdite.');
 const page=await login(browser,email);await page.goto(portal+'task_page?distance=0&location_given=false&taskid='+task.id,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#task_date_time');const fresh=await page.evaluate(readDetail);
 if(!sameOffer(task,fresh,email)||!fresh.canRequest)throw Error('La mission a changé ou n’est plus disponible.');
 await beforeClick(); // Persist an uncertain pending request BEFORE the irreversible click.
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Demander la Task');if(!b||b.disabled)throw Error('Demande indisponible.');b.click();});
 // Unrecognized feedback never triggers a second click or an automatic retry.
 try{await page.waitForFunction(()=>/demande (?:a été |est )?(?:envoyée|enregistrée)|request (?:has been )?(?:sent|submitted)/i.test(document.body.innerText),{timeout:6000});return 'submitted';}catch{return 'uncertain';}
}
