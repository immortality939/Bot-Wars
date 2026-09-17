// Obstacle definitions — solid objects that can be placed on the map
// (see level.js for where a level lists which obstacles spawn and where).
// width/height are the obstacle's footprint in world units; image is the
// sprite drawn for it, same "image/<file>.png" convention as weapon.js/
// armor.js/item.js.
const OBSTACLES = {

  box: {
    name: "box",
    width: 50,
    height: 50,
    image: "image/box.png",
  },


  metal: {
    name: "metal",
    width: 50,
    height: 50,
    image: "image/metal.png",
  }

};



function getObstacle(name) {

  return OBSTACLES[name] || null;

}



function getAllObstacles() {

  return Object.values(OBSTACLES);

}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    OBSTACLES,
    getObstacle,
    getAllObstacles
  };

}
