// =============================================================================
// cwmap_server.js  —  CLAN WAR MAP (Map Creator format, same map as data/CWmap.js)
// =============================================================================
// Reached ONLY through WAR ZONE > CLAN WAR (no portal leads here). The rules
// (days, hours, authentication time, rewards) live in server.js (CLAN_WAR) and
// online_client.js (OL_CW). The map KEY must stay "CWmap".
window.CUSTOM_MAPS = window.CUSTOM_MAPS || {};

window.CUSTOM_MAPS["CWmap"] = {
  name: "CWmap",
  worldWidth: 2000,
  worldHeight: 2000,
  mapImage: "image/CWmap.png",
  obstacles: [

  ],
  bots: [

  ],
  portals: [

  ]
};
