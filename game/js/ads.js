window.Game = window.Game || {};

Game.Ads = (function () {
  // Replace with your real AdMob Rewarded Ad Unit ID before release (see README.md / docs/PUBLISHING.md).
  const REWARD_UNIT_ID = 'ca-app-pub-6189670769513289/6151875722';

  const BOOSTS = {
    revive:        { name: 'Revive',         kind: 'revive' },
    headStart:     { name: 'Head Start',     kind: 'preRun',  cooldownSec: 1200, weaponLevelBonus: 2, xpFillPct: 0.30 },
    doubleRewards: { name: 'Double Rewards', kind: 'postRun', essenceMultiplier: 2 }
  };

  function isAvailable() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() &&
      window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob);
  }

  // Fires the platform rewarded-ad flow. onReward is only invoked if the user
  // actually watched to completion — never grant a reward optimistically.
  // Callers own what the reward actually does (revive/head-start/double-rewards
  // all have very different effects, so there's no single generic "apply" here).
  // onFailure (optional) fires on no-fill/cancel/error - callers that gate a state
  // transition on the outcome (e.g. the revive death-prompt) need this to avoid
  // getting stuck waiting forever for a reward that's never coming.
  function showRewarded(boostId, onReward, onFailure) {
    if (!isAvailable()) {
      if (onFailure) onFailure(boostId);
      return;
    }
    const AdMob = window.Capacitor.Plugins.AdMob;
    AdMob.prepareRewardVideoAd({ adId: REWARD_UNIT_ID })
      .then(function () { return AdMob.showRewardVideoAd(); })
      .then(function (result) {
        if (result && result.type) onReward(boostId);
        else if (onFailure) onFailure(boostId);
      })
      .catch(function () { if (onFailure) onFailure(boostId); });
  }

  // Head Start is the only boost with a persistent cross-run cooldown (Revive is
  // gated to once-per-run in-memory by arena.js; Double Rewards is naturally
  // gated to once-per-run by only appearing on the results screen).
  function canUseHeadStart(now) {
    const t = now || Date.now();
    return isAvailable() && t >= Game.State.data.boosts.headStart.availableAfter;
  }

  function markHeadStartUsed(now) {
    const t = now || Date.now();
    Game.State.data.boosts.headStart.availableAfter = t + BOOSTS.headStart.cooldownSec * 1000;
    Game.Save.save();
  }

  function headStartCooldownRemaining(now) {
    const t = now || Date.now();
    return Math.max(0, (Game.State.data.boosts.headStart.availableAfter - t) / 1000);
  }

  return {
    BOOSTS: BOOSTS,
    isAvailable: isAvailable,
    showRewarded: showRewarded,
    canUseHeadStart: canUseHeadStart,
    markHeadStartUsed: markHeadStartUsed,
    headStartCooldownRemaining: headStartCooldownRemaining
  };
})();
