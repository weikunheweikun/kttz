/* 快艇骰子 V8：按 200 / 220 / 240 长期均分目标校准的策略 AI。
 * 三档依然使用精确枚举的本轮决策与不同深度的未来估值。
 * 真实掷骰只由 core.js 的 crypto.getRandomValues 执行；此模块不改变任何骰子点数。
 * 本轮决策：对所有有效留骰组合和剩余重掷结果做精确概率期望计算。
 * 未来 1–2 回合：按“目标类别”的最优重掷策略估算期望值（不是整局全局穷举）。
 */
(function(root,factory){
  const api=factory(typeof require==='function'&&typeof module==='object'?require('./core.js'):root.YachtCore);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.YachtAI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';
  const LEVELS={
        easy:{label:'简单',horizon:1,weakChance:0.245,bonusWeight:0.85,carryHurdle:7,futureWeight:0.8},
    medium:{label:'中等',horizon:2,weakChance:0.095,bonusWeight:0.85,carryHurdle:7,futureWeight:0.8},
    hard:{label:'困难',horizon:3,weakChance:0.01,bonusWeight:1.3,carryHurdle:4,futureWeight:0.8}
  };
  const BASE={ones:2.8,twos:6.1,threes:9.2,fours:12.5,fives:16.4,sixes:19.7,
    threeKind:20.5,fourKind:12.0,fullHouse:17.5,smallStraight:22.0,largeStraight:19.0,
    yahtzee:11.8,chance:23.3};
  const IDS=Core.CATEGORIES.map(c=>c.id), N=IDS.length;
  const FACT=[1,1,2,6,24,120], POW6=[1,6,36,216,1296,7776];
  function enumerate(n,min,stem,out){
    if(!n){out.push(stem);return;}
    for(let d=min;d<=6;d++)enumerate(n-1,d,stem+d,out);
  }
  const KEYS=[];
  for(let n=0;n<=5;n++)enumerate(n,1,'',KEYS);
  const ALL_HANDS=KEYS.filter(k=>k.length===5);
  const handsIndex=new Map(ALL_HANDS.map((k,i)=>[k,i]));
  const diceOf=k=>Array.from(k,Number);
  const keyOf=d=>d.slice().sort((a,b)=>a-b).join('');
  const memoHolds=new Map();
  function holdsOf(key){
    if(memoHolds.has(key))return memoHolds.get(key);
    const all=new Map(),len=key.length;
    for(let mask=0;mask<(1<<len);mask++){
      let s='';for(let i=0;i<len;i++)if(mask&(1<<i))s+=key[i];
      if(!all.has(s))all.set(s,mask);
    }
    const out=[...all].map(([k,mask])=>({key:k,mask}));
    memoHolds.set(key,out);return out;
  }
  const transitions=new Map();
  for(const keep of KEYS){
    const r=5-keep.length, rolls=[];enumerate(r,1,'',rolls);
    const options=rolls.map(rolled=>{
      const counts=[0,0,0,0,0,0,0];for(const d of rolled)counts[Number(d)]++;
      let weight=FACT[r];for(let i=1;i<=6;i++)weight/=FACT[counts[i]];
      const end=keyOf(diceOf(keep+rolled));
      return {index:handsIndex.get(end),weight};
    });
    transitions.set(keep,{options,denominator:POW6[r]});
  }
  const scoreMatrix=IDS.map(id=>Float64Array.from(ALL_HANDS,key=>Core.score(id,diceOf(key))));
  const idxForKey=k=>handsIndex.get(k);
  function eRoll(keep,values){
    const t=transitions.get(keep);let sum=0;
    for(const part of t.options)sum+=part.weight*values[part.index];
    return sum/t.denominator;
  }
  // 单一计分类别：求最佳“提前计分或重掷”的精确期望，最多两次可选重掷。
  function optimalTable(terminal){
    const levels=[terminal];
    for(let n=1;n<=2;n++){
      const prev=levels[n-1],cache=new Map();
      for(const k of KEYS)cache.set(k,eRoll(k,prev));
      const next=Float64Array.from(ALL_HANDS,(hand,i)=>{
        let best=terminal[i];
        for(const hold of holdsOf(hand)){
          if(hold.key.length===5)continue;
          const v=cache.get(hold.key);
          if(v>best)best=v;
        }
        return best;
      });
      levels.push(next);
    }
    return levels;
  }
  // 对每一类、每一种“跨轮继承骰子集合”，求下轮的准确目标类别期望。
  // 可以解锁继承的骰子；剩余的空位置必须在下一轮第一掷补齐。
  const targetEV=IDS.map((id,c)=>{
    const dp=optimalTable(scoreMatrix[c]);
    const result=new Map();
    for(const carried of KEYS){
      let best=carried.length===5?dp[2][idxForKey(carried)]:-Infinity;
      for(const kept of holdsOf(carried)){
        const v=eRoll(kept.key,dp[2]);
        if(v>best)best=v;
      }
      result.set(carried,best);
    }
    return result;
  });
  const forecastMemo=new Map();
  function futureValue(openMask,depth,carryKey){
    if(!depth||!openMask)return 0;
    const cacheKey=openMask+'|'+depth+'|'+carryKey;
    if(forecastMemo.has(cacheKey))return forecastMemo.get(cacheKey);
    let best=-Infinity;
    for(let c=0;c<N;c++)if(openMask&(1<<c)){
      const advantage=targetEV[c].get(carryKey)-BASE[IDS[c]];
      // 在更远的回合中仅假设没有跨轮购买的初始骰子；避免凭空把本回合骰子借给未来。
      const tail=depth>1?.76*futureValue(openMask&~(1<<c),depth-1,''):0;
      const value=advantage+tail;
      if(value>best)best=value;
    }
    if(!Number.isFinite(best))best=0;
    forecastMemo.set(cacheKey,best);
    return best;
  }
  // 评估“本轮计分后”，在五颗真实骰子里选择 0~5 颗、花费 3 分/颗的最佳增益。
  const carryForecastMemo=new Map();
  function carryValues(openMask,depth){
    const key=openMask+'|'+depth;
    if(carryForecastMemo.has(key))return carryForecastMemo.get(key);
    const array=new Map();
    const baseline=futureValue(openMask,depth,'');
    for(const carry of KEYS){
      const utility=futureValue(openMask,depth,carry)-Core.COST_PER_DIE*carry.length;
      // 只关心相对“不购买任何骰子”的可验证净收益。
      array.set(carry,utility-baseline);
    }
    carryForecastMemo.set(key,array);
    return array;
  }
  function chooseCarryForHand(fullKey,openMask,depth){
    const potential=carryValues(openMask,depth);const options=[];
    for(const hold of holdsOf(fullKey))options.push({type:'carry',mask:hold.mask,
      value:potential.get(hold.key),count:hold.key.length});
    return options;
  }
  const TOP_KEYS=['ones','twos','threes','fours','fives','sixes'];
  function upperProspect(player,category,score){
    if(!TOP_KEYS.includes(category))return 0;
    const open=TOP_KEYS.filter(c=>!Object.hasOwn(player.scores,c));
    const others=open.filter(c=>c!==category);
    const prev=Core.upperSum(player);
    const projectedRest=others.reduce((s,c)=>s+BASE[c]*.98,0);
    const expected=BASE[category];
    if(!others.length)return 35*((prev+score>=63?1:0)-(prev+expected>=63?1:0));
    const width=3+others.length*3.5;
    const logistic=n=>1/(1+Math.exp(-(n-63)/width));
    return 35*(logistic(prev+score+projectedRest)-logistic(prev+expected+projectedRest));
  }
  function makeState(game,level){
    const p=game.players[game.turn];let openMask=0;
    for(let c=0;c<N;c++)if(!Object.hasOwn(p.scores,IDS[c]))openMask|=1<<c;
    return {p,openMask,level};
  }
  // 缓存一整个回合的价值表：在同一回合第一次/第二次/第三次投掷之间复用。
  const stateMemo=new Map();
  function valuesFor(state){
    const {p,openMask,level}=state;
    const key=level+'|'+openMask+'|'+Core.upperSum(p);
    if(stateMemo.has(key))return stateMemo.get(key);
    const {horizon}=LEVELS[level];
    const scored=Array.from({length:ALL_HANDS.length},()=>[]);
    const v0=Float64Array.from(ALL_HANDS,(hand,i)=>{
      let best=-Infinity;
      for(let c=0;c<N;c++)if(openMask&(1<<c)){
        const points=scoreMatrix[c][i];
        let value=points-BASE[IDS[c]]+LEVELS[level].bonusWeight*upperProspect(p,IDS[c],points);
        if(horizon>1){
          const options=chooseCarryForHand(hand,openMask&~(1<<c),horizon-1);
          value+=LEVELS[level].futureWeight*Math.max(0,...options.map(o=>o.value));
        }
        scored[i].push({type:'score',category:IDS[c],points,value});
        if(value>best)best=value;
      }
      return best;
    });
    const dp=optimalTable(v0);
    const values={v0,dp,scored};
    if(stateMemo.size>52)stateMemo.clear();
    stateMemo.set(key,values);return values;
  }
  function weakRoll(p){
    if(p<=0)return false;
    const source=typeof globalThis!=='undefined'?globalThis.crypto:null;
    if(!source||typeof source.getRandomValues!=='function')return false;
    const bucket=new Uint32Array(1);source.getRandomValues(bucket);
    return bucket[0]/4294967296<p;
  }
  function rankPick(options,config){
    const sort=options.slice().sort((a,b)=>b.value-a.value);
    if(sort.length>1 && weakRoll(config.weakChance))return sort[1];
    return sort[0];
  }
  function optionsRoll(game,dp){
    const rollsLeft=3-game.rollsUsed;
    if(rollsLeft<=0)return [];
    const current=game.dice;
    const valid=current.map((v,i)=>v==null?-1:i).filter(i=>i>=0);
    const result=[];
    const subsetMap=new Map();
    for(let mask=0;mask<(1<<valid.length);mask++){
      let kept='',physical=0;
      for(let j=0;j<valid.length;j++)if(mask&(1<<j)){kept+=current[valid[j]];physical|=1<<valid[j];}
      kept=keyOf(diceOf(kept));
      if(kept.length===5)continue; // 全锁住时不可掷骰
      if(!subsetMap.has(kept))subsetMap.set(kept,physical);
    }
    const expected=dp[rollsLeft-1];
    for(const [kept,physical] of subsetMap)result.push({type:'roll',mask:physical,value:eRoll(kept,expected)});
    return result;
  }
  function actualMaskForCarry(dice,heldKey){
    const needed=Array(7).fill(0);for(const ch of heldKey)needed[+ch]++;
    let mask=0;
    for(let i=0;i<dice.length;i++)if(needed[dice[i]]>0){mask|=1<<i;needed[dice[i]]--;}
    return mask;
  }
  function decide(game,level='medium'){
    if(!game||game.mode!=='ai'||game.turn!==1||game.phase==='finished')throw Error('当前不是 AI 的回合');
    const config=LEVELS[level]||LEVELS.medium,actualLevel=LEVELS[level]?level:'medium';
    const current=makeState(game,actualLevel);
    if(game.phase==='carry'){
      const fullKey=keyOf(game.dice),forecast=chooseCarryForHand(fullKey,current.openMask,config.horizon);
      const shortlist=forecast.map(o=>({...o,value:o.value-(o.count ? config.carryHurdle : 0)}));
      const pick=rankPick(shortlist,config);
      const intended=keyOf(diceOf(fullKey).filter((_,i)=>pick.mask&(1<<i)));
      return {type:'carry',mask:actualMaskForCarry(game.dice,intended),value:pick.value,carryKey:intended};
    }
    if(game.phase!=='rolling')throw Error('未知的 AI 阶段');
    const {dp,scored}=valuesFor(current);
    const options=optionsRoll(game,dp);
    if(game.dice.every(Number.isInteger)){
      const key=keyOf(game.dice),idx=idxForKey(key);
      options.push(...scored[idx]);
    }
    if(!options.length)throw Error('AI 没有合法选择');
    return rankPick(options,config);
  }
  function clearCache(){stateMemo.clear();forecastMemo.clear();carryForecastMemo.clear();}
  return {LEVELS,BASE,decide,clearCache,targetEV,scoreMatrix,ALL_HANDS};
});
