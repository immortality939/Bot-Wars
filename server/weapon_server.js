// =============================================================================
// weapon_server.js  —  ONLINE MODE copy of weapon.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// weapon.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
// =============================================================================

// category: "weapon" marks a weapon as lootable — it can be put in the
// storage grid inventory and can be dropped by an enemy bot when it dies
// (add its name to a bot's spawnItem list in bot.js, e.g. spawnItem:
// "shield,speedup,powerup,health,ak47"). spawnChance is that weapon's own
// independent drop-roll chance (0.5 = 50%), same system item.js already
// uses for spawnItem/spawnChance on regular pickups (see item.js).
//
// CONNECTED STATS — physicalDamage above already combines with the
// character's own physicalDamage at attack-time (see getAttackDamage() in
// character.js). Any of these other stats are also optional on a weapon
// entry (or an armor.js entry) — if set, character.js's
// combineEquipmentStats() adds it straight onto the matching character
// stat the moment the weapon is equipped, plain addition (e.g. hpRegen:
// 0.3 on a character already at hpRegen: 0.01 becomes 0.31):
//   magicalAttack, criticalChance, criticalDamage, mana, movementSpeed,
//   physicalDefense, magicalDefense, hpRegen, manaRegen,
//   vit, dex, int, pow (see character.js's applyAttributeBonus() for
//   what vit/dex/int/pow convert into).
// None of these are set on the entries below yet — add whichever ones a
// given weapon should grant.
const WEAPONS = {

  uzi: {
    name: "uzi",

    physicalDamage: 15,
    physicalDefense:5,
    // knockback: how far (world units) an enemy standing dead-center of
    // the blast gets shoved back. Falls off toward the edge of the old
    // AoE radius the same way damage does — see getAoeFalloff() in
    // game.js — so a bot right at the edge only gets a light shove, not
    // the full push.
    knockback: 12,
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",
    pow:0,
    category: "weapon",
    spawnChance: 1.0,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "a rapid fire gun with a very light damage and small capacity of magazine",
  },


  ak47: {
    name: "ak47",

    physicalDamage: 15,

    knockback: 18,
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  sniper: {
    name: "sniper",

    physicalDamage: 40,

    knockback: 30,
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  shotgun: {
    name: "shotgun",

    physicalDamage: 600,

    knockback: 35,
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    pellets: 5,

    spread: 0.25,

    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  }

};



function getWeapon(name) {

  return WEAPONS[name] || null;

}



function getAllWeapons() {

  return Object.values(WEAPONS);

}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    WEAPONS,
    getWeapon,
    getAllWeapons
  };

}

// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { WEAPONS };
