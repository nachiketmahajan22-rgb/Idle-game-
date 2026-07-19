window.Game = window.Game || {};

Game.Save = (function () {
  const STORAGE_KEY = 'bladeHunterIdle_save_v1';
  const MAX_OFFLINE_MS = 8 * 60 * 60 * 1000;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function save() {
    Game.State.data.lastSaveTimestamp = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Game.State.data));
    } catch (e) { /* storage unavailable/full - progress just won't persist this tick */ }
  }

  // Call once at boot, after Game.State.init(loadedData). Returns the granted
  // amount (0 if this is a fresh save or effectively no time has passed).
  function applyOfflineEarnings(loadedRaw) {
    if (!loadedRaw || !loadedRaw.lastSaveTimestamp) return 0;

    const elapsedMs = Math.max(0, Date.now() - loadedRaw.lastSaveTimestamp);
    const cappedMs = Math.min(elapsedMs, MAX_OFFLINE_MS);
    const elapsedSeconds = cappedMs / 1000;
    if (elapsedSeconds < 1) return 0;

    const elapsedHours = elapsedSeconds / 3600;
    const earned = Game.Camp.getTrickleEssencePerHour() * elapsedHours * Game.Achievements.getMultiplier();

    if (earned > 0) {
      Game.State.addEssence(earned);
      Game.State.data.longestOfflineClaimSeconds = Math.max(
        Game.State.data.longestOfflineClaimSeconds,
        elapsedSeconds
      );
      Game.Achievements.checkAll();
    }
    return earned;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    save: save,
    applyOfflineEarnings: applyOfflineEarnings
  };
})();
