// weapon.js

const WEAPONS = {
  uzi: {
    name: "uzi",
    damage: 4,
    fireRate: 10,
    reloadTime: 2000,
    bulletSpeed: 500,
    magazine: 25,
    maxMagazine: 25,
    fireSound: "uzi.ogg"
  },
  
  ak47: {
    name: "ak47",
    damage: 4,
    fireRate: 7,
    reloadTime: 2000,
    bulletSpeed: 500,
    magazine: 35,
    maxMagazine: 35,
    fireSound: "ak47.ogg",
    hitEffect: "9mm"
  },

  pistol: {
    name: "pistol",
    damage: 8,
    fireRate: 4,
    reloadTime: 1500,
    bulletSpeed: 600,
    magazine: 12,
    maxMagazine: 12,
    fireSound: "pistol.ogg"
  },

  shotgun: {
    name: "shotgun",
    damage: 6,
    fireRate: 2,
    reloadTime: 2500,
    bulletSpeed: 450,
    pellets: 5,
    spread: 0.25,
    magazine: 6,
    maxMagazine: 6,
    fireSound: "shotgun.ogg"
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