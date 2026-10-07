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
    // boss1
    { name: "boss1", x: 575, y: 1443 },
    { name: "boss1", x: 1409, y: 1419 },
    { name: "boss1", x: 981, y: 1208 },
    { name: "boss1", x: 1228, y: 1228 },
    // boss2
    { name: "boss2", x: 780, y: 1214 },
    { name: "boss2", x: 1614, y: 1861 },
    { name: "boss2", x: 352, y: 1823 },
    { name: "boss2", x: 1654, y: 1652 },
    // boss3
    { name: "boss3", x: 382, y: 1460 },
    { name: "boss3", x: 328, y: 1620 },
    { name: "boss3", x: 603, y: 1184 },
    { name: "boss3", x: 1453, y: 1188 },
    // boss4
    { name: "boss4", x: 999, y: 1025 },
    { name: "boss4", x: 1632, y: 1391 },
    { name: "boss4", x: 1186, y: 972 },
    { name: "boss4", x: 1624, y: 1234 },
    // boss5
    { name: "boss5", x: 760, y: 976 },
    { name: "boss5", x: 1818, y: 1824 },
    { name: "boss5", x: 603, y: 1023 },
    { name: "boss5", x: 1828, y: 1664 },
    // boss6
    { name: "boss6", x: 166, y: 1822 },
    { name: "boss6", x: 1429, y: 1022 },
    { name: "boss6", x: 348, y: 1192 },
    { name: "boss6", x: 148, y: 1638 },
    // boss7
    { name: "boss7", x: 150, y: 1407 },
    { name: "boss7", x: 1877, y: 1413 },
    { name: "boss7", x: 370, y: 1009 },
    { name: "boss7", x: 1638, y: 1014 },
    // boss8
    { name: "boss8", x: 1242, y: 806 },
    { name: "boss8", x: 174, y: 1222 },
    { name: "boss8", x: 810, y: 788 },
    { name: "boss8", x: 974, y: 768 },
    // boss9
    { name: "boss9", x: 1866, y: 1248 },
    { name: "boss9", x: 603, y: 796 },
    { name: "boss9", x: 1411, y: 796 },
    { name: "boss9", x: 1622, y: 814 },
    // boss10
    { name: "boss10", x: 366, y: 820 },
    { name: "boss10", x: 1028, y: 608 },
    { name: "boss10", x: 124, y: 1005 },
    { name: "boss10", x: 1859, y: 967 },
    // boss11
    { name: "boss11", x: 1232, y: 580 },
    { name: "boss11", x: 760, y: 566 },
    { name: "boss11", x: 1449, y: 598 },
    { name: "boss11", x: 610, y: 548 },
    // boss12
    { name: "boss12", x: 146, y: 762 },
    { name: "boss12", x: 1868, y: 758 },
    { name: "boss12", x: 1648, y: 578 },
    { name: "boss12", x: 374, y: 552 },
    // boss13
    { name: "boss13", x: 1194, y: 364 },
    { name: "boss13", x: 993, y: 332 },
    { name: "boss13", x: 802, y: 334 },
    { name: "boss13", x: 1846, y: 563 },
    // boss14
    { name: "boss14", x: 128, y: 564 },
    { name: "boss14", x: 1443, y: 346 },
    { name: "boss14", x: 568, y: 334 },
    { name: "boss14", x: 334, y: 342 },
    // boss15
    { name: "boss15", x: 1672, y: 342 },
    { name: "boss15", x: 972, y: 179 },
    { name: "boss15", x: 185, y: 382 },
    { name: "boss15", x: 764, y: 161 },
    // boss16
    { name: "boss16", x: 1401, y: 170 },
    { name: "boss16", x: 549, y: 183 },
    { name: "boss16", x: 1854, y: 350 },
    { name: "boss16", x: 1204, y: 119 },
    // boss17
    { name: "boss17", x: 378, y: 121 },
    { name: "boss17", x: 1656, y: 123 },
    { name: "boss17", x: 156, y: 134 },
    { name: "boss17", x: 1845, y: 126 }
  ],
  portals: [

  ]
};
