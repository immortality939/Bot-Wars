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

// =============================================================================
// REAL-MONEY SHOP  (the SHOP button at the top-right in ONLINE mode)
// =============================================================================
// Same items as above, but sold for REAL MONEY (Philippine pesos) instead of
// gold orbs. The gold lists above are left alone on purpose: save_guard.js
// still reads them to know what a gold purchase could have cost.
//
//   price  — PESOS (PHP) per item. EDIT THESE, the numbers below are only
//            starter prices.
//   name   — must match the item's name in weapon_server.js / armor_server.js /
//            upgrade_server.js, same as the gold lists.
//
// HOW PLAYERS PAY (server.js does the work, see its "REAL-MONEY SHOP" section):
//   1. AUTOMATIC  — GCash, Maya, GrabPay and credit/debit cards (Visa/Mastercard,
//      so foreign players can pay too) through PayMongo. Needs the environment
//      variable PAYMONGO_SECRET_KEY on the server. The item is delivered by
//      itself a few seconds after the payment goes through.
//   2. MANUAL     — the player sends the money to the GCash number (or bank
//      account) below and types the reference number from the receipt. YOU
//      check your GCash/bank app and approve it on  https://<your-server>/admin/shop
//      (needs the environment variable SHOP_ADMIN_KEY). Then the item is delivered.
//
// Everything in this file is shown to players (it is sent to the game), so put
// ONLY things you want players to see here — never an API key or password.
const REAL_SHOP_CURRENCY = "PHP";

const REAL_SHOP = {
  weapon: [
    { name: "uzi", price: 49 },
    { name: "ak47", price: 0 },
    { name: "sniper", price: 149 },
    { name: "shotgun", price: 129 }
  ],
  armor: [
    { name: "armor1", price: 79 },
    { name: "armor2", price: 119 },
    { name: "armor3", price: 179 }
  ],
  stone: [
    { name: "specialstone", price: 39 }
  ],
  accessory: []
};

const PAYMENT_INFO = {
  gcash: { number: "09673016212", name: "Omar Patrick Nollido" },
  // Bank transfer (InstaPay / PESONet / international wire). Leave accountNumber
  // empty ("") to hide the bank option in the shop; fill all three to show it.
  bank: { bankName: "Asia United Bank (AUB)", accountName: "Omar Patrick Nollido", accountNumber: "934-10-500645-5" }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SHOP_WEAPONS,
    SHOP_ARMORS,
    SHOP_STONES,
    SHOP_ACCESSORIES,
    REAL_SHOP_CURRENCY,
    REAL_SHOP,
    PAYMENT_INFO
  };
}
