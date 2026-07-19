(function () {
  const TICK_MS = 100;
  const AUTOSAVE_MS = 10000;

  let lastTick = Date.now();

  function tick() {
    const now = Date.now();
    const deltaSeconds = (now - lastTick) / 1000;
    lastTick = now;

    const rate = Game.Generators.effectiveProductionPerSecond(now);
    Game.State.addEssence(rate * deltaSeconds);
    Game.Achievements.checkAll();

    Game.UI.render();
  }

  function boot() {
    const loaded = Game.Save.load();
    Game.State.init(loaded);

    Game.UI.init();

    const elapsedMs = loaded ? Math.max(0, Date.now() - (loaded.lastSaveTimestamp || Date.now())) : 0;
    const offlineEarned = Game.Save.applyOfflineEarnings(loaded);
    if (offlineEarned > 0) {
      Game.UI.showOfflineModal(offlineEarned, elapsedMs / 1000);
    }

    Game.Achievements.checkAll();
    Game.UI.render();
    Game.Save.save();

    lastTick = Date.now();
    window.setInterval(tick, TICK_MS);
    window.setInterval(Game.Save.save, AUTOSAVE_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Game.Save.save();
    });
    window.addEventListener('pagehide', Game.Save.save);

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
        if (!state.isActive) Game.Save.save();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
