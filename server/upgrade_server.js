// =============================================================================
// upgrade_server.js  —  ONLINE MODE copy of upgrade.js
// =============================================================================
// This is the WHOLE online version of upgrade.js: in online mode the game runs
// THIS file (its numbers AND its functions/formulas), not upgrade.js. Edit
// anything in here to change how the game behaves in ONLINE mode.
// upgrade.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, so players cannot open or edit it. server.js sends it to each
// player when they join an online match; the game swaps it in for as long as
// the player is online, then puts the offline version back (see online.js).
//
// KEEP IT IN STEP WITH upgrade.js: when upgrade.js gets a new function or a fix,
// copy that change in here too, or online mode keeps running the old version.
// =============================================================================

// upgrade.js
//
// Upgrade materials: STONES and ORBS. These are inventory items just
// like the ones in item.js/weapon.js — they can sit in the storage grid
// and drop from bots the same way — but neither one can ever be equipped
// in the Weapon/Armor slots. They're only ever *used on* a weapon or
// armor item, by the upgrade system.
//
// STONES — spend one on an equipped weapon or armor item to upgrade it.
//   canUpgrade lists which of those two categories the stone works on.
//   upgradeChance is the odds the attempt actually succeeds when it's
//   used (1.0 = always succeeds).
//
// ORBS — attach one to a weapon to give it an elemental effect that can
//   trigger on hit (e.g. stunning the enemy so they can't move or fire
//   for a few seconds).
//   canAttached lists which category the orb can be attached to (weapon
//   only, for every orb below). effect is the elemental effect name;
//   effectDuration/effectChance control how long it lasts and how often
//   it actually triggers on a hit. orbEffect is the matching animation
//   name in effect.js's HIT_EFFECTS, played via createHitEffect() the
//   moment the effect triggers on a bot (see applyOrbEffect() in bot.js).
//   fireorb's millisec is its own tunable: burn damage dealt per
//   millisecond while the burn is active.
//
// Load order: weapon.js -> character.js -> effect.js -> level.js ->
// bot.js -> item.js -> upgrade.js -> game.js
//
// Dropping these from a bot works exactly like item.js/weapon.js: add
// the item's name to a bot's spawnItem list in bot.js (e.g. spawnItem:
// "shield,health,specialstone,electricorb") and its own spawnChance
// decides whether it actually drops.



// ---------------------------------------------------------------------------
// STONES
// ---------------------------------------------------------------------------
const STONE_TYPES = {

  specialstone: {
    name: "specialstone",
    category: "stone", // storable in the inventory grid; cannot be equipped

    upgradeChance: 1.0,   // 100% chance the upgrade succeeds
    spawnChance: 0.03,     // 50% chance to drop when a bot that carries it dies
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    canUpgrade: ["weapon", "armor"],

    // Ground-drawn / inventory icon size — resizable, same convention as
    // item.js's ITEM_TYPES (drawn size is radius * 2).
    radius: 10,

    image: "image/specialstone.png"
  }

};



// ---------------------------------------------------------------------------
// ORBS
// ---------------------------------------------------------------------------
const ORB_TYPES = {

  electricorb: {
    name: "electricorb",
    category: "orb", // storable in the inventory grid; cannot be equipped

    spawnChance: 0.3,     // 50% chance to drop when a bot that carries it dies

    canAttached: ["weapon"],

    effect: "electric",      // stuns the enemy — can't move or fire
    effectDuration: 3000,    // ms (3 sec)
    effectChance: 0.1,       // 50% chance to trigger per hit
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    // Ground-drawn / inventory icon size — resizable.
    radius: 10,

    image: "image/electricorb.png",
    orbEffect: "electric" // animation name in effect.js's HIT_EFFECTS — played via createHitEffect() when this effect triggers on a bot
  },

  fireorb: {
    name: "fireorb",
    category: "orb",

    spawnChance: .3,

    canAttached: ["weapon"],

    effect: "fire",
    effectDuration: 3000,
    effectChance: 0.1,
    millisec: 0.009,   // burn damage dealt per millisecond while the effect is active — tune this to change burn strength (e.g. 0.05 = 150 total dmg over the 3s effectDuration)
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    radius: 10,

    image: "image/fireorb.png",
    orbEffect: "fire"
  },

  iceorb: {
    name: "iceorb",
    category: "orb",

    spawnChance: 0.1,

    canAttached: ["weapon"],

    effect: "ice",
    effectDuration: 3000,
    effectChance: 0.25,
    slow: -40,        // flat add to the enemy's movementSpeed while the effect is active (e.g. 100 -> 60)
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    radius: 10,

    image: "image/iceorb.png",
    orbEffect: "ice"
  }

};



// ---------------------------------------------------------------------------
// ACCESSORS — same pattern as getWeapon()/getAllWeapons() in weapon.js
// ---------------------------------------------------------------------------
function getStone(name) {
  return STONE_TYPES[name] || null;
}

function getAllStones() {
  return Object.values(STONE_TYPES);
}

function getOrb(name) {
  return ORB_TYPES[name] || null;
}

function getAllOrbs() {
  return Object.values(ORB_TYPES);
}

// Looks up either a stone or an orb by name, regardless of which map
// it's actually in — handy anywhere the code just has an item name and
// needs to know if it's an upgrade material at all (storage grid,
// spawn rolls, etc.).
function getUpgradeItem(name) {
  return STONE_TYPES[name] || ORB_TYPES[name] || null;
}

function getAllUpgradeItems() {
  return [...Object.values(STONE_TYPES), ...Object.values(ORB_TYPES)];
}

// ---------------------------------------------------------------------------
// UPGRADING GEAR (gear.data.upgradeLevel, 0-9) — runs from upgrade_server.js so
// players can't edit these numbers in the public game page.
//
//   SUCCESS CHANCE — the stone's own upgradeChance (specialstone = 100%) minus
//     UPGRADE_CHANCE_STEP (12%) for every level the gear already has:
//     +0 -> +1 = 100%, +1 -> +2 = 88%, +2 -> +3 = 76%, ... never below 0%.
//
//   STATS — every SUCCESSFUL upgrade adds UPGRADE_STAT_PERCENT (5%) of the
//     item's ORIGINAL (+0) value to EVERY stat it has (see UPGRADE_STAT_FIELDS),
//     weapon or armor alike. So +1 = base x 1.05, +2 = base x 1.10 ... +9 =
//     base x 1.45. Example, armor with physicalDefense 10, health 100,
//     hpRegen 0.001 -> at +1: 10.5 / 105 / 0.00105. The original values are
//     remembered in data.upgradeBase so rounding never drifts.
//     (The old tiered "+15/20/25% damage" / "+1..3 defense" rules are gone.)
//
//   GOLD ORB COST — every attempt costs gold orb, SUCCESS OR FAIL:
//     +0 -> +1 costs UPGRADE_BASE_GOLD (2000); every level up doubles it:
//     +2 = 4000, +3 = 8000, +4 = 16000 ... +9 = 512000. A fail keeps the
//     level, so the next try costs the same again.
//     index.html shows the cost in a Confirm/Cancel window first and takes the
//     gold (getUpgradeGoldCost below).
//
//   Capped at MAX_UPGRADE_LEVEL — the button/roll refuses once there.
//   A stone is consumed on every attempt, success or failure — that part
//   stays in index.html since it's just removing an inventory item.
// ---------------------------------------------------------------------------
const MAX_UPGRADE_LEVEL = 9;
const UPGRADE_CHANCE_STEP = 0.12;      // shaved off success chance per existing level
const UPGRADE_STAT_PERCENT = 0.05;     // +5% of the base stats per successful upgrade
const UPGRADE_BASE_GOLD = 2000;        // gold orb for the first upgrade (+0 -> +1)
const UPGRADE_GOLD_MULTIPLIER = 2;     // the cost x2 for every level already reached

// Every stat that grows with an upgrade. `defense` is the inventory copy's name
// for an armor's physicalDefense (see pickUpArmorDrop), so both are scaled.
const UPGRADE_STAT_FIELDS = [
  "physicalDamage", "physicalDefense", "defense", "magicalAttack", "magicalDefense",
  "health", "mana", "criticalChance", "criticalDamage", "hpRegen", "manaRegen",
  "movementSpeed", "block", "vit", "dex", "int", "pow"
];

// Keeps tiny numbers like hpRegen 0.00105 exact while hiding float noise.
function roundUpgradeStat(v) {
  return Math.round(v * 1000000) / 1000000;
}

// Gold orb needed to attempt the NEXT upgrade of gear that is at `currentLevel`
// (0 -> 2000, 1 -> 4000, 2 -> 8000, 3 -> 16000 ... 8 -> 512000).
function getUpgradeGoldCost(currentLevel) {
  const lvl = Math.max(0, Math.floor(currentLevel || 0));
  return Math.round(UPGRADE_BASE_GOLD * Math.pow(UPGRADE_GOLD_MULTIPLIER, lvl));
}

// Success chance for taking `currentLevel` up to `currentLevel + 1`, given
// the stone's own base upgradeChance (e.g. 1.0 for specialstone).
function getUpgradeChanceAtLevel(baseChance, currentLevel) {
  return Math.max(0, (baseChance || 0) - UPGRADE_CHANCE_STEP * currentLevel);
}

// Returns a COPY of a weapon/armor `data` object with its stats set to what
// `level` upgrades are worth (base x (1 + 5% x level)). Works from the item's
// remembered +0 values (data.upgradeBase); the first time, those are taken from
// the current numbers. Does not mutate `data`.
function applyUpgradeLevelToData(data, level) {
  if (!data) return data;
  level = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(level || 0)));

  const prevLevel = data.upgradeLevel || 0;
  const base = Object.assign({}, data.upgradeBase || {});
  UPGRADE_STAT_FIELDS.forEach((f) => {
    if (typeof data[f] === "number" && typeof base[f] !== "number") {
      // First upgrade: the current numbers ARE the +0 base. (An item that
      // already has levels but no remembered base is backed out of them.)
      base[f] = roundUpgradeStat(data[f] / (1 + UPGRADE_STAT_PERCENT * prevLevel));
    }
  });

  const out = Object.assign({}, data);
  UPGRADE_STAT_FIELDS.forEach((f) => {
    if (typeof base[f] === "number") {
      out[f] = roundUpgradeStat(base[f] * (1 + UPGRADE_STAT_PERCENT * level));
    }
  });
  out.upgradeBase = base;
  out.upgradeLevel = level;
  return out;
}

// Rolls ONE upgrade attempt on a weapon or armor item and returns the result;
// does not touch the stone or the gold — index.html consumes those itself.
//   gearType   — "weapon" or "armor" (see entryType() in index.html)
//   gearData   — the item's current gear.data object (not mutated)
//   baseChance — the stone's own upgradeChance (relic.data.upgradeChance)
// Returns { success, maxed, data }: `data` is the NEW gear.data to store on
// success, or the ORIGINAL gearData unchanged on a fail/maxed/no-op result.
function rollGearUpgrade(gearType, gearData, baseChance) {
  const currentLevel = (gearData && gearData.upgradeLevel) || 0;
  if (currentLevel >= MAX_UPGRADE_LEVEL) return { success: false, maxed: true, data: gearData };
  if (gearType !== "weapon" && gearType !== "armor") return { success: false, maxed: false, data: gearData };

  const chance = getUpgradeChanceAtLevel(baseChance, currentLevel);
  const success = Math.random() < chance;
  if (!success) return { success: false, maxed: false, data: gearData };

  return { success: true, maxed: false, data: applyUpgradeLevelToData(gearData, currentLevel + 1) };
}



// ---------------------------------------------------------------------------
// SELL PRICE (gold orb) — what the SELL button in the item popup pays for
// stones and orbs: every one of them sells for UPGRADE_SELL_PRICE (one unit
// per sale). To price one item differently, give its entry a `sellPrice`
// field. Weapons/armor prices are calculated in armor.js (getItemSellPrice).
// ---------------------------------------------------------------------------
const UPGRADE_SELL_PRICE = 100000;

function getUpgradeItemSellPrice(name) {
  const def = getUpgradeItem(name);
  if (!def) return 0;
  return (typeof def.sellPrice === "number" && def.sellPrice >= 0) ? Math.round(def.sellPrice) : UPGRADE_SELL_PRICE;
}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    STONE_TYPES,
    ORB_TYPES,
    getStone,
    getAllStones,
    getOrb,
    getAllOrbs,
    getUpgradeItem,
    getAllUpgradeItems,
    MAX_UPGRADE_LEVEL,
    UPGRADE_CHANCE_STEP,
    UPGRADE_STAT_PERCENT,
    getUpgradeGoldCost,
    getUpgradeChanceAtLevel,
    applyUpgradeLevelToData,
    rollGearUpgrade,
    getUpgradeItemSellPrice
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { STONE_TYPES, ORB_TYPES, getUpgradeItemSellPrice };
