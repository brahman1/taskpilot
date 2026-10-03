let timer,last='';async function read(){const tasks=readTaskPilotOffers();if(!tasks.length)return;const signature=JSON.stringify(tasks);if(signature===last)return;try{const response=await chrome.runtime.sendMessage({type:'snapshot',tasks});if(!response?.error&&!response?.ignored)last=signature;}catch{}}
new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(read,1500);}).observe(document.documentElement,{childList:true,subtree:true});
chrome.runtime.onMessage.addListener(m=>{if(m.type==='read-now')read();});setTimeout(read,2000);
