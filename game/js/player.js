window.Game = window.Game || {};

Game.Player = (function () {
  const BASE_HP = 100;
  const BASE_MOVE_SPEED = 180;
  const BASE_PICKUP_RADIUS = 60;
  const HIT_INVULN_SEC = 0.3;
  const MAX_PASSIVE_STACKS = 5;

  const PASSIVE_IDS = ['vitality', 'swiftBoots', 'bloodMagnet', 'momentum', 'quickening', 'essenceSense'];

  const PASSIVE_INFO = {
    vitality:     { name: 'Vitality',      icon: '❤', desc: '+20 max HP, +10 instant heal' },
    swiftBoots:   { name: 'Swift Boots',   icon: '👢', desc: '+8% move speed' },
    bloodMagnet:  { name: 'Blood Magnet',  icon: '🧲', desc: '+25% pickup radius' },
    momentum:     { name: 'Momentum',      icon: '🌀', desc: '+6% all weapon damage' },
    quickening:   { name: 'Quickening',    icon: '⏱', desc: '+5% attack speed, all weapons' },
    essenceSense: { name: 'Essence Sense', icon: '🔶', desc: '+15% essence shard drop chance' }
  };

  // Cosmetic only - no stat differences between characters, purely which colors/icon
  // draw the on-screen hunter in the arena. Canvas-drawn (cloak + body + blade), no
  // image assets, consistent with the rest of the game's zero-binary-asset approach.
  const CHARACTERS = [
    { id: 'bladeHunter', name: 'Blade Hunter', icon: '⚔', bodyColor: '#e8e6e3', cloakColor: '#3a1015', accentColor: '#ff2b4d' },
    { id: 'shadowRogue',  name: 'Shadow Rogue', icon: '🗡', bodyColor: '#2a2a35', cloakColor: '#12121a', accentColor: '#6a3df5' },
    { id: 'ironWarden',   name: 'Iron Warden',  icon: '🛡', bodyColor: '#cfcdd6', cloakColor: '#191922', accentColor: '#8a8790' },
    { id: 'emberWitch',   name: 'Ember Witch',  icon: '🔥', bodyColor: '#1a0f0f', cloakColor: '#3a1a05', accentColor: '#ffd23f' }
  ];

  let run = null;

  function createRunPlayer() {
    const maxHP = BASE_HP + Game.Camp.getMaxHPBonus();
    const passives = {};
    PASSIVE_IDS.forEach(function (id) { passives[id] = 0; });
    return {
      x: 0, y: 0,
      hp: maxHP,
      maxHP: maxHP,
      baseMoveSpeed: BASE_MOVE_SPEED * Game.Camp.getMoveSpeedMultiplier(),
      basePickupRadius: BASE_PICKUP_RADIUS * Game.Camp.getPickupRadiusMultiplier(),
      invulnUntil: 0,
      hitCloseCall: false,
      passives: passives
    };
  }

  function init(playerObj) {
    run = playerObj;
  }

  function get() {
    return run;
  }

  function moveSpeed() {
    return run.baseMoveSpeed * (1 + run.passives.swiftBoots * 0.08);
  }

  function pickupRadius() {
    return run.basePickupRadius * (1 + run.passives.bloodMagnet * 0.25);
  }

  function damageMultiplier() {
    return Game.Camp.getDamageMultiplier() * (1 + run.passives.momentum * 0.06);
  }

  // Multiplies directly into a weapon's cooldown (each Quickening stack -5%).
  function cooldownMultiplier() {
    return Math.pow(0.95, run.passives.quickening);
  }

  // Additive bonus to a monster's base essence-shard drop chance.
  function essenceDropBonus() {
    return run.passives.essenceSense * 0.15;
  }

  function canStackPassive(id) {
    return run.passives[id] < MAX_PASSIVE_STACKS;
  }

  function applyPassive(id) {
    if (run.passives[id] === undefined || !canStackPassive(id)) return false;
    run.passives[id] += 1;
    if (id === 'vitality') {
      run.maxHP += 20;
      run.hp = Math.min(run.maxHP, run.hp + 10);
    }
    return true;
  }

  // Returns true if the hit actually landed (false if still within invulnerability window).
  function takeDamage(amount, now) {
    if (now < run.invulnUntil) return false;
    run.hp = Math.max(0, run.hp - amount);
    run.invulnUntil = now + HIT_INVULN_SEC;
    if (run.hp > 0 && run.hp <= run.maxHP * 0.05) run.hitCloseCall = true;
    return true;
  }

  function isDead() {
    return run.hp <= 0;
  }

  function heal(amount) {
    run.hp = Math.min(run.maxHP, run.hp + amount);
  }

  function grantInvulnerability(seconds, now) {
    run.invulnUntil = Math.max(run.invulnUntil, now + seconds);
  }

  function getCharacter(id) {
    return CHARACTERS.find(function (c) { return c.id === id; }) || CHARACTERS[0];
  }

  function getSelectedCharacter() {
    return getCharacter(Game.State.data.selectedCharacter);
  }

  function selectCharacter(id) {
    if (!getCharacter(id)) return false;
    Game.State.data.selectedCharacter = id;
    return true;
  }

  return {
    BASE_HP: BASE_HP,
    BASE_MOVE_SPEED: BASE_MOVE_SPEED,
    BASE_PICKUP_RADIUS: BASE_PICKUP_RADIUS,
    MAX_PASSIVE_STACKS: MAX_PASSIVE_STACKS,
    PASSIVE_IDS: PASSIVE_IDS,
    PASSIVE_INFO: PASSIVE_INFO,
    CHARACTERS: CHARACTERS,
    getCharacter: getCharacter,
    getSelectedCharacter: getSelectedCharacter,
    selectCharacter: selectCharacter,
    createRunPlayer: createRunPlayer,
    init: init,
    get: get,
    moveSpeed: moveSpeed,
    pickupRadius: pickupRadius,
    damageMultiplier: damageMultiplier,
    cooldownMultiplier: cooldownMultiplier,
    essenceDropBonus: essenceDropBonus,
    canStackPassive: canStackPassive,
    applyPassive: applyPassive,
    takeDamage: takeDamage,
    isDead: isDead,
    heal: heal,
    grantInvulnerability: grantInvulnerability
  };

})();
