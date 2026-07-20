window.Game = window.Game || {};

Game.Achievements = (function () {
  const LIST = [
    { id: 'firstHunt',       name: 'First Campaign',    icon: '🗡',  check: function (d) { return d.totalRuns >= 1; } },
    { id: 'fullClear',       name: 'Fort Defended',     icon: '🏰', check: function (d) { return d.fullClearRuns >= 1; } },
    { id: 'waveRider',       name: 'Battle-Hardened',   icon: '⚡', check: function (d) { return d.bestRunLevel >= 10; } },
    { id: 'slayersMark',     name: 'Hundred Foes',      icon: '🐎', check: function (d) { return d.bestRunKills >= 100; } },
    { id: 'gemHoarder',      name: 'Valor Collector',   icon: '💎', check: function (d) { return d.lifetimeGemsCollected >= 500; } },
    { id: 'shardCollector',  name: 'Treasury Keeper',   icon: '🔶', check: function (d) { return d.lifetimeShardsCollected >= 100; } },
    { id: 'warlordsBane',    name: "Commander's Bane",  icon: '🏴', check: function (d) { return d.warlordsKilled >= 1; } },
    { id: 'arsenalComplete', name: 'Full Arsenal',      icon: '⚔',  check: function (d) { return Game.Camp.allWeaponsUnlocked(); } },
    { id: 'firstReforge',    name: 'Oath Renewed',      icon: '💠', check: function (d) { return d.prestigeCount >= 1; } },
    { id: 'ironWill',        name: 'Unbroken Spirit',   icon: '🩸', check: function (d) { return d.closeCallRuns >= 1; } }
  ];

  let onUnlock = null;

  function setOnUnlock(callback) {
    onUnlock = callback;
  }

  function isUnlocked(id) {
    return Game.State.data.achievements.indexOf(id) !== -1;
  }

  function checkAll() {
    const d = Game.State.data;
    LIST.forEach(function (a) {
      if (isUnlocked(a.id)) return;
      if (a.check(d)) {
        d.achievements.push(a.id);
        if (onUnlock) onUnlock(a);
      }
    });
  }

  function getMultiplier() {
    return 1 + Game.State.data.achievements.length * 0.01;
  }

  return {
    LIST: LIST,
    setOnUnlock: setOnUnlock,
    isUnlocked: isUnlocked,
    checkAll: checkAll,
    getMultiplier: getMultiplier
  };
})();
