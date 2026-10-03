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
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "a rapid fire gun with a very light damage and small capacity of magazine",
  },


  ak47: {
    name: "ak47",
    physicalDamage: 8,
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  sniper: {
    name: "sniper",
    physicalDamage: 15,
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  shotgun: {
    name: "shotgun",
    physicalDamage: 8,
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },

  sword1: {
    name: "Frostbite Edge",
    image: "image/sword1.png",
    physicalDamage: 9,
    dex: 3,
    category: "weapon",
    spawnChance: 1.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cold-blue neon blade that hums with stored energy. Boosts Physical Damage and Dexterity while equipped."
  },

  sword2: {
    name: "Magma Cleaver",
    image: "image/sword2.png",
    physicalDamage: 10,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A molten blade that glows like a forge fire. Boosts Physical Damage and Dexterity while equipped."
  },

  sword3: {
    name: "Void Reaper",
    image: "image/sword3.png",
    physicalDamage: 11,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet blade forged from dark energy. Boosts Physical Damage and Dexterity while equipped."
  },

  sword4: {
    name: "Solar Paladin",
    image: "image/sword4.png",
    physicalDamage: 12,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A holy white-and-gold sword blessed by the sun. Boosts Physical Damage and Dexterity while equipped."
  },

  sword5: {
    name: "Toxic Fang",
    image: "image/sword5.png",
    physicalDamage: 13,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A venom-green blade that drips with acid. Boosts Physical Damage and Dexterity while equipped."
  },

  sword6: {
    name: "Glacier Shard",
    image: "image/sword6.png",
    physicalDamage: 14,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sword carved from a single sheet of living ice. Boosts Physical Damage and Dexterity while equipped."
  },

  sword7: {
    name: "Ember Rustblade",
    image: "image/sword7.png",
    physicalDamage: 15,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A scorched old blade with embers still burning inside. Boosts Physical Damage and Dexterity while equipped."
  },

  sword8: {
    name: "Nightwing Slicer",
    image: "image/sword8.png",
    physicalDamage: 16,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A winged purple blade that cuts silently in the dark. Boosts Physical Damage and Dexterity while equipped."
  },

  sword9: {
    name: "Crimson Sawfang",
    image: "image/sword9.png",
    physicalDamage: 17,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A saw-toothed red blade built to rip armor apart. Boosts Physical Damage and Dexterity while equipped."
  },

  sword10: {
    name: "Azure Pulse",
    image: "image/sword10.png",
    physicalDamage: 18,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sleek blue blade that pulses with every swing. Boosts Physical Damage and Dexterity while equipped."
  },

  sword11: {
    name: "Bloodthorn",
    image: "image/sword11.png",
    physicalDamage: 19,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A jagged dark-red sword covered in cruel thorns. Boosts Physical Damage and Dexterity while equipped."
  },

  sword12: {
    name: "Golden Sentinel",
    image: "image/sword12.png",
    physicalDamage: 20,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A gleaming golden sword made for a royal guard. Boosts Physical Damage and Dexterity while equipped."
  },

  sword13: {
    name: "Deepsea Warden",
    image: "image/sword13.png",
    physicalDamage: 21,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark steel sword lit by cold ocean light. Boosts Physical Damage and Dexterity while equipped."
  },

  sword14: {
    name: "Amethyst Spire",
    image: "image/sword14.png",
    physicalDamage: 22,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A crystal-spiked blade that sparkles with purple light. Boosts Physical Damage and Dexterity while equipped."
  },

  sword15: {
    name: "Viper Thornblade",
    image: "image/sword15.png",
    physicalDamage: 23,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green spiked sword that strikes like a snake. Boosts Physical Damage and Dexterity while equipped."
  },

  sword16: {
    name: "Rose Nova",
    image: "image/sword16.png",
    physicalDamage: 24,
    dex: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A bright pink blade charged with star energy. Boosts Physical Damage and Dexterity while equipped."
  },

  sword17: {
    name: "Obsidian Ruin",
    image: "image/sword17.png",
    physicalDamage: 25,
    dex: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy black-and-red sword that hits like a falling wall. Boosts Physical Damage and Dexterity while equipped."
  },

  sword18: {
    name: "Stormcrest Lance",
    image: "image/sword18.png",
    physicalDamage: 26,
    dex: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 22,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-gold blade crackling with storm light. Boosts Physical Damage and Dexterity while equipped."
  },

  sword19: {
    name: "Lavacore Slayer",
    image: "image/sword19.png",
    physicalDamage: 27,
    dex: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cracked black blade with lava running through it. Boosts Physical Damage and Dexterity while equipped."
  },

  sword20: {
    name: "Twilight Silverfang",
    image: "image/sword20.png",
    physicalDamage: 28,
    dex: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet-and-silver blade that shines at dusk. Boosts Physical Damage and Dexterity while equipped."
  },

  gauntlet1: {
    name: "Frostweave Gauntlet",
    image: "image/gauntlet1.png",
    physicalDamage: 8,
    int: 3,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue-and-white glove that channels cold magic. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet2: {
    name: "Hellfire Fist",
    image: "image/gauntlet2.png",
    physicalDamage: 9,
    int: 4,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black-and-red gauntlet burning with dark flame. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet3: {
    name: "Sunforge Gauntlet",
    image: "image/gauntlet3.png",
    physicalDamage: 10,
    int: 5,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A golden glove that glows with warm power. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet4: {
    name: "Voidtouch Gauntlet",
    image: "image/gauntlet4.png",
    physicalDamage: 11,
    int: 6,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple gauntlet that bends dark magic around the fist. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet5: {
    name: "Tidecaller Gauntlet",
    image: "image/gauntlet5.png",
    physicalDamage: 12,
    int: 2,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A steel-and-teal glove that gathers ocean energy. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet6: {
    name: "Magma Knuckle",
    image: "image/gauntlet6.png",
    physicalDamage: 13,
    int: 3,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cracked red gauntlet with molten magic inside. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet7: {
    name: "Crystal Wraith Gauntlet",
    image: "image/gauntlet7.png",
    physicalDamage: 14,
    int: 4,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue glove with sharp crystal fins that amplify spells. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet8: {
    name: "Jungle Warden Gauntlet",
    image: "image/gauntlet8.png",
    physicalDamage: 15,
    int: 5,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mossy green gauntlet full of wild magic. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet9: {
    name: "Nightbloom Gauntlet",
    image: "image/gauntlet9.png",
    physicalDamage: 16,
    int: 6,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet gauntlet that grows stronger in the dark. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet10: {
    name: "Phoenix Talon Gauntlet",
    image: "image/gauntlet10.png",
    physicalDamage: 17,
    int: 2,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-gold glove with fiery wings. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet11: {
    name: "Aurum Ironfist",
    image: "image/gauntlet11.png",
    physicalDamage: 18,
    int: 3,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black glove trimmed in gold and lit by a bright core. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet12: {
    name: "Scarlet Seraph Gauntlet",
    image: "image/gauntlet12.png",
    physicalDamage: 19,
    int: 4,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-white gauntlet with a glowing core. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet13: {
    name: "Azure Core Gauntlet",
    image: "image/gauntlet13.png",
    physicalDamage: 20,
    int: 5,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue steel glove with a bright mana core. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet14: {
    name: "Bronze Titan Gauntlet",
    image: "image/gauntlet14.png",
    physicalDamage: 21,
    int: 6,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy brown gauntlet powered by an orange core. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet15: {
    name: "Moonshard Gauntlet",
    image: "image/gauntlet15.png",
    physicalDamage: 22,
    int: 2,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple-and-white glove that shines like moonlight. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet16: {
    name: "Glacial Claw",
    image: "image/gauntlet16.png",
    physicalDamage: 23,
    int: 3,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black glove covered in icy cyan crystals. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet17: {
    name: "Sapphire Bastion Gauntlet",
    image: "image/gauntlet17.png",
    physicalDamage: 24,
    int: 4,
    magicalAttack: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sturdy blue gauntlet with a steady glowing core. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet18: {
    name: "Bloodclaw Gauntlet",
    image: "image/gauntlet18.png",
    physicalDamage: 25,
    int: 5,
    magicalAttack: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark glove with long red claws. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet19: {
    name: "Emerald Pulse Gauntlet",
    image: "image/gauntlet19.png",
    physicalDamage: 26,
    int: 6,
    magicalAttack: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green-and-white glove that pulses with life energy. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gauntlet20: {
    name: "Dread Spike Gauntlet",
    image: "image/gauntlet20.png",
    physicalDamage: 27,
    int: 2,
    magicalAttack: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet gauntlet with long crystal spikes. Boosts Physical Damage, Intelligence and Magical Attack while equipped."
  },

  gun1: {
    name: "Skyline Rifle",
    image: "image/gun1.png",
    physicalDamage: 11,
    pow: 3,
    category: "weapon",
    spawnChance: 1.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue-and-steel rifle with a steady glowing core. Boosts Physical Damage and Power while equipped."
  },

  gun2: {
    name: "Inferno Blaster",
    image: "image/gun2.png",
    physicalDamage: 12,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red blaster that glows like a furnace. Boosts Physical Damage and Power while equipped."
  },

  gun3: {
    name: "Frost Pulse Cannon",
    image: "image/gun3.png",
    physicalDamage: 13,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-blue cannon firing ice-cold energy. Boosts Physical Damage and Power while equipped."
  },

  gun4: {
    name: "Violet Phantom Gun",
    image: "image/gun4.png",
    physicalDamage: 14,
    pow: 6,
    category: "weapon",
    spawnChance: 1.2,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple energy gun that hums with dark power. Boosts Physical Damage and Power while equipped."
  },

  gun5: {
    name: "Venom Driver",
    image: "image/gun5.png",
    physicalDamage: 15,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green military gun that fires toxic bolts. Boosts Physical Damage and Power while equipped."
  },

  gun6: {
    name: "Golden Hornet",
    image: "image/gun6.png",
    physicalDamage: 16,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A rugged yellow double-barrel built for heavy fire. Boosts Physical Damage and Power while equipped."
  },

  gun7: {
    name: "Cryo Lancer",
    image: "image/gun7.png",
    physicalDamage: 17,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cyan-and-white rifle that freezes the air around it. Boosts Physical Damage and Power while equipped."
  },

  gun8: {
    name: "Crimson Razor Gun",
    image: "image/gun8.png",
    physicalDamage: 18,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 13,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark-red gun shaped like a blade of fire. Boosts Physical Damage and Power while equipped."
  },

  gun9: {
    name: "Cobalt Striker",
    image: "image/gun9.png",
    physicalDamage: 19,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue rifle with a powerful glowing barrel. Boosts Physical Damage and Power while equipped."
  },

  gun10: {
    name: "Ember Gatling",
    image: "image/gun10.png",
    physicalDamage: 20,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An orange rotary gun that spits out a storm of shots. Boosts Physical Damage and Power while equipped."
  },

  gun11: {
    name: "Nebula Cannon",
    image: "image/gun11.png",
    physicalDamage: 21,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple cannon charged with deep-space energy. Boosts Physical Damage and Power while equipped."
  },

  gun12: {
    name: "Jungle Ranger",
    image: "image/gun12.png",
    physicalDamage: 22,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A camouflaged green rifle made for long fights. Boosts Physical Damage and Power while equipped."
  },

  gun13: {
    name: "Scarlet Lightning Gun",
    image: "image/gun13.png",
    physicalDamage: 23,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-white gun that crackles with energy. Boosts Physical Damage and Power while equipped."
  },

  gun14: {
    name: "Midnight Sniper",
    image: "image/gun14.png",
    physicalDamage: 24,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A slim blue rifle for precise shots. Boosts Physical Damage and Power while equipped."
  },

  gun15: {
    name: "Pink Supernova",
    image: "image/gun15.png",
    physicalDamage: 25,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A bright magenta blaster with a star-bright core. Boosts Physical Damage and Power while equipped."
  },

  gun16: {
    name: "Crystal Tempest Gun",
    image: "image/gun16.png",
    physicalDamage: 26,
    pow: 3,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue crystal-finned gun that shines with frozen light. Boosts Physical Damage and Power while equipped."
  },

  gun17: {
    name: "Aurum Repeater",
    image: "image/gun17.png",
    physicalDamage: 27,
    pow: 4,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black-and-gold rifle with a shining golden core. Boosts Physical Damage and Power while equipped."
  },

  gun18: {
    name: "Galactic Gun",
    image: "image/gun18.png",
    physicalDamage: 28,
    pow: 5,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A spiky purple gun from the edge of the galaxy. Boosts Physical Damage and Power while equipped."
  },

  gun19: {
    name: "Redline Twin Cannon",
    image: "image/gun19.png",
    physicalDamage: 29,
    pow: 6,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy red twin-barrel cannon with huge firepower. Boosts Physical Damage and Power while equipped."
  },

  gun20: {
    name: "Starlight Railgun",
    image: "image/gun20.png",
    physicalDamage: 30,
    pow: 2,
    category: "weapon",
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-blue railgun that fires beams of light. Boosts Physical Damage and Power while equipped."
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
