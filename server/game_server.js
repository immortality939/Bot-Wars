// =============================================================================
// game_server.js  —  ROOM / PARTY / LOOT TUNING (ONLINE MODE)
// =============================================================================
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, same as every other *_server.js file — so none of these numbers
// or rules can be read or edited by a player. It's the home for small
// hardcoded values that control server behavior but don't obviously belong
// inside one specific *_server.js file (weapon/armor/character/item/etc).
//
// Start moving other hardcoded server.js numbers in here over time — this
// file is meant to grow, not stay this short.
// =============================================================================



// ---------------------------------------------------------------------------
// ROOM DROPS — a room (one map instance, one channel) never holds more than
// this many ground items at once; the oldest is deleted to make space for a
// new one. Keeps a long-running room from accumulating forever if nobody
// loots. Used by server.js's "dropAdd" / "invDropAdd" handlers.
// ---------------------------------------------------------------------------
const MAX_ROOM_DROPS = 400;



// ---------------------------------------------------------------------------
// PARTY LOOT — how a party (2+ members) splits a ground item that a solo
// player would otherwise just keep outright. Every ground-item category
// (see item_server.js's createItemDrop()/createInventoryItemDrop() —
// "weapon", "armor", "invItem", "stone", "orb", "gold", or the default
// "item") funnels into exactly ONE of these three rules. server.js's
// "dropTake" handler looks the claimed drop's category up in here and
// applies the matching rule instead of always awarding the picker.
//
//   ALTERNATE — gear/materials (weapons, armor, dropped inventory items,
//     upgrade stones/orbs): goes to ONE party member at a time. Turn order
//     follows the party's member list and rotates every time ANY member
//     claims a drop in this rule (see getPartyLootTurnId()/
//     advancePartyLootTurn() in character_server.js), so loot spreads out
//     evenly instead of always going to whoever is fastest/nearest.
//
//   SPLIT — gold orbs: the orb's gold amount is divided evenly across
//     every party member, with any remainder (from an amount that doesn't
//     divide evenly) given out one-each starting from the front of the
//     turn order, so no gold is lost to rounding.
//
//   SHARED — consumable buffs/heals (health, shield, speedup, powerup):
//     every party member gets the FULL effect applied to their OWN
//     character, not just whoever walked over the drop. A speedup picked
//     up by one member speeds up the whole party.
//
// A category that isn't listed here falls back to SHARED — the safest
// default, since worst case everyone gets an effect meant for one person,
// rather than loot silently disappearing.
// ---------------------------------------------------------------------------
const PARTY_LOOT_RULES = {
  weapon: "ALTERNATE",
  armor: "ALTERNATE",
  invItem: "ALTERNATE",
  stone: "ALTERNATE",
  orb: "ALTERNATE",
  gold: "SPLIT",
  item: "SHARED"
};

function partyLootRuleForCategory(category) {
  return PARTY_LOOT_RULES[category] || "SHARED";
}



// ---- export for server.js (Node) ----
if (typeof module !== "undefined") {
  module.exports = { MAX_ROOM_DROPS, PARTY_LOOT_RULES, partyLootRuleForCategory };
}
