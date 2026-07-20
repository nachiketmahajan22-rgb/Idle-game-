window.Game = window.Game || {};

Game.Arena = (function () {
  const RUN_DURATION_SEC = 180;
  const DEATH_PROMPT_TIMEOUT_SEC = 5;
  const MAX_DT = 0.05;
  const BLADE_SPIN_RAD_PER_SEC = 4.2; // ~1.5s per full rotation

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

  const characterImages = {};
  let spriteFacingLeft = false;

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
    preloadCharacterImages();
  }

  // Preloaded once at boot, well before any Hunt can start, so drawPlayer() never
  // has to deal with a mid-run loading race.
  function preloadCharacterImages() {
    Game.Player.CHARACTERS.forEach(function (c) {
      const img = new Image();
      img.src = c.image;
      characterImages[c.id] = img;
    });
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
    // #screen-hunt is display:none until this run starts, so the canvas's
    // parent had zero size at boot-time init() - resize now that it's about
    // to become visible, or the canvas stays 0x0 and nothing ever renders.
    resize();

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
  // Still plain Canvas 2D (no WebGL/3D engine, no image assets) - depth is faked
  // with radial-gradient "sphere" shading, drop shadows, and a lightly textured
  // terrain instead of flat single-color fills, which is what was reading as
  // "just a dot" before.

  // Generic-rank soldier silhouettes only - see enemies.js for the note on why
  // no named historical figure is used here. Mughal ranks read in warm
  // red/maroon+gold with an angular peaked turban; the Adilshahi (Bijapur)
  // skirmisher uses a distinct teal/indigo palette with a rounder Deccani cap
  // so the two factions stay visually distinguishable at a glance.
  const ENEMY_PALETTE = {
    riftWhelp:      { body: '#6b5a34', turban: '#8a7644', trim: '#3a2f1a', style: 'peak' },
    ravenousCur:    { body: '#274a5c', turban: '#356f88', trim: '#12242c', style: 'dome' },
    boneStalker:    { body: '#7a2418', turban: '#9c3420', trim: '#d8b866', style: 'peakShield' },
    voidReaper:     { body: '#8a1a1a', turban: '#b3121f', trim: '#ffd23f', style: 'peakPlume' },
    abyssalWarlord: { body: '#26262c', turban: '#17171c', trim: '#ff2b4d', style: 'spiked' }
  };

  const TERRAIN_CELL = 220;

  function worldToScreen(x, y, cx, cy) {
    return {
      x: (x - cx) + canvas.width / (2 * dpr),
      y: (y - cy) + canvas.height / (2 * dpr)
    };
  }

  // Deterministic pseudo-random in [0,1) from integer coords, so terrain
  // decorations stay fixed in the world instead of re-rolling every frame.
  function hash2D(x, y) {
    const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function lightenHex(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    let r = (num >> 16) + Math.round(255 * amount);
    let g = ((num >> 8) & 0xff) + Math.round(255 * amount);
    let b = (num & 0xff) + Math.round(255 * amount);
    r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function radialShade(x, y, radius, baseColor, lightAmount) {
    const grad = ctx.createRadialGradient(
      x - radius * 0.35, y - radius * 0.35, radius * 0.1,
      x, y, radius * 1.05
    );
    grad.addColorStop(0, lightenHex(baseColor, lightAmount !== undefined ? lightAmount : 0.35));
    grad.addColorStop(1, baseColor);
    return grad;
  }

  function drawShadowEllipse(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemySoldier(defId, x, y, r) {
    const pal = ENEMY_PALETTE[defId] || ENEMY_PALETTE.riftWhelp;

    // torso
    ctx.fillStyle = radialShade(x, y + r * 0.22, r * 0.95, pal.body, 0.28);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.25, r * 0.78, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();

    // turban/helm, shape varies by rank
    ctx.fillStyle = radialShade(x, y - r * 0.5, r * 0.7, pal.turban, 0.32);
    ctx.beginPath();
    if (pal.style === 'dome') {
      // rounder Deccani cap - Adilshahi Skirmisher
      ctx.arc(x, y - r * 0.42, r * 0.62, Math.PI, 0);
      ctx.closePath();
    } else if (pal.style === 'spiked') {
      // heavy siege helm with a central spike
      ctx.moveTo(x - r * 0.62, y - r * 0.12);
      ctx.quadraticCurveTo(x, y - r * 1.35, x + r * 0.62, y - r * 0.12);
      ctx.closePath();
    } else {
      // angular peaked Mughal turban - scout/infantry/sardar
      ctx.moveTo(x - r * 0.58, y - r * 0.18);
      ctx.quadraticCurveTo(x - r * 0.08, y - r * 1.1, x, y - r * 1.22);
      ctx.quadraticCurveTo(x + r * 0.08, y - r * 1.1, x + r * 0.58, y - r * 0.18);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    if (pal.style === 'spiked') {
      ctx.fillStyle = pal.trim;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.09, y - r * 1.15);
      ctx.lineTo(x + r * 0.09, y - r * 1.15);
      ctx.lineTo(x, y - r * 1.55);
      ctx.closePath();
      ctx.fill();
    } else if (pal.style === 'peakPlume') {
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.05);
      ctx.lineTo(x + r * 0.3, y - r * 1.45);
      ctx.stroke();
    } else if (pal.style === 'peakShield') {
      ctx.fillStyle = pal.trim;
      ctx.beginPath();
      ctx.ellipse(x - r * 0.92, y + r * 0.2, r * 0.26, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();
    }

    // weapon glint (small, only reads clearly on the bigger ranks)
    if (r >= 14) {
      ctx.strokeStyle = 'rgba(232,230,227,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.beginPath();
      ctx.moveTo(x + r * 0.6, y + r * 0.1);
      ctx.lineTo(x + r * 1.15, y - r * 0.55);
      ctx.stroke();
    }
  }

  function draw() {
    if (!ctx || !run) return;
    const player = Game.Player.get();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    drawGround(w, h);
    drawTerrainFeatures(player.x, player.y, w, h);
    drawGrid(player.x, player.y, w, h);
    drawPickups(player.x, player.y, w, h);
    drawWeaponEffects(player.x, player.y);
    drawEnemies(player.x, player.y);
    drawPlayer(w, h, facing);
    drawVignette(w, h);

    ctx.restore();
  }

  function drawGround(w, h) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, '#1c1408');
    grad.addColorStop(1, '#0a0602');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawTerrainFeatures(cx, cy, w, h) {
    const margin = 120;
    const startCellX = Math.floor((cx - w / 2 - margin) / TERRAIN_CELL);
    const endCellX = Math.floor((cx + w / 2 + margin) / TERRAIN_CELL);
    const startCellY = Math.floor((cy - h / 2 - margin) / TERRAIN_CELL);
    const endCellY = Math.floor((cy + h / 2 + margin) / TERRAIN_CELL);

    for (let gx = startCellX; gx <= endCellX; gx++) {
      for (let gy = startCellY; gy <= endCellY; gy++) {
        const presence = hash2D(gx, gy);
        if (presence > 0.4) continue;
        const worldX = gx * TERRAIN_CELL + hash2D(gx + 0.5, gy) * TERRAIN_CELL;
        const worldY = gy * TERRAIN_CELL + hash2D(gx, gy + 0.5) * TERRAIN_CELL;
        const p = worldToScreen(worldX, worldY, cx, cy);
        const variant = hash2D(gx + 0.25, gy + 0.25);

        if (variant < 0.5) {
          ctx.fillStyle = 'rgba(42,42,53,0.5)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 15, 8, variant * Math.PI, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(65,65,78,0.4)';
          ctx.beginPath();
          ctx.ellipse(p.x - 4, p.y - 3, 6, 4, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(179,18,31,0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x - 11, p.y);
          ctx.lineTo(p.x - 3, p.y + 4);
          ctx.lineTo(p.x + 4, p.y - 3);
          ctx.lineTo(p.x + 12, p.y + 2);
          ctx.stroke();
        }
      }
    }
  }

  function drawGrid(cx, cy, w, h) {
    const step = 120;
    ctx.strokeStyle = 'rgba(42,42,53,0.35)';
    ctx.lineWidth = 1;
    const offsetX = ((w / 2 - cx) % step + step) % step;
    const offsetY = ((h / 2 - cy) % step + step) % step;
    ctx.beginPath();
    for (let x = offsetX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offsetY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  function drawVignette(w, h) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, 'rgba(10,10,15,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawPlayer(w, h, facing) {
    const character = Game.Player.getSelectedCharacter();
    // The held blade spins continuously around the hunter rather than only
    // snapping to face the current attack direction - reads as a live,
    // active weapon instead of a static prop.
    const angle = (run.elapsed * BLADE_SPIN_RAD_PER_SEC) % (Math.PI * 2);
    const cx = w / 2;
    const cy = h / 2;

    drawShadowEllipse(cx, cy + 15, 16, 6);

    // Hand-illustrated sprite, drawn upright and only flipped horizontally to
    // face left/right - rotating a full illustrated character through
    // arbitrary angles looks broken, so only the blade below actually rotates
    // to track the facing/attack direction.
    if (Math.abs(facing.x) > 0.15) spriteFacingLeft = facing.x < 0;
    const img = characterImages[character.id];
    const spriteSize = 48;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(cx, cy - 6);
      if (spriteFacingLeft) ctx.scale(-1, 1);
      ctx.drawImage(img, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
      ctx.restore();
    } else {
      // Fallback in the unlikely event the sprite hasn't finished loading yet
      // (preloaded at boot, so this should never really be hit in practice).
      ctx.fillStyle = character.accentColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blade: tapered shape with a hilt, held toward whatever the hunter is
    // currently facing/auto-attacking. Long, thick and dark-outlined so it
    // reads clearly even at the character's small on-screen size, not just
    // when zoomed in.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1.5;

    const bladeGrad = ctx.createLinearGradient(10, 0, 42, 0);
    bladeGrad.addColorStop(0, character.accentColor);
    bladeGrad.addColorStop(1, '#ffffff');
    ctx.fillStyle = bladeGrad;
    ctx.beginPath();
    ctx.moveTo(10, -4.5);
    ctx.lineTo(32, -2);
    ctx.lineTo(42, 0);
    ctx.lineTo(32, 2);
    ctx.lineTo(10, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#5a4632';
    ctx.fillRect(-4, -3.5, 12, 7);
    ctx.strokeRect(-4, -3.5, 12, 7);
    ctx.restore();
  }

  function drawEnemies(cx, cy) {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    Game.Enemies.getActive().forEach(function (enemy) {
      const p = worldToScreen(enemy.x, enemy.y, cx, cy);
      if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) return;

      drawShadowEllipse(p.x, p.y + enemy.radius * 0.55, enemy.radius * 0.9, enemy.radius * 0.32);
      drawEnemySoldier(enemy.defId, p.x, p.y, enemy.radius);

      if (enemy.maxHp > 200) {
        const barW = enemy.radius * 2;
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(p.x - barW / 2, p.y - enemy.radius - 10, barW, 4);
        ctx.fillStyle = '#ff2b4d';
        ctx.fillRect(p.x - barW / 2, p.y - enemy.radius - 10, barW * Math.max(0, enemy.hp / enemy.maxHp), 4);
      }
    });
  }

  function drawPickups(cx, cy, w, h) {
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);

    Game.Pickups.getGems().forEach(function (gem) {
      const p = worldToScreen(gem.x, gem.y, cx, cy);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
      const color = gem.tier === 'small' ? '#ff2b4d' : '#ffd23f';
      const r = gem.tier === 'large' ? 7 : (gem.tier === 'medium' ? 5 : 4);

      ctx.save();
      ctx.globalAlpha = 0.3 * pulse;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = radialShade(p.x, p.y, r, color, 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    Game.Pickups.getShards().forEach(function (shard) {
      const p = worldToScreen(shard.x, shard.y, cx, cy);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;

      ctx.save();
      ctx.globalAlpha = 0.3 * pulse;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = radialShade(p.x, p.y, 8, '#ffd23f', 0.5);
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
      drawShadowEllipse(p.x, p.y + 6, 9, 3);
      ctx.fillStyle = radialShade(p.x, p.y, 10, '#8a6d4a', 0.35);
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
