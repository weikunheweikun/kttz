/* V11: unified board-aware expected-value AI, three-turn receding horizon.
 * Within-turn dice rerolls and the second turn are fully enumerated.
 * The third turn and later continuation use an explicit, feasible target-category
 * policy with an EXACT binomial distribution for each remaining upper box.
 * No bonus weights, arbitrary box prices, artificial carry hurdles or mistakes.
 */
(function(root,factory){const Core=typeof module==='object'&&module.exports?require('./core.js'):root.YachtCore;
 const api=factory(Core);if(typeof module==='object'&&module.exports)module.exports=api;else root.YachtAIBase=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
'use strict';
const LEVELS={expert:{label:'标准',horizon:3,weakChance:0}};
const IDS=Core.CATEGORIES.map(x=>x.id),N=IDS.length,U=6,ALL_MASK=(1<<N)-1;
const FACT=[1,1,2,6,24,120],POW6=[1,6,36,216,1296,7776];
function enumerate(n,min,stem,out){if(!n){out.push(stem);return;}for(let d=min;d<=6;d++)enumerate(n-1,d,stem+d,out);}
const KEYS=[];for(let n=0;n<=5;n++)enumerate(n,1,'',KEYS);
const HANDS=KEYS.filter(x=>x.length===5),HAND_INDEX=new Map(HANDS.map((k,i)=>[k,i]));
const diceOf=k=>Array.from(k,Number),keyOf=d=>d.slice().sort((a,b)=>a-b).join('');
const heldCache=new Map();
function holdsOf(key){let result=heldCache.get(key);if(result)return result;
 const set=new Map();for(let bits=0;bits<(1<<key.length);bits++){let s='';for(let i=0;i<key.length;i++)if(bits&(1<<i))s+=key[i];if(!set.has(s))set.set(s,bits);}
 result=[...set].map(([key,mask])=>({key,mask}));heldCache.set(key,result);return result;}
const TRAN=new Map();for(const keep of KEYS){const out=[],rolls=[];enumerate(5-keep.length,1,'',rolls);
 for(const rolled of rolls){const cnt=[0,0,0,0,0,0,0];for(const c of rolled)cnt[+c]++;
  let w=FACT[rolled.length];for(let x=1;x<=6;x++)w/=FACT[cnt[x]];
  out.push({index:HAND_INDEX.get(keyOf(diceOf(keep+rolled))),weight:w});}
 TRAN.set(keep,{out,den:POW6[5-keep.length]});}
function expectedRoll(keep,values){const t=TRAN.get(keep);let value=0;for(const item of t.out)value+=item.weight*values[item.index];return value/t.den;}
const SCORE=IDS.map(id=>Float64Array.from(HANDS,key=>Core.score(id,diceOf(key))));
function optimizeRolls(terminal){let prev=terminal;const dp=[terminal];
 for(let n=1;n<=2;n++){const ev=new Map();for(const keep of KEYS)ev.set(keep,expectedRoll(keep,prev));
  const next=Float64Array.from(HANDS,(key,i)=>{
   let best=terminal[i];for(const h of holdsOf(key))if(h.key.length<5&&ev.get(h.key)>best)best=ev.get(h.key);
   return best;});dp.push(next);prev=next;}return dp;}
// For a specified target category, three rolls with optimal re-holds.
const TARGET=IDS.map((_,c)=>{const dp=optimizeRolls(SCORE[c]),map=new Map();
 for(const carried of KEYS){let best=-Infinity;for(const choice of holdsOf(carried))best=Math.max(best,expectedRoll(choice.key,dp[2]));map.set(carried,best);}return map;});
const SOLO=TARGET.map(m=>m.get(''));
const upperDist=[Float64Array.of(1)];
// If every die is rolled up to three times looking for face f: success p=1-(5/6)^3.
const P=1-(5/6)**3;const COMB=[1,5,10,10,5,1];
function choose(n,k){let a=1;for(let j=1;j<=k;j++)a=a*(n-j+1)/j;return a;}
function faceDist(face,already){const n=5-already,d=new Float64Array(5*face+1);
 for(let k=0;k<=n;k++)d[(already+k)*face]+=choose(n,k)*P**k*(1-P)**(n-k);
 return d;}
const upperDists=Array.from({length:64});upperDists[0]=Float64Array.of(1);
for(let m=1;m<64;m++){
 const b=m&-m,c=Math.log2(b),prior=upperDists[m^b],dist=faceDist(c+1,0),out=new Float64Array(prior.length+dist.length-1);
 for(let j=0;j<prior.length;j++)if(prior[j])for(let k=0;k<dist.length;k++)if(dist[k])out[j+k]+=prior[j]*dist[k];
 upperDists[m]=out;
}
const probMemo=new Map();function bonusProb(mask,u){if(u>=63)return 1;
 const top=mask&63;if(!top)return 0;const key=(top<<8)|u;if(probMemo.has(key))return probMemo.get(key);
 const d=upperDists[top];let p=0;for(let k=Math.max(0,63-u);k<d.length;k++)p+=d[k];
 probMemo.set(key,p);return p;
}
// Feasible, scorecard-dependent continuation policy: commit one future turn to
// each remaining category, use optimal rerolls for that target, plus exact
// upper-bonus probability under this committed policy.
const tailMemo=new Map();function tail(mask,u){const k=mask+'|'+u;let v=tailMemo.get(k);if(v!==undefined)return v;
 v=35*bonusProb(mask,u);for(let i=0;i<N;i++)if(mask&(1<<i))v+=SOLO[i];
 if(tailMemo.size>14000)tailMemo.clear();tailMemo.set(k,v);return v;}
// Exact upper-bonus influence is evaluated with cumulative probability tails.
// This avoids expensive convolution loops inside the second-turn planner.
const upperSurvival=upperDists.map(d=>{
 const result=new Float64Array(d.length+1);let acc=0;
 for(let i=d.length-1;i>=0;i--){acc+=d[i];result[i]=acc;}
 return result;
});
const FACE_DIST=Array.from({length:6},(_,face)=>Array.from({length:6},(_,held)=>faceDist(face+1,held)));
const bonusDeltaMemo=new Map();
function deltaUpper(mask,u,cat,held){if(held<=0||u>=63)return 0;
 const upper=mask&63,k=(((upper*128+u)*6+cat)*6+held);
 const found=bonusDeltaMemo.get(k);if(found!==undefined)return found;
 const surv=upperSurvival[upper&~(1<<cat)],a=FACE_DIST[cat][held],b=FACE_DIST[cat][0];
 let p=0;for(let i=0;i<a.length;i++){
  const diff=a[i]-b[i];if(!diff)continue;
  const t=63-u-i,prob=t<=0?1:t<surv.length?surv[t]:0;
  p+=diff*prob;
 }
 const val=35*p;if(bonusDeltaMemo.size>12000)bonusDeltaMemo.clear();bonusDeltaMemo.set(k,val);return val;
}
// Value of carrying a specified subset INTO the third turn, relative to
// starting that turn with no dice. Target choice is made before its random rolls.
const KEY_INDEX=new Map(KEYS.map((k,i)=>[k,i]));
const thirdGainMemo=new Map();
function thirdGain(mask,u,keep){if(!mask||!keep.length)return 0;
 const state=mask*128+u,id=KEY_INDEX.get(keep);
 let values=thirdGainMemo.get(state);
 if(!values){values=new Float64Array(KEYS.length).fill(NaN);
  if(thirdGainMemo.size>=3500)thirdGainMemo.clear();thirdGainMemo.set(state,values);}
 let v=values[id];if(!Number.isNaN(v))return v;
 v=0;for(let c=0;c<N;c++)if(mask&(1<<c)){
  let gain=TARGET[c].get(keep)-SOLO[c];
  if(c<6){let held=0;for(const d of keep)if(+d===c+1)held++;
   if(held)gain+=deltaUpper(mask,u,c,held);
  }
  if(gain>v)v=gain;
 }
 values[id]=v;return v;
}
const carryGainMemo=new Map();
function carryGain(mask,u,hand){if(!mask)return 0;
 const state=mask*128+u,id=HAND_INDEX.get(hand);
 let values=carryGainMemo.get(state);
 if(!values){values=new Float64Array(HANDS.length).fill(NaN);
  if(carryGainMemo.size>=6000)carryGainMemo.clear();carryGainMemo.set(state,values);}
 let v=values[id];if(!Number.isNaN(v))return v;
 v=0;for(const h of holdsOf(hand)){
  if(!h.key.length)continue;const net=thirdGain(mask,u,h.key)-3*h.key.length;
  if(net>v+1e-10)v=net;
 }
 values[id]=v;return v;
}
// Full probability enumeration for a SECOND turn (three roll opportunities),
// with third turn + longer future under the explicit target-policy expectation.
const secondMemo=new Map();
function secondProfile(mask,u){const cacheKey=mask+'|'+u;let result=secondMemo.get(cacheKey);if(result)return result;
 if(!mask){const v=tail(0,u);result={baseline:v,values:new Map(KEYS.map(k=>[k,v]))};}
 else {
  const cats=[];for(let c=0;c<N;c++)if(mask&(1<<c))cats.push(c);
  const terminal=Float64Array.from(HANDS,(hand,i)=>{
   let best=-Infinity;
   for(const c of cats){const pts=SCORE[c][i],nextMask=mask&~(1<<c),nextUpper=u+(c<6?pts:0);
    const value=pts+tail(nextMask,nextUpper)+carryGain(nextMask,nextUpper,hand);
    if(value>best)best=value;
   }return best;
  });
  const dp=optimizeRolls(terminal),evFirst=new Map();for(const k of KEYS)evFirst.set(k,expectedRoll(k,dp[2]));
  const values=new Map();for(const kept of KEYS){let best=-Infinity;
   for(const h of holdsOf(kept))best=Math.max(best,evFirst.get(h.key));values.set(kept,best);
  }
  result={baseline:values.get(''),values};
 }
 if(secondMemo.size>190)secondMemo.clear();secondMemo.set(cacheKey,result);
 return result;}
function continuationScore(mask,u,hand){if(!mask)return {future:tail(0,u),carry:''};
 const p=secondProfile(mask,u);let best=p.baseline,carry='';
 for(const h of holdsOf(hand))if(h.key.length){const v=p.values.get(h.key)-3*h.key.length;
  if(v>best+1e-10){best=v;carry=h.key;}}
 return {future:best,carry};
}
const stateMemo=new Map();function currentBoard(mask,u){const k=mask+'|'+u;let result=stateMemo.get(k);if(result)return result;
 const scored=Array.from({length:HANDS.length},()=>[]);
 const terminal=Float64Array.from(HANDS,(hand,i)=>{
  let best=-Infinity;for(let c=0;c<N;c++)if(mask&(1<<c)){
   const pts=SCORE[c][i],nextMask=mask&~(1<<c),nextUpper=u+(c<6?pts:0);
   const cont=continuationScore(nextMask,nextUpper,hand),value=pts+cont.future;
   scored[i].push({type:'score',category:IDS[c],points:pts,value,afterMask:nextMask,afterUpper:nextUpper});
   if(value>best)best=value;
  }return best;
 });
 result={scored,dp:optimizeRolls(terminal)};
 if(stateMemo.size>10)stateMemo.clear();stateMemo.set(k,result);return result;
}
function actualMask(dice,keep){const want=Array(7).fill(0);for(const d of keep)want[+d]++;
 let mask=0;for(let i=0;i<5;i++)if(dice[i]!=null&&want[dice[i]]>0){want[dice[i]]--;mask|=1<<i;}return mask;}
function optionsRoll(game,dp){const remain=3-game.rollsUsed;if(remain<=0)return [];
 const valid=game.dice.map((v,i)=>v==null?-1:i).filter(i=>i>=0),sub=new Map();
 for(let bits=0;bits<(1<<valid.length);bits++){let kept='',m=0;
  for(let j=0;j<valid.length;j++)if(bits&(1<<j)){kept+=game.dice[valid[j]];m|=1<<valid[j];}
  kept=keyOf(diceOf(kept));if(kept.length===5)continue;
  if(!sub.has(kept))sub.set(kept,m);
 }
 const result=[];for(const [kept,mask] of sub)result.push({type:'roll',mask,kept,value:expectedRoll(kept,dp[remain-1])});return result;
}
function decide(g){if(!g||g.mode!=='ai'||g.turn!==1||g.phase==='finished')throw Error('当前不是 AI 回合');
 const p=g.players[1],upper=Core.upperSum(p);let mask=0;
 for(let i=0;i<N;i++)if(!Object.hasOwn(p.scores,IDS[i]))mask|=1<<i;
 if(g.phase==='carry'){
  const hand=keyOf(g.dice);const select=continuationScore(mask,upper,hand);
  return {type:'carry',mask:actualMask(g.dice,select.carry),carryKey:select.carry,value:select.future,reason:''};
 }
 if(g.phase!=='rolling')throw Error('未知 AI 阶段');
 const {scored,dp}=currentBoard(mask,upper),options=optionsRoll(g,dp);
 if(g.dice.every(Number.isInteger))options.push(...scored[HAND_INDEX.get(keyOf(g.dice))]);
 if(!options.length)throw Error('没有合法选择');
 let best=options[0];for(const x of options)if(x.value>best.value+1e-10)best=x;
 return {...best,reason:''};
}
function clearCache(){tailMemo.clear();bonusDeltaMemo.clear();thirdGainMemo.clear();carryGainMemo.clear();secondMemo.clear();stateMemo.clear();}
return {LEVELS,decide,clearCache,TARGET,SOLO,secondProfile,continuationScore,tail,carryGain,inspectBoard(g){
 const p=g.players[1],upper=Core.upperSum(p);let mask=0;for(let i=0;i<N;i++)if(!Object.hasOwn(p.scores,IDS[i]))mask|=1<<i;
 return {upper,remaining:IDS.filter((_,i)=>mask&(1<<i)),tailExpected:tail(mask,upper)};
}};
});
