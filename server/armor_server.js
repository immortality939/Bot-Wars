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
// REQUIRED STAT (ONLINE rules) — a stat the PLAYER must have before the item
// can be equipped. Works on weapon.js AND armor.js entries (rings and
// accessories too). The numbers below are the ONLINE ones; the same block lives in
// armor.js (offline mode has its own copy of these numbers).
//
// requiredType already decides WHICH characters may wear an item. The stat
// that goes with each type (only these three exist):
//     berserker  -> pow
//     magemaster -> int
//     bullwark   -> dex
//
// Two ways an item gets a requiredStat:
//
//  1) DROPPED BY AN ENEMY (automatic, no field needed) — the amount is the
//     enemy's level x perEnemyLevel, so it grows with the enemy:
//         enemy lvl 1  -> 4      lvl 2 -> 8      ...   lvl 10 -> 40
//         enemy lvl 11-20 -> 44-80     lvl 21-30 -> 84-120
//         enemy lvl 31-40 -> 124-160   lvl 41-50 -> 164-200
//     The stat comes from the item's requiredType (a berserker item rolls
//     pow=<amount>, a magemaster item int=<amount>, a bullwark item dex=<amount>).
//     Enemies above maxEnemyLevel use the top amount (200).
//
//  2) FIXED ON THE ITEM — write it on the entry itself and every copy of the
//     item needs exactly that, whatever dropped it:
//         requiredStat: "pow=20",     // cannot be equipped below 20 pow
//     (the object form requiredStat: { pow: 20 } works too).
//
// The check uses the player's OWN stat (the character's base stat + the
// points gained from levels / spent in the POINTS panel). Stats that other
// gear adds do NOT count, otherwise an item could unlock itself.
// ---------------------------------------------------------------------------
const REQUIRED_STAT_RULES = {
  statForType: { berserker: "pow", magemaster: "int", bullwark: "dex" },
  perEnemyLevel: 4,      // requirement per enemy level (level 10 -> 40, level 50 -> 200)
  maxEnemyLevel: 50      // enemies above this level use the top amount
};

// "pow=20" (or { pow: 20 }) -> { stat: "pow", amount: 20 }; null when it is
// missing, not one of the three stats, or not a positive number.
function parseRequiredStat(value) {
  if (!value) return null;
  let stat = null, amount = NaN;
  if (typeof value === "string") {
    const m = value.trim().match(/^([a-z]+)\s*=\s*(\d+(?:\.\d+)?)$/i);
    if (m) { stat = m[1].toLowerCase(); amount = Number(m[2]); }
  } else if (typeof value === "object") {
    const k = Object.keys(value)[0];
    if (k) { stat = k.toLowerCase(); amount = Number(value[k]); }
  }
  const allowed = Object.values(REQUIRED_STAT_RULES.statForType);
  if (!stat || allowed.indexOf(stat) === -1 || !(amount > 0)) return null;
  return { stat: stat, amount: Math.round(amount) };
}

// The requiredStat text ("pow=40") a freshly DROPPED item gets. fixedRequiredStat
// is the item entry's own requiredStat (way 2 above) — when it has one it wins;
// otherwise the amount comes from the dropping enemy's level (way 1). Returns null
// when the item has no requiredType (nothing to base a stat on).
function rollRequiredStat(requiredType, enemyLevel, fixedRequiredStat) {
  const fixed = parseRequiredStat(fixedRequiredStat);
  if (fixed) return fixed.stat + "=" + fixed.amount;
  const stat = REQUIRED_STAT_RULES.statForType[String(requiredType || "").toLowerCase()];
  if (!stat) return null;
  const lvl = Math.max(1, Math.min(REQUIRED_STAT_RULES.maxEnemyLevel, Math.floor(Number(enemyLevel)) || 1));
  return stat + "=" + (lvl * REQUIRED_STAT_RULES.perEnemyLevel);
}



// ---------------------------------------------------------------------------
// ARMOR TYPES
// ---------------------------------------------------------------------------
const ARMOR_TYPES = {

  armor1: {
    name: "armor1",
    requiredType: "berserker",
    image: "image/armor1.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 300000,    // ms — despawns if not looted within 30 sec
    description: "Padded scout vest. Light and quick to wear, with a small boost to defense and health."
  },

  armor2: {
    name: "armor2",
    requiredType: "berserker",
    image: "image/armor2.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Leather jacket stitched with metal plates. Balanced protection for new fighters."
  },

  armor3: {
    name: "armor3",
    requiredType: "berserker",
    image: "image/armor3.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy steel chestplate. Slow to wear, but soaks up serious damage."
  },

  armor4: {
    name: "armor4",
    requiredType: "berserker",
    image: "image/armor4.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Battle-scarred plate armor. Dented, but it still turns away most hits."
  },

  armor5: {
    name: "armor5",
    requiredType: "berserker",
    image: "image/armor5.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Lightweight mesh armor. Easy to move in, with decent defense."
  },

  armor6: {
    name: "armor6",
    requiredType: "berserker",
    image: "image/armor6.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Riveted combat armor built for long fights."
  },

  armor7: {
    name: "armor7",
    requiredType: "berserker",
    image: "image/armor7.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy bulwark plating. Layered steel for fighters who hold the front line."
  },

  armor8: {
    name: "armor8",
    requiredType: "berserker",
    image: "image/armor8.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced plate with extra padding at the joints."
  },

  armor9: {
    name: "armor9",
    requiredType: "berserker",
    image: "image/armor9.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Weathered veteran armor. Every scratch is a fight survived."
  },

  armor10: {
    name: "armor10",
    requiredType: "berserker",
    image: "image/armor10.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Slim tactical suit with light plating. Fast, with a decent chance to block."
  },

  armor11: {
    name: "armor11",
    requiredType: "berserker",
    image: "image/armor11.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Field-tested armor with balanced defense and health."
  },

  armor12: {
    name: "armor12",
    requiredType: "berserker",
    image: "image/armor12.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Thick siege armor made to hold the line against heavy fire."
  },

  armor13: {
    name: "armor13",
    requiredType: "berserker",
    image: "image/armor13.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced battle armor with double-layered chest plates."
  },

  armor14: {
    name: "armor14",
    requiredType: "berserker",
    image: "image/armor14.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Scorched armor from countless battles. Rugged and reliable."
  },

  armor15: {
    name: "armor15",
    requiredType: "bullwark",
    image: "image/armor15.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Agile skirmisher armor that trades weight for speed."
  },

  armor16: {
    name: "armor16",
    requiredType: "bullwark",
    image: "image/armor16.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Alloy-plated armor with solid protection all around."
  },

  armor17: {
    name: "armor17",
    requiredType: "bullwark",
    image: "image/armor17.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy assault armor with a thick, armored shell."
  },

  armor18: {
    name: "armor18",
    requiredType: "bullwark",
    image: "image/armor18.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced guard armor with braced shoulders and a hardened core."
  },

  armor19: {
    name: "armor19",
    requiredType: "bullwark",
    image: "image/armor19.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Old war armor patched with scrap steel. Tough and proven."
  },

  armor20: {
    name: "armor20",
    requiredType: "bullwark",
    image: "image/armor20.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Sleek composite armor that is light but strong."
  },

  armor21: {
    name: "armor21",
    requiredType: "bullwark",
    image: "image/armor21.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Officer's armor with polished plates and strong defense."
  },

  armor22: {
    name: "armor22",
    requiredType: "bullwark",
    image: "image/armor22.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Fortress armor. Heavy and very hard to break through."
  },

  armor23: {
    name: "armor23",
    requiredType: "bullwark",
    image: "image/armor23.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced elite plate with extra health and defense."
  },

  armor24: {
    name: "armor24",
    requiredType: "bullwark",
    image: "image/armor24.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Veteran champion's armor, worn down but still strong."
  },

  armor25: {
    name: "armor25",
    requiredType: "bullwark",
    image: "image/armor25.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Featherweight alloy armor for fast, evasive fighters."
  },

  armor26: {
    name: "armor26",
    requiredType: "bullwark",
    image: "image/armor26.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Commander's armor built to take hits in the thick of battle."
  },

  armor27: {
    name: "armor27",
    requiredType: "bullwark",
    image: "image/armor27.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Heavy siege-breaker armor with thick layered plating."
  },

  armor28: {
    name: "armor28",
    requiredType: "bullwark",
    image: "image/armor28.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced war plate with an energy-treated finish."
  },

  armor29: {
    name: "armor29",
    requiredType: "magemaster",
    image: "image/armor29.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Ancient battle armor, scarred and still standing."
  },

  armor30: {
    name: "armor30",
    requiredType: "magemaster",
    image: "image/armor30.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Light stealth armor with a smooth, low-profile finish."
  },

  armor31: {
    name: "armor31",
    requiredType: "magemaster",
    image: "image/armor31.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Knight-grade armor with balanced protection."
  },

  armor32: {
    name: "armor32",
    requiredType: "magemaster",
    image: "image/armor32.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Titan armor. Massive plates for tanks who never back down."
  },

  armor33: {
    name: "armor33",
    requiredType: "magemaster",
    image: "image/armor33.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced vanguard armor made for leading the charge."
  },

  armor34: {
    name: "armor34",
    requiredType: "magemaster",
    image: "image/armor34.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Relic armor pulled from old battlefields, strong and scarred."
  },

  armor35: {
    name: "armor35",
    requiredType: "magemaster",
    image: "image/armor35.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Swift-guard armor, light but high in defense for its weight."
  },

  armor36: {
    name: "armor36",
    requiredType: "magemaster",
    image: "image/armor36.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Elite armor with high defense and health."
  },

  armor37: {
    name: "armor37",
    requiredType: "magemaster",
    image: "image/armor37.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Colossus armor. A heavy shell that shrugs off blows."
  },

  armor38: {
    name: "armor38",
    requiredType: "magemaster",
    image: "image/armor38.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Reinforced champion armor with hardened plates and strong shielding."
  },

  armor39: {
    name: "armor39",
    requiredType: "magemaster",
    image: "image/armor39.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Legendary battle-worn armor, feared by anyone who has faced its wearer."
  },

  armor40: {
    name: "armor40",
    requiredType: "magemaster",
    image: "image/armor40.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Phantom armor, thin but surprisingly tough."
  },

  armor41: {
    name: "armor41",
    requiredType: "magemaster",
    image: "image/armor41.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Warlord's armor with top-tier protection."
  },

  armor42: {
    name: "armor42",
    requiredType: "magemaster",
    image: "image/armor42.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Juggernaut armor. An unstoppable wall of metal."
  },

  armor43: {
    name: "armor43",
    requiredType: "magemaster",
    image: "image/armor43.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Ultimate reinforced plate, the finest armor in the set."
  },
  
  armor1A: {
    name: "armor1A",
    image: "image/armor43.png",
    radius: 10,
    category: "armor",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Mythic armor that boosts every stat: health, mana, regen, damage, and critical hits."
  },

  // ---------------------------------------------------------------------------
  // RINGS — category: "ring" (sprites ring01.png - ring40.png)
  // ---------------------------------------------------------------------------

  ring01: {
    name: "ring01",
    requiredType: "berserker",
    image: "image/ring01.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 300000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring with a bright star. A starter ring that adds a little damage and crit chance."
  },

  ring02: {
    name: "ring02",
    requiredType: "berserker",
    image: "image/ring02.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red ring with a burning flame. Fuels your attacks with fiery power."
  },

  ring03: {
    name: "ring03",
    requiredType: "berserker",
    image: "image/ring03.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple ring set with a glowing crystal. Hums with arcane energy."
  },

  ring04: {
    name: "ring04",
    requiredType: "berserker",
    image: "image/ring04.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green ring marked with a leaf. Carries the strength of living nature."
  },

  ring05: {
    name: "ring05",
    requiredType: "berserker",
    image: "image/ring05.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden ring with a crown. A symbol of rank that rewards bold fighters."
  },

  ring06: {
    name: "ring06",
    requiredType: "berserker",
    image: "image/ring06.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring with a snowflake. Cold, sharp, and precise."
  },

  ring07: {
    name: "ring07",
    requiredType: "berserker",
    image: "image/ring07.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red ring with a skull. Made for fighters who finish what they start."
  },

  ring08: {
    name: "ring08",
    requiredType: "berserker",
    image: "image/ring08.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring crackling with lightning. Quick strikes, quick kills."
  },

  ring09: {
    name: "ring09",
    requiredType: "berserker",
    image: "image/ring09.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple ring with a hypnotic swirl. Bends power toward the wearer."
  },

  ring10: {
    name: "ring10",
    requiredType: "berserker",
    image: "image/ring10.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Cyan ring with a crosshair. Sharpens your aim for critical hits."
  },

  ring11: {
    name: "ring11",
    requiredType: "berserker",
    image: "image/ring11.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Orange ring with a wolf's head. Gives the wearer a hunter's edge."
  },

  ring12: {
    name: "ring12",
    requiredType: "berserker",
    image: "image/ring12.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Pink ring with a heart. Warm and lucky, a favorite of survivors."
  },

  ring13: {
    name: "ring13",
    requiredType: "berserker",
    image: "image/ring13.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Silver ring with a four-point star. Simple, clean, and dependable."
  },

  ring14: {
    name: "ring14",
    requiredType: "bullwark",
    image: "image/ring14.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red ring with a trident mark. Pierces through enemy defenses."
  },

  ring15: {
    name: "ring15",
    requiredType: "bullwark",
    image: "image/ring15.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring with flowing waves. Calm on the outside, powerful underneath."
  },

  ring16: {
    name: "ring16",
    requiredType: "bullwark",
    image: "image/ring16.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple ring with a horned demon face. Whispers for more damage."
  },

  ring17: {
    name: "ring17",
    requiredType: "bullwark",
    image: "image/ring17.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green ring with a biohazard sign. Toxic power for ruthless fighters."
  },

  ring18: {
    name: "ring18",
    requiredType: "bullwark",
    image: "image/ring18.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden ring with a compass star. Points the way to critical hits."
  },

  ring19: {
    name: "ring19",
    requiredType: "bullwark",
    image: "image/ring19.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red ring with a targeting reticle. Locks onto weak points."
  },

  ring20: {
    name: "ring20",
    requiredType: "bullwark",
    image: "image/ring20.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring with a bright diamond. Clear, sharp, and valuable."
  },

  ring21: {
    name: "ring21",
    requiredType: "bullwark",
    image: "image/ring21.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a blue crystal. Forged in frozen caverns."
  },

  ring22: {
    name: "ring22",
    requiredType: "bullwark",
    image: "image/ring22.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark spiked ring with a red dragon crest. Radiates raw aggression."
  },

  ring23: {
    name: "ring23",
    requiredType: "bullwark",
    image: "image/ring23.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a purple crystal. Pulses with unstable magic."
  },

  ring24: {
    name: "ring24",
    requiredType: "bullwark",
    image: "image/ring24.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden spiked ring with a star. A rare ring for decorated veterans."
  },

  ring25: {
    name: "ring25",
    requiredType: "bullwark",
    image: "image/ring25.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Frost-covered ring with a snowflake. Freezes the air around it."
  },

  ring26: {
    name: "ring26",
    requiredType: "bullwark",
    image: "image/ring26.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark green ring with a radiation mark. Glows with dangerous energy."
  },

  ring27: {
    name: "ring27",
    requiredType: "magemaster",
    image: "image/ring27.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden spiked ring with a blazing flame. Burns with fierce power."
  },

  ring28: {
    name: "ring28",
    requiredType: "magemaster",
    image: "image/ring28.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue ring with a ringed planet. Draws on the power of the cosmos."
  },

  ring29: {
    name: "ring29",
    requiredType: "magemaster",
    image: "image/ring29.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a purple vortex. Pulls power in from the void."
  },

  ring30: {
    name: "ring30",
    requiredType: "magemaster",
    image: "image/ring30.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark ring with a white skull. Worn by fighters who show no mercy."
  },

  ring31: {
    name: "ring31",
    requiredType: "magemaster",
    image: "image/ring31.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Silver and green ring with a leaf. Heals the spirit and sharpens the blade."
  },

  ring32: {
    name: "ring32",
    requiredType: "magemaster",
    image: "image/ring32.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a lightning bolt. Packs a shocking amount of power."
  },

  ring33: {
    name: "ring33",
    requiredType: "magemaster",
    image: "image/ring33.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red spiked ring with a golden crown. Made for rulers of the battlefield."
  },

  ring34: {
    name: "ring34",
    requiredType: "magemaster",
    image: "image/ring34.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a purple crystal. Rich with deep arcane power."
  },

  ring35: {
    name: "ring35",
    requiredType: "magemaster",
    image: "image/ring35.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Gold and cyan ring with a shield crest. Strong, proud, and well-balanced."
  },

  ring36: {
    name: "ring36",
    requiredType: "magemaster",
    image: "image/ring36.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Bronze ring with a golden dragon. Carries the might of an ancient beast."
  },

  ring37: {
    name: "ring37",
    requiredType: "magemaster",
    image: "image/ring37.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a glowing snowflake. Bitter cold that cuts like a blade."
  },

  ring38: {
    name: "ring38",
    requiredType: "magemaster",
    image: "image/ring38.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark green ring with a biohazard sign. Highly toxic, highly deadly."
  },

  ring39: {
    name: "ring39",
    requiredType: "magemaster",
    image: "image/ring39.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Spiked ring with a purple demon face. Hungers for destruction."
  },

  ring40: {
    name: "ring40",
    requiredType: "magemaster",
    image: "image/ring40.png",
    radius: 10,
    category: "ring",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark red spiked ring with a crosshair. Perfect aim for lethal critical hits."
  },

  // ---------------------------------------------------------------------------
  // ACCESSORIES — category: "accessory" (sprites accessory01.png - accessory36.png)
  // ---------------------------------------------------------------------------

  accessory01: {
    name: "accessory01",
    requiredType: "berserker",
    image: "image/accessory01.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 300000,    // ms — despawns if not looted within 30 sec
    description: "Blue spiked circlet with a glowing crystal. Light on the head, strong in the mind."
  },

  accessory02: {
    name: "accessory02",
    requiredType: "berserker",
    image: "image/accessory02.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue glowing wings. Light as air, with a boost to health and mana."
  },

  accessory03: {
    name: "accessory03",
    requiredType: "berserker",
    image: "image/accessory03.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue cloak with glowing edges. Flows behind you like a night wave."
  },

  accessory04: {
    name: "accessory04",
    requiredType: "berserker",
    image: "image/accessory04.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue horned headset. Keeps your focus sharp in the middle of battle."
  },

  accessory05: {
    name: "accessory05",
    requiredType: "berserker",
    image: "image/accessory05.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue companion drone that floats beside you and watches your back."
  },

  accessory06: {
    name: "accessory06",
    requiredType: "berserker",
    image: "image/accessory06.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue crystal pendant on a dark chain. Calm and full of energy."
  },

  accessory07: {
    name: "accessory07",
    requiredType: "berserker",
    image: "image/accessory07.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red spiked crown. A fierce mark of a fighter who never backs down."
  },

  accessory08: {
    name: "accessory08",
    requiredType: "berserker",
    image: "image/accessory08.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red flaming wings. Burn bright and keep your health high."
  },

  accessory09: {
    name: "accessory09",
    requiredType: "berserker",
    image: "image/accessory09.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Dark red cloak. Wrapped in the heat of battle."
  },

  accessory10: {
    name: "accessory10",
    requiredType: "berserker",
    image: "image/accessory10.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red horned headset. Fills you with rage and fighting spirit."
  },

  accessory11: {
    name: "accessory11",
    requiredType: "berserker",
    image: "image/accessory11.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red combat drone with glowing eyes. Small, angry, and loyal."
  },

  accessory12: {
    name: "accessory12",
    requiredType: "berserker",
    image: "image/accessory12.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red crystal pendant on a dark chain. Beats like a second heart."
  },

  accessory13: {
    name: "accessory13",
    requiredType: "bullwark",
    image: "image/accessory13.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green spiked circlet with a glowing gem. Draws strength from nature."
  },

  accessory14: {
    name: "accessory14",
    requiredType: "bullwark",
    image: "image/accessory14.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green crystal wings. Fast and light, with a fresh burst of life."
  },

  accessory15: {
    name: "accessory15",
    requiredType: "bullwark",
    image: "image/accessory15.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green hooded cloak. Blends into the wild."
  },

  accessory16: {
    name: "accessory16",
    requiredType: "bullwark",
    image: "image/accessory16.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green night-vision goggles. See clearly, even in the dark."
  },

  accessory17: {
    name: "accessory17",
    requiredType: "bullwark",
    image: "image/accessory17.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green companion drone with glowing spikes. Keeps you company and keeps you safe."
  },

  accessory18: {
    name: "accessory18",
    requiredType: "bullwark",
    image: "image/accessory18.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green crystal pendant on a dark chain. Quietly restores your energy."
  },

  accessory19: {
    name: "accessory19",
    requiredType: "bullwark",
    image: "image/accessory19.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple spiked crown with a glowing gem. Carries a dark, royal power."
  },

  accessory20: {
    name: "accessory20",
    requiredType: "bullwark",
    image: "image/accessory20.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple shadow wings. Soft in flight and sharp in the dark."
  },

  accessory21: {
    name: "accessory21",
    requiredType: "bullwark",
    image: "image/accessory21.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple cloak with torn edges. Stirs up whispers of the void."
  },

  accessory22: {
    name: "accessory22",
    requiredType: "bullwark",
    image: "image/accessory22.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple horned headset. Hums with strange energy."
  },

  accessory23: {
    name: "accessory23",
    requiredType: "bullwark",
    image: "image/accessory23.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple companion drone with glowing spikes. Floats close and never sleeps."
  },

  accessory24: {
    name: "accessory24",
    requiredType: "bullwark",
    image: "image/accessory24.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple crystal pendant on a dark chain. Glows with mysterious power."
  },

  accessory25: {
    name: "accessory25",
    requiredType: "magemaster",
    image: "image/accessory25.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden crown with a bright star. Only the best fighters wear it."
  },

  accessory26: {
    name: "accessory26",
    requiredType: "magemaster",
    image: "image/accessory26.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "White and gold wings. Radiant, graceful, and full of life."
  },

  accessory27: {
    name: "accessory27",
    requiredType: "magemaster",
    image: "image/accessory27.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "White and gold cloak. Regal and glowing like morning light."
  },

  accessory28: {
    name: "accessory28",
    requiredType: "magemaster",
    image: "image/accessory28.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden winged headset. Sharp focus and a feather-light feel."
  },

  accessory29: {
    name: "accessory29",
    requiredType: "magemaster",
    image: "image/accessory29.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden companion drone with white wings. Shines bright and guards you well."
  },

  accessory30: {
    name: "accessory30",
    requiredType: "magemaster",
    image: "image/accessory30.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Golden star pendant. A treasured charm that boosts health and mana."
  },

  accessory31: {
    name: "accessory31",
    requiredType: "magemaster",
    image: "image/accessory31.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue jetpack with glowing thrusters. Gives you energy to keep going."
  },

  accessory32: {
    name: "accessory32",
    requiredType: "magemaster",
    image: "image/accessory32.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red armored backpack with glowing cells. Packed with power for long fights."
  },

  accessory33: {
    name: "accessory33",
    requiredType: "magemaster",
    image: "image/accessory33.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Purple armored backpack with glowing cells. Stores strange and heavy energy."
  },

  accessory34: {
    name: "accessory34",
    requiredType: "magemaster",
    image: "image/accessory34.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Green armored backpack with glowing cells. Keeps your health and mana flowing."
  },

  accessory35: {
    name: "accessory35",
    requiredType: "magemaster",
    image: "image/accessory35.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Blue battle banner with a winged crest. Lifts the spirit of everyone who sees it."
  },

  accessory36: {
    name: "accessory36",
    requiredType: "magemaster",
    image: "image/accessory36.png",
    radius: 10,
    category: "accessory",
    spawnChance: 0.1,
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
    description: "Red battle banner with a fiery crest. A warning to every enemy that sees it."
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

// RING / ACCESSORY — same lookup idea as getLootableArmorDef() above, one
// per new category. Entries live in ARMOR_TYPES (so online sync of
// ARMOR_TYPES carries them too) but are flagged category: "ring" /
// "accessory" instead of "armor".
function getLootableRingDef(typeName) {
  const def = ARMOR_TYPES[typeName];
  return (def && def.category === "ring") ? def : null;
}

function getLootableAccessoryDef(typeName) {
  const def = ARMOR_TYPES[typeName];
  return (def && def.category === "accessory") ? def : null;
}

function getAllRings() {
  return Object.values(ARMOR_TYPES).filter(d => d.category === "ring");
}

function getAllAccessories() {
  return Object.values(ARMOR_TYPES).filter(d => d.category === "accessory");
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
    getLootableRingDef,
    getLootableAccessoryDef,
    getAllRings,
    getAllAccessories,
    getArmorStats,
    equipArmorStats,
    unequipArmorStats,
    tickArmorRegeneration,
    rollArmorBlock
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { ARMOR_TYPES, parseRequiredStat, rollRequiredStat };
