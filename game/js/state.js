window.Game = window.Game || {};

Game.State = (function () {
  const SAVE_VERSION = 2;
  const BOOST_IDS = ['bladeFrenzy', 'riftSurge', 'goldenEdge'];

  let data = null;

  function createDefault() {
    const generators = {};
    Game.Generators.LIST.forEach(function (g) { generators[g.id] = 0; });

    const boosts = {};
    BOOST_IDS.forEach(function (id) { boosts[id] = { activeUntil: 0, availableAfter: 0 }; });

    return {
      version: SAVE_VERSION,
      essence: 0,
      lifetimeEssence: 0,
      generators: generators,
      clickUpgrades: [],
      achievements: [],
      bladeShards: 0,
      prestigeCount: 0,
      monstersSlain: 0,
      longestOfflineClaimSeconds: 0,
      boosts: boosts,
      lastSaveTimestamp: Date.now()
    };
  }

  // Defensively fills in any keys missing from a loaded (possibly older-schema) save
  // so new fields introduced later never crash on an existing player's save file.
  function reconcile(loaded) {
    const fresh = createDefault();
    const merged = Object.assign({}, fresh, loaded);
    merged.generators = Object.assign({}, fresh.generators, loaded.generators || {});
    merged.boosts = Object.assign({}, fresh.boosts, loaded.boosts || {});
    merged.clickUpgrades = loaded.clickUpgrades || [];
    merged.achievements = loaded.achievements || [];
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
    BOOST_IDS: BOOST_IDS,
    get data() { return data; },
    createDefault: createDefault,
    init: init,
    addEssence: addEssence,
    trySpend: trySpend
  };
})();
