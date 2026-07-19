window.Game = window.Game || {};

Game.Pickups = (function () {
  const MAX_PICKUPS = 150;
  const MAGNET_SPEED = 500;
  const COLLECT_RADIUS = 20;
  const SHARD_ESSENCE_VALUE = 3;

  let gems = [];
  let shards = [];

  function startRun() {
    gems = [];
    shards = [];
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

    return {
      xpGained: gemResult.collectedValue,
      gemsCollected: gemResult.collectedCount,
      essenceGained: shardResult.collectedCount * SHARD_ESSENCE_VALUE,
      shardsCollected: shardResult.collectedCount
    };
  }

  function getGems() {
    return gems;
  }

  function getShards() {
    return shards;
  }

  return {
    SHARD_ESSENCE_VALUE: SHARD_ESSENCE_VALUE,
    startRun: startRun,
    spawnGem: spawnGem,
    spawnShard: spawnShard,
    update: update,
    getGems: getGems,
    getShards: getShards
  };
})();
