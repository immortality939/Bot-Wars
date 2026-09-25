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
    spawnChance: 1.25,     // 50% chance to drop when a bot that carries it dies
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
    effectChance: 1.25,       // 50% chance to trigger per hit
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
    effectChance: 1.25,
    millisec: 0.009,   // burn damage dealt per millisecond while the effect is active — tune this to change burn strength (e.g. 0.05 = 150 total dmg over the 3s effectDuration)
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    radius: 10,

    image: "image/fireorb.png",
    orbEffect: "fire"
  },

  iceorb: {
    name: "iceorb",
    category: "orb",

    spawnChance: 0.3,

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
// UPGRADING GEAR (gear.data.upgradeLevel, 0-9) — moved here from index.html so
// online mode can run upgrade_server.js's copy instead of the player's own.
//   - Success chance for the NEXT level = the stone's own upgradeChance
//     (e.g. specialstone's 100%) minus UPGRADE_CHANCE_STEP for every level the
//     gear already has. So +0 -> +1 rolls at the stone's full upgradeChance,
//     +1 -> +2 rolls at (upgradeChance - 12%), +2 -> +3 at
//     (upgradeChance - 24%), and so on, never dropping below 0%.
//   - Every SUCCESSFUL weapon upgrade multiplies the weapon's CURRENT damage
//     by a percentage tiered by the level it lands on (each upgrade compounds
//     off the previous result, not the original base damage): landing on +1
//     to +3 adds 15% of current damage, +4 to +6 adds 20%, and +7 to +9 adds
//     25% (see getUpgradeDamagePercent below). E.g. 25 damage +1 (15%) ->
//     28.75, then +2 (15% of 28.75) -> 33.06, and so on.
//   - Every SUCCESSFUL armor upgrade adds defense AND max health, both
//     tiered by the level it lands on: landing on +1 to +3 adds +1 defense /
//     +5 health, +4 to +6 adds +2 defense / +10 health, and +7 to +9 adds +3
//     defense / +15 health (see getUpgradeArmorBonus / getUpgradeArmorHealthBonus).
//   - Capped at MAX_UPGRADE_LEVEL — the button/roll refuses once there.
//   - A stone is consumed on every attempt, success or failure — that part
//     stays in index.html since it's just removing an inventory item.
// ---------------------------------------------------------------------------
const MAX_UPGRADE_LEVEL = 9;
const UPGRADE_CHANCE_STEP = 0.12;      // shaved off success chance per existing level

// Percentage of the weapon's CURRENT damage added per successful upgrade,
// tiered by which level it lands on (not the level upgraded from).
function getUpgradeDamagePercent(nextLevel) {
  if (nextLevel <= 3) return 0.15;
  if (nextLevel <= 6) return 0.20;
  return 0.25;
}

// Flat defense added per successful armor upgrade, tiered by landing level.
function getUpgradeArmorBonus(nextLevel) {
  if (nextLevel <= 3) return 1;
  if (nextLevel <= 6) return 2;
  return 3;
}

// Flat max-health added per successful armor upgrade, tiered by landing level.
function getUpgradeArmorHealthBonus(nextLevel) {
  if (nextLevel <= 3) return 5;
  if (nextLevel <= 6) return 10;
  return 15;
}

// Success chance for taking `currentLevel` up to `currentLevel + 1`, given
// the stone's own base upgradeChance (e.g. 1.0 for specialstone).
function getUpgradeChanceAtLevel(baseChance, currentLevel) {
  return Math.max(0, (baseChance || 0) - UPGRADE_CHANCE_STEP * currentLevel);
}

// Rolls ONE upgrade attempt on a weapon or armor item and returns the result;
// does not touch the stone — index.html still consumes that itself.
//   gearType   — "weapon" or "armor" (see entryType() in index.html)
//   gearData   — the item's current gear.data object (not mutated)
//   baseChance — the stone's own upgradeChance (relic.data.upgradeChance)
// Returns { success, maxed, data }: `data` is the NEW gear.data to store on
// success, or the ORIGINAL gearData unchanged on a fail/maxed/no-op result.
function rollGearUpgrade(gearType, gearData, baseChance) {
  const currentLevel = (gearData && gearData.upgradeLevel) || 0;
  if (currentLevel >= MAX_UPGRADE_LEVEL) return { success: false, maxed: true, data: gearData };

  const chance = getUpgradeChanceAtLevel(baseChance, currentLevel);
  const success = Math.random() < chance;
  if (!success) return { success: false, maxed: false, data: gearData };

  const nextLevel = currentLevel + 1;
  let data = gearData;

  if (gearType === "weapon" && typeof gearData.physicalDamage === "number") {
    // Compounding percentage bump — taken off the weapon's CURRENT damage, so
    // each successive upgrade builds on the last result. Rounded to 2 decimal
    // places to avoid drifting into long floats (25 -> 28.75 -> 33.06 -> ...).
    const bonusPct = getUpgradeDamagePercent(nextLevel);
    const newDamage = Math.round(gearData.physicalDamage * (1 + bonusPct) * 100) / 100;
    data = { ...gearData, physicalDamage: newDamage, upgradeLevel: nextLevel };
  } else if (gearType === "armor" && typeof gearData.defense === "number") {
    data = {
      ...gearData,
      defense: gearData.defense + getUpgradeArmorBonus(nextLevel),
      health: (gearData.health || 0) + getUpgradeArmorHealthBonus(nextLevel),
      upgradeLevel: nextLevel
    };
  }
  // gearType/field mismatch (e.g. a weapon with no physicalDamage field):
  // the roll still succeeded (and the stone is still spent by index.html),
  // but there's no numeric field to raise, so upgradeLevel does NOT advance
  // — matches the original index.html behavior exactly.

  return { success: true, maxed: false, data };
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
    getUpgradeDamagePercent,
    getUpgradeArmorBonus,
    getUpgradeArmorHealthBonus,
    getUpgradeChanceAtLevel,
    rollGearUpgrade
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { STONE_TYPES, ORB_TYPES };
