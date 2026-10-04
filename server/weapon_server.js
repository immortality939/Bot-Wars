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
    category: "weapon",
    spawnChance: 1.0,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "a rapid fire gun with a very light damage and small capacity of magazine",
  },


  ak47: {
    name: "ak47",
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  sniper: {
    name: "sniper",
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },


  shotgun: {
    name: "shotgun",
    category: "weapon",
    spawnChance: 0.5,
    width: 20,
    height: 20,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },

  sword1: {
    name: "Frostbite Edge",
    requiredType: "magemaster",
    image: "image/sword1.png",
    category: "weapon",
    spawnChance: 1.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
    width: 30,
    height: 23,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet-and-silver blade that shines at dusk."
  },

  gauntlet1: {
    name: "Frostweave Gauntlet",
    requiredType: "bullwark",
    image: "image/gauntlet1.png",
    category: "weapon",
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
    width: 30,
    height: 30,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A violet gauntlet with long crystal spikes."
  },

  gun1: {
    name: "Skyline Rifle",
    requiredType: "berserker",
    image: "image/gun1.png",
    category: "weapon",
    spawnChance: 1.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 1.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
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
    spawnChance: 0.2,
    width: 30,
    height: 15,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "A white-and-blue railgun that fires beams of light."
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
