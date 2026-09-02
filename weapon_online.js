// weapon.js

const WEAPONS = {
  uzi: {
    name: "uzi",
    damage: 4,
    fireRate: 10,        // bullets per second
    reloadTime: 2000,    // ms
    bulletSpeed: 500,    // units per second
    magazine: 25,        // current ammo in mag (can be changed at runtime)
    maxMagazine: 25      // max ammo per mag
  },
  
    ak47: {
    name: "ak47",
    damage: 4,
    fireRate: 7,        // bullets per second
    reloadTime: 2000,    // ms
    bulletSpeed: 500,    // units per second
    magazine: 350,        // current ammo in mag (can be changed at runtime)
    maxMagazine: 35      // max ammo per mag
  },

  pistol: {
    name: "pistol",
    damage: 8,
    fireRate: 4,
    reloadTime: 1500,
    bulletSpeed: 600,
    magazine: 12,
    maxMagazine: 12
  },

  shotgun: {
    name: "shotgun",
    damage: 6,
    fireRate: 2,
    reloadTime: 2500,
    bulletSpeed: 450,
    pellets: 5,          // custom property for shotgun
    spread: 0.25,        // radians
    magazine: 6,
    maxMagazine: 6
  }
};

function getWeapon(name) {
  return WEAPONS[name] || null;
}

function getAllWeapons() {
  return Object.values(WEAPONS);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WEAPONS, getWeapon, getAllWeapons };
}
