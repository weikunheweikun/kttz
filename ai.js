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
function choose(g,level='hard',rng=Math.random){if(g.turn!==1)throw Error('not ai');const p=g.players[1],u=C.upperSum(p);
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
function clear(){cache.clear();computed=0;}
return {LEVELS,SETTINGS,board,expectedNew,choose,decide:choose,clear,clearCache:clear,stats:()=>({computed,cache:cache.size}),IDS};
});
