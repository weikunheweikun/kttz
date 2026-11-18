const assert = require('node:assert/strict');
const C = require('./core.js');
const AI = require('./ai.js');
assert.deepEqual(Object.keys(AI.LEVELS),['easy','medium','hard']);
assert.deepEqual(Object.values(AI.LEVELS).map(x=>x.horizon),[1,2,3]);
assert.equal(C.COST_PER_DIE,3);
assert.equal(C.CATEGORIES.length,13);
assert.throws(()=>C.newGame('local'),/模式无效/);
assert.throws(()=>C.newGame('solo'),/模式无效/);
assert.equal(C.score('yahtzee',[2,2,2,2,2]),60);
assert.equal(C.score('fullHouse',[3,3,3,3,3]),25);
function runDifficulty(level){
  const g=C.newGame('ai',['我','AI']);let decisions=0,aiScores=0,aiKeeps=0;
  const start=Date.now();
  while(g.phase!=='finished'){
    if(decisions++>3000)throw new Error('endless game '+level);
    if(g.turn===0){
      if(g.phase==='rolling'){
        if(g.dice.some(x=>x==null))C.action(g,'roll');
        const cat=C.CATEGORIES.find(c=>!(c.id in g.players[0].scores));
        C.action(g,'score',{category:cat.id});
      }else C.action(g,'confirmCarry');
    } else {
      const plan=AI.decide(g,level);
      if(plan.type==='roll'){
        assert.equal(g.phase,'rolling');
        for(let i=0;i<5;i++){
          const target=!!(plan.mask&(1<<i));
          if(g.dice[i]!=null&&g.held[i]!==target)C.action(g,'toggleHold',{index:i});
        }
        C.action(g,'roll');
      }else if(plan.type==='score'){
        assert.equal(g.phase,'rolling');
        assert(g.dice.every(Number.isInteger));
        C.action(g,'score',{category:plan.category}); aiScores++;
      }else if(plan.type==='carry'){
        assert.equal(g.phase,'carry');
        for(let i=0;i<5;i++)if(plan.mask&(1<<i)) {C.action(g,'toggleCarry',{index:i});aiKeeps++;}
        C.action(g,'confirmCarry');
      }else throw new Error('unknown plan '+plan.type);
    }
  }
  assert.equal(C.filledCount(g.players[0]),13);
  assert.equal(C.filledCount(g.players[1]),13);
  assert.equal(aiScores,13);
  assert.equal(g.phase,'finished');
  const totals=g.players.map(C.totals);
  assert(totals.every(t=>Number.isFinite(t.total)));
  console.log(level,JSON.stringify({actions:decisions,aiScore:totals[1].total,aiPaid:g.players[1].paid,aiRetainedDice:aiKeeps,ms:Date.now()-start}));
}
for(const level of ['easy','medium','hard'])runDifficulty(level);
console.log('PASS 3 levels, full games, 13 cells each, no local mode, scoring, paid carry');
