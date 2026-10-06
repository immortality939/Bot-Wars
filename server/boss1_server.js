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
    { name: "boss1", x: 1000, y: 1000 }
  ],
  portals: [

  ]
};
