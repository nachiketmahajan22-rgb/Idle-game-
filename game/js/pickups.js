window.Game = window.Game || {};

Game.Pickups = (function () {
  const MAX_PICKUPS = 150;
  const MAGNET_SPEED = 500;
  const COLLECT_RADIUS = 20;
  const SHARD_ESSENCE_VALUE = 3;
  const HEART_HEAL_AMOUNT = 30;

  let gems = [];
  let shards = [];
  let hearts = [];
  let powerOrbs = [];
  let chests = [];

  function startRun() {
    gems = [];
    shards = [];
    hearts = [];
    powerOrbs = [];
    chests = [];
  }

  function pushCapped(list, entry) {
    if (list.length >= MAX_PICKUPS) list.shift();
    list.push(entry);
  }

  function gemTier(value) {
    if (value >= 20) return 'large';
    if (value >= 6) return 'medium';
    return 'small';
  }

  function spawnGem(x, y, value) {
    pushCapped(gems, { x: x, y: y, value: value, tier: gemTier(value) });
  }

  function spawnShard(x, y) {
    pushCapped(shards, { x: x, y: y });
  }

  // Dropped by elite/boss kills (Mughal Sardar, Siege Commander) - a
  // guaranteed comeback moment after the harder fights, rather than relying
  // only on the rare grunt essence-shard drop chance.
  function spawnHeart(x, y) {
    pushCapped(hearts, { x: x, y: y });
  }

  function spawnPowerOrb(x, y) {
    pushCapped(powerOrbs, { x: x, y: y });
  }

  // A small chance from any regular kill - the reward itself is rolled at
  // collection time in arena.js, not at drop time, so what's on the ground
  // is always just "a chest" (mystery), same as Survivor.io's boss chests.
  function spawnChest(x, y) {
    pushCapped(chests, { x: x, y: y });
  }

  function updateList(list, dt, playerPos, pickupRadius) {
    let collectedValue = 0;
    const remaining = [];
    list.forEach(function (p) {
      const dist = Game.Utils.distance(p.x, p.y, playerPos.x, playerPos.y);
      if (dist <= COLLECT_RADIUS) {
        collectedValue += p.value !== undefined ? p.value : 1;
        return;
      }
      if (dist <= pickupRadius) {
        const dir = Game.Utils.normalizeTo(p.x, p.y, playerPos.x, playerPos.y);
        p.x += dir.x * MAGNET_SPEED * dt;
        p.y += dir.y * MAGNET_SPEED * dt;
      }
      remaining.push(p);
    });
    return { remaining: remaining, collectedValue: collectedValue, collectedCount: list.length - remaining.length };
  }

  function update(dt, now, playerPos, pickupRadius) {
    const gemResult = updateList(gems, dt, playerPos, pickupRadius);
    gems = gemResult.remaining;

    const shardResult = updateList(shards, dt, playerPos, pickupRadius);
    shards = shardResult.remaining;

    const heartResult = updateList(hearts, dt, playerPos, pickupRadius);
    hearts = heartResult.remaining;

    const powerResult = updateList(powerOrbs, dt, playerPos, pickupRadius);
    powerOrbs = powerResult.remaining;

    const chestResult = updateList(chests, dt, playerPos, pickupRadius);
    chests = chestResult.remaining;

    return {
      xpGained: gemResult.collectedValue,
      gemsCollected: gemResult.collectedCount,
      essenceGained: shardResult.collectedCount * SHARD_ESSENCE_VALUE,
      shardsCollected: shardResult.collectedCount,
      heartsCollected: heartResult.collectedCount,
      powerOrbsCollected: powerResult.collectedCount,
      chestsCollected: chestResult.collectedCount
    };
  }

  function getGems() {
    return gems;
  }

  function getShards() {
    return shards;
  }

  function getHearts() {
    return hearts;
  }

  function getPowerOrbs() {
    return powerOrbs;
  }

  function getChests() {
    return chests;
  }

  return {
    SHARD_ESSENCE_VALUE: SHARD_ESSENCE_VALUE,
    HEART_HEAL_AMOUNT: HEART_HEAL_AMOUNT,
    startRun: startRun,
    spawnGem: spawnGem,
    spawnShard: spawnShard,
    spawnHeart: spawnHeart,
    spawnPowerOrb: spawnPowerOrb,
    spawnChest: spawnChest,
    update: update,
    getGems: getGems,
    getShards: getShards,
    getHearts: getHearts,
    getPowerOrbs: getPowerOrbs,
    getChests: getChests
  };
})();
