// =============================================================================
// armor_server.js  —  ONLINE MODE copy of armor.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// armor.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
// =============================================================================

// armor.js
//
// Armor items — equippable gear placed in the Armor slot (or the Gear
// slot) of the inventory. Same overall shape/convention as WEAPONS in
// weapon.js and STONE_TYPES/ORB_TYPES in upgrade.js: a flat lookup
// object (ARMOR_TYPES) plus small accessor helpers at the bottom.
//
// FIELDS (per armor entry):
//   name          — armor's own key/name, matches the object key.
//   physicalDefense — flat armor value granted while equipped. Added to
//                   player.physicalDefense (or bot.physicalDefense), same
//                   stat that applyDamageToPlayer() in item.js already
//                   subtracts from incoming damage.
//   category      — "armor", marks it as equippable/lootable/storable
//                   in the inventory grid, same idea as category:
//                   "weapon" in weapon.js.
//   block         — percent chance (0-100) to fully block an incoming
//                   bullet and take zero damage from it.
//   spawnChance   — chance to drop when an enemy bot dies, IF that bot's
//                   spawnItem list (BOT_TYPES in bot.js) includes this
//                   armor's name — same system weapon.js/upgrade.js
//                   already use for their own spawnChance.
//   radius        — ground-drawn / inventory icon size (drawn size is
//                   radius * 2, same convention as item.js). Bump this
//                   up or down if the armor's image looks too small/big
//                   sitting in the inventory grid or on the ground.
//
// CONNECTED STATS — any of these are also optional on an armor entry (or
// a weapon.js entry). If set, character.js's combineEquipmentStats() adds
// it straight onto the matching character stat while equipped, plain
// addition, same as physicalDefense above (e.g. hpRegen: 1 on
// a character already at hpRegen: 0.01 becomes 1.01, health: 30 on a
// character already at health: 80 becomes 110):
//   health, physicalDamage, magicalAttack, criticalChance, criticalDamage,
//   mana, movementSpeed, magicalDefense, hpRegen, manaRegen,
//   vit, dex, int, pow (see character.js's applyAttributeBonus() for
//   what vit/dex/int/pow convert into).
// None of these are set on the entries below yet — add whichever ones a
// given armor should grant.
//
// Load order suggestion: weapon.js -> armor.js -> character.js ->
// effect.js -> level.js -> bot.js -> item.js -> upgrade.js -> game.js
//
// CHARACTERS (character.js) and BOT_TYPES (bot.js) now write their
// `physicalDefense` field as one of these armor NAMES (e.g.
// physicalDefense: "armor1") instead of a flat number — see
// getArmorStats() below, which is what resolves that name into real
// numbers when a character/bot is built.
//
// NOTE: armor is wired into item.js's drop/pickup system (see
// getLootableArmorDef() below, called from item.js's createItemDrop()/
// spawnItemsOnBotDeath()/pickUpArmorDrop()) and into index.html's equip
// UI (the Armor/Gear slots and applyEquippedArmorToPlayer). item.js's
// pickUpArmorDrop() maps this file's `physicalDefense` field onto a
// `defense` field on the inventory copy, since that's the name
// index.html's equip bonus math / upgrade formula / stats popup already
// use for armor items.



// ---------------------------------------------------------------------------
// ARMOR TYPES
// ---------------------------------------------------------------------------
const ARMOR_TYPES = {

  armor1A: {
    name: "armor1",
    image: "image/armor1.png",
    radius: 10,
    physicalDefense: 15,
    physicalDamage:400,
    health: 1000,
    mana:300,
    hpRegen:0.2,
    manaRegen:0.2,
    vit:50,
    pow:50,
    dex:50,
    int:50,
    criticalDamage:1.0,
    criticalChance:0.25,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — small armor and health boost."
  },

  armor1: {
    name: "armor1",
    image: "image/armor1.png",
    radius: 10,
    physicalDefense: 4,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — small armor and health boost."
  },

  armor2: {
    name: "armor2",
    image: "image/armor2.png",
    radius: 10,
    physicalDefense: 8,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — placeholder stats, same as armor1 for now."
  },

  armor3: {
    name: "armor3",
    image: "image/armor3.png",
    radius: 10,
    physicalDefense: 12,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — placeholder stats, same as armor1 for now."
  },

  armor4: {
    name: "armor4",
    image: "image/armor4.png",
    radius: 10,
    physicalDefense: 12,
    block: 6,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 4 (online)."
  },

  armor5: {
    name: "armor5",
    image: "image/armor5.png",
    radius: 10,
    physicalDefense: 14,
    block: 7,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 5 (online)."
  },

  armor6: {
    name: "armor6",
    image: "image/armor6.png",
    radius: 10,
    physicalDefense: 16,
    block: 8,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 6 (online)."
  },

  armor7: {
    name: "armor7",
    image: "image/armor7.png",
    radius: 10,
    physicalDefense: 18,
    block: 9,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 7 (online)."
  },

  armor8: {
    name: "armor8",
    image: "image/armor8.png",
    radius: 10,
    physicalDefense: 20,
    block: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 8 (online)."
  },

  armor9: {
    name: "armor9",
    image: "image/armor9.png",
    radius: 10,
    physicalDefense: 22,
    block: 11,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 9 (online)."
  },

  armor10: {
    name: "armor10",
    image: "image/armor10.png",
    radius: 10,
    physicalDefense: 24,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 10 (online)."
  },

  armor11: {
    name: "armor11",
    image: "image/armor11.png",
    radius: 10,
    physicalDefense: 26,
    block: 3,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 11 (online)."
  },

  armor12: {
    name: "armor12",
    image: "image/armor12.png",
    radius: 10,
    physicalDefense: 28,
    block: 4,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 12 (online)."
  },

  armor13: {
    name: "armor13",
    image: "image/armor13.png",
    radius: 10,
    physicalDefense: 30,
    block: 5,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 13 (online)."
  },

  armor14: {
    name: "armor14",
    image: "image/armor14.png",
    radius: 10,
    physicalDefense: 32,
    block: 6,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 14 (online)."
  },

  armor15: {
    name: "armor15",
    image: "image/armor15.png",
    radius: 10,
    physicalDefense: 34,
    block: 7,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 15 (online)."
  },

  armor16: {
    name: "armor16",
    image: "image/armor16.png",
    radius: 10,
    physicalDefense: 36,
    block: 8,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 16 (online)."
  },

  armor17: {
    name: "armor17",
    image: "image/armor17.png",
    radius: 10,
    physicalDefense: 38,
    block: 9,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 17 (online)."
  },

  armor18: {
    name: "armor18",
    image: "image/armor18.png",
    radius: 10,
    physicalDefense: 40,
    block: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 18 (online)."
  },

  armor19: {
    name: "armor19",
    image: "image/armor19.png",
    radius: 10,
    physicalDefense: 42,
    block: 11,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 19 (online)."
  },

  armor20: {
    name: "armor20",
    image: "image/armor20.png",
    radius: 10,
    physicalDefense: 44,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 20 (online)."
  },

  armor21: {
    name: "armor21",
    image: "image/armor21.png",
    radius: 10,
    physicalDefense: 46,
    block: 3,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 21 (online)."
  },

  armor22: {
    name: "armor22",
    image: "image/armor22.png",
    radius: 10,
    physicalDefense: 48,
    block: 4,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 22 (online)."
  },

  armor23: {
    name: "armor23",
    image: "image/armor23.png",
    radius: 10,
    physicalDefense: 50,
    block: 5,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 23 (online)."
  },

  armor24: {
    name: "armor24",
    image: "image/armor24.png",
    radius: 10,
    physicalDefense: 52,
    block: 6,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 24 (online)."
  },

  armor25: {
    name: "armor25",
    image: "image/armor25.png",
    radius: 10,
    physicalDefense: 54,
    block: 7,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 25 (online)."
  },

  armor26: {
    name: "armor26",
    image: "image/armor26.png",
    radius: 10,
    physicalDefense: 56,
    block: 8,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 26 (online)."
  },

  armor27: {
    name: "armor27",
    image: "image/armor27.png",
    radius: 10,
    physicalDefense: 58,
    block: 9,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 27 (online)."
  },

  armor28: {
    name: "armor28",
    image: "image/armor28.png",
    radius: 10,
    physicalDefense: 60,
    block: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 28 (online)."
  },

  armor29: {
    name: "armor29",
    image: "image/armor29.png",
    radius: 10,
    physicalDefense: 62,
    block: 11,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 29 (online)."
  },

  armor30: {
    name: "armor30",
    image: "image/armor30.png",
    radius: 10,
    physicalDefense: 64,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 30 (online)."
  },

  armor31: {
    name: "armor31",
    image: "image/armor31.png",
    radius: 10,
    physicalDefense: 66,
    block: 3,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 31 (online)."
  },

  armor32: {
    name: "armor32",
    image: "image/armor32.png",
    radius: 10,
    physicalDefense: 68,
    block: 4,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 32 (online)."
  },

  armor33: {
    name: "armor33",
    image: "image/armor33.png",
    radius: 10,
    physicalDefense: 70,
    block: 5,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 33 (online)."
  },

  armor34: {
    name: "armor34",
    image: "image/armor34.png",
    radius: 10,
    physicalDefense: 72,
    block: 6,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 34 (online)."
  },

  armor35: {
    name: "armor35",
    image: "image/armor35.png",
    radius: 10,
    physicalDefense: 74,
    block: 7,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 35 (online)."
  },

  armor36: {
    name: "armor36",
    image: "image/armor36.png",
    radius: 10,
    physicalDefense: 76,
    block: 8,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 36 (online)."
  },

  armor37: {
    name: "armor37",
    image: "image/armor37.png",
    radius: 10,
    physicalDefense: 78,
    block: 9,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 37 (online)."
  },

  armor38: {
    name: "armor38",
    image: "image/armor38.png",
    radius: 10,
    physicalDefense: 80,
    block: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 38 (online)."
  },

  armor39: {
    name: "armor39",
    image: "image/armor39.png",
    radius: 10,
    physicalDefense: 82,
    block: 11,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-worn armor — set 39 (online)."
  },

  armor40: {
    name: "armor40",
    image: "image/armor40.png",
    radius: 10,
    physicalDefense: 84,
    block: 2,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light armor — set 40 (online)."
  },

  armor41: {
    name: "armor41",
    image: "image/armor41.png",
    radius: 10,
    physicalDefense: 86,
    block: 3,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Medium armor — set 41 (online)."
  },

  armor42: {
    name: "armor42",
    image: "image/armor42.png",
    radius: 10,
    physicalDefense: 88,
    block: 4,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy armor — set 42 (online)."
  },

  armor43: {
    name: "armor43",
    image: "image/armor43.png",
    radius: 10,
    physicalDefense: 90,
    block: 5,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced armor — set 43 (online)."
  }

};



// ---------------------------------------------------------------------------
// ACCESSORS — same pattern as getWeapon()/getAllWeapons() in weapon.js
// ---------------------------------------------------------------------------
function getArmor(name) {
  return ARMOR_TYPES[name] || null;
}

function getAllArmors() {
  return Object.values(ARMOR_TYPES);
}

// Same idea as getLootableWeaponDef() in item.js — looks up an armor
// entry only if it's flagged category: "armor", for whenever some other
// file just has a type name and needs to know if it's a lootable armor.
function getLootableArmorDef(typeName) {
  const def = ARMOR_TYPES[typeName];
  return (def && def.category === "armor") ? def : null;
}



// ---------------------------------------------------------------------------
// NAME RESOLUTION — character.js's CHARACTERS and bot.js's BOT_TYPES
// write `armor` as an armor NAME string (e.g. "armor1"). Call this
// wherever a character/bot gets built (getCharacter(), createBot(),
// respawnBot()) to turn that name into the real armor value + health
// bonus to apply. Still backward compatible with a plain number (old
// style, no armor.js bonuses) and with null/undefined (no armor at
// all — e.g. bot.js's shooter).
// ---------------------------------------------------------------------------
// Every OTHER stat an armor entry can carry besides physicalDefense/
// health (see the CONNECTED STATS list in the file header comment
// above). Kept as its own list here (rather than reusing character.js's
// EQUIPMENT_STAT_MAP) since armor.js loads BEFORE character.js (see the
// load-order comment above) — this only needs to exist by the time
// getArmorStats() actually gets CALLED at runtime (createBot(), well
// after every script has loaded), but there's no reason to depend on
// character.js's list order anyway.
const ARMOR_CONNECTED_STAT_FIELDS = [
  "physicalDamage", "magicalAttack", "magicalDefense", "criticalChance",
  "criticalDamage", "mana", "movementSpeed", "hpRegen", "manaRegen"
];

function getArmorStats(armorField) {

  if (typeof armorField === "number") {
    return { armorValue: armorField, health: 0, def: null, bonuses: {} };
  }

  const def = getArmor(armorField);
  if (!def) return { armorValue: 0, health: 0, def: null, bonuses: {} };

  // bonuses — every other connected stat this armor def carries.
  // createBot() (bot.js) folds these onto the bot object the same way
  // combineEquipmentStats() (character.js) already does for the player
  // — previously ONLY armorValue/health made it onto a bot at all, so
  // an armor's magicalDefense/magicalAttack/etc. were silently dropped
  // for every bot wearing it (a bot's magicalDefense was always 0, so
  // any magicalDamage a player dealt went through completely
  // unmitigated, regardless of the armor equipped).
  const bonuses = {};
  ARMOR_CONNECTED_STAT_FIELDS.forEach(field => {
    if (typeof def[field] === "number") bonuses[field] = def[field];
  });

  return {
    armorValue: def.physicalDefense || 0,
    health: def.health || 0,
    def: def,
    bonuses: bonuses
  };
}



// ---------------------------------------------------------------------------
// EQUIP — apply/remove an armor's flat armor + max-health bonus on a
// player (or bot). Mirrors the base/bonus split game.js already uses
// for player.baseArmor vs player.armor (see applyEquippedArmorToPlayer
// in index.html) — call unequipArmorStats() before equipping a new
// armor so bonuses never stack.
// ---------------------------------------------------------------------------
function equipArmorStats(target, armorDef) {
  if (!target || !armorDef) return;

  if (typeof target.basePhysicalDefense !== "number") target.basePhysicalDefense = target.physicalDefense || 0;
  if (typeof target.baseMaxHealth !== "number") target.baseMaxHealth = target.health || 0;

  target.physicalDefense = target.basePhysicalDefense + (armorDef.physicalDefense || 0);

  target.health = target.baseMaxHealth + (armorDef.health || 0);
  if (typeof target.currentHealth === "number") {
    target.currentHealth = Math.min(target.health, target.currentHealth + (armorDef.health || 0));
  }

  target.equippedArmor = armorDef;
}

function unequipArmorStats(target) {
  if (!target) return;

  if (typeof target.basePhysicalDefense === "number") target.physicalDefense = target.basePhysicalDefense;
  if (typeof target.baseMaxHealth === "number") {
    target.health = target.baseMaxHealth;
    if (typeof target.currentHealth === "number") {
      target.currentHealth = Math.min(target.currentHealth, target.health);
    }
  }

  target.equippedArmor = null;
}



// ---------------------------------------------------------------------------
// REGENERATION — RETIRED. Armor's hpRegen/manaRegen used to be a separate
// flat points-per-millisecond tick, applied here every frame. They're now
// just two more entries in character.js's EQUIPMENT_STAT_MAP: an armor
// (or weapon) with hpRegen/manaRegen set gets that value added straight
// onto the character's own percent-based hpRegen/manaRegen the moment
// it's equipped (see combineEquipmentStats() in character.js), and
// tickCharacterRegen() (also character.js) ticks the combined total —
// one regen system instead of two. This function is kept as a harmless
// no-op so existing call sites (game.js, bot.js) don't need to change.
// ---------------------------------------------------------------------------
function tickArmorRegeneration(target, dt) {
  // Intentionally empty — see comment above.
}



// ---------------------------------------------------------------------------
// BLOCK CHANCE — call when a bullet is about to hit someone wearing
// armor. Returns true if the hit should be fully blocked (zero damage).
// ---------------------------------------------------------------------------
function rollArmorBlock(target) {
  if (!target || !target.equippedArmor) return false;

  const blockPercent = target.equippedArmor.block || 0;
  if (blockPercent <= 0) return false;

  return Math.random() * 100 < blockPercent;
}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    ARMOR_TYPES,
    getArmor,
    getAllArmors,
    getLootableArmorDef,
    getArmorStats,
    equipArmorStats,
    unequipArmorStats,
    tickArmorRegeneration,
    rollArmorBlock
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { ARMOR_TYPES };
