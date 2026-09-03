// weapon_online.js
// SERVER SIDE WEAPON DATABASE
// Used only by server.js for online multiplayer


const WEAPONS = {

  uzi: {
    name: "uzi",

    // Damage handled by server
    damage: 400,

    fireRate: 10,

    reloadTime: 2000,

    bulletSpeed: 500,

    magazine: 25,
    maxMagazine: 25,

    fireSound: "uzi.ogg",

    hitEffect: "9mm",

    recoil: 0.05
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

    hitEffect: "9mm",

    recoil: 0.09
  },


  pistol: {
    name: "pistol",

    damage: 8,

    fireRate: 4,

    reloadTime: 1500,

    bulletSpeed: 600,

    magazine: 12,
    maxMagazine: 12,

    fireSound: "pistol.ogg",

    hitEffect: "9mm",

    recoil: 2
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

    fireSound: "shotgun.ogg",

    hitEffect: "shotgun",

    recoil: 0.15
  }

};


// Get one weapon
function getWeapon(name) {

  return WEAPONS[name] || null;

}


// Get all weapons
function getAllWeapons() {

  return Object.values(WEAPONS);

}


export {
  WEAPONS,
  getWeapon,
  getAllWeapons
};
