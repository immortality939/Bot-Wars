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
  },

  tree1: {
    name: "tree1",
    width: 50,
    height: 50,
    image: "image/tree1.png"
  },

  tree2: {
    name: "tree2",
    width: 50,
    height: 50,
    image: "image/tree2.png"
  },

  tree3: {
    name: "tree3",
    width: 50,
    height: 50,
    image: "image/tree3.png"
  },

  tree4: {
    name: "tree4",
    width: 50,
    height: 50,
    image: "image/tree4.png"
  },

  tree5: {
    name: "tree5",
    width: 50,
    height: 50,
    image: "image/tree5.png"
  },

  tree6: {
    name: "tree6",
    width: 50,
    height: 50,
    image: "image/tree6.png"
  },

  tree7: {
    name: "tree7",
    width: 50,
    height: 50,
    image: "image/tree7.png"
  },

  tree8: {
    name: "tree8",
    width: 50,
    height: 50,
    image: "image/tree8.png"
  },

  tree9: {
    name: "tree9",
    width: 50,
    height: 50,
    image: "image/tree9.png"
  },

  tree10: {
    name: "tree10",
    width: 50,
    height: 50,
    image: "image/tree10.png"
  },

  tree11: {
    name: "tree11",
    width: 50,
    height: 50,
    image: "image/tree11.png"
  },

  tree12: {
    name: "tree12",
    width: 50,
    height: 50,
    image: "image/tree12.png"
  },

  tree13: {
    name: "tree13",
    width: 50,
    height: 50,
    image: "image/tree13.png"
  },

  tree14: {
    name: "tree14",
    width: 50,
    height: 50,
    image: "image/tree14.png"
  },

  tree15: {
    name: "tree15",
    width: 50,
    height: 50,
    image: "image/tree15.png"
  },

  car1: {
    name: "car1",
    width: 50,
    height: 50,
    image: "image/car1.png"
  },

  car2: {
    name: "car2",
    width: 50,
    height: 50,
    image: "image/car2.png"
  },

  car3: {
    name: "car3",
    width: 50,
    height: 50,
    image: "image/car3.png"
  },

  car4: {
    name: "car4",
    width: 50,
    height: 50,
    image: "image/car4.png"
  },

  car5: {
    name: "car5",
    width: 50,
    height: 50,
    image: "image/car5.png"
  },

  car6: {
    name: "car6",
    width: 50,
    height: 50,
    image: "image/car6.png"
  },

  rock1: {
    name: "rock1",
    width: 50,
    height: 50,
    image: "image/rock1.png"
  },

  rock2: {
    name: "rock2",
    width: 50,
    height: 50,
    image: "image/rock2.png"
  },

  rock3: {
    name: "rock3",
    width: 50,
    height: 50,
    image: "image/rock3.png"
  },

  rock4: {
    name: "rock4",
    width: 50,
    height: 50,
    image: "image/rock4.png"
  },

  rock5: {
    name: "rock5",
    width: 50,
    height: 50,
    image: "image/rock5.png"
  },

  rock6: {
    name: "rock6",
    width: 50,
    height: 50,
    image: "image/rock6.png"
  },

  rock7: {
    name: "rock7",
    width: 50,
    height: 50,
    image: "image/rock7.png"
  },

  rock8: {
    name: "rock8",
    width: 50,
    height: 50,
    image: "image/rock8.png"
  },

  rock9: {
    name: "rock9",
    width: 50,
    height: 50,
    image: "image/rock9.png"
  },

  rock10: {
    name: "rock10",
    width: 50,
    height: 50,
    image: "image/rock10.png"
  },

  rock11: {
    name: "rock11",
    width: 50,
    height: 50,
    image: "image/rock11.png"
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
