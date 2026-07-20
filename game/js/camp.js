window.Game = window.Game || {};

Game.Camp = (function () {
  const COST_SCALE = 1.15;

  const LIST = [
    { id: 'weaponDamage',          name: 'Talwar Forging',       kind: 'leveled', baseCost: 50,   cap: null, desc: '+4% damage, all weapons' },
    { id: 'ironSinew',             name: 'Kavach Training',      kind: 'leveled', baseCost: 40,   cap: null, desc: '+5 max HP' },
    { id: 'swiftLegs',             name: 'Sahyadri Training',    kind: 'leveled', baseCost: 60,   cap: null, desc: '+2% move speed' },
    { id: 'riftReach',             name: "Scout's Instinct",     kind: 'leveled', baseCost: 45,   cap: null, desc: '+3% pickup radius' },
    { id: 'bladeAcolyteMastery',   name: 'Talwar Mastery',       kind: 'leveled', baseCost: 200,  cap: 6,    desc: '+1 starting Talwar Strike level per 2 purchased' },
    { id: 'essenceTrickleShrine',  name: 'Swarajya Treasury',    kind: 'leveled', baseCost: 80,   cap: null, desc: '+1 Swarajya/hr while away' },
    { id: 'huntersLedger',         name: 'War Council',          kind: 'oneTime', baseCost: 500,  desc: 'Level-up offers 4 choices instead of 3' },
    { id: 'riftTurretBlueprint',   name: 'Watchtower Blueprint', kind: 'oneTime', baseCost: 300,  desc: 'Unlocks Watch Tower Archer as a level-up option' },
    { id: 'bloodHoundKennel',      name: 'Mavla Recruitment',    kind: 'oneTime', baseCost: 600,  desc: 'Unlocks Loyal Mavlas as a level-up option' },
    { id: 'cursedBellChalice',     name: 'War Horn Blessing',    kind: 'oneTime', baseCost: 1000, desc: 'Unlocks Rann Shinga as a level-up option' }
  ];

  const WEAPON_UNLOCK_GEAR_ID = {
    riftTurret: 'riftTurretBlueprint',
    bloodHoundPack: 'bloodHoundKennel',
    cursedCathedral: 'cursedBellChalice'
  };
  const ALWAYS_UNLOCKED_WEAPONS = ['bladeAcolyte', 'shadowBlade'];

  function get(id) {
    return LIST.find(function (c) { return c.id === id; });
  }

  function level(id) {
    return Game.State.data.gear[id] || 0;
  }

  function isOneTimeOwned(id) {
    return level(id) >= 1;
  }

  function costFor(id) {
    const def = get(id);
    if (def.kind === 'oneTime') {
      return isOneTimeOwned(id) ? null : def.baseCost;
    }
    if (def.cap !== null && level(id) >= def.cap) return null;
    return Math.ceil(def.baseCost * Math.pow(COST_SCALE, level(id)));
  }

  function canAfford(id) {
    const cost = costFor(id);
    return cost !== null && Game.State.data.essence >= cost;
  }

  function buy(id) {
    const cost = costFor(id);
    if (cost === null) return false;
    if (!Game.State.trySpend(cost)) return false;
    const def = get(id);
    Game.State.data.gear[id] = def.kind === 'oneTime' ? 1 : level(id) + 1;
    Game.Achievements.checkAll();
    return true;
  }

  function getDamageMultiplier() {
    return 1 + level('weaponDamage') * 0.04;
  }

  function getMaxHPBonus() {
    return level('ironSinew') * 5;
  }

  function getMoveSpeedMultiplier() {
    return 1 + level('swiftLegs') * 0.02;
  }

  function getPickupRadiusMultiplier() {
    return 1 + level('riftReach') * 0.03;
  }

  function getBladeAcolyteStartBonus() {
    return Math.floor(level('bladeAcolyteMastery') / 2);
  }

  function getTrickleEssencePerHour() {
    return level('essenceTrickleShrine') * 1;
  }

  function getLevelUpCardCount() {
    return isOneTimeOwned('huntersLedger') ? 4 : 3;
  }

  function isWeaponUnlocked(weaponId) {
    if (ALWAYS_UNLOCKED_WEAPONS.indexOf(weaponId) !== -1) return true;
    const gearId = WEAPON_UNLOCK_GEAR_ID[weaponId];
    return gearId ? isOneTimeOwned(gearId) : false;
  }

  function allWeaponsUnlocked() {
    return Object.keys(WEAPON_UNLOCK_GEAR_ID).every(function (weaponId) {
      return isWeaponUnlocked(weaponId);
    });
  }

  return {
    LIST: LIST,
    level: level,
    isOneTimeOwned: isOneTimeOwned,
    costFor: costFor,
    canAfford: canAfford,
    buy: buy,
    getDamageMultiplier: getDamageMultiplier,
    getMaxHPBonus: getMaxHPBonus,
    getMoveSpeedMultiplier: getMoveSpeedMultiplier,
    getPickupRadiusMultiplier: getPickupRadiusMultiplier,
    getBladeAcolyteStartBonus: getBladeAcolyteStartBonus,
    getTrickleEssencePerHour: getTrickleEssencePerHour,
    getLevelUpCardCount: getLevelUpCardCount,
    isWeaponUnlocked: isWeaponUnlocked,
    allWeaponsUnlocked: allWeaponsUnlocked
  };
})();
