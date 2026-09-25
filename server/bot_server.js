// =============================================================================
// bot_server.js  —  ONLINE MODE copy of bot.js's BOT_TYPES table
// =============================================================================
// Edit the numbers in here to change enemy stats in ONLINE mode.
// bot.js (the public file) only controls OFFLINE mode — AND only decides
// what a bot LOOKS like / how it patrols/spawns for someone who happens to
// be simulating it. The actual numbers (health, damage, speed, view range,
// respawn time, drops, ...) always come from THIS file once online: server.js
// sends it to every player when they join (same as weapon_server.js,
// armor_server.js, character_server.js, ...), and online.js swaps it into
// the page's BOT_TYPES table before any enemy is spawned or simulated.
//
// This file lives on the SERVER (Render), NOT in the public game website, so
// players cannot open or edit it. Editing the public bot.js's BOT_TYPES only
// changes OFFLINE enemies now — it can no longer buff/nerf enemies online,
// even for whoever ends up hosting a room's fight (see server.js's comment
// on the bot-host model for what a hacked HOST can still affect, and what
// this file closes off).
//
// Keep this in sync with bot.js's BOT_TYPES by hand (add a new bot type in
// both places) — bot.js's AI code (movement/vision/attack state machine)
// still runs from the public file, since it has to execute in the host's
// own browser; only the STATS TABLE is duplicated here and enforced.
// =============================================================================

const BOT_TYPES = {

  // RUSHER — aggressive, moderate FOV, closes distance fast
  rusher: {
    name: "rusher",

    health: 100,
    physicalDefense: "armor1",
    movementSpeed: 110,
    weaponName: "uzi",

    image: "image/police.png",
    radius: 11,

    viewRange: 260,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1500,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.8, // 80% chance to drop a gold orb on death
    goldOrbAmount: 30,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 300,

    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    // BOT SKILL — see the full explanation on the guard entry below, and
    // on bot.js's BOT_TYPES.rusher. Keep in sync by hand.
    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  // GUARD — slow, heavily armored, holds ground, wide FOV (hard to flank
  // from the side, but doesn't chase far and fires a short-range shotgun)
  guard: {
    name: "guard",

    health: 160,
    physicalDefense: "armor3",
    movementSpeed: 70,
    weaponName: "shotgun",

    image: "image/swat.png",
    radius: 15,

    viewRange: 180,
    viewAngle: 110,

    patrolInterval: 3500,
    patrolRadius: 50,
    lookDuration: 2200,

    respawn: 10,
    active: false,

    spawnItem: "shield,speedup,powerup,health,shotgun",
    spawnGoldOrbChance: 0.75, // 75% chance to drop a gold orb on death
    goldOrbAmount: 100,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 30,

    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.00,
    manaRegen: 0.01,

    // BOT SKILL — mirrors bot.js's BOT_TYPES.guard comment/field exactly.
    // bot.js's AI (tryBotUseSkill(), running in the room host's own
    // browser) reads this list from whichever BOT_TYPES table is
    // currently active — online.js swaps THIS server-enforced copy in
    // for the duration of the match, so a player can't remove/edit
    // guard's skills locally to make it easier. Keep in sync with
    // bot.js by hand, same as every other field in this file.
    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  assaulter: {
    name: "assaulter",

    health: 120,
    physicalDefense: "armor2",
    movementSpeed: 100,
    weaponName: "ak47",

    image: "image/soldier.png",
    radius: 13,

    viewRange: 320,
    viewAngle: 140,

    patrolInterval: 3500,
    patrolRadius: 70,
    lookDuration: 2200,

    respawn: 10,
    active: false,

    spawnItem: "armor1",
    spawnGoldOrbChance: 0.75, // 75% chance to drop a gold orb on death
    goldOrbAmount: 75,        // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 30,

    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01
  },

  // SNIPER — barely moves, long range, but a narrow FOV makes it easy to
  // flank: sneak up outside its cone and it won't react until it's hit
  shooter: {
    name: "shooter",

    health: 70,
    physicalDefense: 0,
    movementSpeed: 50,
    weaponName: "sniper",

    image: "image/redbot.png",
    radius: 11,

    viewRange: 500,
    viewAngle: 40,

    patrolInterval: 4000,
    patrolRadius: 30,
    lookDuration: 2500,

    respawn: 10,
    active: false,

    spawnItem: "shield,speedup,powerup,health,sniper",
    spawnGoldOrbChance: 0.75, // 75% chance to drop a gold orb on death
    goldOrbAmount: 50,        // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 30,

    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01
  }

  // Add more bot classes the same way — and mirror the same entry in the
  // public bot.js's BOT_TYPES (that copy only matters for OFFLINE mode now,
  // but keeping the two in sync avoids confusion later).

};

// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { BOT_TYPES };
