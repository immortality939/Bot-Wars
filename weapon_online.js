// weapon_online.js - Server-side weapons (anti-cheat)

const WEAPONS_ONLINE = {
  uzi: {
    name: "uzi",
    damage: 4,
    fireRate: 10,
    reloadTime: 2000,
    bulletSpeed: 500,
    magazine: 25,
    maxMagazine: 25
  },
  
  ak47: {
    name: "ak47",
    damage: 4,
    fireRate: 7,
    reloadTime: 2000,
    bulletSpeed: 500,
    magazine: 350,
    maxMagazine: 35
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
    pellets: 5,
    spread: 0.25,
    magazine: 6,
    maxMagazine: 6
  }
};

function getWeaponOnline(name) {
  const w = WEAPONS_ONLINE[name];
  if (!w) return null;
  return JSON.parse(JSON.stringify(w));
}

function getAllWeaponsOnline() {
  return Object.keys(WEAPONS_ONLINE);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WEAPONS_ONLINE, getWeaponOnline, getAllWeaponsOnline };
}
