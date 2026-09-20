// =============================================================================
// shop_server.js  —  ONLINE MODE copy of shop.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// shop.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
// =============================================================================

// shop.js
//
// The Shop screen's own price list. Each entry just references an item
// that already exists by name in weapon.js (WEAPONS), armor.js
// (ARMOR_TYPES), or upgrade.js (STONE_TYPES) — this file does NOT define
// the item itself (stats/image/description all still come from those
// files), it only says "sell this item, at this gold price".
//
// Adding a { name, price } entry below is what puts that item up for
// sale in the Shop screen (see index.html's Shop script, which reads
// SHOP_WEAPONS/SHOP_ARMORS/SHOP_STONES/SHOP_ACCESSORIES to build each
// category's 6x6 paginated grid) — no other file needs to change.
// Removing an entry takes it out of the shop only; the underlying
// weapon/armor/stone itself is untouched and still usable normally
// (starting gear, bot drops, etc.).
//
// FIELDS:
//   name  — must exactly match that item's own `name` key in weapon.js /
//           armor.js / upgrade.js.
//   price — gold-orb cost shown on its shop slot and charged on Buy.
//
// Order here is display order in the Shop grid (first entry = slot 1,
// top-left of page 1/4).

const SHOP_WEAPONS = [
  { name: "uzi", price: 300 },
  { name: "ak47", price: 500 },
  { name: "sniper", price: 850 },
  { name: "shotgun", price: 650 }
];

const SHOP_ARMORS = [
  { name: "armor1", price: 400 },
  { name: "armor2", price: 600 },
  { name: "armor3", price: 900 }
];

const SHOP_STONES = [
  { name: "specialstone", price: 200 }
];

// No accessory item type exists yet (see item.js) — add entries here,
// same { name, price } shape as above, once one does.
const SHOP_ACCESSORIES = [];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SHOP_WEAPONS,
    SHOP_ARMORS,
    SHOP_STONES,
    SHOP_ACCESSORIES
  };
}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { SHOP_WEAPONS, SHOP_ARMORS, SHOP_STONES, SHOP_ACCESSORIES };
