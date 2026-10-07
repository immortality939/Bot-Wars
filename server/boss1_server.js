// =============================================================================
// boss1_server.js  —  BOSS EVENT MAP (Map Creator format)
// =============================================================================
// Private arena, reached ONLY through WAR ZONE > BOSS EVENT > ENTER MAP (it has no
// portals, and no other map has a portal to it). The schedule / level rules live in
// server.js (BOSS_EVENT) and online_client.js (OL_BOSS). The map KEY must stay
// "BOSSEVENT" — both of those files look for it.
//
// worldWidth / worldHeight = size of the map, mapImage = its background picture.
// bots: name = enemy type (see bot_server.js), x / y = where it starts (its center).
// Players enter near the bottom middle (bossEnter in server.js).
window.CUSTOM_MAPS = window.CUSTOM_MAPS || {};

window.CUSTOM_MAPS["BOSSEVENT"] = {
  name: "BOSSEVENT",
  worldWidth: 2000,
  worldHeight: 2000,
  mapImage: "image/blevel1.png",
  obstacles: [

  ],
 bots: [
    { name: "boss12", x: 397, y: 274 },
    { name: "boss16", x: 1565, y: 372 },
    { name: "boss3", x: 1808, y: 800 },
    { name: "boss6", x: 417, y: 1468 },
    { name: "boss10", x: 1730, y: 1504 },
    { name: "boss13", x: 301, y: 1195 },
    { name: "boss1", x: 752, y: 952 },
    { name: "boss15", x: 1097, y: 762 },
    { name: "boss7", x: 327, y: 721 },
    { name: "boss5", x: 978, y: 387 },
    { name: "boss4", x: 1803, y: 562 },
    { name: "boss8", x: 1790, y: 1152 },
    { name: "boss17", x: 516, y: 1791 },
    { name: "boss9", x: 1024, y: 1604 },
    { name: "boss14", x: 1693, y: 1814 },
    { name: "boss2", x: 1066, y: 1309 },
    { name: "boss11", x: 1434, y: 1039 }
  ],
  portals: [

  ]
};
