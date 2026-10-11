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
];

const SHOP_ARMORS = [
];

const SHOP_STONES = [
  { name: "specialstone", price: 30 }
];

// ACCESSORY tab = rings + accessories (both live in armor_server.js).
const SHOP_ACCESSORIES = [
];

// =============================================================================
// REAL-MONEY SHOP  (the SHOP button at the top-right in ONLINE mode)
// =============================================================================
// Same items as above, but sold for REAL MONEY (Philippine pesos) instead of
// gold orbs. The 4 tier sets (weapons, armor, rings, accessories) are now
// sold ONLY here for pesos; they were removed from the gold lists above.
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

    // --- 4 tiers (PESOS, edit the prices) x berserker, magemaster, bullwark ---
    { name: "gun22", price: 300 },
    { name: "sword22", price: 300 },
    { name: "gauntlet22", price: 300 },
    { name: "gun23", price: 375 },
    { name: "sword23", price: 375 },
    { name: "gauntlet23", price: 375 },
    { name: "gun24", price: 450 },
    { name: "sword24", price: 450 },
    { name: "gauntlet24", price: 450 },
    { name: "gun25", price: 525 },
    { name: "sword25", price: 525 },
    { name: "gauntlet25", price: 525 }
  ],
  armor: [

    // --- 4 tiers (PESOS, edit the prices) x berserker, magemaster, bullwark ---
    { name: "armor47", price: 300 },
    { name: "armor48", price: 300 },
    { name: "armor49", price: 300 },
    { name: "armor50", price: 375 },
    { name: "armor51", price: 375 },
    { name: "armor52", price: 375 },
    { name: "armor53", price: 450 },
    { name: "armor54", price: 450 },
    { name: "armor55", price: 450 },
    { name: "armor56", price: 525 },
    { name: "armor57", price: 525 },
    { name: "armor58", price: 525 }
  ],
  stone: [
    { name: "specialstone", price: 30 }
  ],
  // rings + accessories: 4 tiers (PESOS, edit the prices) x 3 characters
  accessory: [
    { name: "ring44", price: 300 },
    { name: "ring45", price: 300 },
    { name: "ring46", price: 300 },
    { name: "ring47", price: 375 },
    { name: "ring48", price: 375 },
    { name: "ring49", price: 375 },
    { name: "ring50", price: 450 },
    { name: "ring51", price: 450 },
    { name: "ring52", price: 450 },
    { name: "ring53", price: 525 },
    { name: "ring54", price: 525 },
    { name: "ring55", price: 525 },
    { name: "accessory40", price: 300 },
    { name: "accessory41", price: 300 },
    { name: "accessory42", price: 300 },
    { name: "accessory43", price: 375 },
    { name: "accessory44", price: 375 },
    { name: "accessory45", price: 375 },
    { name: "accessory46", price: 450 },
    { name: "accessory47", price: 450 },
    { name: "accessory48", price: 450 },
    { name: "accessory49", price: 525 },
    { name: "accessory50", price: 525 },
    { name: "accessory51", price: 525 }
  ]
};

const PAYMENT_INFO = {
  gcash: { number: "09673016212", name: "Omar Patrick Nollido" },
  // Bank transfer (InstaPay / PESONet / international wire). Leave accountNumber
  // empty ("") to hide the bank option in the shop; fill all three to show it.
  bank: { bankName: "Asia United Bank (AUB)", accountName: "Omar Patrick Nollido", accountNumber: "934-10-500645-5" }
};

// =============================================================================
// POINTS SHOP  (paid with POINTS, not gold and not real money)
// =============================================================================
// Points are earned by watching ads (5 points per finished ad — the AdMob part
// comes next). Every item here is a "half power" copy of one of the shop-set items
// (same picture/name, key ends with "a", every stat is 50% of the original, see
// weapon_server.js / armor_server.js). Tier 1 costs 100 points, then 125, 150, 175.
//
//   name  — must match the item's key in weapon_server.js / armor_server.js.
//   price — POINTS.
const POINTS_SHOP = {
  weapon: [
    { name: "gun22a", price: 100 },
    { name: "sword22a", price: 100 },
    { name: "gauntlet22a", price: 100 },
    { name: "gun23a", price: 125 },
    { name: "sword23a", price: 125 },
    { name: "gauntlet23a", price: 125 },
    { name: "gun24a", price: 150 },
    { name: "sword24a", price: 150 },
    { name: "gauntlet24a", price: 150 },
    { name: "gun25a", price: 175 },
    { name: "sword25a", price: 175 },
    { name: "gauntlet25a", price: 175 }
  ],
  armor: [
    { name: "armor47a", price: 100 },
    { name: "armor48a", price: 100 },
    { name: "armor49a", price: 100 },
    { name: "armor50a", price: 125 },
    { name: "armor51a", price: 125 },
    { name: "armor52a", price: 125 },
    { name: "armor53a", price: 150 },
    { name: "armor54a", price: 150 },
    { name: "armor55a", price: 150 },
    { name: "armor56a", price: 175 },
    { name: "armor57a", price: 175 },
    { name: "armor58a", price: 175 }
  ],
  // rings + accessories
  accessory: [
    { name: "ring44a", price: 100 },
    { name: "ring45a", price: 100 },
    { name: "ring46a", price: 100 },
    { name: "ring47a", price: 125 },
    { name: "ring48a", price: 125 },
    { name: "ring49a", price: 125 },
    { name: "ring50a", price: 150 },
    { name: "ring51a", price: 150 },
    { name: "ring52a", price: 150 },
    { name: "ring53a", price: 175 },
    { name: "ring54a", price: 175 },
    { name: "ring55a", price: 175 },
    { name: "accessory40a", price: 100 },
    { name: "accessory41a", price: 100 },
    { name: "accessory42a", price: 100 },
    { name: "accessory43a", price: 125 },
    { name: "accessory44a", price: 125 },
    { name: "accessory45a", price: 125 },
    { name: "accessory46a", price: 150 },
    { name: "accessory47a", price: 150 },
    { name: "accessory48a", price: 150 },
    { name: "accessory49a", price: 175 },
    { name: "accessory50a", price: 175 },
    { name: "accessory51a", price: 175 }
  ]
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SHOP_WEAPONS,
    SHOP_ARMORS,
    SHOP_STONES,
    SHOP_ACCESSORIES,
    REAL_SHOP_CURRENCY,
    REAL_SHOP,
    POINTS_SHOP,
    PAYMENT_INFO
  };
}
