// =============================================================================
// obstacles_server.js  —  ONLINE MODE obstacle types
// =============================================================================
// Edit the numbers in here to change the obstacles used in ONLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends this table to each player
// when they join an online match.
// =============================================================================

// OBSTACLE_TYPES
//
// Each entry describes one kind of obstacle (a solid block that players and
// bullets collide with).
//
// FIELDS:
//   name   — the obstacle's own name (same as its key below).
//   width  — width of the obstacle, in world units.
//   height — height of the obstacle, in world units.
//   image  — picture drawn for this obstacle (file in the game's image folder).
const OBSTACLE_TYPES = {

  box: {
    name: "box",
    width: 50,     // width of the box
    height: 50,    // height of the box
    image: "image/box.png"
  },

  metal: {
    name: "metal",
    width: 50,
    height: 50,
    image: "image/metal.png"
  }

};

function getObstacleType(name) {
  return OBSTACLE_TYPES[name] || null;
}

function getAllObstacleTypes() {
  return Object.values(OBSTACLE_TYPES);
}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { OBSTACLE_TYPES };
