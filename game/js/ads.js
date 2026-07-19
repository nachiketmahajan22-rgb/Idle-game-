window.Game = window.Game || {};

Game.Ads = (function () {
  // Replace with a real AdMob Rewarded Ad Unit ID before release (see README.md / docs/PUBLISHING.md).
  const REWARD_UNIT_ID = 'ca-app-pub-0000000000000000/0000000000';

  const BOOSTS = {
    bladeFrenzy: { name: 'Blade Frenzy', kind: 'duration', durationSec: 600,  cooldownSec: 1200, productionMult: 2, clickMult: 1 },
    riftSurge:   { name: 'Rift Surge',   kind: 'instant',  durationSec: 0,    cooldownSec: 1800, instantSeconds: 1800 },
    goldenEdge:  { name: 'Golden Edge',  kind: 'duration', durationSec: 300,  cooldownSec: 900,  productionMult: 1, clickMult: 3 }
  };

  let onBoostGranted = null;

  function setOnBoostGranted(callback) {
    onBoostGranted = callback;
  }

  function isAvailable() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() &&
      window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob);
  }

  // Fires the platform rewarded-ad flow. onReward is only invoked if the user
  // actually watched to completion — never grant currency optimistically.
  function showRewarded(boostId, onReward) {
    if (!isAvailable()) return;
    const AdMob = window.Capacitor.Plugins.AdMob;
    AdMob.prepareRewardVideoAd({ adId: REWARD_UNIT_ID })
      .then(function () { return AdMob.showRewardVideoAd(); })
      .then(function (result) {
        if (result && result.type) onReward(boostId);
      })
      .catch(function () { /* ad unfilled/cancelled/failed - no reward, no-op */ });
  }

  function boostState(boostId) {
    return Game.State.data.boosts[boostId];
  }

  function isActive(boostId, now) {
    const t = now || Date.now();
    return t < boostState(boostId).activeUntil;
  }

  function isOnCooldown(boostId, now) {
    const t = now || Date.now();
    return t < boostState(boostId).availableAfter;
  }

  function canWatch(boostId, now) {
    return isAvailable() && !isOnCooldown(boostId, now || Date.now());
  }

  function getProductionMultiplier(now) {
    const t = now || Date.now();
    let mult = 1;
    if (isActive('bladeFrenzy', t)) mult *= BOOSTS.bladeFrenzy.productionMult;
    return mult;
  }

  function getClickMultiplier(now) {
    const t = now || Date.now();
    let mult = 1;
    if (isActive('goldenEdge', t)) mult *= BOOSTS.goldenEdge.clickMult;
    return mult;
  }

  function applyReward(boostId) {
    const def = BOOSTS[boostId];
    const now = Date.now();
    const st = boostState(boostId);
    st.availableAfter = now + def.cooldownSec * 1000;

    if (def.kind === 'duration') {
      st.activeUntil = now + def.durationSec * 1000;
    } else if (def.kind === 'instant') {
      const rate = Game.Generators.rawProductionPerSecond() *
        Game.Prestige.getEssenceMultiplier() *
        Game.Achievements.getMultiplier();
      Game.State.addEssence(rate * def.instantSeconds);
    }

    Game.Save.save();
    if (onBoostGranted) onBoostGranted(boostId, def);
  }

  function watchBoost(boostId) {
    if (!canWatch(boostId)) return;
    showRewarded(boostId, applyReward);
  }

  return {
    BOOSTS: BOOSTS,
    setOnBoostGranted: setOnBoostGranted,
    isAvailable: isAvailable,
    isActive: isActive,
    isOnCooldown: isOnCooldown,
    canWatch: canWatch,
    getProductionMultiplier: getProductionMultiplier,
    getClickMultiplier: getClickMultiplier,
    watchBoost: watchBoost
  };
})();
