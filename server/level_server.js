// =============================================================================
// level_server.js  —  ONLINE MODE copy of level.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// level.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
// =============================================================================

// level.js

const LEVELS = {

  // LEVEL 1: simple open box, no obstacles
  1: {
    name: "Plain Box",

    worldWidth: 700,
    worldHeight: 700,

    mapImage: "image/blevel1.png",

    // Thumbnail shown as this level's button on the "Choose Level" screen
    imageBackground: "image/level1.png",

    // No obstacles on this level
    obstacles: [],

    // ENEMY BOTS FOR THIS LEVEL (offline mode only)
    // name = a bot type from bot.js's BOT_TYPES, quantity = how many to spawn.
    // Bots are spawned at random spots on the map, kept away from the
    // player's spawn point based on each bot's own view range (see bot.js).
    enemyBots: [
      { name: "rusher", quantity: 10 }
    ]
  },


  // LEVEL 2: tall map with a grid of wooden crates
  2: {
    name: "Level 2",

    worldWidth: 700,
    worldHeight: 1700,

    mapImage: "image/blevel2.png",

    // Thumbnail shown as this level's button on the "Choose Level" screen
    imageBackground: "image/level2.png",

    // Obstacles are laid out as a grid instead of a fixed list,
    // so they can be generated to fit the world size below.
    obstacleGrid: {
      cols: 3,
      rows: 8,
      spacing: 75
    },

    // ENEMY BOTS FOR THIS LEVEL (offline mode only)
    enemyBots: [
      { name: "rusher", quantity: 6 }

    ]
  },


  // LEVEL 3: big grassland map, obstacle layout + spawn points based on
  // the sample design image (brown blocks = obstacles, red dots = spawns).
  // Both lists are plain arrays you can freely edit, add to, or remove from.
  3: {
    name: "Level 3",

    worldWidth: 1500,
    worldHeight: 1500,

    mapImage: "image/blevel3.png",

    // Thumbnail shown as this level's button on the "Choose Level" screen.
    // Add your own image/level3.png file, or point this at any image you like.
    imageBackground: "image/level3.png",

    // Manually placed boxes (woodbox.png). x,y = top-left corner of the box.
    obstacles: [
      // Top pair of blocks
      { x: 220, y: 180, width: 420, height: 65 },
      { x: 885, y: 185, width: 455, height: 65 },

      // Middle horizontal block
      { x: 375, y: 415, width: 770, height: 65 },

      // Middle-left / middle-right blocks
      { x: 5,    y: 600, width: 505, height: 90 },
      { x: 1075, y: 640, width: 420, height: 85 },

      // Center vertical block
      { x: 710, y: 665, width: 70, height: 295 },

      // Bottom pair of blocks
      { x: 250, y: 1070, width: 465, height: 90 },
      { x: 975, y: 1070, width: 420, height: 95 }

      // Add more boxes here the same way: { x: ..., y: ..., width: ..., height: ... }
    ],

    // Player respawn points (matches the red dots in the sample design).
    // On spawn/respawn, one of these is picked at random.
    spawnPoints: [
      // Top row
      { x: 280,  y: 88 },
      { x: 480,  y: 90 },
      { x: 740,  y: 125 },
      { x: 978,  y: 108 },
      { x: 1150, y: 108 },
      { x: 1308, y: 115 },

      // Bottom row
      { x: 300,  y: 1365 },
      { x: 528,  y: 1368 },
      { x: 828,  y: 1340 },
      { x: 1060, y: 1373 },
      { x: 1293, y: 1365 }

      // Add more spawn points here the same way: { x: ..., y: ... }
    ],

    // ENEMY BOTS FOR THIS LEVEL (offline mode only)
    enemyBots: [
      { name: "rusher", quantity: 16 },
      { name: "shooter", quantity: 8 },
      { name: "assaulter", quantity: 12 },
      { name: "guard", quantity: 8 }
    ]
  },


  // LEVEL 4: 700x700 maze built directly from the provided maze design image.
  // Dark navy in that image = walkable path/battleground; everything else
  // inside the canvas = wall. The obstacle rectangles below were traced
  // pixel-for-pixel from that image, so the in-game layout matches it exactly.
  4: {
    name: "Level 4",

    worldWidth: 700,
    worldHeight: 700,

    mapImage: "image/blevel4.png",

    // Thumbnail shown as this level's button on the "Choose Level" screen.
    // Add your own image/level4.png file, or point this at any image you like.
    imageBackground: "image/level4.png",

    // Walls of the maze use metal.png instead of the default woodbox.png.
    obstacleImage: "image/metal.png",

    // Walls of the maze. x,y = top-left corner. Traced directly from the
    // maze design image (non-path area).
    obstacles: [
      { x: 0,   y: 0,   width: 700, height: 43 },
      { x: 0,   y: 43,  width: 88,  height: 88 },
      { x: 186, y: 43,  width: 514, height: 19 },
      { x: 186, y: 62,  width: 241, height: 69 },
      { x: 646, y: 62,  width: 54,  height: 145 },
      { x: 0,   y: 131, width: 123, height: 87 },
      { x: 160, y: 131, width: 267, height: 22 },
      { x: 160, y: 153, width: 70,  height: 32 },
      { x: 361, y: 207, width: 164, height: 44 },
      { x: 635, y: 207, width: 65,  height: 372 },
      { x: 0,   y: 218, width: 230, height: 33 },
      { x: 0,   y: 251, width: 88,  height: 99 },
      { x: 372, y: 251, width: 153, height: 11 },
      { x: 160, y: 295, width: 201, height: 55 },
      { x: 0,   y: 350, width: 55,  height: 98 },
      { x: 252, y: 350, width: 109, height: 10 },
      { x: 252, y: 360, width: 273, height: 22 },
      { x: 427, y: 382, width: 98,  height: 55 },
      { x: 252, y: 437, width: 55,  height: 11 },
      { x: 394, y: 437, width: 131, height: 22 },
      { x: 0,   y: 448, width: 307, height: 55 },
      { x: 0,   y: 503, width: 77,  height: 109 },
      { x: 394, y: 543, width: 131, height: 14 },
      { x: 318, y: 557, width: 207, height: 22 },
      { x: 318, y: 579, width: 218, height: 33 },
      { x: 619, y: 579, width: 81,  height: 33 },
      { x: 0,   y: 612, width: 274, height: 66 },
      { x: 646, y: 612, width: 54,  height: 66 },
      { x: 0,   y: 678, width: 700, height: 22 }

      // Add more boxes here the same way: { x: ..., y: ..., width: ..., height: ... }
    ],

    // Player respawn points, matching the 4 red dots in the maze design image.
    spawnPoints: [
      { x: 166, y: 61 },
      { x: 617, y: 94 },
      { x: 122, y: 543 },
      { x: 619, y: 646 }

      // Add more spawn points here the same way: { x: ..., y: ... }
    ],

    // ENEMY BOTS FOR THIS LEVEL (offline mode only)
    enemyBots: [
      { name: "rusher", quantity: 3 },
      { name: "assaulter", quantity: 3 },
      { name: "guard", quantity: 2 }
    ]
  },


  // LEVEL 5: 600x600 layout traced directly from the provided design image.
  // Black in that image = walkable path/battleground; everything else
  // (including the area outside the shape) = wall/border collision.
  // The battleground floor uses metal.png as its background texture, and
  // the walls (including the outside border) use stone.png so the area
  // outside the battleground isn't just a flat, empty-looking color.
  5: {
    name: "Level 5",

    worldWidth: 600,
    worldHeight: 600,

    mapImage: "image/metal.png",

    // Thumbnail shown as this level's button on the "Choose Level" screen.
    // Add your own image/level5.png file, or point this at any image you like.
    imageBackground: "image/level5.png",

    // Walls (including the outside border) use stone.png instead of a
    // plain flat color.
    obstacleImage: "image/stone.png",

    // Walls traced directly from the design image (everything that was NOT
    // the black path area, including the border/outside). x,y = top-left corner.
    obstacles: [
      { x: 0,   y: 0,   width: 600, height: 56 },
      { x: 0,   y: 56,  width: 66,  height: 197 },
      { x: 582, y: 56,  width: 18,  height: 515 },
      { x: 197, y: 121, width: 141, height: 66 },
      { x: 413, y: 168, width: 56,  height: 150 },
      { x: 0,   y: 253, width: 197, height: 65 },
      { x: 0,   y: 318, width: 263, height: 57 },
      { x: 347, y: 318, width: 122, height: 57 },
      { x: 0,   y: 375, width: 197, height: 56 },
      { x: 413, y: 375, width: 56,  height: 56 },
      { x: 0,   y: 431, width: 47,  height: 140 },
      { x: 0,   y: 571, width: 600, height: 29 }

      // Add more boxes here the same way: { x: ..., y: ..., width: ..., height: ... }
    ],

    // The design image had no marked spawn points, so these are placed
    // directly on the walkable (black) path, verified clear of walls.
    // Feel free to edit/add your own.
    spawnPoints: [
      { x: 100, y: 80 },
      { x: 500, y: 80 },
      { x: 100, y: 550 },
      { x: 500, y: 550 },
      { x: 90,  y: 220 },
      { x: 70,  y: 450 },
      { x: 300, y: 240 }

      // Add more spawn points here the same way: { x: ..., y: ... }
    ],

    // ENEMY BOTS FOR THIS LEVEL (offline mode only)
    enemyBots: [
      { name: "rusher", quantity: 3 },
      { name: "assaulter", quantity: 3 },
      { name: "guard", quantity: 2 }
    ]
  }

};



// Turn an obstacleGrid definition into a real list of {x, y, width, height} boxes
function buildObstacleGrid(level) {

  const grid = level.obstacleGrid;

  const cols = grid.cols;
  const rows = grid.rows;
  const spacing = grid.spacing;

  const totalSpacingX = spacing * (cols + 1); // left, between, right
  const totalSpacingY = spacing * (rows + 1); // top, between, bottom

  const boxWidth = (level.worldWidth - totalSpacingX) / cols;
  const boxHeight = (level.worldHeight - totalSpacingY) / rows;

  const obstacles = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      obstacles.push({
        x: spacing + col * (boxWidth + spacing),
        y: spacing + row * (boxHeight + spacing),
        width: boxWidth,
        height: boxHeight
      });
    }
  }

  return obstacles;
}



// GET LEVEL BY NUMBER
// Returns a fresh copy of the level, with obstacles always
// as a ready-to-use array (built from obstacleGrid if needed).
function getLevel(levelNumber) {

  const base = LEVELS[levelNumber];

  if (!base) {
    throw new Error("Level not found: " + levelNumber);
  }

  const level = JSON.parse(JSON.stringify(base));

  if (level.obstacleGrid) {
    level.obstacles = buildObstacleGrid(level);
  } else if (!level.obstacles) {
    level.obstacles = [];
  }

  // Levels without their own spawnPoints just spawn in the center
  if (!level.spawnPoints || level.spawnPoints.length === 0) {
    level.spawnPoints = [
      { x: level.worldWidth / 2, y: level.worldHeight / 2 }
    ];
  }

  // Levels without their own enemyBots list simply have no bots
  if (!level.enemyBots) {
    level.enemyBots = [];
  }

  return level;
}



// GET ALL LEVEL NUMBERS (e.g. [1, 2, 3])
function getAllLevels() {
  return Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
}



// GET LEVEL LIST FOR THE "CHOOSE LEVEL" MENU
// Returns [{ number, name, imageBackground }, ...] sorted by level number,
// so the level-select screen can be built automatically from level.js —
// add a new level above and it shows up here with no other changes needed.
function getLevelList() {
  return getAllLevels().map((number) => {
    const level = LEVELS[number];
    return {
      number: number,
      name: level.name,
      imageBackground: level.imageBackground || "image/level1.png"
    };
  });
}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    LEVELS,
    getLevel,
    getAllLevels,
    getLevelList
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { LEVELS };
