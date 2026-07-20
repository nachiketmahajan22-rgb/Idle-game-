window.Game = window.Game || {};

Game.State = (function () {
  const SAVE_VERSION = 3;

  let data = null;

  function createDefault() {
    const gear = {};
    Game.Camp.LIST.forEach(function (c) { gear[c.id] = 0; });

    return {
      version: SAVE_VERSION,
      essence: 0,
      lifetimeEssence: 0,
      selectedCharacter: 'bladeHunter',
      gear: gear,
      achievements: [],
      bladeShards: 0,
      prestigeCount: 0,
      longestOfflineClaimSeconds: 0,
      totalRuns: 0,
      fullClearRuns: 0,
      bestRunLevel: 0,
      bestRunKills: 0,
      lifetimeGemsCollected: 0,
      lifetimeShardsCollected: 0,
      warlordsKilled: 0,
      closeCallRuns: 0,
      boosts: { headStart: { availableAfter: 0 } },
      lastSaveTimestamp: Date.now()
    };
  }

  // Defensively fills in any keys missing from a loaded (possibly older-schema) save
  // so new fields introduced later never crash on an existing player's save file.
  // Also drops fields from the pre-v3 tap-clicker schema (generators/clickUpgrades/
  // monstersSlain) which no longer mean anything in the run-based Camp/Hunt model.
  function reconcile(loaded) {
    const fresh = createDefault();
    const merged = Object.assign({}, fresh, loaded);
    merged.gear = Object.assign({}, fresh.gear, loaded.gear || {});
    merged.boosts = Object.assign({}, fresh.boosts, loaded.boosts || {});
    merged.achievements = loaded.achievements || [];
    delete merged.generators;
    delete merged.clickUpgrades;
    delete merged.monstersSlain;
    merged.version = SAVE_VERSION;
    return merged;
  }

  function init(loaded) {
    data = loaded ? reconcile(loaded) : createDefault();
  }

  function addEssence(amount) {
    if (amount <= 0) return;
    data.essence += amount;
    data.lifetimeEssence += amount;
  }

  function trySpend(cost) {
    if (data.essence < cost) return false;
    data.essence -= cost;
    return true;
  }

  return {
    SAVE_VERSION: SAVE_VERSION,
    get data() { return data; },
    createDefault: createDefault,
    init: init,
    addEssence: addEssence,
    trySpend: trySpend
  };
})();
