/* 快艇骰子：可测试的纯规则核心。无网络与 DOM 依赖。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YachtCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CATEGORIES = [
    { id: 'ones', label: '一分', info: '1 点合计', section: 'upper' },
    { id: 'twos', label: '二分', info: '2 点合计', section: 'upper' },
    { id: 'threes', label: '三分', info: '3 点合计', section: 'upper' },
    { id: 'fours', label: '四分', info: '4 点合计', section: 'upper' },
    { id: 'fives', label: '五分', info: '5 点合计', section: 'upper' },
    { id: 'sixes', label: '六分', info: '6 点合计', section: 'upper' },
    { id: 'threeKind', label: '三条', info: '至少 3 颗相同，五颗点数总和', section: 'lower' },
    { id: 'fourKind', label: '四条', info: '至少 4 颗相同，五颗点数总和', section: 'lower' },
    { id: 'fullHouse', label: '葫芦', info: '3+2 或 5 颗相同，得 25 分', section: 'lower' },
    { id: 'smallStraight', label: '小顺', info: '连续至少 4 个点数，得 30 分', section: 'lower' },
    { id: 'largeStraight', label: '大顺', info: '连续 5 个点数，得 40 分', section: 'lower' },
    { id: 'yahtzee', label: '快艇', info: '5 颗相同，得 60 分（仅计一次）', section: 'lower' },
    { id: 'chance', label: '机会', info: '五颗点数总和', section: 'lower' }
  ];
  const IDSET = new Set(CATEGORIES.map(c => c.id));
  const TOP_KEYS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const COST_PER_DIE = 3;
  const bonusThreshold = 63;
  const upperBonus = 35;
  function score(category, dice) {
    if (!IDSET.has(category) || !Array.isArray(dice) || dice.length !== 5 || dice.some(n => !Number.isInteger(n) || n < 1 || n > 6)) throw new Error('点数或计分类别无效');
    const counts = [0, 0, 0, 0, 0, 0, 0];
    dice.forEach(n => counts[n]++);
    const sum = dice.reduce((a, b) => a + b, 0);
    const max = Math.max(...counts);
    const unique = new Set(dice);
    if (TOP_KEYS.includes(category)) return counts[TOP_KEYS.indexOf(category) + 1] * (TOP_KEYS.indexOf(category) + 1);
    if (category === 'threeKind') return max >= 3 ? sum : 0;
    if (category === 'fourKind') return max >= 4 ? sum : 0;
    if (category === 'fullHouse') return (counts.includes(3) && counts.includes(2)) || max === 5 ? 25 : 0;
    if (category === 'smallStraight') return ([1, 2, 3, 4].every(n => unique.has(n)) || [2, 3, 4, 5].every(n => unique.has(n)) || [3, 4, 5, 6].every(n => unique.has(n))) ? 30 : 0;
    if (category === 'largeStraight') return ([1, 2, 3, 4, 5].every(n => unique.has(n)) || [2, 3, 4, 5, 6].every(n => unique.has(n))) ? 40 : 0;
    if (category === 'yahtzee') return max === 5 ? 60 : 0;
    if (category === 'chance') return sum;
    throw new Error('未知类别');
  }
  // 加密安全随机数 + 拒绝采样。0..2^32-1 内仅取 6 的整数倍个样本，消除取模偏差。
  // 每次掷骰单独取随机数，不人为控制点数、胜负或历史分布。
  function die() {
    const secureCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (!secureCrypto || typeof secureCrypto.getRandomValues !== 'function') {
      throw new Error('此浏览器不支持安全随机数，无法掷骰；请使用较新版本的 Chrome、Safari 或 Firefox');
    }
    const a = new Uint32Array(1);
    let n;
    do { secureCrypto.getRandomValues(a); n = a[0]; } while (n >= 4294967292);
    return n % 6 + 1;
  }
  function player(name) {
    return { name: String(name || '玩家').trim().slice(0, 16), scores: {}, paid: 0, carry: [] };
  }
  function filledCount(p) { return Object.keys(p.scores).filter(k => IDSET.has(k)).length; }
  function upperSum(p) { return TOP_KEYS.reduce((s, id) => s + (p.scores[id] ?? 0), 0); }
  function lowerSum(p) { return CATEGORIES.filter(c => c.section === 'lower').reduce((s, c) => s + (p.scores[c.id] ?? 0), 0); }
  function totals(p) {
    const upper = upperSum(p), lower = lowerSum(p);
    const bonus = upper >= bonusThreshold ? upperBonus : 0;
    return { upper, lower, bonus, paid: p.paid, total: upper + lower + bonus - p.paid, filled: filledCount(p) };
  }
  function beginTurn(game, who) {
    game.turn = who;
    const values = [...game.players[who].carry];
    game.dice = Array.from({ length: 5 }, (_, i) => i < values.length ? values[i] : null);
    game.held = Array.from({ length: 5 }, (_, i) => i < values.length);
    game.players[who].carry = [];
    game.carrySelection = [false, false, false, false, false];
    game.rollsUsed = 0; // 新回合不自动投掷；仅显示跨轮购买的骰子，空位等首次手动投掷
    game.phase = 'rolling';
  }
  function nextPlayer(game) {
    const candidate = game.players.findIndex((p, i) => i !== game.turn && filledCount(p) < 13);
    if (candidate >= 0) beginTurn(game, candidate);
    else if (filledCount(game.players[game.turn]) < 13) beginTurn(game, game.turn);
    else { game.phase = 'finished'; game.held = [false, false, false, false, false]; }
  }
  function newGame(mode = 'ai', names = ['玩家', 'AI']) {
    if (!['ai', 'online'].includes(mode)) throw new Error('游戏模式无效');
    const number = 2;
    const game = { mode, players: Array.from({ length: number }, (_, i) => player(names[i] || '玩家 ' + (i + 1))), turn: 0, dice: [], held: [], carrySelection: [], rollsUsed: 0, phase: 'rolling', log: [], carryCost: COST_PER_DIE, version: 1 };
    beginTurn(game, 0);
    return game;
  }
  function action(game, type, payload = {}) {
    if (!game || game.phase === 'finished') throw new Error('本局已结束');
    const p = game.players[game.turn];
    if (type === 'toggleHold') {
      if (game.phase !== 'rolling') throw new Error('现在不能保留骰子');
      const i = payload.index;
      if (!Number.isInteger(i) || i < 0 || i >= 5) throw new Error('骰子序号无效');
      if (game.dice[i] == null) throw new Error('尚未投掷的骰子不能锁定');
      game.held[i] = !game.held[i];
    } else if (type === 'roll') {
      if (game.phase !== 'rolling' || game.rollsUsed >= 3) throw new Error('本轮没有剩余重掷机会');
      if (game.held.every(Boolean)) throw new Error('先点击至少一颗骰子，解除锁定后再重掷');
      game.dice = game.dice.map((n, i) => game.held[i] ? n : die());
      game.rollsUsed++;
    } else if (type === 'score') {
      if (game.phase !== 'rolling' || !IDSET.has(payload.category) || Object.hasOwn(p.scores, payload.category)) throw new Error('计分类别不可用');
      if (game.dice.some(v => !Number.isInteger(v))) throw new Error('请先投掷骰子，再选择计分类别');
      const value = score(payload.category, game.dice);
      p.scores[payload.category] = value;
      game.log.unshift({ player: game.turn, category: payload.category, score: value });
      game.log = game.log.slice(0, 32);
      if (filledCount(p) === 13) nextPlayer(game); // 该玩家最后一轮不支付无意义的跨轮保留费
      else { game.phase = 'carry'; game.carrySelection = [false, false, false, false, false]; }
    } else if (type === 'toggleCarry') {
      if (game.phase !== 'carry') throw new Error('仅在记分后选择跨轮保留');
      const i = payload.index;
      if (!Number.isInteger(i) || i < 0 || i >= 5) throw new Error('骰子序号无效');
      game.carrySelection[i] = !game.carrySelection[i];
    } else if (type === 'confirmCarry') {
      if (game.phase !== 'carry') throw new Error('目前不需要确认保留');
      const retained = game.dice.filter((_, i) => game.carrySelection[i]);
      p.carry = retained;
      p.paid += retained.length * COST_PER_DIE;
      if (retained.length) game.log.unshift({ player: game.turn, category: 'carry', score: -(retained.length * COST_PER_DIE), count: retained.length });
      nextPlayer(game);
    } else throw new Error('未知操作');
    game.version = (game.version || 0) + 1;
    return game;
  }
  return { CATEGORIES, TOP_KEYS, COST_PER_DIE, rollDie: die, score, newGame, action, totals, filledCount, upperSum };
});
