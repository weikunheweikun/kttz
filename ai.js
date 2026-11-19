/* Champion three-turn lookahead; shared evaluation for all levels. */
(function(root,factory){
 const C=typeof module==='object' && module.exports ? require('./core.js'):root.YachtCore;
 const Base=typeof module==='object' && module.exports ? require('./ai_base.js'):root.YachtAIBase;
 const api=factory(C,Base);
 if(typeof module==='object' && module.exports) module.exports=api;
 else root.YachtAI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C,V11){
'use strict';
const IDS=C.CATEGORIES.map(x=>x.id),N=13;
const FACT=[1,1,2,6,24,120],P6=[1,6,36,216,1296,7776];
function enumerate(n,lo,s,out){if(n===0){out.push(s);return;}for(let x=lo;x<=6;x++)enumerate(n-1,x,s+x,out)}
const KEYS=[];for(let n=0;n<=5;n++)enumerate(n,1,'',KEYS);
const HANDS=KEYS.filter(k=>k.length===5);const HI=new Map(HANDS.map((x,i)=>[x,i]));
const KI=new Map(KEYS.map((x,i)=>[x,i]));
function holds(s){const x=new Set(['']);for(let i=0;i<s.length;i++){for(const v of [...x])x.add(v+s[i])}return [...x]}
const HS=new Map(KEYS.map(x=>[x,holds(x)]));
const HO=HANDS.map(k=>HS.get(k));
const TR=KEYS.map(k=>{
 const out=[],rolls=[];enumerate(5-k.length,1,'',rolls);
 for(const rolled of rolls){const cnt=[0,0,0,0,0,0,0];for(const ch of rolled)cnt[+ch]++;
  let weight=FACT[rolled.length];for(let j=1;j<=6;j++)weight/=FACT[cnt[j]];
  const idx=HI.get((k+rolled).split('').sort().join(''));out.push([idx,weight]);}
 return {out,den:P6[5-k.length]};
});
const holdIndices=KEYS.map(k=>HS.get(k).map(z=>KI.get(z)));
const handHoldIndices=HANDS.map(k=>HS.get(k).map(z=>KI.get(z)));
const S=IDS.map(id=>Float64Array.from(HANDS,x=>C.score(id,Array.from(x,Number))));
function evRollAll(values){const out=new Float64Array(KEYS.length);for(let i=0;i<KEYS.length;i++){let v=0;for(const [idx,w]of TR[i].out)v+=w*values[idx];out[i]=v/TR[i].den;}return out}
function dp2(terminal){let v=terminal;for(let z=0;z<2;z++){let e=evRollAll(v),next=new Float64Array(HANDS.length);for(let i=0;i<HANDS.length;i++){let best=terminal[i];for(const ki of handHoldIndices[i])if(KEYS[ki].length<5&&e[ki]>best)best=e[ki];next[i]=best;}v=next;}return v}
// For endgame exact no future after finishing last scores; terminal sum of scores + bonus.
// Each state profile gives expected value for any initial dice subset, and post-score carry value for any hand.
const cache=new Map();let computed=0;
const LEVELS={easy:{label:'简单'},normal:{label:'普通'},hard:{label:'困难'}};
// Only selection policy is altered by difficulty; all levels use the exact same dice distribution and board model.
const SETTINGS={hard:{rate:0,spread:0,cap:0},normal:{rate:0.08,spread:2.3,cap:12},easy:{rate:0.205,spread:4.5,cap:19}};
function selectOption(candidates,level,rng){
 candidates.sort((a,b)=>b.value-a.value);
 const best=candidates[0];if(!best)return null;
 const cfg=SETTINGS[level]||SETTINGS.hard;
 if(!cfg.rate||candidates.length<2||rng()>=cfg.rate)return best;
 const options=candidates.slice(1).filter(x=>best.value-x.value<=cfg.cap);
 if(!options.length)return best;
 // Prefer near-optimal alternatives, but sometimes intentionally choose weaker ones.
 const weights=options.map(x=>Math.exp(-(best.value-x.value)/Math.max(0.01,cfg.spread)));
 const total=weights.reduce((a,b)=>a+b,0);let pick=rng()*total;
 for(let i=0;i<options.length;i++){pick-=weights[i];if(pick<=0)return options[i];}
 return options[options.length-1];
}

function board(mask,u,depth=3){if(!mask)return null;const key=mask+'|'+u+'|'+depth;const saved=cache.get(key);if(saved)return saved;computed++;
 const choices=[];for(let c=0;c<N;c++)if(mask&(1<<c))choices.push(c);
 const nextMap=new Map();for(const c of choices){
  const valid=new Set(S[c]);const sub=new Map();const nextMask=mask&~(1<<c);
  for(const pts of valid){const newU=u+(c<6?pts:0);sub.set(pts, nextMask&&depth>1?board(nextMask,newU,depth-1):null)}
  nextMap.set(c,sub);
 }
 const afterScore=new Float64Array(HANDS.length);
 const chosen=new Uint8Array(HANDS.length);
 for(let i=0;i<HANDS.length;i++){
  let best=-Infinity,bestc=0;
  for(const c of choices){const pts=S[c][i],newU=u+(c<6?pts:0),nextMask=mask&~(1<<c),next=nextMap.get(c).get(pts);
   let future=next?next.postScoreCarry[i]:(!nextMask?(newU>=63?35:0):V11.tail(nextMask,newU)+V11.carryGain(nextMask,newU,HANDS[i]));
   let value=pts+future;
   if(value>best){best=value;bestc=c;}}
  afterScore[i]=best;chosen[i]=bestc;
 }
 const v2=dp2(afterScore),first=evRollAll(v2),start=new Float64Array(KEYS.length);
 for(let i=0;i<KEYS.length;i++){
  let best=KEYS[i].length===5?afterScore[HI.get(KEYS[i])]:-Infinity;
  for(const hi of holdIndices[i])if(first[hi]>best)best=first[hi];
  start[i]=best;
 }
 // Buying a subset of the last hand (from this state) for next turn.
 const postScoreCarry=new Float64Array(HANDS.length),carryMasks=new Int32Array(HANDS.length);
 for(let i=0;i<HANDS.length;i++){
  let best=start[KI.get('')],keyId=KI.get('');
  for(const ki of handHoldIndices[i]){
   const val=start[ki]-3*KEYS[ki].length;
   if(val>best){best=val;keyId=ki;}
  }postScoreCarry[i]=best;carryMasks[i]=keyId;
 }
 const profile={mask,u,depth,score:afterScore,choice:chosen,start,postScoreCarry,carryMasks,ev: v2};cache.set(key,profile);return profile;
}
// V11 baseline tail() >0 if mask beyond the last 3; this module only valid with up to 3 remaining.
function expectedNew(mask,u,depth=3){const v=board(mask,u,depth);return v.start[KI.get('')];}
function chooseApprox(g,level='hard',rng=Math.random){if(g.turn!==1)throw Error('not ai');const p=g.players[1],u=C.upperSum(p);
 let mask=0;for(let c=0;c<N;c++)if(!Object.hasOwn(p.scores,IDS[c]))mask|=1<<c;
 
 const P=board(mask,u,3);let hand=g.dice.every(Number.isInteger)?g.dice.slice().sort((a,b)=>a-b).join(''):null;
 if(g.phase==='carry'){
  const ki=P.carryMasks[HI.get(hand)];const key=KEYS[ki];let m=0;const cnt=Array(7).fill(0);for(const d of key)cnt[+d]++;for(let i=0;i<5;i++)if(cnt[g.dice[i]]>0){m|=1<<i;cnt[g.dice[i]]--;}
  if(level==='hard') return {type:'carry',mask:m,carryKey:key,value:P.postScoreCarry[HI.get(hand)]};
  const carryCandidates=handHoldIndices[HI.get(hand)].map(ki=>({type:'carry',keep:KEYS[ki],value:P.start[ki]-3*KEYS[ki].length}));
  const selected=selectOption(carryCandidates,level,rng);
  const counts=Array(7).fill(0);for(const d of selected.keep)counts[+d]++;
  let mask=0;for(let i=0;i<5;i++)if(counts[g.dice[i]]>0){mask|=1<<i;counts[g.dice[i]]--;}
  return {type:'carry',mask,carryKey:selected.keep,value:selected.value};
 }
 const remain=3-g.rollsUsed;
 if(remain<0)throw Error('roll count');
 const idx=hand?HI.get(hand):-1;
 let best=idx>=0?P.score[idx]:-Infinity;
 let ans=idx>=0?{type:'score',category:IDS[P.choice[idx]],value:best}:null;
 if(remain>0){
  const valid=g.dice.map((d,i)=>d===null?-1:i).filter(i=>i>=0);
  const seen=new Set();const next=remain===1?P.score:remain===2?dpOnce(P.score):P.ev;
  for(let bits=0;bits<(1<<valid.length);bits++){
   let subset='',holdMask=0;
   for(let i=0;i<valid.length;i++)if(bits&(1<<i)){subset+=g.dice[valid[i]];holdMask|=1<<valid[i];}
   subset=subset.split('').sort().join('');if(subset.length===5||seen.has(subset))continue;seen.add(subset);
   const ki=KI.get(subset);let value=0;for(const [hi,w]of TR[ki].out)value+=w*next[hi];value/=TR[ki].den;
   if(value>best+1e-10){best=value;ans={type:'roll',mask:holdMask,value};}
  }
 }
 if(level==='hard')return ans;
 const opts=[];
 if(idx>=0){
  const bestCat=P.choice[idx],handKey=HANDS[idx];
  function quickScore(c){const pts=S[c][idx],nm=mask&~(1<<c),nu=u+(c<6?pts:0);
   return pts+V11.tail(nm,nu)+V11.carryGain(nm,nu,handKey);}
  const bestQuick=quickScore(bestCat);
  for(let c=0;c<N;c++)if(mask&(1<<c)){
   // Local opportunity-cost differences, anchored to the champion's 3-turn value.
   opts.push({type:'score',category:IDS[c],value:P.score[idx]+quickScore(c)-bestQuick});
  }
 }
 if(remain>0){
  const valid=g.dice.map((d,i)=>d==null?-1:i).filter(i=>i>=0),seen=new Set();
  const next=remain===1?P.score:remain===2?dpOnce(P.score):P.ev;
  for(let bits=0;bits<(1<<valid.length);bits++){
   let subset='',hm=0;
   for(let i=0;i<valid.length;i++)if(bits&(1<<i)){subset+=g.dice[valid[i]];hm|=1<<valid[i]}
   subset=subset.split('').sort().join('');if(subset.length===5||seen.has(subset))continue;seen.add(subset);
   const ki=KI.get(subset);let value=0;
   for(const [hi,w] of TR[ki].out)value+=w*next[hi];value/=TR[ki].den;
   opts.push({type:'roll',mask:hm,value});
  }
 }
 if(!opts.length)return ans;
 return selectOption(opts,level,rng);
}

function dpOnce(terminal){let e=evRollAll(terminal),v=new Float64Array(HANDS.length);for(let i=0;i<HANDS.length;i++){let best=terminal[i];for(const ki of handHoldIndices[i])if(KEYS[ki].length<5&&e[ki]>best)best=e[ki];v[i]=best;}return v}

/* Risk-sensitive 13-round optimal-policy lookups.
 * Offline DP target: certainty-equivalent utility with eta = 0.008.
 * The gzip file contains only frequently reached board states to keep a static
 * browser game practical. An existing board-aware AI handles unseen states.
 * Rules, random dice and all player actions remain owned by core.js.
 */
const RISK_POLICY_FILE='ai_policy_008.bin.gz?v=12';
const RECORD_BYTES=1016; // board state (4 bytes), visit frequency (4), 252 × 4-byte decisions
const POLICY_ETA=0.008;
let riskData=null,riskLoading=null,riskUnavailable=false,policyMisses=0,approxUpperLookups=0;
const PCOUNT=[],PKEY=[],FIVE_INDEX=new Map();
(function initPartOrder(){
 const v=[0,0,0,0,0,0];
 function visit(d,n){
  if(d===6){if(n===0){const x=v.slice(),id=PCOUNT.length;PCOUNT.push(x);let key='';for(let j=0;j<6;j++)key+=String(j+1).repeat(x[j]);PKEY.push(key);if(key.length===5)FIVE_INDEX.set(key,id);}return;}
  for(let j=0;j<=n;j++){v[d]=j;visit(d+1,n-j);}
 }
 for(let n=0;n<=5;n++)visit(0,n);
})();
function canonicalDice(dice){return dice.slice().sort((a,b)=>a-b).join('');}
function handMask(dice,partIndex){
 const want=PCOUNT[partIndex].slice();let bits=0;
 for(let i=0;i<5;i++)if(Number.isInteger(dice[i])&&want[dice[i]-1]>0){bits|=1<<i;want[dice[i]-1]--;}
 return bits;
}
function parsePolicy(arrayBuffer){
 if(arrayBuffer.byteLength%RECORD_BYTES)throw new Error('AI policy data size mismatch');
 const view=new DataView(arrayBuffer),offset=new Map(),n=arrayBuffer.byteLength/RECORD_BYTES;
 for(let i=0;i<n;i++){const base=i*RECORD_BYTES;offset.set(view.getUint32(base,true),base+8);}
 return {view,offset,n};
}
async function loadRiskPolicy(){
 if(riskData)return riskData;
 if(riskUnavailable)return null;
 if(!riskLoading)riskLoading=(async()=>{
  try{
   let bytes;
   if(typeof module==='object'&&module.exports){
    const fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
    const gzip=fs.readFileSync(path.join(__dirname,'ai_policy_008.bin.gz'));
    const raw=zlib.gunzipSync(gzip);
    bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
   }else{
    if(typeof fetch!=='function'||typeof DecompressionStream!=='function')throw new Error('browser lacks streaming gzip support');
    const url=new URL(RISK_POLICY_FILE,typeof self!=='undefined'?self.location.href:location.href);
    const resp=await fetch(url);
    if(!resp.ok||!resp.body)throw new Error('unable to load risk AI policy: '+resp.status);
    bytes=await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   }
   riskData=parsePolicy(bytes);return riskData;
  }catch(err){
   riskUnavailable=true;
   if(typeof console!=='undefined')console.warn('AI policy unavailable, using existing board-aware fallback',err);
   return null;
  }
 })();
 return riskLoading;
}
function lookup(mask,u,dice){
 if(!riskData||dice.some(x=>!Number.isInteger(x)))return null;
 const u63=Math.min(63,u),st=(mask<<6)|u63;
 let base=riskData.offset.get(st);
 if(base===undefined){
  // Nearest upper subtotal from the *same set of remaining boxes*.
  // This is a fast, conservative interpolation for extremely rare states;
  // upper-bonus-already-earned states cannot borrow non-bonus policies.
  for(let d=1;d<=63&&base===undefined;d++){
   const a=u63-d,b=u63+d;
   if(a>=0&&((a===63)===(u63===63)))base=riskData.offset.get((mask<<6)|a);
   if(base===undefined&&b<=63&&((b===63)===(u63===63)))base=riskData.offset.get((mask<<6)|b);
  }
  if(base!==undefined)approxUpperLookups++;
 }
 if(base===undefined)return null;
 const f=FIVE_INDEX.get(canonicalDice(dice));
 if(f===undefined)return null;
 const packed=riskData.view.getUint32(base+4*(f-210),true); // first 210 part indices have 0..4 dice
 return {category:packed>>>27,hold3:(packed>>>18)&511,hold2:(packed>>>9)&511,carry:packed&511};
}
function bitsCount(x){let n=0;for(;x;x&=x-1)n++;return n;}
function selectMistake(original,candidates,rate,rng){
 if(rate<=0||rng()>=rate||candidates.length===0)return original;
 return candidates[Math.floor(rng()*candidates.length)];
}
function noisyRollMask(ideal,dice,level,rng){
 const conf=NOISE[level];if(!conf||rng()>=conf.roll)return ideal;
 const legal=Array.from({length:5},(_,i)=>Number.isInteger(dice[i])?i:-1).filter(i=>i>=0);
 const alt=[];
 // One- or occasionally two-die deviation from the globally optimized choice.
 for(const i of legal){const x=ideal^(1<<i);if(x!==ideal&&bitsCount(x)<5)alt.push(x);}
 if(rng()<conf.rollDouble&&legal.length>1){
  for(const i of legal)for(const j of legal)if(i<j){const x=ideal^(1<<i)^(1<<j);if(bitsCount(x)<5)alt.push(x);}
 }
 if(!alt.length)return ideal;
 return alt[Math.floor(rng()*alt.length)];
}
function noisyScore(id,mask,u,dice,level,rng){
 const conf=NOISE[level];if(!conf||rng()>=conf.score)return id;
 const hand=dice.slice(),choices=[];
 for(let i=0;i<13;i++)if((mask&(1<<i))&&i!==id){
  const pts=C.score(IDS[i],hand);
  // Nearby alternatives are chosen from the actual legal unfilled boxes, not
  // fake scores, modified dice or illegally re-used categories.
  const hint=pts + (i<6?Math.min(8,pts*0.19):0)
     + (i===11? -10 : i===10? -4 : i===9? -3 : 0);
  choices.push({id:i,hint});
 }
 if(!choices.length)return id;
 choices.sort((a,b)=>b.hint-a.hint);
 const pool=choices.slice(0,Math.min(choices.length,conf.scorePool));
 const selected=pool[Math.floor(Math.pow(rng(),conf.scorePower)*pool.length)];
 return selected.id;
}
function noisyCarry(ideal,dice,level,rng){
 const conf=NOISE[level];if(!conf||rng()>=conf.carry)return ideal;
 const alt=[];
 for(let i=0;i<5;i++)alt.push(ideal^(1<<i));
 if(rng()<conf.carrySkip)alt.push(0,0);
 return alt[Math.floor(rng()*alt.length)];
}
// Deliberately adjustable *decision error* rates. Never change RNG outcomes,
// scoring, payment or the number of rolls. Rates are calibrated by full games.
const NOISE={
 hard:{roll:0,score:0,carry:0,rollDouble:0,scorePool:1,scorePower:1,carrySkip:0},
 normal:{roll:0.09,score:0.09,carry:0.072,rollDouble:0.10,scorePool:3,scorePower:1.4,carrySkip:0.15},
 easy:{roll:0.172,score:0.175,carry:0.144,rollDouble:0.28,scorePool:7,scorePower:0.9,carrySkip:0.35}
};
function getBoardState(g){
 const p=g.players[1];let mask=0;
 for(let c=0;c<N;c++)if(!Object.hasOwn(p.scores,IDS[c]))mask|=1<<c;
 return {mask,u:C.upperSum(p)};
}
function quickCarry(mask,u,dice,level,rng){
 const hand=canonicalDice(dice);
 let best=0,keep='';
 for(const sub of HS.get(hand)){
  if(sub.length===0)continue;
  let gain=0;
  for(let c=0;c<N;c++)if(mask&(1<<c)){
   let value=(V11.TARGET[c].get(sub)||0)-V11.SOLO[c];
   if(c<6&&u<63){
    const same=[...sub].filter(x=>+x===c+1).length;
    if(same)value+=Math.min(15,35*same*(c+1)/Math.max(12,63-u)/3);
   }
   gain=Math.max(gain,value);
  }
  const net=gain-3*sub.length;
  if(net>best){best=net;keep=sub;}
 }
 let maskBits=0;
 const counts=Array(7).fill(0);for(const d of keep)counts[+d]++;
 for(let i=0;i<5;i++)if(counts[dice[i]]>0){maskBits|=1<<i;counts[dice[i]]--;}
 return {type:'carry',mask:noisyCarry(maskBits,dice,level,rng)};
}
const quickMemo=new Map();
function quickBoard(mask,u){
 const k=mask+'|'+Math.min(u,63),old=quickMemo.get(k);if(old)return old;
 const terminal=new Float64Array(HANDS.length),choice=new Uint8Array(HANDS.length);
 for(let h=0;h<HANDS.length;h++){
  let val=-Infinity,cat=-1;
  for(let c=0;c<N;c++)if(mask&(1<<c)){
   const pts=S[c][h],nu=u+(c<6?pts:0),nm=mask&~(1<<c);
   const v=pts+V11.tail(nm,nu);
   if(v>val){val=v;cat=c;}
  }
  terminal[h]=val;choice[h]=cat;
 }
 const roll1=evRollAll(terminal),after1=dpOnce(terminal),roll2=evRollAll(after1);
 const result={terminal,choice,roll1,roll2};
 if(quickMemo.size>64)quickMemo.clear();quickMemo.set(k,result);return result;
}
function quickFallback(g,level,rng){
 const {mask,u}=getBoardState(g);
 if(g.phase==='carry')return quickCarry(mask,u,g.dice,level,rng);
 if(g.rollsUsed===0){
  let held=0;for(let i=0;i<5;i++)if(Number.isInteger(g.dice[i]))held|=1<<i;
  if(bitsCount(held)<5)return {type:'roll',mask:held};
 }
 const prof=quickBoard(mask,u),full=FIVE_INDEX.has(canonicalDice(g.dice));
 const index=full?HI.get(canonicalDice(g.dice)):-1;
 const score=()=>({type:'score',category:IDS[noisyScore(prof.choice[index],mask,u,g.dice,level,rng)]});
 if(g.rollsUsed>=3||g.rollsUsed===0)return score();
 let best=index>=0?prof.terminal[index]:-Infinity,choice=-1;
 const ev=g.rollsUsed===1?prof.roll2:prof.roll1;
 const seen=new Set();
 for(let b=0;b<32;b++){
  let k='',hm=0;
  for(let i=0;i<5;i++)if((b&(1<<i))&&Number.isInteger(g.dice[i])){k+=g.dice[i];hm|=1<<i;}
  k=k.split('').sort().join('');if(k.length===5||seen.has(k))continue;seen.add(k);
  const val=ev[KI.get(k)];
  if(val>best){best=val;choice=hm;}
 }
 if(choice<0)return score();
 return {type:'roll',mask:noisyRollMask(choice,g.dice,level,rng)};
}
function approximate(g,level,rng){policyMisses++;return quickFallback(g,level,rng);}

async function decide(g,level='hard',rng=Math.random){
 if(g.turn!==1)throw Error('not ai');
 await loadRiskPolicy();
 if(!riskData)return quickFallback(g,level,rng);
 const {mask,u}=getBoardState(g);
 if(g.phase==='carry'){
  // The last scoring action gives us the parent board state whose carry
  // decision is stored with the selected category in the exact policy.
  const last=g.log&&g.log.find(x=>x.player===1&&x.category!=='carry');
  if(last){
   const c=IDS.indexOf(last.category),parentMask=mask|(1<<c),parentUpper=u-(c<6?last.score:0);
   const p=lookup(parentMask,parentUpper,g.dice);
   if(p&&p.category===c){
    const m=handMask(g.dice,p.carry);
    return {type:'carry',mask:noisyCarry(m,g.dice,level,rng)};
   }
  }
  return approximate(g,level,rng);
 }
 if(g.phase!=='rolling')throw Error('unknown AI phase');
 if(g.rollsUsed===0){
  const present=g.dice.filter(Number.isInteger);
  // At the beginning of a new turn, paid carry dice must remain held for
  // the first throw; if all five were carried, score immediately.
  if(present.length<5){let m=0;for(let i=0;i<5;i++)if(Number.isInteger(g.dice[i]))m|=1<<i;
   return {type:'roll',mask:m};}
 }
 const p=lookup(mask,u,g.dice);
 if(!p)return approximate(g,level,rng);
 if(g.rollsUsed>=3||g.rollsUsed===0){
  return {type:'score',category:IDS[noisyScore(p.category,mask,u,g.dice,level,rng)]};
 }
 const held=handMask(g.dice,g.rollsUsed===1?p.hold3:p.hold2);
 if(bitsCount(held)===5){return {type:'score',category:IDS[noisyScore(p.category,mask,u,g.dice,level,rng)]};}
 return {type:'roll',mask:noisyRollMask(held,g.dice,level,rng)};
}
function clear(){cache.clear();computed=0;}
return {LEVELS,SETTINGS,NOISE,board,expectedNew,choose:decide,decide,ready:loadRiskPolicy,clear,clearCache:clear,stats:()=>({computed,cache:cache.size,policyStates:riskData?.n||0,policyMisses,approxUpperLookups}),IDS};
});
