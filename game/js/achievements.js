window.Game = window.Game || {};

Game.Achievements = (function () {
  const LIST = [
    { id: 'firstBlood',    name: 'First Blood',        icon: '🩸', check: function (d) { return Game.Generators.totalOwned() >= 1; } },
    { id: 'bladeInitiate', name: 'Blade Initiate',     icon: '🗡',  check: function (d) { return Game.Generators.totalOwned() >= 10; } },
    { id: 'monsterSlayer', name: 'Monster Slayer',     icon: '👹', check: function (d) { return d.lifetimeEssence >= 1000; } },
    { id: 'riftBreaker',   name: 'Rift Breaker',       icon: '🌀', check: function (d) { return d.lifetimeEssence >= 1000000; } },
    { id: 'legionCommander', name: 'Legion Commander', icon: '🏴', check: function (d) { return Game.Generators.maxOwnedOfAny() >= 25; } },
    { id: 'nightsEdge',    name: "Night's Edge",       icon: '🌑', check: function (d) { return Game.Generators.ownsAllTiers(); } },
    { id: 'firstReforge',  name: 'First Reforge',      icon: '⚔',  check: function (d) { return d.prestigeCount >= 1; } },
    { id: 'ascended',      name: 'Ascended',           icon: '💠', check: function (d) { return d.bladeShards >= 10; } },
    { id: 'idleSlayer',    name: 'Idle Slayer',        icon: '⏳', check: function (d) { return d.longestOfflineClaimSeconds >= 3600; } },
    { id: 'wavesSurvived100', name: 'Waves Survived: 100', icon: '🛡', check: function (d) { return d.prestigeCount >= 100; } }
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
