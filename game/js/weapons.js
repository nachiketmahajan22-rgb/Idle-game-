window.Game = window.Game || {};

Game.Weapons = (function () {
  const MAX_EQUIPPED = 4;
  const MAX_PROJECTILES = 200;

  const DEFS = {
    bladeAcolyte: {
      name: 'Talwar Strike', kind: 'meleeArc', icon: '⚔',
      baseDamage: 12, damageGrowth: 1.15,
      baseCooldown: 0.90, cooldownMult: 0.96, minCooldown: 0.5,
      range: 90, baseArc: 100, arcBonusLevels: [5, 8], arcBonusDeg: 15
    },
    shadowBlade: {
      name: 'Wagh Nakh Throw', kind: 'homingProjectile', icon: '🐾',
      baseDamage: 8, damageGrowth: 1.12,
      baseCooldown: 0.60, cooldownMult: 0.95, minCooldown: 0.3,
      projectileSpeed: 400, maxLifetimeSec: 2,
      basePierce: 1, pierceBonusLevels: [4, 8], countBonusLevel: 6
    },
    riftTurret: {
      name: 'Watch Tower Archer', kind: 'turret', icon: '🏹',
      baseDamage: 6, damageGrowth: 1.10,
      fireRate: 2, baseRange: 220, rangeBonusLevels: [3, 7], rangeBonusMult: 1.15,
      secondTurretLevel: 5, redeployInterval: 6,
      projectileSpeed: 500, maxLifetimeSec: 1.5
    },
    bloodHoundPack: {
      name: 'Loyal Mavlas', kind: 'orbit', icon: '🛡',
      baseDamage: 10, damageGrowth: 1.10,
      orbitRadius: 70, orbitSpeedDeg: 180, hitCooldown: 0.5,
      baseCount: 1, countBonusLevels: [3, 6]
    },
    cursedCathedral: {
      name: 'Rann Shinga', kind: 'aoePulse', icon: '📯',
      baseDamage: 18, damageGrowth: 1.18,
      baseCooldown: 3.00, cooldownMult: 0.95, minCooldown: 1.8,
      baseRadius: 130, radiusBonusLevels: [4, 8], radiusBonusMult: 0.10,
      telegraphSec: 0.15, pulseVisualSec: 0.3
    }
  };

  const WEAPON_IDS = Object.keys(DEFS);

  let equipped = [];
  let runtime = {};
  let projectiles = [];
  let pulses = [];

  function damageAt(id, level) {
    const def = DEFS[id];
    return def.baseDamage * Math.pow(def.damageGrowth, level - 1);
  }

  function cooldownAt(id, level) {
    const def = DEFS[id];
    return Math.max(def.minCooldown, def.baseCooldown * Math.pow(def.cooldownMult, level - 1));
  }

  function steppedBonus(level, bonusLevels, bonusAmount) {
    let bonus = 0;
    bonusLevels.forEach(function (lvl) { if (level >= lvl) bonus += bonusAmount; });
    return bonus;
  }

  function arcAt(level) {
    return DEFS.bladeAcolyte.baseArc + steppedBonus(level, DEFS.bladeAcolyte.arcBonusLevels, DEFS.bladeAcolyte.arcBonusDeg);
  }

  function pierceAt(level) {
    const def = DEFS.shadowBlade;
    return def.basePierce + steppedBonus(level, def.pierceBonusLevels, 1);
  }

  function shadowBladeCountAt(level) {
    return level >= DEFS.shadowBlade.countBonusLevel ? 2 : 1;
  }

  function turretRangeAt(level) {
    const def = DEFS.riftTurret;
    let range = def.baseRange;
    def.rangeBonusLevels.forEach(function (lvl) { if (level >= lvl) range *= def.rangeBonusMult; });
    return range;
  }

  function turretCountAt(level) {
    return level >= DEFS.riftTurret.secondTurretLevel ? 2 : 1;
  }

  function houndCountAt(level) {
    const def = DEFS.bloodHoundPack;
    let count = def.baseCount;
    def.countBonusLevels.forEach(function (lvl) { if (level >= lvl) count += 1; });
    return count;
  }

  function cathedralRadiusAt(level) {
    const def = DEFS.cursedCathedral;
    let mult = 1;
    def.radiusBonusLevels.forEach(function (lvl) { if (level >= lvl) mult += def.radiusBonusMult; });
    return def.baseRadius * mult;
  }

  function get(id) {
    return equipped.find(function (w) { return w.id === id; });
  }

  function hasEquipped(id) {
    return !!get(id);
  }

  function getEquipped() {
    return equipped;
  }

  function equippedCount() {
    return equipped.length;
  }

  function canEquipMore() {
    return equipped.length < MAX_EQUIPPED;
  }

  function addWeapon(id) {
    if (!canEquipMore() || hasEquipped(id)) return false;
    equipped.push({ id: id, level: 1 });
    initRuntimeFor(id);
    return true;
  }

  function levelUp(id) {
    const w = get(id);
    if (!w || w.level >= 8) return false;
    w.level += 1;
    return true;
  }

  function initRuntimeFor(id) {
    if (id === 'riftTurret') {
      runtime.riftTurret = { turrets: [], redeployTimer: 0 };
    } else if (id === 'bloodHoundPack') {
      runtime.bloodHoundPack = { angle: 0, hitCooldowns: [] };
    } else {
      runtime[id] = { cooldown: 0 };
    }
  }

  function startRun(bladeAcolyteBonusLevels) {
    equipped = [{ id: 'bladeAcolyte', level: 1 + (bladeAcolyteBonusLevels || 0) }];
    runtime = {};
    projectiles = [];
    pulses = [];
    initRuntimeFor('bladeAcolyte');
  }

  function spawnProjectile(x, y, dirX, dirY, speed, damage, pierce, lifetime) {
    if (projectiles.length >= MAX_PROJECTILES) projectiles.shift();
    projectiles.push({ x: x, y: y, dirX: dirX, dirY: dirY, speed: speed, damage: damage, pierce: pierce, age: 0, lifetime: lifetime });
  }

  function updateMeleeArc(dt, now, playerPos, facing) {
    const rt = runtime.bladeAcolyte;
    const w = get('bladeAcolyte');
    if (!w) return;
    rt.cooldown -= dt;
    if (rt.cooldown > 0) return;
    rt.cooldown = cooldownAt('bladeAcolyte', w.level) * Game.Player.cooldownMultiplier();

    const range = DEFS.bladeAcolyte.range;
    const halfArcRad = (arcAt(w.level) / 2) * (Math.PI / 180);
    const facingAngle = Math.atan2(facing.y, facing.x);
    const dmg = damageAt('bladeAcolyte', w.level) * Game.Player.damageMultiplier();

    Game.Enemies.getActive().forEach(function (enemy) {
      const d = Game.Utils.distance(playerPos.x, playerPos.y, enemy.x, enemy.y);
      if (d > range + enemy.radius) return;
      const toEnemy = Math.atan2(enemy.y - playerPos.y, enemy.x - playerPos.x);
      let diff = Math.abs(toEnemy - facingAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= halfArcRad) Game.Enemies.applyDamage(enemy, dmg);
    });
  }

  function updateHomingProjectileWeapon(dt, now, playerPos) {
    const rt = runtime.shadowBlade;
    const w = get('shadowBlade');
    if (!w) return;
    rt.cooldown -= dt;
    if (rt.cooldown > 0) return;
    rt.cooldown = cooldownAt('shadowBlade', w.level) * Game.Player.cooldownMultiplier();

    const count = shadowBladeCountAt(w.level);
    const dmg = damageAt('shadowBlade', w.level) * Game.Player.damageMultiplier();
    const pierce = pierceAt(w.level);
    const def = DEFS.shadowBlade;

    for (let i = 0; i < count; i++) {
      const target = Game.Enemies.findNearest(playerPos.x, playerPos.y, Infinity);
      if (!target) break;
      const dir = Game.Utils.normalizeTo(playerPos.x, playerPos.y, target.x, target.y);
      spawnProjectile(playerPos.x, playerPos.y, dir.x, dir.y, def.projectileSpeed, dmg, pierce, def.maxLifetimeSec);
    }
  }

  function updateTurret(dt, now, playerPos) {
    const w = get('riftTurret');
    if (!w) return;
    const rt = runtime.riftTurret;
    const def = DEFS.riftTurret;
    const desiredCount = turretCountAt(w.level);

    rt.redeployTimer -= dt;
    if (rt.turrets.length === 0 || rt.redeployTimer <= 0) {
      rt.turrets = [];
      for (let i = 0; i < desiredCount; i++) {
        rt.turrets.push({ x: playerPos.x + i * 20, y: playerPos.y, fireCooldown: 0 });
      }
      rt.redeployTimer = def.redeployInterval;
    }

    const dmg = damageAt('riftTurret', w.level) * Game.Player.damageMultiplier();
    const range = turretRangeAt(w.level);
    const fireInterval = 1 / def.fireRate;

    rt.turrets.forEach(function (turret) {
      turret.fireCooldown -= dt;
      if (turret.fireCooldown > 0) return;
      const target = Game.Enemies.findNearest(turret.x, turret.y, range * range);
      if (!target) return;
      turret.fireCooldown = fireInterval * Game.Player.cooldownMultiplier();
      const dir = Game.Utils.normalizeTo(turret.x, turret.y, target.x, target.y);
      spawnProjectile(turret.x, turret.y, dir.x, dir.y, def.projectileSpeed, dmg, 0, def.maxLifetimeSec);
    });
  }

  function updateOrbit(dt, now, playerPos) {
    const w = get('bloodHoundPack');
    if (!w) return;
    const rt = runtime.bloodHoundPack;
    const def = DEFS.bloodHoundPack;
    const count = houndCountAt(w.level);
    const dmg = damageAt('bloodHoundPack', w.level) * Game.Player.damageMultiplier();

    rt.angle = (rt.angle + def.orbitSpeedDeg * dt) % 360;
    while (rt.hitCooldowns.length < count) rt.hitCooldowns.push(0);

    for (let i = 0; i < count; i++) {
      rt.hitCooldowns[i] -= dt;
      const angleRad = ((rt.angle + (360 / count) * i) * Math.PI) / 180;
      const hx = playerPos.x + Math.cos(angleRad) * def.orbitRadius;
      const hy = playerPos.y + Math.sin(angleRad) * def.orbitRadius;
      if (rt.hitCooldowns[i] > 0) continue;
      const hit = Game.Enemies.getActive().find(function (enemy) {
        return Game.Utils.distance(hx, hy, enemy.x, enemy.y) <= enemy.radius + 10;
      });
      if (hit) {
        Game.Enemies.applyDamage(hit, dmg);
        rt.hitCooldowns[i] = def.hitCooldown;
      }
    }
  }

  function updateAoePulse(dt, now, playerPos) {
    const w = get('cursedCathedral');
    if (!w) return;
    const rt = runtime.cursedCathedral;
    const def = DEFS.cursedCathedral;

    if (rt.telegraphRemaining !== undefined) {
      rt.telegraphRemaining -= dt;
      if (rt.telegraphRemaining <= 0) {
        const dmg = damageAt('cursedCathedral', w.level) * Game.Player.damageMultiplier();
        const radius = cathedralRadiusAt(w.level);
        Game.Enemies.getActive().forEach(function (enemy) {
          if (Game.Utils.distance(rt.originX, rt.originY, enemy.x, enemy.y) <= radius + enemy.radius) {
            Game.Enemies.applyDamage(enemy, dmg);
          }
        });
        pulses.push({ x: rt.originX, y: rt.originY, radius: radius, age: 0, duration: def.pulseVisualSec });
        delete rt.telegraphRemaining;
        rt.cooldown = cooldownAt('cursedCathedral', w.level) * Game.Player.cooldownMultiplier();
      }
      return;
    }

    rt.cooldown -= dt;
    if (rt.cooldown > 0) return;
    rt.originX = playerPos.x;
    rt.originY = playerPos.y;
    rt.telegraphRemaining = def.telegraphSec;
  }

  function updateProjectiles(dt) {
    projectiles = projectiles.filter(function (p) {
      p.age += dt;
      if (p.age >= p.lifetime) return false;
      p.x += p.dirX * p.speed * dt;
      p.y += p.dirY * p.speed * dt;

      const hit = Game.Enemies.getActive().find(function (enemy) {
        return Game.Utils.distance(p.x, p.y, enemy.x, enemy.y) <= enemy.radius + 6;
      });
      if (hit) {
        Game.Enemies.applyDamage(hit, p.damage);
        if (p.pierce <= 0) return false;
        p.pierce -= 1;
      }
      return true;
    });

    pulses = pulses.filter(function (pulse) {
      pulse.age += dt;
      return pulse.age < pulse.duration;
    });
  }

  function update(dt, now, playerPos, facing) {
    if (hasEquipped('bladeAcolyte')) updateMeleeArc(dt, now, playerPos, facing);
    if (hasEquipped('shadowBlade')) updateHomingProjectileWeapon(dt, now, playerPos);
    if (hasEquipped('riftTurret')) updateTurret(dt, now, playerPos);
    if (hasEquipped('bloodHoundPack')) updateOrbit(dt, now, playerPos);
    if (hasEquipped('cursedCathedral')) updateAoePulse(dt, now, playerPos);
    updateProjectiles(dt);
  }

  function getProjectiles() {
    return projectiles;
  }

  function getPulses() {
    return pulses;
  }

  function getHoundPositions(playerPos) {
    const w = get('bloodHoundPack');
    if (!w) return [];
    const rt = runtime.bloodHoundPack;
    const def = DEFS.bloodHoundPack;
    const count = houndCountAt(w.level);
    const positions = [];
    for (let i = 0; i < count; i++) {
      const angleRad = ((rt.angle + (360 / count) * i) * Math.PI) / 180;
      positions.push({
        x: playerPos.x + Math.cos(angleRad) * def.orbitRadius,
        y: playerPos.y + Math.sin(angleRad) * def.orbitRadius
      });
    }
    return positions;
  }

  function getTurretPositions() {
    return runtime.riftTurret ? runtime.riftTurret.turrets : [];
  }

  return {
    DEFS: DEFS,
    WEAPON_IDS: WEAPON_IDS,
    MAX_EQUIPPED: MAX_EQUIPPED,
    damageAt: damageAt,
    cooldownAt: cooldownAt,
    arcAt: arcAt,
    pierceAt: pierceAt,
    turretRangeAt: turretRangeAt,
    houndCountAt: houndCountAt,
    cathedralRadiusAt: cathedralRadiusAt,
    get: get,
    hasEquipped: hasEquipped,
    getEquipped: getEquipped,
    equippedCount: equippedCount,
    canEquipMore: canEquipMore,
    addWeapon: addWeapon,
    levelUp: levelUp,
    startRun: startRun,
    update: update,
    getProjectiles: getProjectiles,
    getPulses: getPulses,
    getHoundPositions: getHoundPositions,
    getTurretPositions: getTurretPositions
  };
})();
