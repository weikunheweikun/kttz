/* AI decisions are computed off the UI thread. */
importScripts('core.js?v=12','ai_base.js?v=12','ai.js?v=12');
self.onmessage=async function(e){
 const {id,game,level}=e.data||{};
 try{self.postMessage({id,decision:await self.YachtAI.decide(game,level)});}
 catch(err){self.postMessage({id,error:err&&err.message||String(err)});}
};
