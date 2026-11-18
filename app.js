/* 快艇骰子 · 浏览器界面 + WebRTC DataChannel 手工信令（无需后端） */
(() => {
  'use strict';
  const Core = window.YachtCore;
  const AI = window.YachtAI;
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const PIPS = {
    1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8]
  };
  const $game = $('game');
  const $modal = $('mainModal');
  const $body = $('modalBody');
  const $title = $('modalTitle');
  let game;
  let chosenCategory = null;
  let aiDifficulty = 'medium';
  let aiTimer = null;
  let aiGeneration = 0;
  let summaryShown = false;
  let rollAnimating = false;
  let toastTimer;
  let net = freshNet();
  function freshNet() { return { role:null, pc:null, dc:null, status:'未连接', connected:false, offerCode:'', answerCode:'', ready:false, name:'玩家', busy:false, awaitingRoll:false }; }
  function warn(err) { const message = err instanceof Error ? err.message : String(err); showToast(message, true); }
  function showToast(message, error=false) {
    const el=$('toast'); el.textContent=message; el.className=(error?'error ':'')+'show';
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.className='';},3300);
  }
  function canAct() {
    return !!game && !rollAnimating && !(game.mode==='ai' && game.turn===1) && (game.mode!=='online' || (net.connected && (net.role==='host' ? game.turn===0 : game.turn===1)));
  }
  function isOnline() { return game && game.mode==='online'; }
  function connectionUpdate() {
    const tag=$('connectionTag');
    if (isOnline()) { tag.hidden=false; tag.textContent=net.connected?'● 已直连':'○ 未连接'; }
    else tag.hidden=true;
  }
  function pipFace(n) {
    return Array.from({length:9},(_,k)=>`<span class="pip ${PIPS[n]?.includes(k)?'on':''}"></span>`).join('');
  }
  function dieMarkup(n,i) {
    const isCarry=game.phase==='carry';
    const selected=isCarry ? !!game.carrySelection[i] : !!game.held[i];
    const empty=n==null;
    const active=canAct() && game.phase!=='finished' && !empty;
    return `<button type="button" class="die ${empty?'empty':''} ${selected?(isCarry?'carry-selected':'held'):''}" data-die="${i}" style="--dice-index:${i}" ${!active?'disabled':''} aria-pressed="${selected}" aria-label="第 ${i+1} 颗，${empty?'尚未投掷':`${n} 点，${selected?'已锁定':'未锁定'}`}">
        <span class="die-face ${empty?'empty':''}" aria-hidden="true"><span class="face-pips">${empty?'<span class="die-placeholder">·</span>':pipFace(n)}</span></span>
        <span class="die-status">${empty?'待掷':game.phase==='finished'?'已完成':(selected?(isCarry?'已选 · 留到下轮':'已锁定'):isCarry?'选择保留':'点击锁定')}</span>
      </button>`;
  }
  function playerMarkup(p,i) {
    const t=Core.totals(p),active=game.phase!=='finished'&&game.turn===i;
    return `<section class="player-card panel ${active?'active':''}">
      <div class="player-line"><span class="player-name">${esc(p.name)}</span><span class="player-flag ${active?'':'muted'}">${game.phase==='finished'?'已完成':active?(game.mode==='ai'&&i===1?'AI 思考中':'当前玩家'):'等待'}</span></div>
      <div class="player-total"><strong>${t.total}</strong><small>分 · ${t.filled}/13 格</small></div>
      <div class="player-foot"><span>上栏 ${t.upper}/63</span><span>奖励 ${t.bonus}</span><span class="${t.paid?'red':''}">留骰 −${t.paid}</span></div>
    </section>`;
  }
  function scoreCell(p,i,cat) {
    const filled=Object.prototype.hasOwnProperty.call(p.scores, cat.id);
    if (filled) return `<span class="score-value ${p.scores[cat.id]===0?'zero':''}">${p.scores[cat.id]}</span>`;
    if (game.phase==='rolling' && game.turn===i && canAct() && game.dice.every(n=>n!=null)) {
      const value=Core.score(cat.id, game.dice);
      return `<button class="score-option" type="button" data-category="${cat.id}" aria-label="将 ${value} 分记入${esc(cat.label)}">${value}<span class="plus"> +</span></button>`;
    }
    return '<span class="score-value zero">—</span>';
  }
  function scoreRow(cat) {
    return `<tr><td><span class="cat-name">${esc(cat.label)}</span><small class="cat-hint">${esc(cat.info)}</small></td>
      ${game.players.map((p,i)=>`<td class="${game.turn===i&&game.phase!=='finished'?'active-col':''}"><div class="score-cell">${scoreCell(p,i,cat)}</div></td>`).join('')}</tr>`;
  }
  function summaryRow(label,getter,cls='subtotal-row') {
    return `<tr class="${cls}"><td>${esc(label)}</td>${game.players.map(p=>`<td><span class="score-value">${getter(Core.totals(p))}</span></td>`).join('')}</tr>`;
  }
  function scoreTable() {
    const upper=Core.CATEGORIES.filter(c=>c.section==='upper'),lower=Core.CATEGORIES.filter(c=>c.section==='lower');
    return `<section class="panel score-panel" id="scoreboard">
      <div class="panel-heading"><div><h2>计分卡 <span class="muted-inline">/ 13 格</span></h2><p>${game.phase==='rolling'&&game.dice.some(n=>n==null)?'先掷骰子，再点击对应的得分':'选择可用的分数，即可完成本轮记分'}</p></div><span class="tag">可记 0 分</span></div>
      <table class="score-table"><thead><tr><th>类别</th>${game.players.map((p,i)=>`<th class="${game.turn===i&&game.phase!=='finished'?'active-col':''}">${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody><tr class="section-row"><td colspan="${game.players.length+1}">上半区 · 同点数累加</td></tr>${upper.map(scoreRow).join('')}
      ${summaryRow('上栏小计',t=>t.upper)}${summaryRow('上栏奖励（≥63）',t=>t.bonus)}
      <tr class="section-row"><td colspan="${game.players.length+1}">下半区 · 组合得分</td></tr>${lower.map(scoreRow).join('')}
      ${summaryRow('下栏小计',t=>t.lower)}${summaryRow('跨轮留骰支出',t=>t.paid?`−${t.paid}`:'0')}${summaryRow('总分',t=>t.total,'subtotal-row score-total')}
      </tbody></table>
      <p class="score-disclaimer">同一类别只能记分一次；可以主动记 0 分。五条可计入葫芦（25 分），但不触发额外快艇奖励或万能牌计分。</p>
      <div class="lastlog" aria-live="polite"><strong>最近记录</strong><span class="lastlog-text">${game.log?.length ? game.log.slice(0,2).map(l=>`${esc(game.players[l.player]?.name)} ${l.category==='carry'?`保留 ${l.count} 颗，−${-l.score} 分`:`${esc(Core.CATEGORIES.find(c=>c.id===l.category)?.label||'')} +${l.score}`}`).join(' · ') : '还没有记录，掷骰并选择计分格后会显示在这里。'}</span></div>
    </section>`;
  }
  function endBanner() {
    const ts=game.players.map(Core.totals),largest=Math.max(...ts.map(t=>t.total)),winners=ts.map((t,i)=>t.total===largest?game.players[i].name:null).filter(Boolean);
    return `<section class="panel finished-banner"><span class="eyebrow">本局结算</span><h1>${ts.length===1?'完成 13 格计分！':winners.length===1?`${esc(winners[0])} 获胜！`:'平局！'}</h1><p>最终成绩：${game.players.map((p,i)=>`${esc(p.name)} ${ts[i].total} 分`).join(' · ')}</p><button class="button primary" id="playAgain">再来一局</button></section>`;
  }
  function rollPanel() {
    const p=game.players[game.turn],turn=Core.filledCount(p)+(game.phase==='rolling'?1:0);
    let title,subtitle,actionButtons,explain;
    if (game.phase==='rolling') {
      title=`${esc(p.name)} · 第 ${Math.min(turn,13)} / 13 轮`;
      subtitle=(game.mode==='ai'&&game.turn===1)?`AI 正在评估${AI.LEVELS[aiDifficulty].horizon}回合内的掷骰、计分和留骰方案。` : canAct()?(game.rollsUsed===0?'尚未掷骰。点击下方「掷骰」开始，已购买的跨轮骰子会保留在桌面上。':'点击骰子锁定或解锁，最多掷 3 次；满意后选择计分格。'):(isOnline()&&!net.connected?'请先完成点对点连接，再开始游戏。':'等待对方完成本轮操作。');
      actionButtons=`<button type="button" class="button primary big" id="rollButton" ${!canAct()||game.rollsUsed>=3?'disabled':''}>${game.rollsUsed===0?'掷骰 · 开始本轮':'重掷未锁定骰子'} <span class="button-count">${game.rollsUsed<3?`${3-game.rollsUsed} 次剩余`:'次数已用完'}</span></button><button type="button" class="button big ghost" id="scoreScroll">计分卡 ↓</button>`;
      explain=game.rollsUsed>=3?'三次掷骰已用完，请在计分卡中选择一个类别。':game.rollsUsed===0?'第一掷需要手动点击。未购买的骰子不会提前显示点数。':game.held.every(Boolean)?'五颗都已锁定。可以直接计分，或者先解锁再掷。':'锁定的骰子不会参与下一次重掷，跨轮保留的骰子也能解锁。';
    } else if (game.phase==='carry') {
      const n=game.carrySelection.filter(Boolean).length,cost=n*Core.COST_PER_DIE;
      title=`${esc(p.name)} · 本轮已记分`;
      subtitle=game.mode==='ai'&&game.turn===1?`AI 正在决定是否花费 ${Core.COST_PER_DIE} 分/颗，把骰子留到下一轮。`:`现在选择要带到自己下一轮的骰子（最多 5 颗）。每颗扣除 ${Core.COST_PER_DIE} 分；不选即不扣分。`;
      actionButtons=`<button type="button" class="button green big" id="confirmCarry" ${!canAct()?'disabled':''}>${n?'支付 '+cost+' 分，':'不保留，'}进入下一轮 →</button>`;
      explain='被选择的骰子下轮会作为起始点数，并默认锁住；下轮可以解除锁定继续重掷。';
    } else {
      title='全局结束';subtitle='13 个类别已全部填写。';actionButtons=`<button type="button" class="button primary big" id="playAgain">再来一局</button>`;explain='总分 = 13 格得分 + 上半区奖励 − 跨轮留骰费用。';
    }
    const count=game.carrySelection?.filter(Boolean).length||0;
    const tag=game.phase==='rolling'?`<span class="tag emphasis">${game.rollsUsed===0?'等待第一掷':`已掷 ${game.rollsUsed} / 3 次`}</span><span class="tag">锁定 ${game.held.filter(Boolean).length} 颗</span>`:game.phase==='carry'?`<span class="tag emphasis">已选 ${count} / 5 颗</span><span class="tag">保留费用 ${Core.COST_PER_DIE} 分/颗</span>`:'<span class="tag emphasis">本局结束</span><span class="tag">已完成 13 格</span>';
    const metricLabel=game.phase==='carry'?`本次选择 ${count} 颗` : game.phase==='finished'?'全部计分完成':'当前掷骰进度';
    const metricValue=game.phase==='carry'?`−${count*Core.COST_PER_DIE} 分`:game.phase==='finished'?'13 / 13':`${game.rollsUsed} / 3 次`;
    const footnote=isOnline()&&!net.connected?'联机尚未建立。请先在 P2P 联机流程中完成连接。':game.phase==='carry'?`选中的骰子会进入你的下一轮；本次费用 ${Core.COST_PER_DIE} 分/颗，确认后计入总分。`:game.phase==='finished'?'全部 13 个计分格已完成，可查看对局总结或开启新对局。':`每颗跨轮保留费用为 ${Core.COST_PER_DIE} 分，只有本轮计分后才需要决定是否保留。`;
    return `<section class="panel roll-panel">
      <div class="turn-intro"><span class="eyebrow">${game.phase==='rolling'?'DICE TABLE':game.phase==='carry'?'KEEP FOR NEXT ROUND':'GAME OVER'}</span>
      <h1 class="play-title" title="${esc(p.name)}">${title}</h1><p class="play-subtitle">${subtitle}</p></div>
      <div class="roll-tags">${tag}</div>
      <div class="turn-metric"><span>${metricLabel}</span><strong>${metricValue}</strong></div>
      <div class="dice-row">${game.dice.map(dieMarkup).join('')}</div>
      <div class="turn-actions">${actionButtons}</div>
      <p class="microcopy">${explain}</p>
      <div class="turn-footnote"><strong>规则提示</strong><span>${footnote}</span></div>
    </section>`;
  }
  function welcomeMarkup() {
    return `<section class="panel welcome-card"><span class="eyebrow">YACHT / A SMALL STRATEGY GAME</span>
      <h1>五颗骰子。十三轮抉择。</h1><p>原版 13 格快艇计分，快艇 60 分。每轮计分后可以支付 3 分/颗，带骰子进入下一轮。</p>
      <div class="home-choices">
        <button class="mode-choice" data-start-mode="ai"><span class="mode-icon">01 / SOLO</span><strong>挑战 AI</strong><small>简单、中等、困难三种前瞻策略</small></button>
        <button class="mode-choice" data-start-mode="online"><span class="mode-icon">02 / ONLINE</span><strong>P2P 联机</strong><small>交换连接码，与好友直接对战</small></button>
      </div><p class="welcome-note">无需注册 · 无本地自动存档 · 重新打开页面即为新对局</p></section>`;
  }
  function endSummaryMarkup(){
    const totals=game.players.map(Core.totals),max=Math.max(...totals.map(x=>x.total));
    const winner=totals.map((t,i)=>t.total===max?game.players[i].name:null).filter(Boolean);
    const first=totals[0],second=totals[1];
    const verdict=first.total===second.total?'本局平局':`${esc(winner[0])} 获胜`;
    const entries=game.players.map((p,i)=>{const t=totals[i];
      const highest=Core.CATEGORIES.filter(c=>p.scores[c.id]!=null).sort((a,b)=>p.scores[b.id]-p.scores[a.id])[0];
      return `<div class="results-player ${t.total===max?'is-winner':''}"><div class="results-name"><span>${esc(p.name)}</span>${t.total===max?'<span class="results-badge">最佳成绩</span>':''}</div>
        <div class="results-big">${t.total}<small>分</small></div>
        <dl><div><dt>上半区</dt><dd>${t.upper}</dd></div><div><dt>上栏奖励</dt><dd>+${t.bonus}</dd></div><div><dt>下半区</dt><dd>${t.lower}</dd></div><div><dt>留骰费用</dt><dd>−${t.paid}</dd></div></dl>
        <p>最高单项 · ${highest?esc(highest.label)+' '+p.scores[highest.id]+' 分':'—'}</p></div>`;
    }).join('');
    const gap=Math.abs(first.total-second.total);
    return `<div class="result-intro"><span class="eyebrow">MATCH COMPLETE / 13 ROUNDS</span><h3>${verdict}</h3>
      <p>${gap?`双方相差 ${gap} 分。`: '双方最终得分相同。'} 上栏奖励与跨轮留骰费用均已计入。</p></div>
      <div class="results-grid">${entries}</div>
      <div class="modal-actions"><button class="button" data-close-modal>查看完整计分卡</button><button class="button primary" id="playAgain">再来一局</button></div>`;
  }
  function maybeShowSummary(){
    if(!game||game.phase!=='finished'||summaryShown)return;
    summaryShown=true;
    openModal('对局总结',endSummaryMarkup());
  }
  function render() {
    const currentY=window.scrollY;
    connectionUpdate();
    if(!game){$game.innerHTML=welcomeMarkup();return;}
    $game.innerHTML=`${game.phase==='finished'?endBanner():''}<div class="score-hero">${game.players.map(playerMarkup).join('')}</div><div class="work-area">${rollPanel()}${scoreTable()}</div>`;
    if(Math.abs(window.scrollY-currentY)>1)window.scrollTo(0,currentY);
    if(game.phase==='finished')queueMicrotask(maybeShowSummary);
    else scheduleAI();
  }
  function handleGameAction(type,payload={}) {
    if (!canAct()) return warn('当前暂时不可操作，或联机尚未建立');
    try {
      if (isOnline() && net.role==='guest') {
        send({t:'action',type,payload});
      } else {
        Core.action(game,type,payload);
        render(); if (isOnline()) sendState();
      }
    } catch(e) {warn(e);}
  }
  function cubeMarkup() {
    // 六个可见立体面在最后一帧直接停在规则引擎已经生成的点数上。
    const sides=[['front',1],['back',6],['right',3],['left',4],['top',2],['bottom',5]];
    return `<span class="die-cube" aria-hidden="true">${sides.map(([side,value])=>`<span class="cube-side cube-${side}">${pipFace(value)}</span>`).join('')}</span>`;
  }
  const END_ANGLES={1:[0,0],2:[-90,0],3:[0,-90],4:[0,90],5:[90,0],6:[0,180]};
  const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
  async function showRollAnimation(indices,reference) {
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !indices.length) return;
    const moving=indices.map(i=>({i,el:document.querySelector(`.die[data-die="${i}"]`)})).filter(x=>x.el);
    for(const {i,el} of moving){
      const face=el.querySelector('.die-face');
      if(!face)continue;
      const [ax,ay]=END_ANGLES[reference.dice[i]];
      face.style.setProperty('--end-x',(720+ax)+'deg');
      face.style.setProperty('--end-y',(720+ay)+'deg');
      face.style.setProperty('--cube-half',(face.getBoundingClientRect().width/2)+'px');
      face.insertAdjacentHTML('beforeend',cubeMarkup());
      el.classList.add('is-rolling');
    }
    // 用真实骰面作最终帧；完成之后让平面骰面与该帧轻柔叠化，而非突然切面。
    await pause(805);
    if(game!==reference)return;
    for(const {el} of moving)if(el.isConnected)el.classList.add('is-settling');
    await pause(190);
  }
  async function commitRoll() {
    if(rollAnimating)return;
    if (!game || game.phase!=='rolling' || game.rollsUsed>=3 || game.held.every(Boolean)) {
      if(game?.held?.every(Boolean))warn('五颗骰子都已锁定，请先解锁再掷');
      return;
    }
    const reference=game;
    const indices=game.held.flatMap((held,i)=>held?[]:[i]);
    try {
      Core.action(game,'roll'); // 先由安全随机数决定点数，然后让动画落在对应面上
      rollAnimating=true;
      render();
      if(isOnline())sendState();
      await showRollAnimation(indices,reference);
    } catch(e){warn(e);} finally {
      rollAnimating=false;
      if(game===reference)render();
    }
  }
  function animatedRoll() {
    if(!canAct())return warn('现在还不能掷骰，或联机尚未建立');
    if(isOnline()&&net.role==='guest') {
      if(net.awaitingRoll)return;
      if(game.phase!=='rolling'||game.rollsUsed>=3||game.held.every(Boolean))return warn('当前无法掷骰');
      // 创建方产生安全随机点数；收到同步状态后，加入方播放同一结果的动画。
      net.awaitingRoll=true;
      send({t:'action',type:'roll',payload:{}});
      return;
    }
    return commitRoll();
  }
  function openModal(title,html) {
    $title.textContent=title; $body.innerHTML=html; $modal.classList.remove('hidden');$modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
  }
  function closeModal() {$modal.classList.add('hidden');$modal.setAttribute('aria-hidden','true');document.body.style.overflow='';chosenCategory=null;}
  function confirmScore(id) {
    if (!canAct()||game.phase!=='rolling'||game.dice.some(n=>n==null)) return;
    const cat=Core.CATEGORIES.find(c=>c.id===id);if(!cat)return;
    chosenCategory=id;
    const v=Core.score(id,game.dice);
    openModal('确认本轮计分',`<div class="info-box">将本轮五颗骰子的得分 <strong class="gold" style="font-size:24px">${v}</strong> 分记入「<strong>${esc(cat.label)}</strong>」。<p style="margin:7px 0 0">${esc(cat.info)}。一旦记录，此格不能再次更改。</p></div>
      ${v===0?'<p class="red" style="font-size:13px">注意：这个组合在该类别中得 0 分。你仍可主动选择记 0。</p>':''}
      <div class="modal-actions"><button class="button" data-close-modal>返回</button><button class="button primary" id="scoreConfirmButton">确定记分 ${v}</button></div>`);
  }
  function rulesModal() {
    openModal('玩法与计分规则',`<p class="muted-text">每位玩家每局填满 13 个格子；每回合有 5 颗骰子，最多 3 次手动掷骰。开局不自动掷骰，点击「掷骰」后才会出现随机点数。每次可以锁定部分骰子，只重掷其余骰子。</p>
      <div class="info-box"><strong class="gold">本版新增：跨轮保留</strong><br>本轮在计分卡完成记分后，可从刚才的五颗骰子中选 0–5 颗保留给自己下一轮。每颗花费 <strong>${Core.COST_PER_DIE} 分</strong>，费用从最终总分扣除。下轮开始时，仅显示已购买的骰子，其他位置保持空白，必须手动点击「掷骰」生成其余点数；每轮最多 3 次掷骰，已保留的骰子也可解锁重掷。若购买全部 5 颗，可以不掷就直接记分。</div>
      <p class="muted-text">上半区：1–6 点分别累计相同点数的和；上栏合计达到 63 分额外加 35 分。下半区：三条／四条得全部点数总和；葫芦 25 分、小顺 30 分、大顺 40 分、快艇 60 分、机会为全部点数总和。</p>
      <p class="muted-text">本版中 <strong>五条也算葫芦</strong>；快艇计分栏只能填写一次，取消后续快艇的额外加分与万能牌（Joker）规则。玩家可以在任意尚未填写的格子记 0 分。最后一轮结算后不可再购买跨轮保留。</p>
      <div class="info-box warning">P2P 联机采用 WebRTC 数据通道，双方首次需交换「邀请码」和「回复码」，之后游戏数据尽量直接在两台设备之间传输；不需要自建信令服务器。部分手机运营商网络／严格 NAT 可能无法打通（此版不使用 TURN 中继）。</div>
      <button class="button primary full" data-close-modal>知道了</button>`);
  }
  function newModal() {
    openModal('选择游戏模式', `<p class="muted-text">每局 13 轮。仅支持挑战 AI 和 P2P 联机，不再提供同屏双人或个人练习。</p>
      <div class="option-grid"><button type="button" class="mode-choice" data-start-mode="ai"><span class="mode-icon">01 / SOLO</span><strong>挑战 AI</strong><small>三档难度，概率搜索与跨轮策略各不相同</small></button>
      <button type="button" class="mode-choice" data-start-mode="online"><span class="mode-icon">02 / P2P</span><strong>P2P 联机</strong><small>与好友交换连接码，实时对局</small></button></div>
      ${game?.phase!=='finished'&&game?'<p class="muted-text">开始其他对局将结束当前进度；游戏不会在本地自动保存。</p>':''}`);
  }
  function setupAI() {
    openModal('挑战 AI', `<p class="muted-text">你先手，AI 后手。AI 会使用与玩家相同的 13 格计分、3 次掷骰及 3 分/颗跨轮留骰规则。</p>
      <label class="field-label" for="setupNameOne">我的昵称</label><input id="setupNameOne" class="field-input" maxlength="16" value="我" autocomplete="off" />
      <label class="field-label" for="aiLevel">AI 难度</label>
      <div class="difficulty-picks" role="radiogroup" aria-label="AI 难度">
        <label><input type="radio" name="aiLevel" value="easy" ${aiDifficulty==='easy'?'checked':''}><span><strong>简单</strong><small>本轮决策 · 偶尔次优</small></span></label>
        <label><input type="radio" name="aiLevel" value="medium" ${aiDifficulty==='medium'?'checked':''}><span><strong>中等</strong><small>兼顾下轮 · 偶尔次优</small></span></label>
        <label><input type="radio" name="aiLevel" value="hard" ${aiDifficulty==='hard'?'checked':''}><span><strong>困难</strong><small>兼顾后两轮 · 偶尔次优</small></span></label>
      </div>
      <p class="muted-text">本轮掷骰使用精确概率枚举；未来回合采用按类别估计的有限前瞻。AI 不提前知道真实骰点。</p>
      <div class="modal-actions"><button type="button" class="button" id="backToModes">返回</button><button type="button" class="button primary" id="startAI">开始挑战</button></div>`);
  }
  function cancelAI() {aiGeneration++;if(aiTimer!==null)clearTimeout(aiTimer);aiTimer=null;}
  function startAI() {
    const level=document.querySelector('input[name="aiLevel"]:checked')?.value||'medium';
    const name=($('setupNameOne')?.value||'我').trim().slice(0,16)||'我';
    cancelAI();closeNetwork();aiDifficulty=level;summaryShown=false;
    game=Core.newGame('ai',[name,'AI · '+AI.LEVELS[level].label]);
    closeModal();render();showToast('已开始挑战 · AI '+AI.LEVELS[level].label);
  }
  function scheduleAI() {
    if(!game||game.mode!=='ai'||game.turn!==1||game.phase==='finished'||rollAnimating||aiTimer!==null)return;
    const generation=aiGeneration;
    aiTimer=setTimeout(()=>{aiTimer=null;if(generation!==aiGeneration)return;void advanceAI(generation);},400);
  }
  async function advanceAI(generation) {
    if(generation!==aiGeneration||!game||game.mode!=='ai'||game.turn!==1||game.phase==='finished'||rollAnimating)return;
    const reference=game;
    try {
      const decision=AI.decide(game,aiDifficulty);
      if(generation!==aiGeneration||reference!==game)return;
      if(decision.type==='roll'){
        for(let i=0;i<5;i++){
          const held=!!(decision.mask&(1<<i));
          if(game.dice[i]!=null&&game.held[i]!==held)Core.action(game,'toggleHold',{index:i});
        }
        await commitRoll();
      } else if(decision.type==='score') {
        Core.action(game,'score',{category:decision.category});render();
      } else if(decision.type==='carry'){
        for(let i=0;i<5;i++)if(decision.mask&(1<<i))Core.action(game,'toggleCarry',{index:i});
        Core.action(game,'confirmCarry');render();
      }
    } catch(e){warn(e);console.error('AI action error',e);}
    if(generation===aiGeneration&&reference===game)scheduleAI();
  }
  function closeNetwork() {
    try {net.dc?.close();}catch{}try{net.pc?.close();}catch{}
    net=freshNet();
  }
  function networkModal(section='host') {
    openModal('P2P 双人联机', `<div class="tabs"><button class="tab ${section==='host'?'active':''}" data-net-tab="host">① 创建房间</button><button class="tab ${section==='guest'?'active':''}" data-net-tab="guest">② 加入房间</button></div>
      ${section==='host'?hostPane():guestPane()}`);
  }
  function hostPane() {
    return `<p class="muted-text">创建方执先手。生成邀请码，发送给好友；收到好友的回复码后粘贴到下方完成直连。</p>
      <label class="field-label" for="hostName">我的昵称</label><input id="hostName" class="field-input" maxlength="16" value="${esc(net.role==='host'?net.name:'玩家 1')}" autocomplete="off">
      <div class="modal-actions"><button class="button primary" data-net-action="offer" ${net.busy?'disabled':''}>${net.busy?'正在生成…':net.offerCode?'重新生成邀请码':'生成邀请码'}</button></div>
      ${net.offerCode?`<div class="modal-code"><label class="field-label" for="offerOutput">邀请码（请私发给对方，不要公开发布）</label><textarea readonly id="offerOutput" class="field-input">${esc(net.offerCode)}</textarea>
      <div class="modal-actions"><button class="button" data-net-copy="offerOutput">复制邀请码</button><button class="button" data-net-action="shareOffer">分享邀请链接</button></div></div>`:''}
      <div class="divider"></div><label class="field-label" for="answerInput">在这里粘贴好友回复码</label><textarea class="field-input" id="answerInput" placeholder="好友生成的回复码 / 回复链接…" spellcheck="false"></textarea>
      <div class="modal-actions"><button class="button green" data-net-action="acceptAnswer" ${!net.offerCode||net.busy?'disabled':''}>确认回复码并建立连接</button></div>
      <div class="network-status" id="networkStatus">${esc(net.status)}</div>
      <div class="info-box warning">建立连接时双方应保持此页面在前台。第一次交换长码可以通过微信、短信等私聊发送；这些应用仅用于传码，不传输游戏数据。</div>`;
  }
  function guestPane() {
    const hashInvite=readFragmentCode('offer');
    return `<p class="muted-text">收到好友的邀请码或邀请链接后粘贴。生成回复码并发回创建方，对方确认后双方即可对战。</p>
      <label class="field-label" for="guestName">我的昵称</label><input id="guestName" class="field-input" maxlength="16" value="${esc(net.role==='guest'?net.name:'玩家 2')}" autocomplete="off">
      <label class="field-label" for="offerInput">好友邀请码 / 邀请链接</label><textarea class="field-input" id="offerInput" placeholder="粘贴邀请码或带 #offer= 的链接…" spellcheck="false">${esc(hashInvite||'')}</textarea>
      <div class="modal-actions"><button class="button primary" data-net-action="answer" ${net.busy?'disabled':''}>${net.busy?'正在生成…':'生成回复码'}</button></div>
      ${net.answerCode?`<div class="modal-code"><label class="field-label" for="answerOutput">回复码（复制后发送给创建方）</label><textarea readonly class="field-input" id="answerOutput">${esc(net.answerCode)}</textarea>
      <div class="modal-actions"><button class="button green" data-net-copy="answerOutput">复制回复码</button><button class="button" data-net-action="shareAnswer">分享回复码</button></div></div>`:''}
      <div class="network-status" id="networkStatus">${esc(net.status)}</div>
      <div class="info-box">只有创建方需要粘贴回复码。加入方发出回复码之后，保持游戏页面打开，等待对方确认即可。</div>`;
  }
  function setStatus(message) {net.status=message;const s=$('networkStatus');if(s)s.textContent=message;connectionUpdate();}
  function pcSetup(role) {
    const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]});
    net.pc=pc;net.role=role;net.connected=false;net.ready=false;
    pc.onconnectionstatechange=()=>{
      if(net.pc!==pc)return;
      if (pc.connectionState==='failed') {net.connected=false;setStatus('连接失败：网络可能不支持直接 P2P，可尝试双方切换 Wi-Fi');render();}
      if (pc.connectionState==='disconnected') {net.connected=false;setStatus('连接中断，请尝试恢复网络；若无法恢复需重新配对');render();}
      if (pc.connectionState==='connected') {if (net.dc?.readyState==='open') {net.connected=true;setStatus('点对点连接已恢复 ✓');render();}else setStatus('浏览器通道已连接，正在同步游戏…');}
    };
    return pc;
  }
  function setupChannel(dc) {
    net.dc=dc;
    dc.onopen=()=>{
      net.connected=true;net.ready=true;setStatus('连接成功 ✓ · 游戏数据正在点对点同步');
      if(net.role==='host')sendState();
      else send({t:'hello',name:net.name});
      closeModal();render();showToast('P2P 连接成功，可以开始对战！');
    };
    dc.onclose=()=>{net.connected=false;net.ready=false;setStatus('对方连接已断开，当前对局暂停');render();};
    dc.onerror=()=>{setStatus('数据通道遇到问题，请检查双方网络');};
    dc.onmessage=event=>{
      try{
        if(typeof event.data!=='string'||event.data.length>100000)return;
        const msg=JSON.parse(event.data);
        if(net.role==='host')receiveHost(msg);else receiveGuest(msg);
      }catch(e){console.warn('P2P message discarded',e);}
    };
  }
  function send(obj) {if (net.dc?.readyState==='open')net.dc.send(JSON.stringify(obj));}
  function sendState(){ if(net.role==='host')send({t:'state',game}); }
  function receiveHost(msg){
    if(msg?.t==='hello') {
      if(game?.mode==='online')game.players[1].name=String(msg.name||'玩家 2').trim().slice(0,16)||'玩家 2';
      render();sendState();return;
    }
    if(msg?.t==='action'){
      const allowed=['toggleHold','roll','score','toggleCarry','confirmCarry'];
      if(!allowed.includes(msg.type)||!game||game.mode!=='online'||game.turn!==1)return;
      try{if(msg.type==='roll'){void commitRoll();}else{Core.action(game,msg.type,msg.payload||{});render();sendState();}}
      catch(e){send({t:'error',message:e.message});}
    }
    if(msg?.t==='resync')sendState();
    if(msg?.t==='requestRestart')showToast('对方想再来一局，请由创建方点击「新对局」。');
  }
  function receiveGuest(msg){
    if(msg?.t==='state'&&msg.game?.mode==='online'&&Array.isArray(msg.game.players)&&msg.game.players.length===2&&msg.game.dice?.length===5) {
      const isNewRoll=game?.phase==='rolling' && msg.game.phase==='rolling' && game.turn===msg.game.turn && msg.game.rollsUsed===game.rollsUsed+1;
      const indices=isNewRoll?game.held.flatMap((held,i)=>held?[]:[i]):[];
      if(game?.phase==='finished'&&msg.game.phase==='rolling'&&msg.game.players.every(p=>Core.filledCount(p)===0))summaryShown=false;
      game=msg.game;net.awaitingRoll=false;
      if(isNewRoll){
        const reference=game;
        rollAnimating=true;render();
        void showRollAnimation(indices,reference).finally(()=>{rollAnimating=false;if(game===reference)render();});
      }else render();
    } else if(msg?.t==='error'){net.awaitingRoll=false;warn(msg.message||'操作被拒绝');}
  }
  function waitIce(pc) {
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise(resolve=>{
      let finished=false;
      const done=()=>{if(finished)return;finished=true;clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
      const check=()=>{if(pc.iceGatheringState==='complete')done();};
      const timer=setTimeout(done,18000);pc.addEventListener('icegatheringstatechange',check);check();
    });
  }
  function bytesToBase64(bytes) {let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function base64ToBytes(str) {const bin=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4));return Uint8Array.from(bin,ch=>ch.charCodeAt(0));}
  async function compress(bytes) {
    if(typeof CompressionStream!=='function')return null;
    const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function decompress(bytes) {
    if(typeof DecompressionStream!=='function')throw Error('当前浏览器不支持压缩连接码，请升级 Safari/Chrome 后再试');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function encode(desc) {
    const raw=new TextEncoder().encode(JSON.stringify({type:desc.type,sdp:desc.sdp}));
    const zipped=await compress(raw);
    return zipped&&zipped.length<raw.length?'Y4G.'+bytesToBase64(zipped):'Y4R.'+bytesToBase64(raw);
  }
  function parseSignalInput(value) {
    let v=String(value||'').trim();
    if(v.length>60000)throw Error('连接码太长');
    if(v.includes('#offer='))v=v.split('#offer=')[1].split(/[&#\s]/)[0];
    else if(v.includes('#answer='))v=v.split('#answer=')[1].split(/[&#\s]/)[0];
    return decodeURIComponent(v).replace(/\s/g,'');
  }
  async function decode(value,expectType) {
    const code=parseSignalInput(value);
    if(!/^Y4[GR]\.[A-Za-z0-9_-]+$/.test(code))throw Error('连接码格式不正确，请完整复制本版生成的邀请码或回复码');
    let bytes=base64ToBytes(code.slice(4));
    if(code.startsWith('Y4G.'))bytes=await decompress(bytes);
    if(bytes.length>60000)throw Error('连接码无效');
    const desc=JSON.parse(new TextDecoder().decode(bytes));
    if(desc?.type!==expectType||typeof desc.sdp!=='string'||desc.sdp.length>50000)throw Error('邀请码与回复码类型不匹配');
    return desc;
  }
  async function createOffer() {
    if(typeof RTCPeerConnection==='undefined')throw Error('该浏览器不支持 WebRTC');
    const name=($('hostName')?.value||'玩家 1').trim().slice(0,16)||'玩家 1';
    closeNetwork();net.name=name;net.busy=true;setStatus('正在收集网络候选地址，可能需要数秒…');
    const pc=pcSetup('host');const dc=pc.createDataChannel('yahtzee-match',{ordered:true});setupChannel(dc);
    try{
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);await waitIce(pc);
      net.offerCode=await encode(pc.localDescription);
      const hasCandidate=/a=candidate:/i.test(pc.localDescription.sdp);
      cancelAI();summaryShown=false;game=Core.newGame('online',[name,'玩家 2']);net.busy=false;
      render();networkModal('host');setStatus(hasCandidate?'邀请码已生成，请复制或分享，再等待好友回复码':'邀请码已生成，但浏览器未收集到可连接的 ICE 地址；该环境下直连可能失败');
    } catch(e){closeNetwork();throw e;}
  }
  async function acceptAnswer() {
    if(net.role!=='host'||!net.pc)throw Error('请先生成邀请码');
    const code=$('answerInput')?.value;
    const answer=await decode(code,'answer');
    await net.pc.setRemoteDescription(new RTCSessionDescription(answer));
    setStatus('回复码已确认，等待两台设备建立直连…');
    showToast('回复码已接收，正在建立直连');
  }
  async function createAnswer() {
    if(typeof RTCPeerConnection==='undefined')throw Error('当前浏览器不支持 WebRTC');
    const offerInput=$('offerInput')?.value;
    const name=($('guestName')?.value||'玩家 2').trim().slice(0,16)||'玩家 2';
    const offer=await decode(offerInput,'offer');
    closeNetwork();net.name=name;net.busy=true;setStatus('正在处理邀请码并生成回复码…');
    const pc=pcSetup('guest');
    pc.ondatachannel=event=>setupChannel(event.channel);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitIce(pc);
      net.answerCode=await encode(pc.localDescription);net.busy=false;
      const hasCandidate=/a=candidate:/i.test(pc.localDescription.sdp);
      cancelAI();summaryShown=false;game=Core.newGame('online',['玩家 1',name]);
      render();networkModal('guest');setStatus(hasCandidate?'回复码已生成。发给创建方，等待对方确认':'回复码已生成，但浏览器未收集到 ICE 地址；请检查 WebRTC / 网络限制');
    } catch(e){closeNetwork();throw e;}
  }
  function readFragmentCode(which) {
    const hash=window.location.hash;
    if(hash.startsWith('#'+which+'=')){
      try{return decodeURIComponent(hash.slice(which.length+2));}catch{return '';}
    }
    return '';
  }
  function offerLink() {return `${location.origin}${location.pathname}#offer=${net.offerCode}`;}
  async function copyText(value) {
    if(!value)throw Error('没有可复制的内容');
    if(navigator.clipboard && window.isSecureContext)await navigator.clipboard.writeText(value);
    else {
      const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw Error('复制失败，请长按文本手动复制');
    }
    showToast('已复制，发送给好友即可');
  }
  async function shareText(title,text) {
    if(navigator.share) {try {await navigator.share({title,text});}catch(e){if(e.name!=='AbortError')await copyText(text);}}
    else await copyText(text);
  }
  async function handleNetwork(button) {
    const cmd=button.dataset.netAction;
    button.disabled=true;
    try {
      if(cmd==='offer')await createOffer();
      else if(cmd==='answer')await createAnswer();
      else if(cmd==='acceptAnswer')await acceptAnswer();
      else if(cmd==='shareOffer')await shareText('快艇骰子 · P2P 对战邀请',offerLink());
      else if(cmd==='shareAnswer')await shareText('快艇骰子 · P2P 回复码',net.answerCode);
    } catch(e) {warn(e);setStatus('错误：'+e.message);} finally {if(button.isConnected)button.disabled=false;}
  }
  function playAgain() {
    if(game.mode==='online') {
      if(net.role==='guest'){send({t:'requestRestart'});showToast('已向创建方发送再来一局请求');return;}
      if(!net.connected)return warn('联机已断开，请重新配对');
      openModal('重新开始联机对局',`<p class="muted-text">双方的 13 格得分将清零。</p><div class="modal-actions"><button class="button" data-close-modal>取消</button><button class="button primary" id="confirmRestartOnline">确认重开</button></div>`);
    } else {cancelAI();summaryShown=false;game=Core.newGame('ai',[game.players[0].name,game.players[1].name]);closeModal();render();}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='rulesButton')return rulesModal();
    if(b.id==='newGameButton')return newModal();
    if(b.id==='rollButton')return animatedRoll();
    if(b.id==='confirmCarry')return handleGameAction('confirmCarry');
    if(b.id==='scoreScroll')return $('scoreboard')?.scrollIntoView({behavior:'smooth',block:'start'});
    if(b.id==='playAgain')return playAgain();
    if(b.id==='confirmRestartOnline') {summaryShown=false;game=Core.newGame('online',game.players.map(p=>p.name));closeModal();render();sendState();return;}
    if(b.id==='backToModes')return newModal();
    if(b.id==='startAI')return startAI();
    if(b.dataset.die!=null)return handleGameAction(game.phase==='carry'?'toggleCarry':'toggleHold',{index:Number(b.dataset.die)});
    if(b.dataset.category)return confirmScore(b.dataset.category);
    if(b.id==='scoreConfirmButton') {const c=chosenCategory;closeModal();return handleGameAction('score',{category:c});}
    if(b.hasAttribute('data-close-modal'))return closeModal();
    if(b.dataset.startMode){
      const mode=b.dataset.startMode;
      if(mode==='rules')return rulesModal();
      if(mode==='online')return networkModal('host');
      return setupAI();
    }
    if(b.dataset.netTab) return networkModal(b.dataset.netTab);
    if(b.dataset.netCopy){try {return await copyText($(b.dataset.netCopy)?.value);}catch(e){return warn(e);}}
    if(b.dataset.netAction)return handleNetwork(b);
  });
  $modal.addEventListener('click',e=>{if(e.target===$modal)closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$modal.classList.contains('hidden'))closeModal();});
  window.addEventListener('hashchange',()=>{if(readFragmentCode('offer')){networkModal('guest');}});
  game=null;render();
  if(readFragmentCode('offer'))networkModal('guest');
})();
