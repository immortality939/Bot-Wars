// weapon_server.js

const WEAPONS = {
  uzi: {
    name: "uzi",
    damage: 4,
    fireRate: 10,
    reloadTime: 2000,
    bulletSpeed: 500,
    magazine: 250,
    maxMagazine: 25,
    fireSound: "uzi.ogg",
    hitEffect: "9mm",
    recoil: 0.05,
    bulletPiercing: 2,
    muzzleFlash: {
      image: "muzzleflash.png",
      frameWidth: 268,
      frameHeight: 140,
      numFrames: 3,
      fps: 25,
      width: 20,
      height: 20,
      scale: 1
    }
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
    recoil: 0.12,
    bulletPiercing: 2,
    muzzleFlash: {
      image: "muzzleflash.png",
      frameWidth: 32,
      frameHeight: 32,
      numFrames: 6,
      fps: 60,
      width: 48,
      height: 48,
      scale: 1
    }
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
    recoil: 2,
    bulletPiercing: 2,
    muzzleFlash: {
      image: "muzzleflash.png",
      frameWidth: 32,
      frameHeight: 32,
      numFrames: 6,
      fps: 60,
      width: 48,
      height: 48,
      scale: 1
    }
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
    recoil: 0.2,
    bulletPiercing: 2,
    muzzleFlash: {
      image: "muzzleflash.png",
      frameWidth: 268,
      frameHeight: 140,
      numFrames: 3,
      fps: 60,
      width: 20,
      height: 20,
      scale: 1
    }
  }
};

function getWeapon(name) {
  return WEAPONS[name] || null;
}

function getAllWeapons() {
  return Object.values(WEAPONS);
}

export { WEAPONS, getWeapon, getAllWeapons };
