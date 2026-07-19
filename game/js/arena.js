window.Game = window.Game || {};

Game.Arena = (function () {
  const RUN_DURATION_SEC = 180;
  const DEATH_PROMPT_TIMEOUT_SEC = 5;
  const MAX_DT = 0.05;

  let canvas = null;
  let ctx = null;
  let dpr = 1;

  let running = false;
  let rafHandle = null;
  let lastFrameTime = 0;
  let phase = 'active'; // 'active' | 'levelup' | 'death' | 'ended'

  let run = null;
  let facing = { x: 1, y: 0 };
  let deathPromptDeadline = 0;
  let deathPromptAwaitingAd = false;
  let pendingLevelUps = 0;
  let resultsData = null;

  let hudCallback = null;
  let levelUpCallback = null;
  let deathPromptCallback = null;
  let resultsCallback = null;
  let warlordBannerCallback = null;
  let revivedCallback = null;

  function onHudUpdate(cb) { hudCallback = cb; }
  function onLevelUp(cb) { levelUpCallback = cb; }
  function onDeathPrompt(cb) { deathPromptCallback = cb; }
  function onResults(cb) { resultsCallback = cb; }
  function onWarlordBanner(cb) { warlordBannerCallback = cb; }
  function onRevived(cb) { revivedCallback = cb; }

  function xpToNext(level) {
    return Math.round(25 * Math.pow(level, 1.4));
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function isRunning() {
    return running;
  }

  function startHunt(headStartApplied) {
    const bonusLevels = Game.Camp.getBladeAcolyteStartBonus() +
      (headStartApplied ? Game.Ads.BOOSTS.headStart.weaponLevelBonus : 0);

    Game.Weapons.startRun(bonusLevels);
    Game.Enemies.startRun();
    Game.Pickups.startRun();
    Game.Enemies.setOnKill(handleEnemyKilled);
    Game.Enemies.setOnWarlordApproach(function () {
      if (warlordBannerCallback) warlordBannerCallback();
    });

    const player = Game.Player.createRunPlayer();
    player.x = 0;
    player.y = 0;
    Game.Player.init(player);

    const startXpFraction = headStartApplied ? Game.Ads.BOOSTS.headStart.xpFillPct : 0;

    run = {
      elapsed: 0,
      xp: xpToNext(1) * startXpFraction,
      level: 1,
      kills: 0,
      gemsCollected: 0,
      shardsCollected: 0,
      warlordsKilled: 0,
      reviveUsed: false,
      hitCloseCall: false
    };

    facing = { x: 1, y: 0 };
    pendingLevelUps = 0;
    resultsData = null;
    deathPromptAwaitingAd = false;
    phase = 'active';

    running = true;
    lastFrameTime = performance.now();
    rafHandle = requestAnimationFrame(loop);
  }

  function retreat() {
    if (!running) return;
    endRun(false);
  }

  function handleEnemyKilled(enemy) {
    run.kills += 1;
    if (enemy.defId === 'abyssalWarlord') run.warlordsKilled += 1;
  }

  function loop(now) {
    if (!running) return;
    const dt = Game.Utils.clamp((now - lastFrameTime) / 1000, 0, MAX_DT);
    lastFrameTime = now;

    if (phase === 'active') {
      simulate(dt, now);
    } else if (phase === 'death') {
      if (!deathPromptAwaitingAd && now >= deathPromptDeadline) {
        endRun(false);
        return;
      }
    }

    if (!running) return;
    draw();
    rafHandle = requestAnimationFrame(loop);
  }

  function simulate(dt, now) {
    run.elapsed += dt;
    if (run.elapsed >= RUN_DURATION_SEC) {
      run.elapsed = RUN_DURATION_SEC;
      endRun(true);
      return;
    }

    const player = Game.Player.get();
    const joy = Game.Joystick.getVector();
    const speed = Game.Player.moveSpeed();
    player.x = Game.Utils.clamp(player.x + joy.x * speed * dt, -Game.Utils.WORLD_HALF_SIZE, Game.Utils.WORLD_HALF_SIZE);
    player.y = Game.Utils.clamp(player.y + joy.y * speed * dt, -Game.Utils.WORLD_HALF_SIZE, Game.Utils.WORLD_HALF_SIZE);

    if (joy.x * joy.x + joy.y * joy.y > 0.01) {
      facing = { x: joy.x, y: joy.y };
    } else {
      const nearest = Game.Enemies.findNearest(player.x, player.y, Infinity);
      if (nearest) facing = Game.Utils.normalizeTo(player.x, player.y, nearest.x, nearest.y);
    }

    Game.Enemies.update(dt, now, run.elapsed, player);
    Game.Weapons.update(dt, now, player, facing);

    const pickupResult = Game.Pickups.update(dt, now, player, Game.Player.pickupRadius());
    run.xp += pickupResult.xpGained;
    run.gemsCollected += pickupResult.gemsCollected;
    run.shardsCollected += pickupResult.shardsCollected;

    while (run.xp >= xpToNext(run.level)) {
      run.xp -= xpToNext(run.level);
      run.level += 1;
      pendingLevelUps += 1;
    }

    if (Game.Player.get().hitCloseCall) run.hitCloseCall = true;

    if (pendingLevelUps > 0) {
      showNextLevelUp();
      return;
    }

    if (Game.Player.isDead()) {
      triggerDeathPrompt(now);
      return;
    }

    if (hudCallback) {
      const rawEstimate = run.shardsCollected * Game.Pickups.SHARD_ESSENCE_VALUE +
        Math.floor(run.elapsed / 10) * 2 + run.kills * 0.1;
      hudCallback({
        hp: player.hp,
        maxHp: player.maxHP,
        timeRemaining: RUN_DURATION_SEC - run.elapsed,
        xp: run.xp,
        xpToNext: xpToNext(run.level),
        level: run.level,
        kills: run.kills,
        essenceEstimate: rawEstimate * Game.Prestige.getEssenceMultiplier() * Game.Achievements.getMultiplier()
      });
    }
  }

  function buildLevelUpChoices() {
    const cardCount = Game.Camp.getLevelUpCardCount();
    const candidates = [];

    Game.Weapons.WEAPON_IDS.forEach(function (weaponId) {
      const owned = Game.Weapons.get(weaponId);
      if (owned) {
        if (owned.level < 8) candidates.push({ type: 'levelUp', id: weaponId, weight: 4 });
      } else if (Game.Weapons.canEquipMore() && Game.Camp.isWeaponUnlocked(weaponId)) {
        candidates.push({ type: 'newWeapon', id: weaponId, weight: 3 });
      }
    });

    Game.Player.PASSIVE_IDS.forEach(function (passiveId) {
      if (Game.Player.canStackPassive(passiveId)) {
        candidates.push({ type: 'passive', id: passiveId, weight: 3 });
      }
    });

    const chosen = [];
    const remaining = candidates.slice();
    while (chosen.length < cardCount && remaining.length > 0) {
      let totalWeight = 0;
      remaining.forEach(function (c) { totalWeight += c.weight; });
      let r = Math.random() * totalWeight;
      let idx = 0;
      for (; idx < remaining.length; idx++) {
        r -= remaining[idx].weight;
        if (r <= 0) break;
      }
      if (idx >= remaining.length) idx = remaining.length - 1;
      chosen.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
    while (chosen.length < cardCount) chosen.push({ type: 'essenceCache' });

    return chosen;
  }

  function showNextLevelUp() {
    phase = 'levelup';
    const choices = buildLevelUpChoices();
    if (levelUpCallback) levelUpCallback(choices);
  }

  function chooseLevelUpCard(card) {
    if (card.type === 'newWeapon') Game.Weapons.addWeapon(card.id);
    else if (card.type === 'levelUp') Game.Weapons.levelUp(card.id);
    else if (card.type === 'passive') Game.Player.applyPassive(card.id);
    else if (card.type === 'essenceCache') Game.State.addEssence(20);

    pendingLevelUps = Math.max(0, pendingLevelUps - 1);

    if (pendingLevelUps > 0) {
      showNextLevelUp();
      return;
    }

    if (Game.Player.isDead()) {
      triggerDeathPrompt(performance.now());
      return;
    }

    phase = 'active';
    lastFrameTime = performance.now();
  }

  function triggerDeathPrompt(now) {
    phase = 'death';
    deathPromptDeadline = now + DEATH_PROMPT_TIMEOUT_SEC * 1000;
    deathPromptAwaitingAd = false;
    const canRevive = !run.reviveUsed && Game.Ads.isAvailable();
    if (deathPromptCallback) deathPromptCallback(canRevive);
  }

  function reviveViaAd() {
    if (!run || run.reviveUsed || deathPromptAwaitingAd) return;
    deathPromptAwaitingAd = true;
    Game.Ads.showRewarded('revive', function () {
      deathPromptAwaitingAd = false;
      run.reviveUsed = true;
      const player = Game.Player.get();
      const now = performance.now();
      player.hp = player.maxHP * 0.5;
      Game.Player.grantInvulnerability(2, now);
      lastFrameTime = now;
      phase = 'active';
      if (revivedCallback) revivedCallback();
    }, function () {
      deathPromptAwaitingAd = false;
      endRun(false);
    });
  }

  function declineDefeat() {
    endRun(false);
  }

  function endRun(fullClear) {
    running = false;
    phase = 'ended';
    if (rafHandle) cancelAnimationFrame(rafHandle);

    const survivalSeconds = run.elapsed;
    const bankedEssenceRaw = run.shardsCollected * Game.Pickups.SHARD_ESSENCE_VALUE +
      Math.floor(survivalSeconds / 10) * 2 +
      run.kills * 0.1;
    const multiplier = Game.Prestige.getEssenceMultiplier() * Game.Achievements.getMultiplier();
    const bankedEssence = bankedEssenceRaw * multiplier;

    const d = Game.State.data;
    d.totalRuns += 1;
    if (fullClear) d.fullClearRuns += 1;
    d.bestRunLevel = Math.max(d.bestRunLevel, run.level);
    d.bestRunKills = Math.max(d.bestRunKills, run.kills);
    d.lifetimeGemsCollected += run.gemsCollected;
    d.lifetimeShardsCollected += run.shardsCollected;
    d.warlordsKilled += run.warlordsKilled;
    if (fullClear && run.hitCloseCall) d.closeCallRuns += 1;

    Game.Achievements.checkAll();
    Game.Save.save();

    resultsData = {
      fullClear: fullClear,
      survivalSeconds: survivalSeconds,
      level: run.level,
      kills: run.kills,
      gemsCollected: run.gemsCollected,
      shardsCollected: run.shardsCollected,
      bankedEssence: bankedEssence,
      doubleUsed: false,
      doubleAvailable: Game.Ads.isAvailable()
    };

    if (resultsCallback) resultsCallback(resultsData);
  }

  function useDoubleRewardsAd() {
    if (!resultsData || resultsData.doubleUsed || !resultsData.doubleAvailable) return;
    Game.Ads.showRewarded('doubleRewards', function () {
      resultsData.doubleUsed = true;
      resultsData.bankedEssence *= 2;
      if (resultsCallback) resultsCallback(resultsData);
    }, function () { /* ad failed/declined - leave results as-is, button stays tappable */ });
  }

  function returnToCamp() {
    if (resultsData) {
      Game.State.addEssence(resultsData.bankedEssence);
      Game.Achievements.checkAll();
      Game.Save.save();
    }
    resultsData = null;
    run = null;
  }

  // ---- rendering ----

  const ENEMY_COLORS = {
    riftWhelp: '#b3121f',
    ravenousCur: '#ff6b3d',
    boneStalker: '#cfcdd6',
    voidReaper: '#6a3df5',
    abyssalWarlord: '#12121a'
  };

  function worldToScreen(x, y, cx, cy) {
    return {
      x: (x - cx) + canvas.width / (2 * dpr),
      y: (y - cy) + canvas.height / (2 * dpr)
    };
  }

  function draw() {
    if (!ctx || !run) return;
    const player = Game.Player.get();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    drawGrid(player.x, player.y, w, h);
    drawPickups(player.x, player.y, w, h);
    drawWeaponEffects(player.x, player.y);
    drawEnemies(player.x, player.y);
    drawPlayer(w, h);

    ctx.restore();
  }

  function drawGrid(cx, cy, w, h) {
    const step = 120;
    ctx.strokeStyle = '#2a2a35';
    ctx.lineWidth = 1;
    const offsetX = ((w / 2 - cx) % step + step) % step;
    const offsetY = ((h / 2 - cy) % step + step) % step;
    ctx.beginPath();
    for (let x = offsetX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offsetY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  function drawPlayer(w, h) {
    ctx.fillStyle = '#e8e6e3';
    ctx.strokeStyle = '#ff2b4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawEnemies(cx, cy) {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    Game.Enemies.getActive().forEach(function (enemy) {
      const p = worldToScreen(enemy.x, enemy.y, cx, cy);
      if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) return;
      ctx.fillStyle = ENEMY_COLORS[enemy.defId] || '#b3121f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();

      if (enemy.maxHp > 200) {
        const barW = enemy.radius * 2;
        ctx.fillStyle = '#2a2a35';
        ctx.fillRect(p.x - barW / 2, p.y - enemy.radius - 10, barW, 4);
        ctx.fillStyle = '#ff2b4d';
        ctx.fillRect(p.x - barW / 2, p.y - enemy.radius - 10, barW * Math.max(0, enemy.hp / enemy.maxHp), 4);
      }
    });
  }

  function drawPickups(cx, cy, w, h) {
    Game.Pickups.getGems().forEach(function (gem) {
      const p = worldToScreen(gem.x, gem.y, cx, cy);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
      ctx.fillStyle = gem.tier === 'large' ? '#ffd23f' : (gem.tier === 'medium' ? '#ffd23f' : '#ff2b4d');
      const r = gem.tier === 'large' ? 7 : (gem.tier === 'medium' ? 5 : 4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    Game.Pickups.getShards().forEach(function (shard) {
      const p = worldToScreen(shard.x, shard.y, cx, cy);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawWeaponEffects(cx, cy) {
    Game.Weapons.getProjectiles().forEach(function (proj) {
      const p = worldToScreen(proj.x, proj.y, cx, cy);
      ctx.fillStyle = '#e8e6e3';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    Game.Weapons.getPulses().forEach(function (pulse) {
      const p = worldToScreen(pulse.x, pulse.y, cx, cy);
      const progress = pulse.age / pulse.duration;
      ctx.strokeStyle = 'rgba(255,210,63,' + (1 - progress) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse.radius * progress, 0, Math.PI * 2);
      ctx.stroke();
    });
    Game.Weapons.getHoundPositions(Game.Player.get()).forEach(function (hp) {
      const p = worldToScreen(hp.x, hp.y, cx, cy);
      ctx.fillStyle = '#8a6d4a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill();
    });
    Game.Weapons.getTurretPositions().forEach(function (turret) {
      const p = worldToScreen(turret.x, turret.y, cx, cy);
      ctx.fillStyle = '#8a8790';
      ctx.fillRect(p.x - 8, p.y - 8, 16, 16);
    });
  }

  // Test-only hook (used by the Playwright verification suite) so the ~3-minute
  // run timer doesn't have to be waited out in real time to exercise that path.
  function debugFastForward(seconds) {
    if (run) run.elapsed = Math.max(run.elapsed, seconds);
  }

  return {
    STATE_DURATION: RUN_DURATION_SEC,
    init: init,
    isRunning: isRunning,
    startHunt: startHunt,
    retreat: retreat,
    debugFastForward: debugFastForward,
    chooseLevelUpCard: chooseLevelUpCard,
    reviveViaAd: reviveViaAd,
    declineDefeat: declineDefeat,
    useDoubleRewardsAd: useDoubleRewardsAd,
    returnToCamp: returnToCamp,
    onHudUpdate: onHudUpdate,
    onLevelUp: onLevelUp,
    onDeathPrompt: onDeathPrompt,
    onResults: onResults,
    onWarlordBanner: onWarlordBanner,
    onRevived: onRevived
  };
})();
