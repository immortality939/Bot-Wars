// weapon_online.js - Works for both browser and server (NO import/export)

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
    maxMagazine: 350
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

function getWeapon(name) {
  const w = WEAPONS_ONLINE[name];
  if (!w) return null;
  return JSON.parse(JSON.stringify(w));
}

function getWeaponOnline(name) {
  return getWeapon(name);
}

function getAllWeapons() {
  return Object.keys(WEAPONS_ONLINE);
}

function getAllWeaponsOnline() {
  return getAllWeapons();
}

// For browser (global variables)
if (typeof window !== "undefined") {
  window.WEAPONS = WEAPONS_ONLINE;
  window.WEAPONS_ONLINE = WEAPONS_ONLINE;
  window.getWeapon = getWeapon;
  window.getWeaponOnline = getWeaponOnline;
  window.getAllWeapons = getAllWeapons;
  window.getAllWeaponsOnline = getAllWeaponsOnline;
}

// For Node.js/server (CommonJS)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { WEAPONS_ONLINE, getWeapon, getWeaponOnline, getAllWeapons, getAllWeaponsOnline };
}
