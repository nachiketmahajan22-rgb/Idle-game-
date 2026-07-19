(function () {
  const AUTOSAVE_MS = 10000;

  function boot() {
    const loaded = Game.Save.load();
    Game.State.init(loaded);

    Game.UI.init();

    const elapsedMs = loaded ? Math.max(0, Date.now() - (loaded.lastSaveTimestamp || Date.now())) : 0;
    const offlineEarned = Game.Save.applyOfflineEarnings(loaded);
    if (offlineEarned > 0) {
      Game.UICamp.showOfflineModal(offlineEarned, elapsedMs / 1000);
    }

    Game.Achievements.checkAll();
    Game.UICamp.refresh();
    Game.Save.save();

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
