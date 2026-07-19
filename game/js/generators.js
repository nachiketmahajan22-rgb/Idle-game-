window.Game = window.Game || {};

Game.Generators = (function () {
  const LIST = [
    { id: 'riftWhelpSnare',           name: 'Rift Whelp Snare',           icon: '🕸', baseCost: 15,           baseProduction: 0.1 },
    { id: 'bladeAcolyte',             name: 'Blade Acolyte',              icon: '🗡',  baseCost: 100,          baseProduction: 1 },
    { id: 'shadowBlade',              name: 'Shadow Blade',               icon: '🌑',  baseCost: 1100,         baseProduction: 8 },
    { id: 'riftTurret',               name: 'Rift Turret',                icon: '🔮',  baseCost: 12000,        baseProduction: 47 },
    { id: 'bloodHoundPack',          name: 'Blood Hound Pack',           icon: '🐺',  baseCost: 130000,       baseProduction: 260 },
    { id: 'boneGolemForge',          name: 'Bone Golem Forge',           icon: '⚙',        baseCost: 1400000,      baseProduction: 1400 },
    { id: 'voidReaper',              name: 'Void Reaper',                icon: '💀',  baseCost: 20000000,     baseProduction: 7800 },
    { id: 'cursedCathedral',        name: 'Cursed Cathedral',           icon: '⛪',        baseCost: 330000000,    baseProduction: 44000 },
    { id: 'abyssalWarlordsLegion',  name: "Abyssal Warlord's Legion",   icon: '🏴',  baseCost: 5100000000,   baseProduction: 260000 },
    { id: 'eclipseTitan',           name: 'Eclipse Titan',              icon: '🌑',  baseCost: 75000000000,  baseProduction: 1600000 }
  ];

  const COST_SCALE = 1.15;

  function get(id) {
    return LIST.find(function (g) { return g.id === id; });
  }

  function owned(id) {
    return (Game.State.data.generators[id]) || 0;
  }

  function costFor(id) {
    const def = get(id);
    return Math.ceil(def.baseCost * Math.pow(COST_SCALE, owned(id)));
  }

  function canAfford(id) {
    return Game.State.data.essence >= costFor(id);
  }

  function buy(id) {
    const cost = costFor(id);
    if (!Game.State.trySpend(cost)) return false;
    Game.State.data.generators[id] = owned(id) + 1;
    Game.State.data.monstersSlain += 1;
    Game.Achievements.checkAll();
    return true;
  }

  function rawProductionPerSecond() {
    return LIST.reduce(function (sum, g) {
      return sum + owned(g.id) * g.baseProduction;
    }, 0);
  }

  function effectiveProductionPerSecond(now) {
    const t = now || Date.now();
    return rawProductionPerSecond() *
      Game.Prestige.getEssenceMultiplier() *
      Game.Achievements.getMultiplier() *
      Game.Ads.getProductionMultiplier(t);
  }

  function totalOwned() {
    return LIST.reduce(function (sum, g) { return sum + owned(g.id); }, 0);
  }

  function maxOwnedOfAny() {
    return LIST.reduce(function (max, g) { return Math.max(max, owned(g.id)); }, 0);
  }

  function ownsAllTiers() {
    return LIST.every(function (g) { return owned(g.id) > 0; });
  }

  return {
    LIST: LIST,
    get: get,
    owned: owned,
    costFor: costFor,
    canAfford: canAfford,
    buy: buy,
    rawProductionPerSecond: rawProductionPerSecond,
    effectiveProductionPerSecond: effectiveProductionPerSecond,
    totalOwned: totalOwned,
    maxOwnedOfAny: maxOwnedOfAny,
    ownsAllTiers: ownsAllTiers
  };
})();
