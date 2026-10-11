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
// REQUIRED STAT — optional, same field armor entries can carry. If an entry
// has  requiredStat: "pow=20"  (stat=amount, only pow / int / dex), the player's own
// stat must be at least that to equip it. Without the field, an item that an enemy
// DROPS still gets one automatically: the stat comes from its requiredType
// (berserker = pow, magemaster = int, bullwark = dex) and the amount is the
// enemy's level x 4 (level 10 = 40 ... level 50 = 200). The ONLINE numbers and the
// helper functions (parseRequiredStat / rollRequiredStat) are in armor_server.js.
const WEAPONS = {

  uzi: {
    name: "uzi",
    category: "weapon",
    physicalDamage:6,
    spawnChance: 0.025,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "a rapid fire gun with a very light damage and small capacity of magazine",
  },


  ak47: {
    name: "ak47",
    category: "weapon",
    physicalDamage:10,
    spawnChance: 0.025,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  sniper: {
    name: "sniper",
    category: "weapon",
    physicalDamage:14,
    spawnChance: 0.025,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  shotgun: {
    name: "shotgun",
    category: "weapon",
    spawnChance: 0.025,
    physicalDamage:16,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },

  sword1: {
    name: "Frostbite Edge",
    requiredType: "magemaster",
    image: "image/sword1.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 300000,    // ms — despawns if not looted within 30 sec
    description: "A cold-blue neon blade that hums with stored energy."
  },

  sword2: {
    name: "Magma Cleaver",
    requiredType: "magemaster",
    image: "image/sword2.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A molten blade that glows like a forge fire."
  },

  sword3: {
    name: "Void Reaper",
    requiredType: "magemaster",
    image: "image/sword3.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet blade forged from dark energy."
  },

  sword4: {
    name: "Solar Paladin",
    requiredType: "magemaster",
    image: "image/sword4.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A holy white-and-gold sword blessed by the sun."
  },

  sword5: {
    name: "Toxic Fang",
    requiredType: "magemaster",
    image: "image/sword5.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A venom-green blade that drips with acid."
  },

  sword6: {
    name: "Glacier Shard",
    requiredType: "magemaster",
    image: "image/sword6.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sword carved from a single sheet of living ice."
  },

  sword7: {
    name: "Ember Rustblade",
    requiredType: "magemaster",
    image: "image/sword7.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A scorched old blade with embers still burning inside."
  },

  sword8: {
    name: "Nightwing Slicer",
    requiredType: "magemaster",
    image: "image/sword8.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A winged purple blade that cuts silently in the dark."
  },

  sword9: {
    name: "Crimson Sawfang",
    requiredType: "magemaster",
    image: "image/sword9.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A saw-toothed red blade built to rip armor apart."
  },

  sword10: {
    name: "Azure Pulse",
    requiredType: "magemaster",
    image: "image/sword10.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sleek blue blade that pulses with every swing."
  },

  sword11: {
    name: "Bloodthorn",
    requiredType: "magemaster",
    image: "image/sword11.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 25,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A jagged dark-red sword covered in cruel thorns."
  },

  sword12: {
    name: "Golden Sentinel",
    requiredType: "magemaster",
    image: "image/sword12.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A gleaming golden sword made for a royal guard."
  },

  sword13: {
    name: "Deepsea Warden",
    requiredType: "magemaster",
    image: "image/sword13.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark steel sword lit by cold ocean light."
  },

  sword14: {
    name: "Amethyst Spire",
    requiredType: "magemaster",
    image: "image/sword14.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A crystal-spiked blade that sparkles with purple light."
  },

  sword15: {
    name: "Viper Thornblade",
    requiredType: "magemaster",
    image: "image/sword15.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green spiked sword that strikes like a snake."
  },

  sword16: {
    name: "Rose Nova",
    requiredType: "magemaster",
    image: "image/sword16.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A bright pink blade charged with star energy."
  },

  sword17: {
    name: "Obsidian Ruin",
    requiredType: "magemaster",
    image: "image/sword17.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy black-and-red sword that hits like a falling wall."
  },

  sword18: {
    name: "Stormcrest Lance",
    requiredType: "magemaster",
    image: "image/sword18.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 22,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-gold blade crackling with storm light."
  },

  sword19: {
    name: "Lavacore Slayer",
    requiredType: "magemaster",
    image: "image/sword19.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cracked black blade with lava running through it."
  },

  sword20: {
    name: "Twilight Silverfang",
    requiredType: "magemaster",
    image: "image/sword20.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet-and-silver blade that shines at dusk."
  },

  sword21: {
    name: "Arcane Sovereign Blade",
    requiredType: "magemaster",
    image: "image/sword21.png",
    category: "weapon",
    magicalAttack: 40,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 400,
    mana: 20,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.01,
    criticalChance: 0.01,
    pow: 20,
    int: 20,
    dex: 20,
    vit: 20,
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A radiant blade wrapped in violet runes that amplifies the magic of its wielder."
  },

  extremegauntlet: {
    name: "Extreme Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet15.png",
    category: "weapon",
    physicalDamage:200,
    physicalDefense:30,
    magicalAttack:200,
    magicalDefense:30,
    health:1500,
    mana:100,
    hpRegen:0.1,
    manaRegen:0.1,
    criticalDamage:0.3,
    criticalChance:0.25,
    pow:70,
    vit:70,
    dex:70,
    int:70,
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue-and-white glove that channels cold magic."
  },

  gauntlet1: {
    name: "Frostweave Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet1.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue-and-white glove that channels cold magic."
  },

  gauntlet2: {
    name: "Hellfire Fist",
    requiredType: "bullwark",
    image: "image/gauntlet2.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black-and-red gauntlet burning with dark flame."
  },

  gauntlet3: {
    name: "Sunforge Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet3.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A golden glove that glows with warm power."
  },

  gauntlet4: {
    name: "Voidtouch Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet4.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple gauntlet that bends dark magic around the fist."
  },

  gauntlet5: {
    name: "Tidecaller Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet5.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A steel-and-teal glove that gathers ocean energy."
  },

  gauntlet6: {
    name: "Magma Knuckle",
    requiredType: "bullwark",
    image: "image/gauntlet6.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cracked red gauntlet with molten magic inside."
  },

  gauntlet7: {
    name: "Crystal Wraith Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet7.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue glove with sharp crystal fins that amplify spells."
  },

  gauntlet8: {
    name: "Jungle Warden Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet8.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mossy green gauntlet full of wild magic."
  },

  gauntlet9: {
    name: "Nightbloom Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet9.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet gauntlet that grows stronger in the dark."
  },

  gauntlet10: {
    name: "Phoenix Talon Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet10.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-gold glove with fiery wings."
  },

  gauntlet11: {
    name: "Aurum Ironfist",
    requiredType: "bullwark",
    image: "image/gauntlet11.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black glove trimmed in gold and lit by a bright core."
  },

  gauntlet12: {
    name: "Scarlet Seraph Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet12.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 28,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-white gauntlet with a glowing core."
  },

  gauntlet13: {
    name: "Azure Core Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet13.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 26,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue steel glove with a bright mana core."
  },

  gauntlet14: {
    name: "Bronze Titan Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet14.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy brown gauntlet powered by an orange core."
  },

  gauntlet15: {
    name: "Moonshard Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet15.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple-and-white glove that shines like moonlight."
  },

  gauntlet16: {
    name: "Glacial Claw",
    requiredType: "bullwark",
    image: "image/gauntlet16.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black glove covered in icy cyan crystals."
  },

  gauntlet17: {
    name: "Sapphire Bastion Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet17.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 27,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A sturdy blue gauntlet with a steady glowing core."
  },

  gauntlet18: {
    name: "Bloodclaw Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet18.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark glove with long red claws."
  },

  gauntlet19: {
    name: "Emerald Pulse Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet19.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green-and-white glove that pulses with life energy."
  },

  gauntlet20: {
    name: "Dread Spike Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet20.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet gauntlet with long crystal spikes."
  },

  gauntlet21: {
    name: "Titan Bulwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet21.png",
    category: "weapon",
    physicalDamage: 40,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 400,
    mana: 20,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.01,
    criticalChance: 0.01,
    pow: 20,
    int: 20,
    dex: 20,
    vit: 20,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A massive reinforced gauntlet that turns every punch into a crushing blow."
  },

  gun1: {
    name: "Skyline Rifle",
    requiredType: "berserker",
    image: "image/gun1.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue-and-steel rifle with a steady glowing core."
  },

  gun2: {
    name: "Inferno Blaster",
    requiredType: "berserker",
    image: "image/gun2.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red blaster that glows like a furnace."
  },

  gun3: {
    name: "Frost Pulse Cannon",
    requiredType: "berserker",
    image: "image/gun3.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-blue cannon firing ice-cold energy."
  },

  gun4: {
    name: "Violet Phantom Gun",
    requiredType: "berserker",
    image: "image/gun4.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple energy gun that hums with dark power."
  },

  gun5: {
    name: "Venom Driver",
    requiredType: "berserker",
    image: "image/gun5.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A green military gun that fires toxic bolts."
  },

  gun6: {
    name: "Golden Hornet",
    requiredType: "berserker",
    image: "image/gun6.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A rugged yellow double-barrel built for heavy fire."
  },

  gun7: {
    name: "Cryo Lancer",
    requiredType: "berserker",
    image: "image/gun7.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A cyan-and-white rifle that freezes the air around it."
  },

  gun8: {
    name: "Crimson Razor Gun",
    requiredType: "berserker",
    image: "image/gun8.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 13,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A dark-red gun shaped like a blade of fire."
  },

  gun9: {
    name: "Cobalt Striker",
    requiredType: "berserker",
    image: "image/gun9.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue rifle with a powerful glowing barrel."
  },

  gun10: {
    name: "Ember Gatling",
    requiredType: "berserker",
    image: "image/gun10.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "An orange rotary gun that spits out a storm of shots."
  },

  gun11: {
    name: "Nebula Cannon",
    requiredType: "berserker",
    image: "image/gun11.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A purple cannon charged with deep-space energy."
  },

  gun12: {
    name: "Jungle Ranger",
    requiredType: "berserker",
    image: "image/gun12.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A camouflaged green rifle made for long fights."
  },

  gun13: {
    name: "Scarlet Lightning Gun",
    requiredType: "berserker",
    image: "image/gun13.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 17,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A red-and-white gun that crackles with energy."
  },

  gun14: {
    name: "Midnight Sniper",
    requiredType: "berserker",
    image: "image/gun14.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 14,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A slim blue rifle for precise shots."
  },

  gun15: {
    name: "Pink Supernova",
    requiredType: "berserker",
    image: "image/gun15.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A bright magenta blaster with a star-bright core."
  },

  gun16: {
    name: "Crystal Tempest Gun",
    requiredType: "berserker",
    image: "image/gun16.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blue crystal-finned gun that shines with frozen light."
  },

  gun17: {
    name: "Aurum Repeater",
    requiredType: "berserker",
    image: "image/gun17.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A black-and-gold rifle with a shining golden core."
  },

  gun18: {
    name: "Galactic Gun",
    requiredType: "berserker",
    image: "image/gun18.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A spiky purple gun from the edge of the galaxy."
  },

  gun19: {
    name: "Redline Twin Cannon",
    requiredType: "berserker",
    image: "image/gun19.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A heavy red twin-barrel cannon with huge firepower."
  },

  gun20: {
    name: "Starlight Railgun",
    requiredType: "berserker",
    image: "image/gun20.png",
    category: "weapon",
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-blue railgun that fires beams of light."
  },

  gun21: {
    name: "Crimson Fury Cannon",
    requiredType: "berserker",
    image: "image/gun21.png",
    category: "weapon",
    physicalDamage: 40,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 400,
    mana: 20,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.01,
    criticalChance: 0.01,
    pow: 20,
    int: 20,
    dex: 20,
    vit: 20,
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A blood-red cannon built for relentless firepower and reckless fighters."
  },

  // ---- SHOP WEAPON SETS (4 tiers x berserker gun / magemaster sword / bullwark gauntlet, +25% per tier) ----

  gun22: {
    name: "Vanguard Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun18.png",
    category: "weapon",
    physicalDamage: 100,
    physicalDefense: 20,
    magicalDefense: 20,
    health: 1000,
    mana: 50,
    hpRegen: 0.008,
    manaRegen: 0.008,
    criticalDamage: 0.021,
    criticalChance: 0.016,
    pow: 30,
    int: 30,
    dex: 30,
    vit: 30,
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for berserkers: raw physical damage with solid defense."
  },

  gun22a: {
    name: "Vanguard Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun18.png",
    category: "weapon",
    physicalDamage: 50,
    physicalDefense: 10,
    magicalDefense: 10,
    health: 500,
    mana: 25,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.0105,
    criticalChance: 0.008,
    pow: 15,
    int: 15,
    dex: 15,
    vit: 15,
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for berserkers: raw physical damage with solid defense."
  },

  sword22: {
    name: "Vanguard Mage Blade",
    requiredType: "magemaster",
    image: "image/sword18.png",
    category: "weapon",
    magicalAttack: 100,
    physicalDefense: 20,
    magicalDefense: 20,
    health: 1000,
    mana: 50,
    hpRegen: 0.008,
    manaRegen: 0.008,
    criticalDamage: 0.021,
    criticalChance: 0.016,
    pow: 30,
    int: 30,
    dex: 30,
    vit: 30,
    spawnChance: 0.025,
    width: 30,
    height: 22,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for mage masters: boosts magical attack and mana."
  },

  sword22a: {
    name: "Vanguard Mage Blade",
    requiredType: "magemaster",
    image: "image/sword18.png",
    category: "weapon",
    magicalAttack: 50,
    physicalDefense: 10,
    magicalDefense: 10,
    health: 500,
    mana: 25,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.0105,
    criticalChance: 0.008,
    pow: 15,
    int: 15,
    dex: 15,
    vit: 15,
    spawnChance: 0.025,
    width: 30,
    height: 22,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for mage masters: boosts magical attack and mana."
  },

  gauntlet22: {
    name: "Vanguard Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet18.png",
    category: "weapon",
    physicalDamage: 100,
    physicalDefense: 20,
    magicalDefense: 20,
    health: 1000,
    mana: 50,
    hpRegen: 0.008,
    manaRegen: 0.008,
    criticalDamage: 0.021,
    criticalChance: 0.016,
    pow: 30,
    int: 30,
    dex: 30,
    vit: 30,
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gauntlet22a: {
    name: "Vanguard Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet18.png",
    category: "weapon",
    physicalDamage: 50,
    physicalDefense: 10,
    magicalDefense: 10,
    health: 500,
    mana: 25,
    hpRegen: 0.004,
    manaRegen: 0.004,
    criticalDamage: 0.0105,
    criticalChance: 0.008,
    pow: 15,
    int: 15,
    dex: 15,
    vit: 15,
    spawnChance: 0.025,
    width: 30,
    height: 29,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A well balanced and strong weapon to start with. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gun23: {
    name: "Elite Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun19.png",
    category: "weapon",
    physicalDamage: 125,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 1250,
    mana: 62.5,
    hpRegen: 0.01,
    manaRegen: 0.01,
    criticalDamage: 0.02625,
    criticalChance: 0.02,
    pow: 37.5,
    int: 37.5,
    dex: 37.5,
    vit: 37.5,
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  gun23a: {
    name: "Elite Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun19.png",
    category: "weapon",
    physicalDamage: 62.5,
    physicalDefense: 12.5,
    magicalDefense: 12.5,
    health: 625,
    mana: 31.25,
    hpRegen: 0.005,
    manaRegen: 0.005,
    criticalDamage: 0.013125,
    criticalChance: 0.01,
    pow: 18.75,
    int: 18.75,
    dex: 18.75,
    vit: 18.75,
    spawnChance: 0.025,
    width: 30,
    height: 16,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  sword23: {
    name: "Elite Mage Blade",
    requiredType: "magemaster",
    image: "image/sword19.png",
    category: "weapon",
    magicalAttack: 125,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 1250,
    mana: 62.5,
    hpRegen: 0.01,
    manaRegen: 0.01,
    criticalDamage: 0.02625,
    criticalChance: 0.02,
    pow: 37.5,
    int: 37.5,
    dex: 37.5,
    vit: 37.5,
    spawnChance: 0.025,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  sword23a: {
    name: "Elite Mage Blade",
    requiredType: "magemaster",
    image: "image/sword19.png",
    category: "weapon",
    magicalAttack: 62.5,
    physicalDefense: 12.5,
    magicalDefense: 12.5,
    health: 625,
    mana: 31.25,
    hpRegen: 0.005,
    manaRegen: 0.005,
    criticalDamage: 0.013125,
    criticalChance: 0.01,
    pow: 18.75,
    int: 18.75,
    dex: 18.75,
    vit: 18.75,
    spawnChance: 0.025,
    width: 30,
    height: 24,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  gauntlet23: {
    name: "Elite Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet19.png",
    category: "weapon",
    physicalDamage: 125,
    physicalDefense: 25,
    magicalDefense: 25,
    health: 1250,
    mana: 62.5,
    hpRegen: 0.01,
    manaRegen: 0.01,
    criticalDamage: 0.02625,
    criticalChance: 0.02,
    pow: 37.5,
    int: 37.5,
    dex: 37.5,
    vit: 37.5,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gauntlet23a: {
    name: "Elite Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet19.png",
    category: "weapon",
    physicalDamage: 62.5,
    physicalDefense: 12.5,
    magicalDefense: 12.5,
    health: 625,
    mana: 31.25,
    hpRegen: 0.005,
    manaRegen: 0.005,
    criticalDamage: 0.013125,
    criticalChance: 0.01,
    pow: 18.75,
    int: 18.75,
    dex: 18.75,
    vit: 18.75,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A stronger weapon: 25% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gun24: {
    name: "Mythic Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun20.png",
    category: "weapon",
    physicalDamage: 150,
    physicalDefense: 30,
    magicalDefense: 30,
    health: 1500,
    mana: 75,
    hpRegen: 0.012,
    manaRegen: 0.012,
    criticalDamage: 0.0315,
    criticalChance: 0.024,
    pow: 45,
    int: 45,
    dex: 45,
    vit: 45,
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  gun24a: {
    name: "Mythic Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun20.png",
    category: "weapon",
    physicalDamage: 75,
    physicalDefense: 15,
    magicalDefense: 15,
    health: 750,
    mana: 37.5,
    hpRegen: 0.006,
    manaRegen: 0.006,
    criticalDamage: 0.01575,
    criticalChance: 0.012,
    pow: 22.5,
    int: 22.5,
    dex: 22.5,
    vit: 22.5,
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  sword24: {
    name: "Mythic Mage Blade",
    requiredType: "magemaster",
    image: "image/sword20.png",
    category: "weapon",
    magicalAttack: 150,
    physicalDefense: 30,
    magicalDefense: 30,
    health: 1500,
    mana: 75,
    hpRegen: 0.012,
    manaRegen: 0.012,
    criticalDamage: 0.0315,
    criticalChance: 0.024,
    pow: 45,
    int: 45,
    dex: 45,
    vit: 45,
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  sword24a: {
    name: "Mythic Mage Blade",
    requiredType: "magemaster",
    image: "image/sword20.png",
    category: "weapon",
    magicalAttack: 75,
    physicalDefense: 15,
    magicalDefense: 15,
    health: 750,
    mana: 37.5,
    hpRegen: 0.006,
    manaRegen: 0.006,
    criticalDamage: 0.01575,
    criticalChance: 0.012,
    pow: 22.5,
    int: 22.5,
    dex: 22.5,
    vit: 22.5,
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  gauntlet24: {
    name: "Mythic Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet20.png",
    category: "weapon",
    physicalDamage: 150,
    physicalDefense: 30,
    magicalDefense: 30,
    health: 1500,
    mana: 75,
    hpRegen: 0.012,
    manaRegen: 0.012,
    criticalDamage: 0.0315,
    criticalChance: 0.024,
    pow: 45,
    int: 45,
    dex: 45,
    vit: 45,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gauntlet24a: {
    name: "Mythic Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet20.png",
    category: "weapon",
    physicalDamage: 75,
    physicalDefense: 15,
    magicalDefense: 15,
    health: 750,
    mana: 37.5,
    hpRegen: 0.006,
    manaRegen: 0.006,
    criticalDamage: 0.01575,
    criticalChance: 0.012,
    pow: 22.5,
    int: 22.5,
    dex: 22.5,
    vit: 22.5,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A mythic-grade weapon: 50% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gun25: {
    name: "Extreme Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun21.png",
    category: "weapon",
    physicalDamage: 175,
    physicalDefense: 35,
    magicalDefense: 35,
    health: 1750,
    mana: 87.5,
    hpRegen: 0.014,
    manaRegen: 0.014,
    criticalDamage: 0.03675,
    criticalChance: 0.028,
    pow: 52.5,
    int: 52.5,
    dex: 52.5,
    vit: 52.5,
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  gun25a: {
    name: "Extreme Berserker Rifle",
    requiredType: "berserker",
    image: "image/gun21.png",
    category: "weapon",
    physicalDamage: 87.5,
    physicalDefense: 17.5,
    magicalDefense: 17.5,
    health: 875,
    mana: 43.75,
    hpRegen: 0.007,
    manaRegen: 0.007,
    criticalDamage: 0.018375,
    criticalChance: 0.014,
    pow: 26.25,
    int: 26.25,
    dex: 26.25,
    vit: 26.25,
    spawnChance: 0.025,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for berserkers: raw physical damage with solid defense."
  },

  sword25: {
    name: "Extreme Mage Blade",
    requiredType: "magemaster",
    image: "image/sword21.png",
    category: "weapon",
    magicalAttack: 175,
    physicalDefense: 35,
    magicalDefense: 35,
    health: 1750,
    mana: 87.5,
    hpRegen: 0.014,
    manaRegen: 0.014,
    criticalDamage: 0.03675,
    criticalChance: 0.028,
    pow: 52.5,
    int: 52.5,
    dex: 52.5,
    vit: 52.5,
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  sword25a: {
    name: "Extreme Mage Blade",
    requiredType: "magemaster",
    image: "image/sword21.png",
    category: "weapon",
    magicalAttack: 87.5,
    physicalDefense: 17.5,
    magicalDefense: 17.5,
    health: 875,
    mana: 43.75,
    hpRegen: 0.007,
    manaRegen: 0.007,
    criticalDamage: 0.018375,
    criticalChance: 0.014,
    pow: 26.25,
    int: 26.25,
    dex: 26.25,
    vit: 26.25,
    spawnChance: 0.025,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for mage masters: boosts magical attack and mana."
  },

  gauntlet25: {
    name: "Extreme Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet21.png",
    category: "weapon",
    physicalDamage: 175,
    physicalDefense: 35,
    magicalDefense: 35,
    health: 1750,
    mana: 87.5,
    hpRegen: 0.014,
    manaRegen: 0.014,
    criticalDamage: 0.03675,
    criticalChance: 0.028,
    pow: 52.5,
    int: 52.5,
    dex: 52.5,
    vit: 52.5,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

  gauntlet25a: {
    name: "Extreme Bullwark Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet21.png",
    category: "weapon",
    physicalDamage: 87.5,
    physicalDefense: 17.5,
    magicalDefense: 17.5,
    health: 875,
    mana: 43.75,
    hpRegen: 0.007,
    manaRegen: 0.007,
    criticalDamage: 0.018375,
    criticalChance: 0.014,
    pow: 26.25,
    int: 26.25,
    dex: 26.25,
    vit: 26.25,
    spawnChance: 0.025,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "The strongest weapon of the shop sets: 75% more power than the Vanguard set. Built for bullwarks: heavy defense and health to outlast everyone."
  },

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
