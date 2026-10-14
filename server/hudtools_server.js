// =============================================================================
// hudtools_server.js — ONLINE MODE settings for the MINI MAP and the EQUIP / UNEQUIP button.
// -----------------------------------------------------------------------------
// Lives on the SERVER (GitHub / Render) with the other *_server.js files. server.js sends
// the source of every server/*_server.js file to the client after login, and running it
// there publishes HUDTOOLS_ONLINE (same pattern as online_server.js's ONLINE_RULES), so
// these numbers/texts can't be changed by editing the public game files.
// The OFFLINE copy of the same settings is data/hudtools.js.
// =============================================================================
const HUDTOOLS_ONLINE = {

  // MINI MAP — small square map beside the OPTIONS button.
  MINIMAP: {
    enabled: true,
    size: 76,                 // width and height in pixels
    refreshMs: 120,           // how often it redraws (higher = lighter on the phone)
    showBots: true,           // enemies as red dots
    showPortals: true,        // entrances / exits
    showOtherPlayers: true,   // other players as white dots
    showViewBox: true,        // thin box showing what the screen currently sees
    background: "rgba(4,16,22,0.82)",
    mapColor: "rgba(20,60,70,0.85)",
    border: "rgba(0,255,210,0.55)",
    obstacleColor: "rgba(120,140,150,0.9)",
    portalColor: "#2ee6ff",
    botColor: "#ff4b4b",
    otherPlayerColor: "#ffffff",
    playerColor: "#3dff7a",
    viewBoxColor: "rgba(255,255,255,0.45)",
    botDot: 2,                // dot sizes in pixels
    otherPlayerDot: 2.5,
    playerDot: 3.5
  },

  // EQUIP / UNEQUIP — the button in the item popup (tap an item in the inventory).
  EQUIP: {
    equipLabel: "Equip",
    unequipLabel: "Unequip",
    equippedMessage: "Equipped ",
    unequippedMessage: "Unequipped ",
    fullMessage: "Inventory is full, cannot remove item. Player must discard or drop some items first.",
    cannotEquipMessage: "This item cannot be equipped.",
    // which circle slot(s) each item type goes to (first free one is used; if all are taken, the first is swapped)
    slotsByType: {
      weapon: ["weapon"],
      armor: ["armor"],
      ring: ["ring1", "ring2"],
      accessory: ["accessory", "accessory2"],
      magazine: ["magazine"]
    },
    // slots that count as "equipped" (an item in one of these shows UNEQUIP instead of EQUIP)
    circleSlots: ["weapon", "armor", "magazine", "accessory", "ring1", "ring2", "accessory2"]
  }
};

globalThis["HUDTOOLS_ONLINE"] = HUDTOOLS_ONLINE;
if (typeof module !== "undefined") module.exports = { HUDTOOLS_ONLINE };
