// character.js

const DEFAULT_CHARACTER = {
  name: "player",
  health: 100,
  armor: 2,
  movementSpeed: 100,
  weaponName: "uzi",
  currentHealth: 100,
  isReloading: false,
  reloadFinishTime: 0,
  lastShotTime: 0,
  image: "soldier.png",
  cameraZoom: 1.0
};


const CHARACTERS = {


  // DEFAULT CHARACTER
  player: {
    ...DEFAULT_CHARACTER
  },


  // FAST CHARACTER
  scout: {
    name: "scout",
    health: 80,
    armor: 1,
    movementSpeed: 160,
    weaponName: "uzi",
    currentHealth: 80,
    isReloading: false,
    reloadFinishTime: 0,
    lastShotTime: 0,
    image: "scout.png",
    cameraZoom: 1.2
  },


  // NORMAL SOLDIER
  soldier: {
    name: "soldier",
    health: 120,
    armor: 3,
    movementSpeed: 100,
    weaponName: "ak47",
    currentHealth: 120,
    isReloading: false,
    reloadFinishTime: 0,
    lastShotTime: 0,
    image: "soldier.png",
    cameraZoom: 1.0
  },


  // HEAVY TANK CHARACTER
  tank: {
    name: "tank",
    health: 250,
    armor: 8,
    movementSpeed: 60,
    weaponName: "shotgun",
    currentHealth: 250,
    isReloading: false,
    reloadFinishTime: 0,
    lastShotTime: 0,
    image: "tank.png",
    cameraZoom: 0.8
  }

};



function getCharacter(name) {

  const base = CHARACTERS[name];


  if (!base) {

    throw new Error(
      "Character not found: " + name
    );

  }


  const char = JSON.parse(
    JSON.stringify(base)
  );


  char.currentHealth = char.health;

  char.isReloading = false;

  char.reloadFinishTime = 0;

  char.lastShotTime = 0;


  return char;

}





function attachWeaponToCharacter(character) {


  if (typeof getWeapon === "undefined") {

    throw new Error(
      "weapon.js not loaded or getWeapon() missing"
    );

  }


  const weapon = getWeapon(
    character.weaponName
  );


  if (!weapon) {

    throw new Error(
      "Weapon not found: " +
      character.weaponName
    );

  }


  character.weapon = weapon;


  return character;

}





// GET ALL CHARACTERS
function getAllCharacters(){

  return Object.keys(CHARACTERS);

}





if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    CHARACTERS,
    getCharacter,
    attachWeaponToCharacter,
    getAllCharacters
  };

}