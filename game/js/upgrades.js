window.Game = window.Game || {};

Game.Upgrades = (function () {
  const LIST = [
    { id: 'honedEdge1', name: 'Honed Edge I',   cost: 500,      multiplier: 2 },
    { id: 'honedEdge2', name: 'Honed Edge II',  cost: 50000,    multiplier: 2 },
    { id: 'honedEdge3', name: 'Honed Edge III', cost: 5000000,  multiplier: 2 }
  ];

  const BASE_CLICK_VALUE = 1;

  function isOwned(id) {
    return Game.State.data.clickUpgrades.indexOf(id) !== -1;
  }

  function costFor(id) {
    return LIST.find(function (u) { return u.id === id; }).cost;
  }

  function canAfford(id) {
    return Game.State.data.essence >= costFor(id);
  }

  function buy(id) {
    if (isOwned(id)) return false;
    if (!Game.State.trySpend(costFor(id))) return false;
    Game.State.data.clickUpgrades.push(id);
    Game.Achievements.checkAll();
    return true;
  }

  function getClickMultiplier() {
    return LIST.reduce(function (mult, u) {
      return isOwned(u.id) ? mult * u.multiplier : mult;
    }, 1);
  }

  function effectiveClickValue(now) {
    const t = now || Date.now();
    return BASE_CLICK_VALUE * getClickMultiplier() * Game.Ads.getClickMultiplier(t);
  }

  return {
    LIST: LIST,
    BASE_CLICK_VALUE: BASE_CLICK_VALUE,
    isOwned: isOwned,
    costFor: costFor,
    canAfford: canAfford,
    buy: buy,
    getClickMultiplier: getClickMultiplier,
    effectiveClickValue: effectiveClickValue
  };
})();
