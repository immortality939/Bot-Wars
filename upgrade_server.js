// =============================================================================
// upgrade_server.js  —  ONLINE MODE copy of upgrade.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// upgrade.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
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



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    STONE_TYPES,
    ORB_TYPES,
    getStone,
    getAllStones,
    getOrb,
    getAllOrbs,
    getUpgradeItem,
    getAllUpgradeItems
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { STONE_TYPES, ORB_TYPES };
