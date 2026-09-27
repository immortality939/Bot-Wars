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
    physicalDamage: 12,
    category: "weapon",
    spawnChance: 1.0,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "a rapid fire gun with a very light damage and small capacity of magazine",
  },


  ak47: {
    name: "ak47",
    physicalDamage: 8,
    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  sniper: {
    name: "sniper",
    physicalDamage: 15,
    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  shotgun: {
    name: "shotgun",
    physicalDamage: 8,
    category: "weapon",
    spawnChance: 0.5,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },

  dexsword1: {
    name: "dexsword1",
    image: "image/dexsword1.png",
    physicalDamage: 9,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword2: {
    name: "dexsword2",
    image: "image/dexsword2.png",
    physicalDamage: 10,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword3: {
    name: "dexsword3",
    image: "image/dexsword3.png",
    physicalDamage: 11,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword4: {
    name: "dexsword4",
    image: "image/dexsword4.png",
    physicalDamage: 12,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword5: {
    name: "dexsword5",
    image: "image/dexsword5.png",
    physicalDamage: 13,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword6: {
    name: "dexsword6",
    image: "image/dexsword6.png",
    physicalDamage: 14,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword7: {
    name: "dexsword7",
    image: "image/dexsword7.png",
    physicalDamage: 15,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword8: {
    name: "dexsword8",
    image: "image/dexsword8.png",
    physicalDamage: 16,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword9: {
    name: "dexsword9",
    image: "image/dexsword9.png",
    physicalDamage: 17,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword10: {
    name: "dexsword10",
    image: "image/dexsword10.png",
    physicalDamage: 18,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword11: {
    name: "dexsword11",
    image: "image/dexsword11.png",
    physicalDamage: 19,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword12: {
    name: "dexsword12",
    image: "image/dexsword12.png",
    physicalDamage: 20,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword13: {
    name: "dexsword13",
    image: "image/dexsword13.png",
    physicalDamage: 21,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword14: {
    name: "dexsword14",
    image: "image/dexsword14.png",
    physicalDamage: 22,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword15: {
    name: "dexsword15",
    image: "image/dexsword15.png",
    physicalDamage: 23,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword16: {
    name: "dexsword16",
    image: "image/dexsword16.png",
    physicalDamage: 24,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword17: {
    name: "dexsword17",
    image: "image/dexsword17.png",
    physicalDamage: 25,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword18: {
    name: "dexsword18",
    image: "image/dexsword18.png",
    physicalDamage: 26,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword19: {
    name: "dexsword19",
    image: "image/dexsword19.png",
    physicalDamage: 27,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  dexsword20: {
    name: "dexsword20",
    image: "image/dexsword20.png",
    physicalDamage: 28,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dexterity-focused blade — grants bonus dex while equipped."
  },

  intsword1: {
    name: "intsword1",
    image: "image/intsword1.png",
    physicalDamage: 8,
    int: 3,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword2: {
    name: "intsword2",
    image: "image/intsword2.png",
    physicalDamage: 9,
    int: 4,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword3: {
    name: "intsword3",
    image: "image/intsword3.png",
    physicalDamage: 10,
    int: 5,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword4: {
    name: "intsword4",
    image: "image/intsword4.png",
    physicalDamage: 11,
    int: 6,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword5: {
    name: "intsword5",
    image: "image/intsword5.png",
    physicalDamage: 12,
    int: 2,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword6: {
    name: "intsword6",
    image: "image/intsword6.png",
    physicalDamage: 13,
    int: 3,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword7: {
    name: "intsword7",
    image: "image/intsword7.png",
    physicalDamage: 14,
    int: 4,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword8: {
    name: "intsword8",
    image: "image/intsword8.png",
    physicalDamage: 15,
    int: 5,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword9: {
    name: "intsword9",
    image: "image/intsword9.png",
    physicalDamage: 16,
    int: 6,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword10: {
    name: "intsword10",
    image: "image/intsword10.png",
    physicalDamage: 17,
    int: 2,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword11: {
    name: "intsword11",
    image: "image/intsword11.png",
    physicalDamage: 18,
    int: 3,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword12: {
    name: "intsword12",
    image: "image/intsword12.png",
    physicalDamage: 19,
    int: 4,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword13: {
    name: "intsword13",
    image: "image/intsword13.png",
    physicalDamage: 20,
    int: 5,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword14: {
    name: "intsword14",
    image: "image/intsword14.png",
    physicalDamage: 21,
    int: 6,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword15: {
    name: "intsword15",
    image: "image/intsword15.png",
    physicalDamage: 22,
    int: 2,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword16: {
    name: "intsword16",
    image: "image/intsword16.png",
    physicalDamage: 23,
    int: 3,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword17: {
    name: "intsword17",
    image: "image/intsword17.png",
    physicalDamage: 24,
    int: 4,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword18: {
    name: "intsword18",
    image: "image/intsword18.png",
    physicalDamage: 25,
    int: 5,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword19: {
    name: "intsword19",
    image: "image/intsword19.png",
    physicalDamage: 26,
    int: 6,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  intsword20: {
    name: "intsword20",
    image: "image/intsword20.png",
    physicalDamage: 27,
    int: 2,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An intellect-focused blade — grants bonus int and magical attack while equipped."
  },

  powsword1: {
    name: "WrathBlade",
    image: "image/powsword1.png",
    physicalDamage: 11,
    pow: 3,
    category: "weapon",
    spawnChance: 1.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword2: {
    name: "powsword2",
    image: "image/powsword2.png",
    physicalDamage: 12,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword3: {
    name: "powsword3",
    image: "image/powsword3.png",
    physicalDamage: 13,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword4: {
    name: "powsword4",
    image: "image/powsword4.png",
    physicalDamage: 14,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword5: {
    name: "powsword5",
    image: "image/powsword5.png",
    physicalDamage: 15,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword6: {
    name: "powsword6",
    image: "image/powsword6.png",
    physicalDamage: 16,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword7: {
    name: "powsword7",
    image: "image/powsword7.png",
    physicalDamage: 17,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword8: {
    name: "powsword8",
    image: "image/powsword8.png",
    physicalDamage: 18,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword9: {
    name: "powsword9",
    image: "image/powsword9.png",
    physicalDamage: 19,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword10: {
    name: "powsword10",
    image: "image/powsword10.png",
    physicalDamage: 20,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword11: {
    name: "powsword11",
    image: "image/powsword11.png",
    physicalDamage: 21,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword12: {
    name: "powsword12",
    image: "image/powsword12.png",
    physicalDamage: 22,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword13: {
    name: "powsword13",
    image: "image/powsword13.png",
    physicalDamage: 23,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword14: {
    name: "powsword14",
    image: "image/powsword14.png",
    physicalDamage: 24,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword15: {
    name: "powsword15",
    image: "image/powsword15.png",
    physicalDamage: 25,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword16: {
    name: "powsword16",
    image: "image/powsword16.png",
    physicalDamage: 26,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword17: {
    name: "powsword17",
    image: "image/powsword17.png",
    physicalDamage: 27,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword18: {
    name: "powsword18",
    image: "image/powsword18.png",
    physicalDamage: 28,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword19: {
    name: "powsword19",
    image: "image/powsword19.png",
    physicalDamage: 29,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  },

  powsword20: {
    name: "powsword20",
    image: "image/powsword20.png",
    physicalDamage: 30,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A power-focused blade — grants bonus pow and physical damage while equipped."
  }

};



function getWeapon(name) {

  return WEAPONS[name] || null;

}



function getAllWeapons() {

  return Object.values(WEAPONS);

}



// ---------------------------------------------------------------------------
// IMAGE SIZE — width/height get copied onto each entry here so the rest of
// the server code can just read weaponDef.width/weaponDef.height like any
// other field, but the actual hardcoded pixel numbers live in
// game_server.js's WEAPON_IMAGE_SIZES (see the comment there for why) —
// nothing is hardcoded in THIS file. A weapon with no entry there (uzi,
// ak47, sniper, shotgun — no real sprite file to measure yet) just doesn't
// get a width/height added; getWeaponImageSize() returns null for those.
// ---------------------------------------------------------------------------
const { getWeaponImageSize } = require("./game_server.js");

Object.values(WEAPONS).forEach((def) => {
  const size = getWeaponImageSize(def.name);
  if (size) {
    def.width = size.width;
    def.height = size.height;
  }
});



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    WEAPONS,
    getWeapon,
    getAllWeapons
  };

}

// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { WEAPONS };
