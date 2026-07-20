window.Game = window.Game || {};

Game.Enemies = (function () {
  const MAX_ACTIVE = 80;
  const SPAWN_RADIUS = 650;
  const CONTACT_RANGE = 16;
  const CONTACT_COOLDOWN = 0.6;
  const BOSS_DASH_INTERVAL = 4;
  const BOSS_DASH_DURATION = 0.4;
  const BOSS_DASH_MULT = 3;
  const WARLORD_TELEGRAPH_SEC = 2;

  // Generic ranks/unit-types only - deliberately no specific named historical
  // figure is used as a repeatable enemy/boss, out of respect for the real
  // people involved in this history.
  const DEFS = {
    riftWhelp:      { name: 'Mughal Scout',        hp: 12,   speed: 90,  contactDamage: 5,  xpValue: 3,  radius: 10, essenceDropChance: 0.04 },
    ravenousCur:    { name: 'Adilshahi Skirmisher', hp: 18,   speed: 130, contactDamage: 6,  xpValue: 4,  radius: 12, essenceDropChance: 0.04 },
    boneStalker:    { name: 'Mughal Infantry',     hp: 30,   speed: 70,  contactDamage: 8,  xpValue: 6,  radius: 14, essenceDropChance: 0.04 },
    voidReaper:     { name: 'Mughal Sardar',       hp: 220,  speed: 55,  contactDamage: 18, xpValue: 20, radius: 22, isElite: true },
    abyssalWarlord: { name: 'Siege Commander',     hp: 1400, speed: 60,  contactDamage: 30, xpValue: 80, radius: 40, isBoss: true }
  };

  // Gated by unlockAt so a fresh campaign opens with Scouts only, then
  // gradually introduces the tougher grunt ranks - a new player's first
  // 20 seconds shouldn't already have Skirmishers and Infantry mixed in.
  const GRUNT_WEIGHTS = [
    { id: 'riftWhelp', weight: 0.60, unlockAt: 0 },
    { id: 'ravenousCur', weight: 0.25, unlockAt: 20 },
    { id: 'boneStalker', weight: 0.15, unlockAt: 50 }
  ];

  let active = [];
  let nextInstanceId = 1;
  let spawnTimer = 0;
  let eliteSpawnQueue = [];
  let onKill = null;
  let onWarlordApproach = null;

  function setOnKill(callback) {
    onKill = callback;
  }

  function setOnWarlordApproach(callback) {
    onWarlordApproach = callback;
  }

  function waveMultiplier(t) {
    return 1 + (t / 180) * 1.5;
  }

  function damageMultiplier(t) {
    return 1 + (t / 180) * 0.8;
  }

  function spawnInterval(t) {
    // Eased in more gently than a flat 1.4s start - the opening seconds of a
    // campaign shouldn't already feel like a swarm before the player has
    // found their footing.
    return Math.max(0.4, 1.8 - (t / 180) * 1.4);
  }

  function pickGruntId(t) {
    const pool = GRUNT_WEIGHTS.filter(function (g) { return t >= g.unlockAt; });
    const totalWeight = pool.reduce(function (sum, g) { return sum + g.weight; }, 0);
    const r = Math.random() * totalWeight;
    let cumulative = 0;
    for (let i = 0; i < pool.length; i++) {
      cumulative += pool[i].weight;
      if (r <= cumulative) return pool[i].id;
    }
    return pool[pool.length - 1].id;
  }

  function startRun() {
    active = [];
    nextInstanceId = 1;
    spawnTimer = 0;
    eliteSpawnQueue = [
      { time: 30, id: 'voidReaper', telegraphed: false },
      { time: 75, id: 'voidReaper', telegraphed: false },
      { time: 120, id: 'voidReaper', telegraphed: false },
      { time: 165, id: 'voidReaper', telegraphed: false },
      { time: 90, id: 'abyssalWarlord', telegraphed: false },
      { time: 170, id: 'abyssalWarlord', telegraphed: false }
    ];
  }

  function spawnPointAround(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    let x = playerPos.x + Math.cos(angle) * SPAWN_RADIUS;
    let y = playerPos.y + Math.sin(angle) * SPAWN_RADIUS;
    x = Game.Utils.clamp(x, -Game.Utils.WORLD_HALF_SIZE, Game.Utils.WORLD_HALF_SIZE);
    y = Game.Utils.clamp(y, -Game.Utils.WORLD_HALF_SIZE, Game.Utils.WORLD_HALF_SIZE);
    return { x: x, y: y };
  }

  function spawnAt(id, x, y, t) {
    const def = DEFS[id];
    const hp = def.hp * waveMultiplier(t);
    active.push({
      instanceId: nextInstanceId++,
      defId: id,
      x: x, y: y,
      hp: hp,
      maxHp: hp,
      speed: def.speed,
      contactDamage: def.contactDamage,
      xpValue: def.xpValue,
      radius: def.radius,
      attackCooldown: 0,
      dashCooldown: def.isBoss ? BOSS_DASH_INTERVAL : 0,
      dashUntil: 0
    });
  }

  function update(dt, now, t, playerPos) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && active.length < MAX_ACTIVE) {
      spawnTimer = spawnInterval(t);
      const p = spawnPointAround(playerPos);
      spawnAt(pickGruntId(t), p.x, p.y, t);
    }

    eliteSpawnQueue.forEach(function (entry) {
      if (!entry.telegraphed && entry.id === 'abyssalWarlord' && t >= entry.time - WARLORD_TELEGRAPH_SEC) {
        entry.telegraphed = true;
        if (onWarlordApproach) onWarlordApproach();
      }
    });

    eliteSpawnQueue = eliteSpawnQueue.filter(function (entry) {
      if (t < entry.time) return true;
      if (active.length < MAX_ACTIVE) {
        const p = spawnPointAround(playerPos);
        spawnAt(entry.id, p.x, p.y, t);
      }
      return false;
    });

    active.forEach(function (enemy) {
      const def = DEFS[enemy.defId];
      let speed = enemy.speed;
      if (def.isBoss) {
        enemy.dashCooldown -= dt;
        if (enemy.dashCooldown <= 0) {
          enemy.dashCooldown = BOSS_DASH_INTERVAL;
          enemy.dashUntil = now + BOSS_DASH_DURATION;
        }
        if (now < enemy.dashUntil) speed = enemy.speed * BOSS_DASH_MULT;
      }

      const dir = Game.Utils.normalizeTo(enemy.x, enemy.y, playerPos.x, playerPos.y);
      enemy.x += dir.x * speed * dt;
      enemy.y += dir.y * speed * dt;

      enemy.attackCooldown -= dt;
      const distToPlayer = Game.Utils.distance(enemy.x, enemy.y, playerPos.x, playerPos.y);
      if (distToPlayer <= enemy.radius + CONTACT_RANGE && enemy.attackCooldown <= 0) {
        const dmg = enemy.contactDamage * damageMultiplier(t);
        const landed = Game.Player.takeDamage(dmg, now);
        if (landed) enemy.attackCooldown = CONTACT_COOLDOWN;
      }
    });
  }

  function applyDamage(enemy, amount) {
    enemy.hp -= amount;
    if (enemy.hp <= 0) kill(enemy);
  }

  function kill(enemy) {
    const idx = active.indexOf(enemy);
    if (idx === -1) return;
    active.splice(idx, 1);
    const def = DEFS[enemy.defId];

    Game.Pickups.spawnGem(enemy.x, enemy.y, enemy.xpValue);

    if (enemy.defId === 'abyssalWarlord') {
      for (let i = 0; i < 5; i++) {
        Game.Pickups.spawnShard(enemy.x + (Math.random() - 0.5) * 30, enemy.y + (Math.random() - 0.5) * 30);
      }
    } else if (enemy.defId === 'voidReaper') {
      const count = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < count; i++) {
        Game.Pickups.spawnShard(enemy.x + (Math.random() - 0.5) * 20, enemy.y + (Math.random() - 0.5) * 20);
      }
    } else {
      const chance = def.essenceDropChance + Game.Player.essenceDropBonus();
      if (Math.random() < chance) Game.Pickups.spawnShard(enemy.x, enemy.y);
    }

    if (onKill) onKill(enemy);
  }

  function getActive() {
    return active;
  }

  function findNearest(x, y, maxRangeSq) {
    let best = null;
    let bestDistSq = maxRangeSq;
    active.forEach(function (enemy) {
      const dSq = Game.Utils.distanceSq(x, y, enemy.x, enemy.y);
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        best = enemy;
      }
    });
    return best;
  }

  return {
    DEFS: DEFS,
    setOnKill: setOnKill,
    setOnWarlordApproach: setOnWarlordApproach,
    waveMultiplier: waveMultiplier,
    damageMultiplier: damageMultiplier,
    startRun: startRun,
    update: update,
    applyDamage: applyDamage,
    getActive: getActive,
    findNearest: findNearest
  };
})();
