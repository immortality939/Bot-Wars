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

  armor1: {
    name: "armor1",
    image: "image/armor1.png",
    radius: 10,

    physicalDefense: 5,
    physicalDamage:10,
    block: 10,   // 10% chance to fully block a bullet
    vit:2,
    dex:2,
    int:2,
    mana: 200,
    health:2000,
    pow:10,
    hpRegen: 0.1,
    manaRegen: 0.01,
    magicalAttack:5,
    magicalDefense:5,
    criticalChance: 0.08,
    criticalDamage: 0.05,
    category: "armor",
    spawnChance: 0.5,
    description: "Light armor — small armor and health boost."
  },

  armor2: {
    name: "armor2",
    image: "image/armor2.png",
    radius: 10,

    physicalDefense: 3,
    health: 300,

    block: 10,

    category: "armor",
    spawnChance: 0.5,
    description: "Medium armor — placeholder stats, same as armor1 for now."
  },

  armor3: {
    name: "armor3",
    image: "image/armor3.png",
    radius: 10,

    physicalDefense: 3,
    health: 30,

    block: 10,

    category: "armor",
    spawnChance: 0.5,
    description: "Heavy armor — placeholder stats, same as armor1 for now."
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
