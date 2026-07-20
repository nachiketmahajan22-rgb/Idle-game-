window.Game = window.Game || {};

Game.Player = (function () {
  const BASE_HP = 100;
  const BASE_MOVE_SPEED = 180;
  const BASE_PICKUP_RADIUS = 60;
  const HIT_INVULN_SEC = 0.3;
  const MAX_PASSIVE_STACKS = 5;

  const PASSIVE_IDS = ['vitality', 'swiftBoots', 'bloodMagnet', 'momentum', 'quickening', 'essenceSense'];

  const PASSIVE_INFO = {
    vitality:     { name: 'Kavach Blessing', icon: '❤', desc: '+20 max HP, +10 instant heal' },
    swiftBoots:   { name: 'Ashwa Gati',      icon: '👢', desc: '+8% move speed' },
    bloodMagnet:  { name: "Scout's Eye",     icon: '🧲', desc: '+25% pickup radius' },
    momentum:     { name: 'Momentum',        icon: '🌀', desc: '+6% all weapon damage' },
    quickening:   { name: 'Quickening',      icon: '⏱', desc: '+5% attack speed, all weapons' },
    essenceSense: { name: 'Swarajya Sense',  icon: '🔶', desc: '+15% Hon drop chance' }
  };

  // Cosmetic only - no stat differences between the four historical companions.
  // Each has a hand-illustrated sprite (assets/characters/<id>.png) in proper
  // Maratha attire (pagadi turban, angarkha), drawn upright and flipped
  // horizontally to face left/right in the arena; accentColor still drives the
  // held blade's color and the Camp selection UI's highlight.
  const CHARACTERS = [
    { id: 'bladeHunter', name: 'Shivaji Maharaj',     icon: '👑', image: 'assets/characters/bladeHunter.png', accentColor: '#ff8c1a' },
    { id: 'shadowRogue',  name: 'Tanaji Malusare',     icon: '🦁', image: 'assets/characters/shadowRogue.png', accentColor: '#d1481f' },
    { id: 'ironWarden',   name: 'Bajiprabhu Deshpande', icon: '🛡', image: 'assets/characters/ironWarden.png', accentColor: '#4a6fa5' },
    { id: 'emberWitch',   name: 'Netaji Palkar',       icon: '🐎', image: 'assets/characters/emberWitch.png', accentColor: '#c9a227' }
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
