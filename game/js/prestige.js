window.Game = window.Game || {};

Game.Prestige = (function () {
  // Rescaled for the run-based economy (a full 180s run nets roughly 90-120 raw
  // Essence, not the millions/billions the old passive-generator economy produced) -
  // 1500 puts the first shard within reach after ~15 runs rather than ~1000.
  const LIFETIME_ESSENCE_PER_SHARD_SQRT = 1500;
  const MULTIPLIER_PER_SHARD = 0.02;

  // Total shards the player's current lifetime earnings "justify" — not a per-reforge
  // grant. Reforging twice without earning more essence in between must not pay out
  // shards twice, so gains are always (target - shards already held).
  function projectedTotalShards() {
    return Math.floor(Math.sqrt(Game.State.data.lifetimeEssence / LIFETIME_ESSENCE_PER_SHARD_SQRT));
  }

  function projectedGainedShards() {
    return Math.max(0, projectedTotalShards() - Game.State.data.bladeShards);
  }

  function getEssenceMultiplier() {
    return 1 + Game.State.data.bladeShards * MULTIPLIER_PER_SHARD;
  }

  function getProjectedEssenceMultiplier() {
    return 1 + (Game.State.data.bladeShards + projectedGainedShards()) * MULTIPLIER_PER_SHARD;
  }

  function canReforge() {
    return projectedGainedShards() >= 1;
  }

  function reforge() {
    const gained = projectedGainedShards();
    if (gained < 1) return false;

    const d = Game.State.data;
    d.bladeShards += gained;
    d.prestigeCount += 1;
    d.essence = 0;
    Game.Camp.LIST.forEach(function (c) { d.gear[c.id] = 0; });

    Game.Achievements.checkAll();
    return true;
  }

  return {
    projectedTotalShards: projectedTotalShards,
    projectedGainedShards: projectedGainedShards,
    getEssenceMultiplier: getEssenceMultiplier,
    getProjectedEssenceMultiplier: getProjectedEssenceMultiplier,
    canReforge: canReforge,
    reforge: reforge
  };
})();
