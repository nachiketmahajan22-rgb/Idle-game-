window.Game = window.Game || {};

Game.UI = (function () {
  const fmt = Game.Utils.formatNumber;

  let els = {};

  function cacheEls() {
    els = {
      essenceCount: document.getElementById('essence-count'),
      essenceRate: document.getElementById('essence-rate'),
      shardsChip: document.getElementById('blade-shards-chip'),
      tapButton: document.getElementById('tap-button'),
      tapFxLayer: document.getElementById('tap-fx-layer'),
      boostsPanel: document.getElementById('boosts-panel'),
      tabNav: document.getElementById('tab-nav'),
      tabPanels: document.querySelectorAll('.tab-panel'),
      upgradesList: document.getElementById('upgrades-list'),
      generatorsList: document.getElementById('generators-list'),
      statsGrid: document.getElementById('stats-grid'),
      achievementsGrid: document.getElementById('achievements-grid'),
      shardsCurrent: document.getElementById('shards-current'),
      multiplierCurrent: document.getElementById('multiplier-current'),
      shardsProjected: document.getElementById('shards-projected'),
      multiplierProjected: document.getElementById('multiplier-projected'),
      reforgeBtn: document.getElementById('reforge-btn'),
      offlineModal: document.getElementById('offline-modal'),
      offlineText: document.getElementById('offline-text'),
      offlineCloseBtn: document.getElementById('offline-close-btn'),
      reforgeModal: document.getElementById('reforge-modal'),
      reforgeModalShards: document.getElementById('reforge-modal-shards'),
      reforgeCancelBtn: document.getElementById('reforge-cancel-btn'),
      reforgeConfirmBtn: document.getElementById('reforge-confirm-btn'),
      achievementToast: document.getElementById('achievement-toast')
    };
  }

  function spawnFloatingPlus(amount) {
    const span = document.createElement('span');
    span.className = 'float-plus';
    span.textContent = '+' + fmt(amount);
    span.style.left = (45 + Math.random() * 10) + '%';
    els.tapFxLayer.appendChild(span);
    span.addEventListener('animationend', function () { span.remove(); });
  }

  function showToast(text) {
    const t = els.achievementToast;
    t.textContent = text;
    t.classList.remove('hidden');
    // restart animation
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    window.setTimeout(function () { t.classList.add('hidden'); }, 3000);
  }

  function bindEvents() {
    els.tapButton.addEventListener('click', function () {
      const now = Date.now();
      const value = Game.Upgrades.effectiveClickValue(now);
      Game.State.addEssence(value);
      spawnFloatingPlus(value);
      Game.Achievements.checkAll();
    });

    els.boostsPanel.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-boost-action]');
      if (!btn || btn.disabled) return;
      Game.Ads.watchBoost(btn.getAttribute('data-boost-action'));
    });

    els.tabNav.addEventListener('click', function (e) {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      els.tabPanels.forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + tab); });
    });

    els.upgradesList.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-upgrade-action]');
      if (!btn || btn.disabled) return;
      if (Game.Upgrades.buy(btn.getAttribute('data-upgrade-action'))) Game.Save.save();
    });

    els.generatorsList.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-generator-action]');
      if (!btn || btn.disabled) return;
      if (Game.Generators.buy(btn.getAttribute('data-generator-action'))) Game.Save.save();
    });

    els.offlineCloseBtn.addEventListener('click', function () {
      els.offlineModal.classList.add('hidden');
    });

    els.reforgeBtn.addEventListener('click', function () {
      if (els.reforgeBtn.disabled) return;
      els.reforgeModalShards.textContent = fmt(Game.Prestige.projectedGainedShards());
      els.reforgeModal.classList.remove('hidden');
    });

    els.reforgeCancelBtn.addEventListener('click', function () {
      els.reforgeModal.classList.add('hidden');
    });

    els.reforgeConfirmBtn.addEventListener('click', function () {
      Game.Prestige.reforge();
      els.reforgeModal.classList.add('hidden');
      Game.Save.save();
    });

    Game.Achievements.setOnUnlock(function (achievement) {
      showToast('Achievement unlocked: ' + achievement.name);
    });

    Game.Ads.setOnBoostGranted(function (boostId, def) {
      showToast(def.name + ' activated!');
    });
  }

  function boostStatusText(boostId, now) {
    const def = Game.Ads.BOOSTS[boostId];
    if (Game.Ads.isActive(boostId, now)) {
      const remaining = (Game.State.data.boosts[boostId].activeUntil - now) / 1000;
      return Game.Utils.formatDuration(remaining);
    }
    if (Game.Ads.isOnCooldown(boostId, now)) {
      const remaining = (Game.State.data.boosts[boostId].availableAfter - now) / 1000;
      return Game.Utils.formatDuration(remaining);
    }
    return '';
  }

  function renderBoosts(now) {
    Object.keys(Game.Ads.BOOSTS).forEach(function (boostId) {
      const btn = els.boostsPanel.querySelector('[data-boost-action="' + boostId + '"]');
      const status = els.boostsPanel.querySelector('[data-boost-status="' + boostId + '"]');
      const active = Game.Ads.isActive(boostId, now);
      const canWatch = Game.Ads.canWatch(boostId, now);

      btn.disabled = !canWatch;
      btn.classList.toggle('active-boost', active);
      btn.textContent = active ? 'Active' : (canWatch ? 'Watch Ad' : (Game.Ads.isAvailable() ? 'Cooldown' : 'Locked'));
      status.textContent = boostStatusText(boostId, now);
    });
  }

  // Shop/achievement/stat DOM is built exactly once (buildXxx) and subsequently only
  // updated in place (updateXxx) rather than rebuilt via innerHTML every tick — replacing
  // nodes on a 100ms timer would detach buttons out from under an in-progress tap/click.
  let upgradeRows = {};
  let generatorRows = {};
  let achievementTiles = {};
  let statValueEls = {};

  function buildUpgradesList() {
    els.upgradesList.innerHTML = Game.Upgrades.LIST.map(function (u) {
      return '' +
        '<div class="shop-row" data-row="' + u.id + '">' +
          '<span class="shop-icon">⚔</span>' +
          '<div class="shop-details">' +
            '<div class="shop-name">' + u.name + '</div>' +
            '<div class="shop-sub">Tap value ×' + u.multiplier + '</div>' +
          '</div>' +
          '<button class="shop-buy-btn" data-upgrade-action="' + u.id + '"></button>' +
        '</div>';
    }).join('');
    upgradeRows = {};
    Game.Upgrades.LIST.forEach(function (u) {
      upgradeRows[u.id] = {
        row: els.upgradesList.querySelector('[data-row="' + u.id + '"]'),
        btn: els.upgradesList.querySelector('[data-upgrade-action="' + u.id + '"]')
      };
    });
  }

  function updateUpgrades() {
    Game.Upgrades.LIST.forEach(function (u) {
      const refs = upgradeRows[u.id];
      const owned = Game.Upgrades.isOwned(u.id);
      const affordable = Game.Upgrades.canAfford(u.id);
      refs.row.className = 'shop-row' + (owned ? ' purchased' : (!affordable ? ' unaffordable' : ''));
      refs.btn.disabled = owned || !affordable;
      refs.btn.textContent = owned ? 'Owned' : fmt(u.cost);
    });
  }

  function buildGeneratorsList() {
    els.generatorsList.innerHTML = Game.Generators.LIST.map(function (g) {
      return '' +
        '<div class="shop-row" data-row="' + g.id + '">' +
          '<span class="shop-icon">' + g.icon + '</span>' +
          '<div class="shop-details">' +
            '<div class="shop-name">' + g.name + '</div>' +
            '<div class="shop-sub">' + fmt(g.baseProduction) + '/sec each</div>' +
          '</div>' +
          '<span class="shop-owned" data-owned="' + g.id + '"></span>' +
          '<button class="shop-buy-btn" data-generator-action="' + g.id + '"></button>' +
        '</div>';
    }).join('');
    generatorRows = {};
    Game.Generators.LIST.forEach(function (g) {
      generatorRows[g.id] = {
        row: els.generatorsList.querySelector('[data-row="' + g.id + '"]'),
        owned: els.generatorsList.querySelector('[data-owned="' + g.id + '"]'),
        btn: els.generatorsList.querySelector('[data-generator-action="' + g.id + '"]')
      };
    });
  }

  function updateGenerators() {
    Game.Generators.LIST.forEach(function (g) {
      const refs = generatorRows[g.id];
      const affordable = Game.Generators.canAfford(g.id);
      refs.row.className = 'shop-row' + (!affordable ? ' unaffordable' : '');
      refs.owned.textContent = Game.Generators.owned(g.id);
      refs.btn.disabled = !affordable;
      refs.btn.textContent = fmt(Game.Generators.costFor(g.id));
    });
  }

  const STAT_TILES = [
    { key: 'lifetimeEssence', label: 'Lifetime Essence' },
    { key: 'monstersSlain', label: 'Monsters Slain' },
    { key: 'prestigeCount', label: 'Waves Survived' },
    { key: 'bladeShards', label: 'Blade Shards' }
  ];

  function buildStats() {
    els.statsGrid.innerHTML = STAT_TILES.map(function (t) {
      return '<div class="stat-tile"><div class="stat-value" data-stat="' + t.key + '"></div><div class="stat-label">' + t.label + '</div></div>';
    }).join('');
    statValueEls = {};
    STAT_TILES.forEach(function (t) {
      statValueEls[t.key] = els.statsGrid.querySelector('[data-stat="' + t.key + '"]');
    });
  }

  function updateStats() {
    const d = Game.State.data;
    STAT_TILES.forEach(function (t) {
      statValueEls[t.key].textContent = fmt(d[t.key]);
    });
  }

  function buildAchievements() {
    els.achievementsGrid.innerHTML = Game.Achievements.LIST.map(function (a) {
      return '<div class="achievement-tile locked" data-tile="' + a.id + '" title="' + a.name + '">' + a.icon + '</div>';
    }).join('');
    achievementTiles = {};
    Game.Achievements.LIST.forEach(function (a) {
      achievementTiles[a.id] = els.achievementsGrid.querySelector('[data-tile="' + a.id + '"]');
    });
  }

  function updateAchievements() {
    Game.Achievements.LIST.forEach(function (a) {
      const unlocked = Game.Achievements.isUnlocked(a.id);
      achievementTiles[a.id].className = 'achievement-tile ' + (unlocked ? 'unlocked' : 'locked');
    });
  }

  function renderAscend() {
    const d = Game.State.data;
    els.shardsCurrent.textContent = fmt(d.bladeShards);
    els.multiplierCurrent.textContent = '+' + Math.round((Game.Prestige.getEssenceMultiplier() - 1) * 100) + '%';
    els.shardsProjected.textContent = fmt(Game.Prestige.projectedGainedShards());
    els.multiplierProjected.textContent = '+' + Math.round((Game.Prestige.getProjectedEssenceMultiplier() - 1) * 100) + '%';
    els.reforgeBtn.disabled = !Game.Prestige.canReforge();
  }

  function renderHUD(now) {
    const d = Game.State.data;
    els.essenceCount.textContent = fmt(d.essence);
    els.essenceRate.textContent = fmt(Game.Generators.effectiveProductionPerSecond(now)) + ' / sec';
    els.shardsChip.textContent = fmt(d.bladeShards);
    renderBoosts(now);
  }

  function render() {
    const now = Date.now();
    renderHUD(now);
    updateUpgrades();
    updateGenerators();
    updateStats();
    updateAchievements();
    renderAscend();
  }

  function showOfflineModal(amount, elapsedSeconds) {
    els.offlineText.textContent = 'While you slept, your blades culled the rift for ' +
      Game.Utils.formatClock(elapsedSeconds) + ', earning ' + fmt(amount) + ' Essence.';
    els.offlineModal.classList.remove('hidden');
  }

  function init() {
    cacheEls();
    bindEvents();
    buildUpgradesList();
    buildGeneratorsList();
    buildStats();
    buildAchievements();
  }

  return {
    init: init,
    render: render,
    showOfflineModal: showOfflineModal
  };
})();
