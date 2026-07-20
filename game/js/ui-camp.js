window.Game = window.Game || {};

Game.UICamp = (function () {
  const fmt = Game.Utils.formatNumber;

  let els = {};
  let gearRows = {};
  let statValueEls = {};
  let achievementTiles = {};

  const STAT_TILES = [
    { key: 'lifetimeEssence', label: 'Lifetime Essence' },
    { key: 'totalRuns', label: 'Hunts Run' },
    { key: 'bestRunKills', label: 'Best Run Kills' },
    { key: 'bestRunLevel', label: 'Best Run Level' },
    { key: 'lifetimeGemsCollected', label: 'Gems Collected' },
    { key: 'lifetimeShardsCollected', label: 'Shards Collected' },
    { key: 'warlordsKilled', label: 'Warlords Slain' },
    { key: 'prestigeCount', label: 'Reforges' }
  ];

  function cacheEls() {
    els = {
      essenceCount: document.getElementById('camp-essence-count'),
      shardsChip: document.getElementById('blade-shards-chip'),
      beginHuntBtn: document.getElementById('begin-hunt-btn'),
      headStartBtn: document.getElementById('head-start-btn'),
      headStartStatus: document.getElementById('head-start-status'),
      characterSelect: document.getElementById('character-select'),

      tabNav: document.getElementById('camp-tab-nav'),
      tabPanels: document.querySelectorAll('#screen-camp .tab-panel'),

      gearList: document.getElementById('gear-shop-list'),
      statsGrid: document.getElementById('camp-stats-grid'),
      achievementsGrid: document.getElementById('camp-achievements-grid'),

      shardsCurrent: document.getElementById('shards-current'),
      multiplierCurrent: document.getElementById('multiplier-current'),
      shardsProjected: document.getElementById('shards-projected'),
      multiplierProjected: document.getElementById('multiplier-projected'),
      reforgeBtn: document.getElementById('reforge-btn'),

      reforgeModal: document.getElementById('reforge-modal'),
      reforgeModalShards: document.getElementById('reforge-modal-shards'),
      reforgeCancelBtn: document.getElementById('reforge-cancel-btn'),
      reforgeConfirmBtn: document.getElementById('reforge-confirm-btn'),

      offlineModal: document.getElementById('offline-modal'),
      offlineText: document.getElementById('offline-text'),
      offlineCloseBtn: document.getElementById('offline-close-btn'),

      achievementToast: document.getElementById('achievement-toast')
    };
  }

  function buildCharacterSelect() {
    els.characterSelect.innerHTML = Game.Player.CHARACTERS.map(function (c) {
      return '' +
        '<button class="character-btn" data-character="' + c.id + '" style="--char-color:' + c.accentColor + '">' +
          '<span class="character-icon">' + c.icon + '</span>' +
          '<span class="character-name">' + c.name + '</span>' +
        '</button>';
    }).join('');
  }

  function updateCharacterSelect() {
    const selected = Game.State.data.selectedCharacter;
    Array.prototype.forEach.call(els.characterSelect.querySelectorAll('.character-btn'), function (btn) {
      btn.classList.toggle('selected', btn.getAttribute('data-character') === selected);
    });
  }

  function buildGearList() {
    els.gearList.innerHTML = Game.Camp.LIST.map(function (c) {
      return '' +
        '<div class="shop-row" data-row="' + c.id + '">' +
          '<div class="shop-details">' +
            '<div class="shop-name">' + c.name + '</div>' +
            '<div class="shop-sub">' + c.desc + '</div>' +
          '</div>' +
          '<span class="shop-owned" data-level="' + c.id + '"></span>' +
          '<button class="shop-buy-btn" data-gear-action="' + c.id + '"></button>' +
        '</div>';
    }).join('');

    gearRows = {};
    Game.Camp.LIST.forEach(function (c) {
      gearRows[c.id] = {
        row: els.gearList.querySelector('[data-row="' + c.id + '"]'),
        level: els.gearList.querySelector('[data-level="' + c.id + '"]'),
        btn: els.gearList.querySelector('[data-gear-action="' + c.id + '"]')
      };
    });
  }

  function updateGearList() {
    Game.Camp.LIST.forEach(function (c) {
      const refs = gearRows[c.id];
      const cost = Game.Camp.costFor(c.id);
      const affordable = Game.Camp.canAfford(c.id);
      const maxed = cost === null;

      refs.row.className = 'shop-row' + (maxed ? ' purchased' : (!affordable ? ' unaffordable' : ''));
      refs.level.textContent = c.kind === 'oneTime'
        ? (Game.Camp.isOneTimeOwned(c.id) ? 'Owned' : 'Locked')
        : ('Lv ' + Game.Camp.level(c.id));
      refs.btn.disabled = maxed || !affordable;
      refs.btn.textContent = maxed ? (c.kind === 'oneTime' ? 'Owned' : 'Max') : fmt(cost);
    });
  }

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

  function updateAscend() {
    const d = Game.State.data;
    els.shardsCurrent.textContent = fmt(d.bladeShards);
    els.multiplierCurrent.textContent = '+' + Math.round((Game.Prestige.getEssenceMultiplier() - 1) * 100) + '%';
    els.shardsProjected.textContent = fmt(Game.Prestige.projectedGainedShards());
    els.multiplierProjected.textContent = '+' + Math.round((Game.Prestige.getProjectedEssenceMultiplier() - 1) * 100) + '%';
    els.reforgeBtn.disabled = !Game.Prestige.canReforge();
  }

  function updateHeadStart() {
    const now = Date.now();
    const canUse = Game.Ads.canUseHeadStart(now);
    els.headStartBtn.disabled = !canUse;
    if (canUse) {
      els.headStartStatus.textContent = '';
    } else if (!Game.Ads.isAvailable()) {
      els.headStartStatus.textContent = 'Available in the Android app';
    } else {
      els.headStartStatus.textContent = Game.Utils.formatDuration(Game.Ads.headStartCooldownRemaining(now)) + ' left';
    }
  }

  function refresh() {
    els.essenceCount.textContent = fmt(Game.State.data.essence);
    els.shardsChip.textContent = fmt(Game.State.data.bladeShards);
    updateCharacterSelect();
    updateGearList();
    updateStats();
    updateAchievements();
    updateAscend();
    updateHeadStart();
  }

  function showToast(text) {
    const t = els.achievementToast;
    t.textContent = text;
    t.classList.remove('hidden');
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    window.setTimeout(function () { t.classList.add('hidden'); }, 3000);
  }

  function bindEvents() {
    els.characterSelect.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-character]');
      if (!btn) return;
      Game.Player.selectCharacter(btn.getAttribute('data-character'));
      Game.Save.save();
      updateCharacterSelect();
    });

    els.tabNav.addEventListener('click', function (e) {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      Array.prototype.forEach.call(els.tabNav.querySelectorAll('.tab-btn'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      els.tabPanels.forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + tab); });
    });

    els.gearList.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-gear-action]');
      if (!btn || btn.disabled) return;
      if (Game.Camp.buy(btn.getAttribute('data-gear-action'))) {
        Game.Save.save();
        refresh();
      }
    });

    els.beginHuntBtn.addEventListener('click', function () {
      Game.UI.showScreen(Game.UI.STATE.HUNT);
      Game.Arena.startHunt(false);
    });

    els.headStartBtn.addEventListener('click', function () {
      if (!Game.Ads.canUseHeadStart()) return;
      els.headStartBtn.disabled = true;
      Game.Ads.showRewarded('headStart', function () {
        Game.Ads.markHeadStartUsed(Date.now());
        Game.UI.showScreen(Game.UI.STATE.HUNT);
        Game.Arena.startHunt(true);
      }, function () {
        updateHeadStart();
      });
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
      refresh();
    });

    els.offlineCloseBtn.addEventListener('click', function () {
      els.offlineModal.classList.add('hidden');
    });

    Game.Achievements.setOnUnlock(function (achievement) {
      showToast('Achievement unlocked: ' + achievement.name);
      refresh();
    });
  }

  function showOfflineModal(amount, elapsedSeconds) {
    els.offlineText.textContent = 'While you were away, your Essence Trickle Shrine gathered ' +
      fmt(amount) + ' Essence over ' + Game.Utils.formatClock(elapsedSeconds) + '.';
    els.offlineModal.classList.remove('hidden');
  }

  function init() {
    cacheEls();
    buildCharacterSelect();
    buildGearList();
    buildStats();
    buildAchievements();
    bindEvents();
    refresh();
  }

  return { init: init, refresh: refresh, showOfflineModal: showOfflineModal };
})();
