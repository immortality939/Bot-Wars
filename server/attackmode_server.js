// =============================================================================
// attackmode_server.js  —  ONLINE MODE copy of attackmode.js
// =============================================================================
// Edit the numbers in here to change how the game behaves in ONLINE mode.
// attackmode.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. server.js sends these tables to each player
// when they join an online match; the game then uses them instead of the
// offline tables until the player leaves.
// =============================================================================

// attackmode.js
//
// Defines a character/bot's own inherent "attack" — separate from
// whatever weapon (weapon.js) or skill (skill.js) it has equipped.
// character.js's CHARACTERS[...].attack and bot.js's BOT_TYPES[...].attack
// are just a name (e.g. "melee"); getAttackMode() below resolves that name
// into the real stats for how the attack actually plays out — how far it
// reaches, and what hit effect (effect.js) animates in front of the
// attacker when it lands. Same lookup pattern as getWeapon() (weapon.js)
// and getSkill() (skill.js).
//
// Used by:
//   - game.js's performPlayerMeleeAttack() (fireBullet()'s melee branch) —
//     the player's base attack, aimed with the right analog stick's
//     direction and animated/landed in front of the player.
//   - bot.js's tryBotMeleeAttack() — a bot striking the player directly
//     once it's close enough, instead of lobbing a mortar shot practically
//     on top of itself.
//
// Load order required: effect.js -> attackmode.js -> character.js -> bot.js -> game.js
const ATTACK_MODES = {

  melee: {
    name: "melee",

    // HIT EFFECT — played in front of the attacker (attacker position +
    // facing/aim direction * meleeRange), from effect.js.
    hitEffect: "basicattack",

    // MELEE RANGE — how far in front of the attacker (beyond its own
    // radius) this attack reaches. A target is hit if it's within this
    // range of the attacker, roughly in front of it.
    meleeRange: 33
  }

};

function getAttackMode(name) {
  return ATTACK_MODES[name] || null;
}

function getAllAttackModes() {
  return Object.values(ATTACK_MODES);
}

if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    ATTACK_MODES,
    getAttackMode,
    getAllAttackModes
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { ATTACK_MODES };
