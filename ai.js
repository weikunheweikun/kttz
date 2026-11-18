/* Yacht AI: bounded, category-guided Monte-Carlo lookahead.
 * Planning draws NEVER affect actual dice: the core alone uses crypto.getRandomValues.
 * Difficulty horizon counts the current scoring turn (1/2/3).
 * Returns suggested score / hold mask + roll / carry mask. */
(function(root, factory) {
  const api=factory(typeof require==='function' && typeof module==='object' ? require('./core.js') : root.YachtCore);
  if(typeof module==='object' && module.exports)module.exports=api; else root.YachtAI=api;
})(typeof globalThis!=='undefined'?globalThis:this, function(Core) {
  'use strict';
  const LEVELS={
    easy:{label:'简单',horizon:1,samples:12,weakChance:1/6,forecastSamples:7},
    medium:{label:'中等',horizon:2,samples:16,weakChance:1/10,forecastSamples:9},
    hard:{label:'困难',horizon:3,samples:20,weakChance:1/20,forecastSamples:12}
  };
  // Estimated score for a fully-played fresh category. Used as a slot's opportunity cost;
  // the planner compares gains against taking that same category on a later round.
  const BASE={ones:2.8,twos:6.1,threes:9.2,fours:12.5,fives:16.4,sixes:19.7,
    threeKind:20.5,fourKind:12.0,fullHouse:17.5,smallStraight:22.0,largeStraight:19.0,yahtzee:11.8,chance:23.3};
  const ORDER=Core.CATEGORIES.map(c=>c.id);
  function hash(s){let n=2166136261;for(let i=0;i<s.length;i++){n^=s.charCodeAt(i);n=Math.imul(n,16777619);}return n>>>0;}
  function rng(seed){let a=(seed||1)>>>0;return ()=>{a^=a<<13;a^=a>>>17;a^=a<<5;return (a>>>0)/4294967296;};}
  const randomDie = rand => Math.floor(rand()*6)+1;
  function randomChance(p){
    const crypto=(typeof globalThis!=='undefined'&&globalThis.crypto);
    if(!crypto?.getRandomValues)return false;
    const b=new Uint32Array(1);crypto.getRandomValues(b);
    return (b[0]/4294967296)<p;
  }
  const popcount = n=>{let x=n,c=0;while(x){x&=x-1;c++;}return c;};
  const canonical = values=>values.slice().filter(n=>n!=null).sort((a,b)=>a-b).join('');
  function counts(d){const a=[0,0,0,0,0,0,0];for(const n of d)if(n)a[n]++;return a;}
  function maskFromIndices(ids){let m=0;for(const id of ids)m|=(1<<id);return m;}
  function targetMask(category,dice){
    const n=counts(dice),filled=dice.map((v,i)=>v==null?-1:i).filter(i=>i>=0);
    if(!filled.length)return 0;
    if(category==='chance')return maskFromIndices(filled.filter(i=>dice[i]>=5));
    const upper=['ones','twos','threes','fours','fives','sixes'];
    if(upper.includes(category)){const value=upper.indexOf(category)+1;return maskFromIndices(filled.filter(i=>dice[i]===value));}
    if(['threeKind','fourKind','yahtzee'].includes(category)){
      let value=6;
      for(let x=5;x>=1;x--)if(n[x]>n[value]||(n[x]===n[value]&&x>value))value=x;
      return maskFromIndices(filled.filter(i=>dice[i]===value));
    }
    if(category==='fullHouse'){
      if(Math.max(...n)===5)return maskFromIndices(filled);
      const ordered=[1,2,3,4,5,6].sort((a,b)=>n[b]-n[a]||b-a);
      const first=ordered[0],second=ordered[1];let firstCount=0,secondCount=0;
      return maskFromIndices(filled.filter(i=>{
        if(dice[i]===first&&firstCount<3){firstCount++;return true;}
        if(dice[i]===second&&secondCount<2){secondCount++;return true;}
        return false;
      }));
    }
    if(category==='smallStraight'||category==='largeStraight'){
      const sequences=category==='smallStraight'?[[1,2,3,4],[2,3,4,5],[3,4,5,6]]:[[1,2,3,4,5],[2,3,4,5,6]];
      let best=sequences[0],bestHit=-1;
      for(const seq of sequences){const hit=seq.filter(x=>n[x]).length;if(hit>bestHit){best=seq;bestHit=hit;}}
      const seen=new Set();return maskFromIndices(filled.filter(i=>{const v=dice[i];if(best.includes(v)&&!seen.has(v)){seen.add(v);return true;}return false;}));
    }
    return 0;
  }
  function finishTarget(category,initial,rolls,rand){
    const dice=initial.slice();
    for(let r=0;r<rolls;r++){
      const hold=targetMask(category,dice);
      if(hold===31&&dice.every(Number.isInteger))break;
      for(let i=0;i<5;i++)if(!(hold&(1<<i)))dice[i]=randomDie(rand);
    }
    return dice;
  }
  const expectedCache=new Map();
  function expectedTarget(category,carry,config){
    const key=category+':'+canonical(carry)+':'+config.forecastSamples;
    if(expectedCache.has(key))return expectedCache.get(key);
    const arr=[...carry,...Array(5-carry.length).fill(null)];
    const rand=rng(hash(key));let sum=0;
    for(let j=0;j<config.forecastSamples;j++)sum+=Core.score(category,finishTarget(category,arr,3,rand));
    const ans=sum/config.forecastSamples;
    if(expectedCache.size>16000)expectedCache.clear();
    expectedCache.set(key,ans);
    return ans;
  }
  function candidateCarryMasks(category,dice){
    const exact=targetMask(category,dice);
    const candidates=new Set([0,exact]);
    if(popcount(exact)>3){let limited=0,count=0;for(let i=0;i<5;i++)if(exact&(1<<i)){limited|=1<<i;if(++count===3)break;}candidates.add(limited);}
    if(popcount(exact)>1){let limited=0,count=0;for(let i=0;i<5;i++)if(exact&(1<<i)){limited|=1<<i;if(++count===2)break;}candidates.add(limited);}
    return [...candidates];
  }
  function retained(dice,mask){return dice.filter((_,i)=>mask&(1<<i));}
  function bestCarryFor(category,dice,config){
    let best={category,mask:0,carry:[],gain:expectedTarget(category,[],config)-BASE[category]};
    for(const mask of candidateCarryMasks(category,dice)){
      if(!mask)continue;
      const carry=retained(dice,mask);
      const gain=expectedTarget(category,carry,config)-BASE[category]-carry.length*Core.COST_PER_DIE;
      if(gain>best.gain+1e-8)best={category,mask,carry,gain};
    }
    return best;
  }
  function futureValue(dice,remaining,steps,config,player,localCache){
    if(steps<=0||remaining.length===0)return 0;
    const k=canonical(dice)+'|'+remaining.join(',')+'|'+steps;
    if(localCache.has(k))return localCache.get(k);
    const options=remaining.map(category=>bestCarryFor(category,dice,config)).sort((a,b)=>b.gain-a.gain);
    let best=options[0]?.gain||0;
    if(steps>=2 && remaining.length>1){
      // Depth 3: explicitly sample the result of the NEXT round and optimize the third.
      for(const item of options.slice(0,3)){
        const next=remaining.filter(c=>c!==item.category);
        const rand=rng(hash(k+item.category+canonical(item.carry)));
        let third=0;
        for(let n=0;n<3;n++){
          const finished=finishTarget(item.category,[...item.carry,...Array(5-item.carry.length).fill(null)],3,rand);
          const result=Math.max(...next.map(c=>bestCarryFor(c,finished,config).gain));
          third+=result;
        }
        const combined=item.gain+.72*(third/3);
        if(combined>best)best=combined;
      }
    }
    localCache.set(k,best);
    return best;
  }
  function upperProspect(p,category,value){
    const upper=['ones','twos','threes','fours','fives','sixes'];
    if(!upper.includes(category))return 0;
    const previousUpper=Core.upperSum(p);
    const already=upper.filter(c=>Object.prototype.hasOwnProperty.call(p.scores,c));
    const others=upper.filter(c=>!already.includes(c)&&c!==category);
    // Soft estimate of the +35 upper bonus probability. At last upper slot it becomes exact.
    const projected=previousUpper+value+others.reduce((n,c)=>n+BASE[c]*.94,0);
    const baseline=previousUpper+BASE[category]+others.reduce((n,c)=>n+BASE[c]*.94,0);
    if(!others.length)return 35*((projected>=63?1:0)-(baseline>=63?1:0));
    const soft=x=>1/(1+Math.exp(-(x-63)/(3+others.length*4)));
    return 35*(soft(projected)-soft(baseline));
  }
  function immediateValue(category,dice,player){
    const points=Core.score(category,dice);
    const upperExtra=upperProspect(player,category,points);
    return points-BASE[category]+upperExtra*.68;
  }
  function configFor(level){return LEVELS[level]||LEVELS.medium;}
  function rankOptions(options,config,randWeak=true){
    const ordered=options.slice().sort((a,b)=>b.value-a.value);
    if(randWeak&&ordered.length>1&&randomChance(config.weakChance))return ordered[1];
    return ordered[0];
  }
  function chooseScore(game,config,cache){
    const player=game.players[game.turn];const cats=ORDER.filter(c=>!Object.prototype.hasOwnProperty.call(player.scores,c));
    const out=cats.map(category=>{
      const immediate=immediateValue(category,game.dice,player);
      const remaining=cats.filter(c=>c!==category);
      const forward=config.horizon>1?futureValue(game.dice,remaining,config.horizon-1,config,player,cache):0;
      return {type:'score',category,value:immediate+.72*forward,points:Core.score(category,game.dice)};
    });
    return out.sort((a,b)=>b.value-a.value);
  }
  function chooseRoll(game,config,cache){
    const player=game.players[game.turn];const cats=ORDER.filter(c=>!Object.prototype.hasOwnProperty.call(player.scores,c));
    const extra=3-game.rollsUsed-1; // after the upcoming roll
    const maskByTarget=cats.map(c=>({category:c,mask:targetMask(c,game.dice)})).filter(a=>a.mask!==31);
    // An empty mask provides a deliberate complete reroll option.
    maskByTarget.push({category:'chance',mask:0});
    const evaluated=[];
    for(const option of maskByTarget){
      const r=rng(hash('plan|'+game.version+'|'+game.dice.join('')+'|'+option.category+'|'+option.mask));
      let total=0;
      for(let i=0;i<config.samples;i++){
        const hand=game.dice.slice();
        for(let j=0;j<5;j++)if(!(option.mask&(1<<j)))hand[j]=randomDie(r);
        const end=finishTarget(option.category,hand,extra,r);
        const remaining=cats.filter(c=>c!==option.category);
        const value=immediateValue(option.category,end,player);
        const next=config.horizon>1?futureValue(end,remaining,config.horizon-1,config,player,cache):0;
        total+=value+.72*next;
      }
      evaluated.push({type:'roll',mask:option.mask,target:option.category,value:total/config.samples});
    }
    return evaluated.sort((a,b)=>b.value-a.value);
  }
  function chooseCarry(game,config){
    const player=game.players[game.turn];const cats=ORDER.filter(c=>!Object.prototype.hasOwnProperty.call(player.scores,c));
    const options=cats.map(c=>bestCarryFor(c,game.dice,config));
    options.push({mask:0,category:'',gain:0});
    return rankOptions(options.map(o=>({...o,type:'carry',value:o.gain})),config);
  }
  function decide(game,level='medium'){
    if(!game||game.mode!=='ai'||game.turn!==1||game.phase==='finished')throw Error('当前不是 AI 的回合');
    const config=configFor(level),cache=new Map();
    if(game.phase==='carry')return chooseCarry(game,config);
    if(game.phase!=='rolling')throw Error('未知的 AI 阶段');
    if(game.rollsUsed===0&&game.dice.some(v=>v==null))return {type:'roll',mask:game.held.reduce((m,held,i)=>m|(held?1<<i:0),0),target:'initial',value:0};
    const scored=game.dice.every(Number.isInteger)?chooseScore(game,config,cache):[];
    if(game.rollsUsed>=3)return rankOptions(scored,config);
    const rolls=chooseRoll(game,config,cache);
    if(!rolls.length)return rankOptions(scored,config);
    if(!scored.length || rolls[0].value>scored[0].value+.35)return rankOptions(rolls,config);
    return rankOptions(scored,config);
  }
  return {LEVELS,BASE,decide,targetMask,finishTarget,bestCarryFor,configFor};
});
