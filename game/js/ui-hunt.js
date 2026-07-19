window.Game = window.Game || {};

Game.UIHunt = (function () {
  const fmt = Game.Utils.formatNumber;

  let els = {};

  function cacheEls() {
    els = {
      hpFill: document.getElementById('hud-hp-fill'),
      hpText: document.getElementById('hud-hp-text'),
      timer: document.getElementById('hud-timer'),
      xpFill: document.getElementById('hud-xp-fill'),
      level: document.getElementById('hud-level'),
      essenceEstimate: document.getElementById('hud-essence-estimate'),
      kills: document.getElementById('hud-kills'),
      retreatBtn: document.getElementById('retreat-btn'),
      warlordBanner: document.getElementById('warlord-banner'),

      levelUpModal: document.getElementById('levelup-modal'),
      levelUpCards: document.getElementById('levelup-cards'),

      deathModal: document.getElementById('death-modal'),
      deathReviveBtn: document.getElementById('death-revive-btn'),
      deathAcceptBtn: document.getElementById('death-accept-btn'),

      resultsModal: document.getElementById('results-modal'),
      resultsStats: document.getElementById('results-stats'),
      resultsDoubleBtn: document.getElementById('results-double-btn'),
      resultsReturnBtn: document.getElementById('results-return-btn')
    };
  }

  function cardLabel(card) {
    if (card.type === 'newWeapon') {
      const def = Game.Weapons.DEFS[card.id];
      return { icon: def.icon, title: def.name, desc: 'New weapon' };
    }
    if (card.type === 'levelUp') {
      const w = Game.Weapons.get(card.id);
      const def = Game.Weapons.DEFS[card.id];
      return { icon: def.icon, title: def.name, desc: 'Level ' + w.level + ' → ' + (w.level + 1) };
    }
    if (card.type === 'passive') {
      const info = Game.Player.PASSIVE_INFO[card.id];
      return { icon: info.icon, title: info.name, desc: info.desc };
    }
    return { icon: '\u{1F4B0}', title: 'Essence Cache', desc: '+20 Essence' };
  }

  function bindEvents() {
    els.retreatBtn.addEventListener('click', function () {
      Game.Arena.retreat();
    });

    els.deathReviveBtn.addEventListener('click', function () {
      els.deathReviveBtn.disabled = true;
      Game.Arena.reviveViaAd();
    });

    els.deathAcceptBtn.addEventListener('click', function () {
      Game.Arena.declineDefeat();
    });

    els.resultsDoubleBtn.addEventListener('click', function () {
      els.resultsDoubleBtn.disabled = true;
      Game.Arena.useDoubleRewardsAd();
    });

    els.resultsReturnBtn.addEventListener('click', function () {
      Game.Arena.returnToCamp();
      Game.UI.showScreen(Game.UI.STATE.CAMP);
    });

    Game.Arena.onHudUpdate(updateHud);
    Game.Arena.onLevelUp(showLevelUp);
    Game.Arena.onDeathPrompt(showDeathPrompt);
    Game.Arena.onResults(showResults);
    Game.Arena.onWarlordBanner(showWarlordBanner);
    Game.Arena.onRevived(hideDeathModal);
  }

  function updateHud(data) {
    els.hpFill.style.width = Math.max(0, (data.hp / data.maxHp) * 100) + '%';
    els.hpText.textContent = Math.ceil(Math.max(0, data.hp)) + ' / ' + data.maxHp;
    els.timer.textContent = Game.Utils.formatDuration(data.timeRemaining);
    els.xpFill.style.width = Math.min(100, (data.xp / data.xpToNext) * 100) + '%';
    els.level.textContent = 'Lv ' + data.level;
    els.essenceEstimate.textContent = fmt(data.essenceEstimate);
    els.kills.textContent = data.kills;
  }

  function showLevelUp(choices) {
    els.levelUpCards.innerHTML = choices.map(function (card, idx) {
      const label = cardLabel(card);
      return '' +
        '<button class="levelup-card" data-card-idx="' + idx + '">' +
          '<span class="levelup-card-icon">' + label.icon + '</span>' +
          '<span class="levelup-card-title">' + label.title + '</span>' +
          '<span class="levelup-card-desc">' + label.desc + '</span>' +
        '</button>';
    }).join('');

    Array.prototype.forEach.call(els.levelUpCards.querySelectorAll('.levelup-card'), function (btn, idx) {
      btn.addEventListener('click', function () {
        Game.Arena.chooseLevelUpCard(choices[idx]);
        els.levelUpModal.classList.add('hidden');
      });
    });

    els.levelUpModal.classList.remove('hidden');
  }

  function showDeathPrompt(canRevive) {
    els.deathReviveBtn.disabled = !canRevive;
    els.deathReviveBtn.classList.toggle('hidden', !canRevive);
    els.deathModal.classList.remove('hidden');
  }

  function hideDeathModal() {
    els.deathModal.classList.add('hidden');
  }

  function showResults(data) {
    hideDeathModal();
    els.levelUpModal.classList.add('hidden');

    const rows = [
      { label: 'Result', value: data.fullClear ? 'Full Clear' : 'Retreated' },
      { label: 'Time Survived', value: Game.Utils.formatDuration(data.survivalSeconds) },
      { label: 'Level Reached', value: data.level },
      { label: 'Enemies Slain', value: data.kills },
      { label: 'Gems Collected', value: data.gemsCollected },
      { label: 'Essence Banked', value: fmt(data.bankedEssence) }
    ];
    els.resultsStats.innerHTML = rows.map(function (r) {
      return '<div class="results-row"><span>' + r.label + '</span><span>' + r.value + '</span></div>';
    }).join('');

    els.resultsDoubleBtn.disabled = data.doubleUsed || !data.doubleAvailable;
    els.resultsDoubleBtn.classList.toggle('hidden', data.doubleUsed || !data.doubleAvailable);

    els.resultsModal.classList.remove('hidden');
  }

  function showWarlordBanner() {
    els.warlordBanner.classList.remove('hidden');
    els.warlordBanner.style.animation = 'none';
    void els.warlordBanner.offsetWidth;
    els.warlordBanner.style.animation = '';
    window.setTimeout(function () { els.warlordBanner.classList.add('hidden'); }, 2500);
  }

  function hideAllModals() {
    els.levelUpModal.classList.add('hidden');
    els.deathModal.classList.add('hidden');
    els.resultsModal.classList.add('hidden');
  }

  function init() {
    cacheEls();
    bindEvents();
  }

  return { init: init, hideAllModals: hideAllModals };
})();
