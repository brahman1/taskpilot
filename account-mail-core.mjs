export function validateMailConfig(config){
 const publicUrl=new URL(config.publicUrl||'http://127.0.0.1:4173');
 if(publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||!(publicUrl.protocol==='https:'||['http://127.0.0.1:4173','http://localhost:4173'].includes(publicUrl.origin)))throw Error('Adresse publique e-mail invalide : utilisez HTTPS ou le serveur local.');
 const apiKey=String(config.apiKey||''),from=String(config.from||'');
 if(/[\r\n]/.test(apiKey+from)||apiKey.length>500||from.length>320||(from&&!/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/.test(from)))throw Error('Configuration de l’expéditeur invalide.');
 return {apiKey,from,publicUrl:publicUrl.origin};
}
export function createAccountMailer(input,{fetcher=fetch}={}){const config=validateMailConfig(input),configured=Boolean(config.apiKey&&config.from);
 async function send({to,purpose,token,idempotencyKey}){if(!configured)throw Error('Service e-mail non configuré.');const reset=purpose==='reset',link=config.publicUrl+'/#'+(reset?'reset-password':purpose==='taskrabbit'?'verify-taskrabbit':'verify-email')+'='+encodeURIComponent(token),minutes=reset?15:60;
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:JSON.stringify({from:'TaskPilot <'+config.from+'>',to:[to],subject:reset?'Réinitialiser votre mot de passe TaskPilot':purpose==='taskrabbit'?'Vérifier votre adresse Taskrabbit dans TaskPilot':'Vérifier votre adresse e-mail TaskPilot',text:(reset?'Vous avez demandé un nouveau mot de passe.':purpose==='taskrabbit'?'Confirmez que cette adresse Taskrabbit vous appartient. Cette vérification seule n’active pas les demandes automatiques.':'Confirmez votre adresse e-mail pour accéder à TaskPilot.')+'\n\n'+link+'\n\nCe lien expire dans '+minutes+' minutes et ne peut être utilisé qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.\n\nVotre mot de passe n’est jamais envoyé par e-mail.'}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Service e-mail indisponible.');const result=await response.json();if(!result.id)throw Error('Envoi non accepté.');return {id:result.id};
 }
 return {configured,send};
}
