// projectile.js
//
// Defines the visual/physical "look" of a fired projectile, separate from
// the weapon that fires it. A weapon just references a projectile by name
// (weapon.js: projectile: "6mm"), and game.js looks up that name here to
// know what image/size to draw for every bullet in flight.
const PROJECTILES = {

  "6mm": {
    name: "6mm",
    height: 6,
    width: 18,
    image: "image/bullet.png"
  }

};



function getProjectile(name) {

  return PROJECTILES[name] || null;

}



function getAllProjectiles() {

  return Object.values(PROJECTILES);

}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    PROJECTILES,
    getProjectile,
    getAllProjectiles
  };

}
