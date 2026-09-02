// character.js

const DEFAULT_CHARACTER = {
  name: "player",
  health: 100,
  armor: 2,
  movementSpeed: 100,
  weaponName: "ak47",      // default; can be changed at runtime
  currentHealth: 100,
  isReloading: false,
  reloadFinishTime: 0,
  lastShotTime: 0
};

const CHARACTERS = {
  player: { ...DEFAULT_CHARACTER }
};

function getCharacter(name) {
  const base = CHARACTERS[name];
  if (!base) return null;

  const char = JSON.parse(JSON.stringify(base));
  char.currentHealth = base.health;
  char.isReloading = false;
  char.lastShotTime = 0;
  return char;
}

function attachWeaponToCharacter(character) {
  if (typeof getWeapon === "undefined") {
    throw new Error("weapon.js not loaded or getWeapon() missing");
  }
  const weapon = getWeapon(character.weaponName);
  if (!weapon) {
    throw new Error("Weapon not found: " + character.weaponName);
  }
  character.weapon = weapon;
  return character;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CHARACTERS, getCharacter, attachWeaponToCharacter };
}