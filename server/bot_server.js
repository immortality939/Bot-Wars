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
// Every entry can carry a display `name` and a `description` (flavor text).
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
    spawnItem: "specialstone,armor1",
    spawnGoldOrbChance: 0.8, // 80% chance to drop a gold orb on death
    goldOrbAmount: 30,       // gold given when this bot's orb is picked up
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
    manaRegen: 0.01,
    // BOT SKILL — see the full explanation on the guard entry below, and
    // on bot.js's BOT_TYPES.rusher. Keep in sync by hand.
    botSkill: ""
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
    spawnItem: "shield,speedup,powerup,health,shotgun,gun4,sword1",
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
    hpRegen: 0.01,
    manaRegen: 0.01,

    // BOT SKILL — mirrors bot.js's BOT_TYPES.guard comment/field exactly.
    // bot.js's AI (tryBotUseSkill(), running in the room host's own
    // browser) reads this list from whichever BOT_TYPES table is
    // currently active — online.js swaps THIS server-enforced copy in
    // for the duration of the match, so a player can't remove/edit
    // guard's skills locally to make it easier. Keep in sync with
    // bot.js by hand, same as every other field in this file.
    botSkill: ""
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
    health: 120,
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
  },

  // ---------------------------------------------------------------------
  // bot01–bot20 — 20 extra enemy types using your own bot_01.png..bot_20.png
  // artwork. Stats step up gradually every 4 bots (5 difficulty tiers) so
  // higher-numbered bots hit harder/tankier/see farther. Tweak freely.
  // ---------------------------------------------------------------------
  bot01: {
    name: "Patrol Officer",
    description: "A police-type patrol bot with a blue armored shell and a star badge on its chest. It keeps watch over its area and moves in fast on anything suspicious.",
    health: 200,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "uzi",
    image: "image/police.png",
    radius: 11,
    viewRange: 220,
    viewAngle: 80,
    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone,accessory01,ring01,gauntlet1,sword6,gun9"",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 4,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 8,

    attackSpeed: 1,
    physicalDamage: 8,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
  bot01elite: {
    name: "Elite Officer",
    description: "A police-type patrol bot with a blue armored shell and a star badge on its chest. It keeps watch over its area and moves in fast on anything suspicious.",
    health: 400,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "uzi",
    image: "image/police.png",
    radius: 13,
    viewRange: 220,
    viewAngle: 80,
    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 7,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 11,

    attackSpeed: 1,
    physicalDamage: 14,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot02: {
    name: "Shadow Ninja",
    description: "A stealth-type ninja bot in black armor with glowing red eyes and a masked face. It moves quietly and strikes quickly before slipping away.",

    health: 250,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_02.png",
    radius: 11,

    viewRange: 220,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 6,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 1,
    expGet: 12,

    attackSpeed: 1,
    physicalDamage: 9,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot03: {
    name: "Violet Warlord",
    description: "A war-machine bot with purple and silver armor and a menacing faction emblem on its chest. It leads from the front and hits hard with cold, mechanical precision.",

    health: 250,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_03.png",
    radius: 11,

    viewRange: 220,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 8,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 2,
    expGet: 16,

    attackSpeed: 1,
    physicalDamage: 9,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
  bot03elite: {
    name: "Elite Warlord",
    description: "A war-machine bot with purple and silver armor and a menacing faction emblem on its chest. It leads from the front and hits hard with cold, mechanical precision.",

    health: 500,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_03.png",
    radius: 13,

    viewRange: 220,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 14,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 2,
    expGet: 19,

    attackSpeed: 1,
    physicalDamage: 15,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot04: {
    name: "SWAT Trooper",
    description: "A tactical assault bot in black armor marked SWAT, with flashing blue lights. It pushes into enemy positions and fights with strict discipline.",

    health: 300,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_04.png",
    radius: 11,

    viewRange: 220,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 10,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 3,
    expGet: 18,

    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot04elite: {
    name: "Elite Trooper",
    description: "A tactical assault bot in black armor marked SWAT, with flashing blue lights. It pushes into enemy positions and fights with strict discipline.",

    health: 600,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_04.png",
    radius: 11,

    viewRange: 220,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 16,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 3,
    expGet: 22,

    attackSpeed: 1,
    physicalDamage: 16,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot05: {
    name: "Fire Marshal",
    description: "A rescue-type bot in red and yellow armor with a firefighter emblem. It charges into danger without fear and shrugs off heavy damage.",

    health: 350,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "uzi",
    magicAttack:8,
    image: "image/bot_05.png",
    radius: 11,

    viewRange: 260,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 13,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 4,
    expGet: 20,

    attackSpeed: 1,
    physicalDamage: 13,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
 
   bot05elite: {
    name: "Elite Marshal",
    description: "A rescue-type bot in red and yellow armor with a firefighter emblem. It charges into danger without fear and shrugs off heavy damage.",

    health: 750,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "uzi",
    magicAttack:8,
    image: "image/bot_05.png",
    radius: 13,

    viewRange: 260,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 19,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 4,
    expGet: 25,

    attackSpeed: 1,
    physicalDamage: 18,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot06: {
    name: "Cosmic Voyager",
    description: "A space-type bot with a deep blue shell and a glowing planet emblem. It drifts across the map like a wandering star and attacks with strange bursts of energy.",

    health: 455,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_06.png",
    radius: 11,

    viewRange: 260,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 15,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 4,
    expGet: 23,

    attackSpeed: 1,
    physicalDamage: 17,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot07: {
    name: "Camo Commando",
    description: "A military-type bot in green camouflage plating with a white star. It holds its ground like a veteran soldier and follows its targets with discipline.",

    health: 500,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_07.png",
    radius: 11,

    viewRange: 260,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 18,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 5,
    expGet: 25,

    attackSpeed: 1,
    physicalDamage: 23,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot07elite: {
    name: "Elite Commando",
    description: "A military-type bot in green camouflage plating with a white star. It holds its ground like a veteran soldier and follows its targets with discipline.",

    health: 1000,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_07.png",
    radius: 13,

    viewRange: 260,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 25,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 5,
    expGet: 30,

    attackSpeed: 1,
    physicalDamage: 29,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot08: {
    name: "Red Dragon",
    description: "A dragon-type bot in fiery red armor with a golden dragon emblem. It is proud and aggressive, and it attacks with fierce, burning force.",

    health: 600,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_08.png",
    radius: 11,

    viewRange: 260,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 20,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 5,
    expGet: 28,

    attackSpeed: 1,
    physicalDamage: 28,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot09: {
    name: "Frost Guard",
    description: "An ice-type bot with pale blue and silver armor and a snowflake core. It stays cool and calm, guarding its area and chilling anything that gets close.",

    health: 800,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "uzi",
    magicAttack:10,
    image: "image/bot_09.png",
    radius: 11,

    viewRange: 300,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 25,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 6,
    expGet: 32,

    attackSpeed: 1,
    physicalDamage: 37,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot09elite: {
    name: "Elite Frost",
    description: "An ice-type bot with pale blue and silver armor and a snowflake core. It stays cool and calm, guarding its area and chilling anything that gets close.",

    health: 1600,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "uzi",
    magicAttack:10,
    image: "image/bot_09.png",
    radius: 13,

    viewRange: 300,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 32,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 6,
    expGet: 37,

    attackSpeed: 1,
    physicalDamage: 45,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot10: {
    name: "Horned Demon",
    description: "A demon-type bot in black armor with glowing red veins, curved horns and burning eyes. It is ruthless and hits with brutal force.",

    health: 1100,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_10.png",
    radius: 11,

    viewRange: 300,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 30,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 7,
    expGet: 38,

    attackSpeed: 1,
    physicalDamage: 43,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot10elite: {
    name: "Elite Demon",
    description: "A demon-type bot in black armor with glowing red veins, curved horns and burning eyes. It is ruthless and hits with brutal force.",

    health: 2200,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_10.png",
    radius: 13,

    viewRange: 300,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 38,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 7,
    expGet: 46,

    attackSpeed: 1,
    physicalDamage: 49,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot11: {
    name: "Alien Invader",
    description: "An alien-type bot with a glowing green shell and an alien face emblem. It wanders strangely and attacks without warning.",

    health: 1550,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_11.png",
    radius: 11,

    viewRange: 300,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 37,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 8,
    expGet: 42,

    attackSpeed: 1,
    physicalDamage: 48,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot11elite: {
    name: "Elite Invader",
    description: "An alien-type bot with a glowing green shell and an alien face emblem. It wanders strangely and attacks without warning.",

    health: 3100,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_11.png",
    radius: 13,

    viewRange: 300,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 47,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 8,
    expGet: 50,

    attackSpeed: 1,
    physicalDamage: 58,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot12: {
    name: "Road Racer",
    description: "A speed-type bot in red and white armor with a checkered flag emblem. It is built for fast movement and rushes at enemies before they can react.",

    health: 1800,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_12.png",
    radius: 11,

    viewRange: 300,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 45,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 46,

    attackSpeed: 1,
    physicalDamage: 53,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot12elite: {
    name: "Elite Racer",
    description: "A speed-type bot in red and white armor with a checkered flag emblem. It is built for fast movement and rushes at enemies before they can react.",

    health: 3600,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_12.png",
    radius: 13,

    viewRange: 300,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 52,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 52,

    attackSpeed: 1,
    physicalDamage: 59,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot13: {
    name: "Hooded Assassin",
    description: "A stealth-type assassin bot in dark purple armor with a hooded face. It hides in the shadows and ambushes its targets.",

    health: 2200,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_13.png",
    radius: 11,

    viewRange: 340,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 50,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 50,

    attackSpeed: 1,
    physicalDamage: 60,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot13elite: {
    name: "Elite Assassin",
    description: "A stealth-type assassin bot in dark purple armor with a hooded face. It hides in the shadows and ambushes its targets.",

    health: 4400,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_13.png",
    radius: 13,

    viewRange: 340,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 60,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 58,

    attackSpeed: 1,
    physicalDamage: 70,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot14: {
    name: "Justice Guardian",
    description: "A hero-type bot in red and blue armor with a heroic faction emblem. It defends its area bravely and never backs down from a fight.",

    health: 2605,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_14.png",
    radius: 11,

    viewRange: 340,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 57,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 65,

    attackSpeed: 1,
    physicalDamage: 67,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot14elite: {
    name: "Elite Guardian",
    description: "A hero-type bot in red and blue armor with a heroic faction emblem. It defends its area bravely and never backs down from a fight.",

    health: 4210,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_14.png",
    radius: 13,

    viewRange: 340,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 67,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 75,

    attackSpeed: 1,
    physicalDamage: 75,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot15: {
    name: "Royal Guard",
    description: "An elite guard bot in gold and black armor with a crown emblem. It protects its territory with pride and heavy, disciplined strikes.",

    health: 3000,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_15.png",
    radius: 11,

    viewRange: 340,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 70,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 75,

    attackSpeed: 1,
    physicalDamage: 78,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot16: {
    name: "Cyber Core",
    description: "A cyber-type bot with neon purple and cyan lights and a glowing power symbol. It moves like a machine that never shuts down and attacks with electric energy.",

    health: 3500,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_16.png",
    radius: 11,

    viewRange: 340,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 80,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 85,

    attackSpeed: 1,
    physicalDamage: 95,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot16elite: {
    name: "Elite Cyber Core",
    description: "A cyber-type bot with neon purple and cyan lights and a glowing power symbol. It moves like a machine that never shuts down and attacks with electric energy.",

    health: 7000,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_16.png",
    radius: 13,

    viewRange: 340,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 90,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 90,

    attackSpeed: 1,
    physicalDamage: 105,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot17: {
    name: "Skull Raider",
    description: "A death-type bot in black and red armor with a white skull on its chest. It raids the area without mercy and finishes off anything it catches.",

    health: 4200,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "uzi",
    magicAttack:20,
    image: "image/bot_17.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 110,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 105,

    attackSpeed: 1,
    physicalDamage: 120,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot18: {
    name: "Steel Wolf",
    description: "A wolf-type bot in blue and silver armor with a snarling wolf emblem. It hunts its territory with sharp senses and strikes fast.",

    health: 4800,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_18.png",
    radius: 12,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 125,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 130,

    attackSpeed: 1,
    physicalDamage: 140,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot18elite: {
    name: "Elite Wolf",
    description: "A wolf-type bot in blue and silver armor with a snarling wolf emblem. It hunts its territory with sharp senses and strikes fast.",

    health: 9600,
    physicalDefense: "armor1",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_18.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 140,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 12,
    expGet: 140,

    attackSpeed: 1,
    physicalDamage: 150,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot19: {
    name: "Hazmat Bot",
    description: "A toxic-type bot in yellow and black armor with a biohazard emblem. It spreads poison around it and wears its enemies down.",

    health: 5500,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_19.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 145,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 12,
    expGet: 145,

    attackSpeed: 1,
    physicalDamage: 160,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  bot20: {
    name: "Oni Samurai",
    description: "A samurai-type bot in purple and gold armor with a horned oni mask. It fights with fierce honor and strikes with heavy, powerful blows.",

    health: 6500,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_20.png",
    radius: 11,
    magicAttack:20,
    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 170,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 13,
    expGet: 160,

    attackSpeed: 1,
    physicalDamage: 180,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  
    bot20elite: {
    name: "Elite Samurai",
    description: "A samurai-type bot in purple and gold armor with a horned oni mask. It fights with fierce honor and strikes with heavy, powerful blows.",

    health: 13000,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_20.png",
    radius: 13,
    magicAttack:20,
    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 190,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 13,
    expGet: 170,

    attackSpeed: 1,
    physicalDamage: 190,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  // ---------------------------------------------------------------------
  // bot19elite — missing elite for the LEVEL12 map (one elite per map).
  // ---------------------------------------------------------------------
  bot19elite: {
    name: "Elite Hazmat Bot",
    description: "A hazmat-suit bot built tougher than the rest of its pack. It hits harder and takes far more punishment.",

    health: 11000,
    physicalDefense: "armor2",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_19.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 160,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 12,
    expGet: 155,

    attackSpeed: 1,
    physicalDamage: 170,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  // =====================================================================
  // bot21–bot40 — 20 NEW enemy types using bot_21.png..bot_40.png (one
  // type per level, LEVEL 14 .. LEVEL 33).
  // bot41–bot58 — 18 "Mk II" versions that REUSE bot_21..bot_38.png art
  // for LEVEL 34 .. LEVEL 51 (same trick as before: reuse a picture, give
  // it new name + much stronger numbers).
  //
  // STAT CURVE (health / physicalDamage / expGet / goldOrbAmount):
  //   L14-L21 = your own numbers from the old table, kept as-is.
  //   L22-L51 = grows every level, but the % growth shrinks from
  //             ~6% down to ~3% so it never explodes.
  //   NOTE: `health` here is the LEVEL-1 baseline; the game multiplies it by
  //   1.03 per level (HEALTH_GROWTH_RATE) when the bot spawns.
  //   Every type has an "elite" twin (health x2, a bit more dmg/exp/gold,
  //   respawn 60, active) — each map spawns exactly ONE elite of its own level.
  // =====================================================================
  bot21: {
    name: "Cyber Falcon",
    description: "A cyan armored sphere with a glowing winged-falcon emblem. It swoops in fast and strikes with precise bursts.",

    health: 7500,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_21.png",
    radius: 11,

    viewRange: 340,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 205,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 14,
    expGet: 180,

    attackSpeed: 1,
    physicalDamage: 200,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot22: {
    name: "Bone Reaper",
    description: "A soot-black sphere with orange glowing plates and a white skull emblem. It reaps anything that wanders into its patrol.",

    health: 9000,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_22.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 230,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 15,
    expGet: 210,

    attackSpeed: 1,
    physicalDamage: 230,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot23: {
    name: "Blizzard Sentinel",
    description: "A frost-white sphere with a blue snowflake core. It guards its ground coldly and never tires.",

    health: 11500,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_23.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 280,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 16,
    expGet: 250,

    attackSpeed: 1,
    physicalDamage: 260,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot24: {
    name: "Nuclear Warden",
    description: "A green-lit sphere marked with a radiation symbol. It poisons the air around it and hits with irradiated rounds.",

    health: 13000,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_24.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 300,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 17,
    expGet: 275,

    attackSpeed: 1,
    physicalDamage: 278,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot25: {
    name: "Void Raven",
    description: "A dark purple sphere with a winged raven crest. It hunts from the shadows and strikes from odd angles.",

    health: 14200,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_25.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 325,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 18,
    expGet: 290,

    attackSpeed: 1,
    physicalDamage: 295,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot26: {
    name: "Inferno Core",
    description: "A red-hot armored sphere with a blazing flame emblem. It burns with rage and hits with scorching force.",

    health: 15500,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_26.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 350,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 19,
    expGet: 310,

    attackSpeed: 1,
    physicalDamage: 320,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot27: {
    name: "Storm Surge",
    description: "A blue sphere crackling with a lightning-bolt emblem. It moves in quick bursts and shocks everything nearby.",

    health: 17500,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_27.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 370,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 20,
    expGet: 330,

    attackSpeed: 1,
    physicalDamage: 340,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot28: {
    name: "Golden Monarch",
    description: "A gold-plated royal sphere with a crown emblem. It commands its area and takes heavy hits to bring down.",

    health: 18000,
    physicalDefense: "armor5",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_28.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 380,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 21,
    expGet: 340,

    attackSpeed: 1,
    physicalDamage: 360,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot29: {
    name: "Crimson Fiend",
    description: "A blood-red sphere with a horned demon face. It is relentless and brutal in close fights.",

    health: 19100,
    physicalDefense: "armor5",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_29.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 401,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 22,
    expGet: 359,

    attackSpeed: 1,
    physicalDamage: 378,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot30: {
    name: "Sniper Prime",
    description: "A white and blue sphere with a targeting crosshair. It spots threats from far away and rarely misses.",

    health: 20200,
    physicalDefense: "armor5",
    movementSpeed: 91,
    weaponName: "shotgun",

    image: "image/bot_30.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 423,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 23,
    expGet: 378,

    attackSpeed: 1,
    physicalDamage: 397,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot31: {
    name: "Toxic Plague",
    description: "A green sphere with a biohazard emblem. It spreads decay wherever it patrols.",

    health: 21400,
    physicalDefense: "armor5",
    movementSpeed: 91,
    weaponName: "ak47",

    image: "image/bot_31.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 445,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 24,
    expGet: 398,

    attackSpeed: 1,
    physicalDamage: 416,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot32: {
    name: "Vortex Spiral",
    description: "A purple sphere with a swirling vortex core. It pulls enemies in and wears them down.",

    health: 22600,
    physicalDefense: "armor6",
    movementSpeed: 92,
    weaponName: "sniper",

    image: "image/bot_32.png",
    radius: 11,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 468,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 25,
    expGet: 419,

    attackSpeed: 1,
    physicalDamage: 435,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot33: {
    name: "Crimson Eagle",
    description: "A red and white sphere with an eagle emblem. It dives on targets with disciplined aggression.",

    health: 23850,
    physicalDefense: "armor6",
    movementSpeed: 92,
    weaponName: "uzi",

    image: "image/bot_33.png",
    radius: 11,

    viewRange: 390,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 493,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 26,
    expGet: 441,

    attackSpeed: 1,
    physicalDamage: 456,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot34: {
    name: "Hex Guardian",
    description: "A cyan sphere with a hexagon shield emblem. It holds its ground behind layered armor.",

    health: 25150,
    physicalDefense: "armor6",
    movementSpeed: 93,
    weaponName: "shotgun",

    image: "image/bot_34.png",
    radius: 11,

    viewRange: 390,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 518,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 27,
    expGet: 463,

    attackSpeed: 1,
    physicalDamage: 477,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot35: {
    name: "Ember Fox",
    description: "An orange sphere with a fox emblem. It is cunning, quick to react and hard to pin down.",

    health: 26500,
    physicalDefense: "armor6",
    movementSpeed: 93,
    weaponName: "ak47",

    image: "image/bot_35.png",
    radius: 11,

    viewRange: 390,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 543,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 28,
    expGet: 486,

    attackSpeed: 1,
    physicalDamage: 498,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot36: {
    name: "Tidal Wave",
    description: "A deep-blue sphere with a wave emblem. It crashes into enemies in heavy waves of fire.",

    health: 27900,
    physicalDefense: "armor7",
    movementSpeed: 94,
    weaponName: "sniper",

    image: "image/bot_36.png",
    radius: 11,

    viewRange: 390,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 570,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 29,
    expGet: 510,

    attackSpeed: 1,
    physicalDamage: 520,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot37: {
    name: "Hell Trident",
    description: "A red and black sphere with a trident emblem. It pierces armor with savage thrusts.",

    health: 29350,
    physicalDefense: "armor7",
    movementSpeed: 94,
    weaponName: "uzi",

    image: "image/bot_37.png",
    radius: 11,

    viewRange: 390,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 597,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 30,
    expGet: 534,

    attackSpeed: 1,
    physicalDamage: 542,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot38: {
    name: "Forest Spirit",
    description: "A green sphere with a leaf emblem. It looks calm but recovers and fights with ancient strength.",

    health: 30850,
    physicalDefense: "armor7",
    movementSpeed: 95,
    weaponName: "shotgun",

    image: "image/bot_38.png",
    radius: 11,

    viewRange: 400,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 626,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 31,
    expGet: 560,

    attackSpeed: 1,
    physicalDamage: 565,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot39: {
    name: "Alien Overlord",
    description: "A purple sphere with an alien skull emblem. It commands its patrol with strange, deadly power.",

    health: 32400,
    physicalDefense: "armor7",
    movementSpeed: 95,
    weaponName: "ak47",

    image: "image/bot_39.png",
    radius: 11,

    viewRange: 400,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 655,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 32,
    expGet: 586,

    attackSpeed: 1,
    physicalDamage: 588,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot40: {
    name: "Solar Nova",
    description: "A white and gold sphere with a radiant star emblem. It shines with explosive power.",

    health: 33950,
    physicalDefense: "armor8",
    movementSpeed: 96,
    weaponName: "sniper",

    image: "image/bot_40.png",
    radius: 11,

    viewRange: 400,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 684,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 33,
    expGet: 612,

    attackSpeed: 1,
    physicalDamage: 612,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot41: {
    name: "Cyber Falcon Mk II",
    description: "A cyan armored sphere with a glowing winged-falcon emblem. It swoops in fast and strikes with precise bursts. Upgraded Mk II version: tougher and hits harder.",

    health: 35550,
    physicalDefense: "armor8",
    movementSpeed: 96,
    weaponName: "uzi",

    image: "image/bot_21.png",
    radius: 11,

    viewRange: 400,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 715,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 34,
    expGet: 640,

    attackSpeed: 1,
    physicalDamage: 637,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot42: {
    name: "Bone Reaper Mk II",
    description: "A soot-black sphere with orange glowing plates and a white skull emblem. It reaps anything that wanders into its patrol. Upgraded Mk II version: tougher and hits harder.",

    health: 37200,
    physicalDefense: "armor8",
    movementSpeed: 97,
    weaponName: "shotgun",

    image: "image/bot_22.png",
    radius: 11,

    viewRange: 400,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 746,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 35,
    expGet: 668,

    attackSpeed: 1,
    physicalDamage: 661,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot43: {
    name: "Blizzard Sentinel Mk II",
    description: "A frost-white sphere with a blue snowflake core. It guards its ground coldly and never tires. Upgraded Mk II version: tougher and hits harder.",

    health: 38900,
    physicalDefense: "armor8",
    movementSpeed: 97,
    weaponName: "ak47",

    image: "image/bot_23.png",
    radius: 11,

    viewRange: 410,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 778,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 36,
    expGet: 696,

    attackSpeed: 1,
    physicalDamage: 686,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot44: {
    name: "Nuclear Warden Mk II",
    description: "A green-lit sphere marked with a radiation symbol. It poisons the air around it and hits with irradiated rounds. Upgraded Mk II version: tougher and hits harder.",

    health: 40650,
    physicalDefense: "armor9",
    movementSpeed: 98,
    weaponName: "sniper",

    image: "image/bot_24.png",
    radius: 11,

    viewRange: 410,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 811,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 37,
    expGet: 726,

    attackSpeed: 1,
    physicalDamage: 712,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot45: {
    name: "Void Raven Mk II",
    description: "A dark purple sphere with a winged raven crest. It hunts from the shadows and strikes from odd angles. Upgraded Mk II version: tougher and hits harder.",

    health: 42400,
    physicalDefense: "armor9",
    movementSpeed: 98,
    weaponName: "uzi",

    image: "image/bot_25.png",
    radius: 11,

    viewRange: 410,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 844,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 38,
    expGet: 756,

    attackSpeed: 1,
    physicalDamage: 738,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot46: {
    name: "Inferno Core Mk II",
    description: "A red-hot armored sphere with a blazing flame emblem. It burns with rage and hits with scorching force. Upgraded Mk II version: tougher and hits harder.",

    health: 44200,
    physicalDefense: "armor9",
    movementSpeed: 99,
    weaponName: "shotgun",

    image: "image/bot_26.png",
    radius: 11,

    viewRange: 410,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 879,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 39,
    expGet: 786,

    attackSpeed: 1,
    physicalDamage: 764,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot47: {
    name: "Storm Surge Mk II",
    description: "A blue sphere crackling with a lightning-bolt emblem. It moves in quick bursts and shocks everything nearby. Upgraded Mk II version: tougher and hits harder.",

    health: 46050,
    physicalDefense: "armor9",
    movementSpeed: 99,
    weaponName: "ak47",

    image: "image/bot_27.png",
    radius: 11,

    viewRange: 410,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 913,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 40,
    expGet: 817,

    attackSpeed: 1,
    physicalDamage: 790,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot48: {
    name: "Golden Monarch Mk II",
    description: "A gold-plated royal sphere with a crown emblem. It commands its area and takes heavy hits to bring down. Upgraded Mk II version: tougher and hits harder.",

    health: 47900,
    physicalDefense: "armor10",
    movementSpeed: 100,
    weaponName: "sniper",

    image: "image/bot_28.png",
    radius: 11,

    viewRange: 420,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 949,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 41,
    expGet: 849,

    attackSpeed: 1,
    physicalDamage: 817,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot49: {
    name: "Crimson Fiend Mk II",
    description: "A blood-red sphere with a horned demon face. It is relentless and brutal in close fights. Upgraded Mk II version: tougher and hits harder.",

    health: 49800,
    physicalDefense: "armor10",
    movementSpeed: 100,
    weaponName: "uzi",

    image: "image/bot_29.png",
    radius: 11,

    viewRange: 420,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 984,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 42,
    expGet: 881,

    attackSpeed: 1,
    physicalDamage: 843,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot50: {
    name: "Sniper Prime Mk II",
    description: "A white and blue sphere with a targeting crosshair. It spots threats from far away and rarely misses. Upgraded Mk II version: tougher and hits harder.",

    health: 51700,
    physicalDefense: "armor10",
    movementSpeed: 101,
    weaponName: "shotgun",

    image: "image/bot_30.png",
    radius: 11,

    viewRange: 420,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1021,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 43,
    expGet: 913,

    attackSpeed: 1,
    physicalDamage: 870,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot51: {
    name: "Toxic Plague Mk II",
    description: "A green sphere with a biohazard emblem. It spreads decay wherever it patrols. Upgraded Mk II version: tougher and hits harder.",

    health: 53600,
    physicalDefense: "armor10",
    movementSpeed: 101,
    weaponName: "ak47",

    image: "image/bot_31.png",
    radius: 11,

    viewRange: 420,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 1057,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 44,
    expGet: 946,

    attackSpeed: 1,
    physicalDamage: 897,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot52: {
    name: "Vortex Spiral Mk II",
    description: "A purple sphere with a swirling vortex core. It pulls enemies in and wears them down. Upgraded Mk II version: tougher and hits harder.",

    health: 55550,
    physicalDefense: "armor11",
    movementSpeed: 102,
    weaponName: "sniper",

    image: "image/bot_32.png",
    radius: 11,

    viewRange: 420,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1095,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 45,
    expGet: 979,

    attackSpeed: 1,
    physicalDamage: 924,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot53: {
    name: "Crimson Eagle Mk II",
    description: "A red and white sphere with an eagle emblem. It dives on targets with disciplined aggression. Upgraded Mk II version: tougher and hits harder.",

    health: 57500,
    physicalDefense: "armor11",
    movementSpeed: 102,
    weaponName: "uzi",

    image: "image/bot_33.png",
    radius: 11,

    viewRange: 430,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 1132,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 46,
    expGet: 1013,

    attackSpeed: 1,
    physicalDamage: 951,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot54: {
    name: "Hex Guardian Mk II",
    description: "A cyan sphere with a hexagon shield emblem. It holds its ground behind layered armor. Upgraded Mk II version: tougher and hits harder.",

    health: 59450,
    physicalDefense: "armor11",
    movementSpeed: 103,
    weaponName: "shotgun",

    image: "image/bot_34.png",
    radius: 11,

    viewRange: 430,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 1170,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 47,
    expGet: 1047,

    attackSpeed: 1,
    physicalDamage: 978,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot55: {
    name: "Ember Fox Mk II",
    description: "An orange sphere with a fox emblem. It is cunning, quick to react and hard to pin down. Upgraded Mk II version: tougher and hits harder.",

    health: 61450,
    physicalDefense: "armor11",
    movementSpeed: 103,
    weaponName: "ak47",

    image: "image/bot_35.png",
    radius: 11,

    viewRange: 430,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1208,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 48,
    expGet: 1081,

    attackSpeed: 1,
    physicalDamage: 1005,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot56: {
    name: "Tidal Wave Mk II",
    description: "A deep-blue sphere with a wave emblem. It crashes into enemies in heavy waves of fire. Upgraded Mk II version: tougher and hits harder.",

    health: 63400,
    physicalDefense: "armor12",
    movementSpeed: 104,
    weaponName: "sniper",

    image: "image/bot_36.png",
    radius: 11,

    viewRange: 430,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 1247,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 49,
    expGet: 1115,

    attackSpeed: 1,
    physicalDamage: 1032,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot57: {
    name: "Hell Trident Mk II",
    description: "A red and black sphere with a trident emblem. It pierces armor with savage thrusts. Upgraded Mk II version: tougher and hits harder.",

    health: 65400,
    physicalDefense: "armor12",
    movementSpeed: 104,
    weaponName: "uzi",

    image: "image/bot_37.png",
    radius: 11,

    viewRange: 430,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1285,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 50,
    expGet: 1150,

    attackSpeed: 1,
    physicalDamage: 1059,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot58: {
    name: "Forest Spirit Mk II",
    description: "A green sphere with a leaf emblem. It looks calm but recovers and fights with ancient strength. Upgraded Mk II version: tougher and hits harder.",

    health: 67350,
    physicalDefense: "armor12",
    movementSpeed: 105,
    weaponName: "shotgun",

    image: "image/bot_38.png",
    radius: 11,

    viewRange: 440,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 10,
    active: false,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 1324,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 51,
    expGet: 1184,

    attackSpeed: 1,
    physicalDamage: 1085,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot21elite: {
    name: "Elite Cyber Falcon",
    description: "A cyan armored sphere with a glowing winged-falcon emblem. It swoops in fast and strikes with precise bursts.",

    health: 15000,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_21.png",
    radius: 13,

    viewRange: 340,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 230,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 14,
    expGet: 194,

    attackSpeed: 1,
    physicalDamage: 216,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot22elite: {
    name: "Elite Bone Reaper",
    description: "A soot-black sphere with orange glowing plates and a white skull emblem. It reaps anything that wanders into its patrol.",

    health: 18000,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_22.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 258,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 15,
    expGet: 227,

    attackSpeed: 1,
    physicalDamage: 248,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot23elite: {
    name: "Elite Blizzard Sentinel",
    description: "A frost-white sphere with a blue snowflake core. It guards its ground coldly and never tires.",

    health: 23000,
    physicalDefense: "armor3",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_23.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 314,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 16,
    expGet: 270,

    attackSpeed: 1,
    physicalDamage: 281,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot24elite: {
    name: "Elite Nuclear Warden",
    description: "A green-lit sphere marked with a radiation symbol. It poisons the air around it and hits with irradiated rounds.",

    health: 26000,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_24.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 336,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 17,
    expGet: 297,

    attackSpeed: 1,
    physicalDamage: 300,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot25elite: {
    name: "Elite Void Raven",
    description: "A dark purple sphere with a winged raven crest. It hunts from the shadows and strikes from odd angles.",

    health: 28400,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_25.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 364,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 18,
    expGet: 313,

    attackSpeed: 1,
    physicalDamage: 319,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot26elite: {
    name: "Elite Inferno Core",
    description: "A red-hot armored sphere with a blazing flame emblem. It burns with rage and hits with scorching force.",

    health: 31000,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "shotgun",

    image: "image/bot_26.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 392,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 19,
    expGet: 335,

    attackSpeed: 1,
    physicalDamage: 346,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot27elite: {
    name: "Elite Storm Surge",
    description: "A blue sphere crackling with a lightning-bolt emblem. It moves in quick bursts and shocks everything nearby.",

    health: 35000,
    physicalDefense: "armor4",
    movementSpeed: 90,
    weaponName: "ak47",

    image: "image/bot_27.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 414,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 20,
    expGet: 356,

    attackSpeed: 1,
    physicalDamage: 367,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot28elite: {
    name: "Elite Golden Monarch",
    description: "A gold-plated royal sphere with a crown emblem. It commands its area and takes heavy hits to bring down.",

    health: 36000,
    physicalDefense: "armor5",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/bot_28.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 426,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 21,
    expGet: 367,

    attackSpeed: 1,
    physicalDamage: 389,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot29elite: {
    name: "Elite Crimson Fiend",
    description: "A blood-red sphere with a horned demon face. It is relentless and brutal in close fights.",

    health: 38200,
    physicalDefense: "armor5",
    movementSpeed: 90,
    weaponName: "uzi",

    image: "image/bot_29.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 449,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 22,
    expGet: 388,

    attackSpeed: 1,
    physicalDamage: 408,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot30elite: {
    name: "Elite Sniper Prime",
    description: "A white and blue sphere with a targeting crosshair. It spots threats from far away and rarely misses.",

    health: 40400,
    physicalDefense: "armor5",
    movementSpeed: 91,
    weaponName: "shotgun",

    image: "image/bot_30.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 474,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 23,
    expGet: 408,

    attackSpeed: 1,
    physicalDamage: 429,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot31elite: {
    name: "Elite Toxic Plague",
    description: "A green sphere with a biohazard emblem. It spreads decay wherever it patrols.",

    health: 42800,
    physicalDefense: "armor5",
    movementSpeed: 91,
    weaponName: "ak47",

    image: "image/bot_31.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 498,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 24,
    expGet: 430,

    attackSpeed: 1,
    physicalDamage: 449,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot32elite: {
    name: "Elite Vortex Spiral",
    description: "A purple sphere with a swirling vortex core. It pulls enemies in and wears them down.",

    health: 45200,
    physicalDefense: "armor6",
    movementSpeed: 92,
    weaponName: "sniper",

    image: "image/bot_32.png",
    radius: 13,

    viewRange: 380,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 524,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 25,
    expGet: 453,

    attackSpeed: 1,
    physicalDamage: 470,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot33elite: {
    name: "Elite Crimson Eagle",
    description: "A red and white sphere with an eagle emblem. It dives on targets with disciplined aggression.",

    health: 47700,
    physicalDefense: "armor6",
    movementSpeed: 92,
    weaponName: "uzi",

    image: "image/bot_33.png",
    radius: 13,

    viewRange: 390,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 552,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 26,
    expGet: 476,

    attackSpeed: 1,
    physicalDamage: 492,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot34elite: {
    name: "Elite Hex Guardian",
    description: "A cyan sphere with a hexagon shield emblem. It holds its ground behind layered armor.",

    health: 50300,
    physicalDefense: "armor6",
    movementSpeed: 93,
    weaponName: "shotgun",

    image: "image/bot_34.png",
    radius: 13,

    viewRange: 390,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 580,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 27,
    expGet: 500,

    attackSpeed: 1,
    physicalDamage: 515,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot35elite: {
    name: "Elite Ember Fox",
    description: "An orange sphere with a fox emblem. It is cunning, quick to react and hard to pin down.",

    health: 53000,
    physicalDefense: "armor6",
    movementSpeed: 93,
    weaponName: "ak47",

    image: "image/bot_35.png",
    radius: 13,

    viewRange: 390,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 608,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 28,
    expGet: 525,

    attackSpeed: 1,
    physicalDamage: 538,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot36elite: {
    name: "Elite Tidal Wave",
    description: "A deep-blue sphere with a wave emblem. It crashes into enemies in heavy waves of fire.",

    health: 55800,
    physicalDefense: "armor7",
    movementSpeed: 94,
    weaponName: "sniper",

    image: "image/bot_36.png",
    radius: 13,

    viewRange: 390,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 638,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 29,
    expGet: 551,

    attackSpeed: 1,
    physicalDamage: 562,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot37elite: {
    name: "Elite Hell Trident",
    description: "A red and black sphere with a trident emblem. It pierces armor with savage thrusts.",

    health: 58700,
    physicalDefense: "armor7",
    movementSpeed: 94,
    weaponName: "uzi",

    image: "image/bot_37.png",
    radius: 13,

    viewRange: 390,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 669,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 30,
    expGet: 577,

    attackSpeed: 1,
    physicalDamage: 585,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot38elite: {
    name: "Elite Forest Spirit",
    description: "A green sphere with a leaf emblem. It looks calm but recovers and fights with ancient strength.",

    health: 61700,
    physicalDefense: "armor7",
    movementSpeed: 95,
    weaponName: "shotgun",

    image: "image/bot_38.png",
    radius: 13,

    viewRange: 400,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 701,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 31,
    expGet: 605,

    attackSpeed: 1,
    physicalDamage: 610,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot39elite: {
    name: "Elite Alien Overlord",
    description: "A purple sphere with an alien skull emblem. It commands its patrol with strange, deadly power.",

    health: 64800,
    physicalDefense: "armor7",
    movementSpeed: 95,
    weaponName: "ak47",

    image: "image/bot_39.png",
    radius: 13,

    viewRange: 400,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 734,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 32,
    expGet: 633,

    attackSpeed: 1,
    physicalDamage: 635,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot40elite: {
    name: "Elite Solar Nova",
    description: "A white and gold sphere with a radiant star emblem. It shines with explosive power.",

    health: 67900,
    physicalDefense: "armor8",
    movementSpeed: 96,
    weaponName: "sniper",

    image: "image/bot_40.png",
    radius: 13,

    viewRange: 400,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 766,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 33,
    expGet: 661,

    attackSpeed: 1,
    physicalDamage: 661,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot41elite: {
    name: "Elite Cyber Falcon Mk II",
    description: "A cyan armored sphere with a glowing winged-falcon emblem. It swoops in fast and strikes with precise bursts. Upgraded Mk II version: tougher and hits harder.",

    health: 71100,
    physicalDefense: "armor8",
    movementSpeed: 96,
    weaponName: "uzi",

    image: "image/bot_21.png",
    radius: 13,

    viewRange: 400,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 801,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 34,
    expGet: 691,

    attackSpeed: 1,
    physicalDamage: 688,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot42elite: {
    name: "Elite Bone Reaper Mk II",
    description: "A soot-black sphere with orange glowing plates and a white skull emblem. It reaps anything that wanders into its patrol. Upgraded Mk II version: tougher and hits harder.",

    health: 74400,
    physicalDefense: "armor8",
    movementSpeed: 97,
    weaponName: "shotgun",

    image: "image/bot_22.png",
    radius: 13,

    viewRange: 400,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 836,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 35,
    expGet: 721,

    attackSpeed: 1,
    physicalDamage: 714,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot43elite: {
    name: "Elite Blizzard Sentinel Mk II",
    description: "A frost-white sphere with a blue snowflake core. It guards its ground coldly and never tires. Upgraded Mk II version: tougher and hits harder.",

    health: 77800,
    physicalDefense: "armor8",
    movementSpeed: 97,
    weaponName: "ak47",

    image: "image/bot_23.png",
    radius: 13,

    viewRange: 410,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 871,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 36,
    expGet: 752,

    attackSpeed: 1,
    physicalDamage: 741,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot44elite: {
    name: "Elite Nuclear Warden Mk II",
    description: "A green-lit sphere marked with a radiation symbol. It poisons the air around it and hits with irradiated rounds. Upgraded Mk II version: tougher and hits harder.",

    health: 81300,
    physicalDefense: "armor9",
    movementSpeed: 98,
    weaponName: "sniper",

    image: "image/bot_24.png",
    radius: 13,

    viewRange: 410,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 908,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 37,
    expGet: 784,

    attackSpeed: 1,
    physicalDamage: 769,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot45elite: {
    name: "Elite Void Raven Mk II",
    description: "A dark purple sphere with a winged raven crest. It hunts from the shadows and strikes from odd angles. Upgraded Mk II version: tougher and hits harder.",

    health: 84800,
    physicalDefense: "armor9",
    movementSpeed: 98,
    weaponName: "uzi",

    image: "image/bot_25.png",
    radius: 13,

    viewRange: 410,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 945,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 38,
    expGet: 816,

    attackSpeed: 1,
    physicalDamage: 797,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot46elite: {
    name: "Elite Inferno Core Mk II",
    description: "A red-hot armored sphere with a blazing flame emblem. It burns with rage and hits with scorching force. Upgraded Mk II version: tougher and hits harder.",

    health: 88400,
    physicalDefense: "armor9",
    movementSpeed: 99,
    weaponName: "shotgun",

    image: "image/bot_26.png",
    radius: 13,

    viewRange: 410,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 984,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 39,
    expGet: 849,

    attackSpeed: 1,
    physicalDamage: 825,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot47elite: {
    name: "Elite Storm Surge Mk II",
    description: "A blue sphere crackling with a lightning-bolt emblem. It moves in quick bursts and shocks everything nearby. Upgraded Mk II version: tougher and hits harder.",

    health: 92100,
    physicalDefense: "armor9",
    movementSpeed: 99,
    weaponName: "ak47",

    image: "image/bot_27.png",
    radius: 13,

    viewRange: 410,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1023,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 40,
    expGet: 882,

    attackSpeed: 1,
    physicalDamage: 853,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot48elite: {
    name: "Elite Golden Monarch Mk II",
    description: "A gold-plated royal sphere with a crown emblem. It commands its area and takes heavy hits to bring down. Upgraded Mk II version: tougher and hits harder.",

    health: 95800,
    physicalDefense: "armor10",
    movementSpeed: 100,
    weaponName: "sniper",

    image: "image/bot_28.png",
    radius: 13,

    viewRange: 420,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 1063,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 41,
    expGet: 917,

    attackSpeed: 1,
    physicalDamage: 882,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot49elite: {
    name: "Elite Crimson Fiend Mk II",
    description: "A blood-red sphere with a horned demon face. It is relentless and brutal in close fights. Upgraded Mk II version: tougher and hits harder.",

    health: 99600,
    physicalDefense: "armor10",
    movementSpeed: 100,
    weaponName: "uzi",

    image: "image/bot_29.png",
    radius: 13,

    viewRange: 420,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 1102,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 42,
    expGet: 951,

    attackSpeed: 1,
    physicalDamage: 910,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot50elite: {
    name: "Elite Sniper Prime Mk II",
    description: "A white and blue sphere with a targeting crosshair. It spots threats from far away and rarely misses. Upgraded Mk II version: tougher and hits harder.",

    health: 103400,
    physicalDefense: "armor10",
    movementSpeed: 101,
    weaponName: "shotgun",

    image: "image/bot_30.png",
    radius: 13,

    viewRange: 420,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1144,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 43,
    expGet: 986,

    attackSpeed: 1,
    physicalDamage: 940,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot51elite: {
    name: "Elite Toxic Plague Mk II",
    description: "A green sphere with a biohazard emblem. It spreads decay wherever it patrols. Upgraded Mk II version: tougher and hits harder.",

    health: 107200,
    physicalDefense: "armor10",
    movementSpeed: 101,
    weaponName: "ak47",

    image: "image/bot_31.png",
    radius: 13,

    viewRange: 420,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 1184,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 44,
    expGet: 1022,

    attackSpeed: 1,
    physicalDamage: 969,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot52elite: {
    name: "Elite Vortex Spiral Mk II",
    description: "A purple sphere with a swirling vortex core. It pulls enemies in and wears them down. Upgraded Mk II version: tougher and hits harder.",

    health: 111100,
    physicalDefense: "armor11",
    movementSpeed: 102,
    weaponName: "sniper",

    image: "image/bot_32.png",
    radius: 13,

    viewRange: 420,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1226,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 45,
    expGet: 1057,

    attackSpeed: 1,
    physicalDamage: 998,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot53elite: {
    name: "Elite Crimson Eagle Mk II",
    description: "A red and white sphere with an eagle emblem. It dives on targets with disciplined aggression. Upgraded Mk II version: tougher and hits harder.",

    health: 115000,
    physicalDefense: "armor11",
    movementSpeed: 102,
    weaponName: "uzi",

    image: "image/bot_33.png",
    radius: 13,

    viewRange: 430,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.75, // chance to drop a gold orb on death
    goldOrbAmount: 1268,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 46,
    expGet: 1094,

    attackSpeed: 1,
    physicalDamage: 1027,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot54elite: {
    name: "Elite Hex Guardian Mk II",
    description: "A cyan sphere with a hexagon shield emblem. It holds its ground behind layered armor. Upgraded Mk II version: tougher and hits harder.",

    health: 118900,
    physicalDefense: "armor11",
    movementSpeed: 103,
    weaponName: "shotgun",

    image: "image/bot_34.png",
    radius: 13,

    viewRange: 430,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.6, // chance to drop a gold orb on death
    goldOrbAmount: 1310,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 47,
    expGet: 1131,

    attackSpeed: 1,
    physicalDamage: 1056,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot55elite: {
    name: "Elite Ember Fox Mk II",
    description: "An orange sphere with a fox emblem. It is cunning, quick to react and hard to pin down. Upgraded Mk II version: tougher and hits harder.",

    health: 122900,
    physicalDefense: "armor11",
    movementSpeed: 103,
    weaponName: "ak47",

    image: "image/bot_35.png",
    radius: 13,

    viewRange: 430,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1353,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 48,
    expGet: 1167,

    attackSpeed: 1,
    physicalDamage: 1085,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot56elite: {
    name: "Elite Tidal Wave Mk II",
    description: "A deep-blue sphere with a wave emblem. It crashes into enemies in heavy waves of fire. Upgraded Mk II version: tougher and hits harder.",

    health: 126800,
    physicalDefense: "armor12",
    movementSpeed: 104,
    weaponName: "sniper",

    image: "image/bot_36.png",
    radius: 13,

    viewRange: 430,
    viewAngle: 70,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.65, // chance to drop a gold orb on death
    goldOrbAmount: 1397,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 49,
    expGet: 1204,

    attackSpeed: 1,
    physicalDamage: 1115,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },
  bot57elite: {
    name: "Elite Hell Trident Mk II",
    description: "A red and black sphere with a trident emblem. It pierces armor with savage thrusts. Upgraded Mk II version: tougher and hits harder.",

    health: 130800,
    physicalDefense: "armor12",
    movementSpeed: 104,
    weaponName: "uzi",

    image: "image/bot_37.png",
    radius: 13,

    viewRange: 430,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 60,
    active: true,

    spawnItem: "specialstone",
    spawnGoldOrbChance: 0.7, // chance to drop a gold orb on death
    goldOrbAmount: 1439,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 50,
    expGet: 1242,

    attackSpeed: 1,
    physicalDamage: 1144,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,

    botSkill: ""
  },

  // ---------------------------------------------------------------------
  // boss1–boss17 — 17 BOSS enemies using boss1.png..boss17.png. Bigger
  // (radius), much tankier and harder hitting than bot01–bot20, slower to
  // move, and they respawn much later (respawn = seconds). Stats step up
  // gradually from boss1 (weakest) to boss17 (strongest); each has its own
  // display name + description. Tweak freely.
  // ---------------------------------------------------------------------
  boss1: {
    name: "Inferno Warlord",
    description: "A powerful fire-type boss bot covered in heavy armor and blazing energy. It attacks enemies with explosive fire strikes and becomes more dangerous when enraged.",

    health: 50000,
    physicalDefense: "armor3",
    movementSpeed: 60,
    weaponName: "uzi",

    image: "image/boss1.png",
    radius: 16,

    viewRange: 300,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 1800,

    respawn: 3600,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 150,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 6,
    expGet: 150,

    attackSpeed: 1,
    physicalDamage: 440,
    attack: "melee",
    criticalChance: 0.1,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss2: {
    name: "Tempest Sentinel",
    description: "A storm-type boss bot with silver plating and a swirling blue energy core. It lashes out with crackling bursts of lightning and keeps enemies off balance.",

    health: 345,
    physicalDefense: "armor3",
    movementSpeed: 62,
    weaponName: "shotgun",

    image: "image/boss2.png",
    radius: 16,

    viewRange: 309,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 2000,

    respawn: 65,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 190,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 6,
    expGet: 185,

    attackSpeed: 1,
    physicalDamage: 22,
    attack: "melee",
    criticalChance: 0.105,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss3: {
    name: "Shadow Drake",
    description: "A dark dragon-type boss bot wrapped in black armor and glowing violet energy. It strikes from the shadows with sharp, piercing attacks.",

    health: 390,
    physicalDefense: "armor4",
    movementSpeed: 58,
    weaponName: "ak47",

    image: "image/boss3.png",
    radius: 16,

    viewRange: 318,
    viewAngle: 85,

    patrolInterval: 3000,
    patrolRadius: 50,

    lookDuration: 2200,

    respawn: 70,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 230,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 6,
    expGet: 220,

    attackSpeed: 1,
    physicalDamage: 23,
    attack: "melee",
    criticalChance: 0.11,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss4: {
    name: "Golden Tyrant",
    description: "A heavy dragon-type boss bot studded with golden spikes over black plating. It charges straight into enemies and crushes anything that gets too close.",

    health: 435,
    physicalDefense: "armor4",
    movementSpeed: 70,
    weaponName: "sniper",

    image: "image/boss4.png",
    radius: 16,

    viewRange: 327,
    viewAngle: 95,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 2400,

    respawn: 75,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 270,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 7,
    expGet: 255,

    attackSpeed: 1,
    physicalDamage: 24,
    attack: "melee",
    criticalChance: 0.115,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss5: {
    name: "Frostbite Colossus",
    description: "An ice-type boss bot armored in silver plates and jagged blue crystals. It freezes the battlefield with icy blasts and slows down anyone who stays near it.",

    health: 480,
    physicalDefense: "armor5",
    movementSpeed: 75,
    weaponName: "uzi",

    image: "image/boss5.png",
    radius: 16,

    viewRange: 336,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 80,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 310,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 7,
    expGet: 290,

    attackSpeed: 1,
    physicalDamage: 26,
    attack: "melee",
    criticalChance: 0.12,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss6: {
    name: "Plague Reaper",
    description: "A poison-type boss bot with a biohazard core and razor-sharp green claws. It spreads toxic energy across the area and wears enemies down over time.",

    health: 525,
    physicalDefense: "armor5",
    movementSpeed: 72,
    weaponName: "shotgun",

    image: "image/boss6.png",
    radius: 16,

    viewRange: 345,
    viewAngle: 120,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 2000,

    respawn: 85,
    active: false,

    spawnItem: "specialstone,armor1,armor2,armor3",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 350,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 7,
    expGet: 325,

    attackSpeed: 1,
    physicalDamage: 28,
    attack: "melee",
    criticalChance: 0.125,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss7: {
    name: "Doom Skull",
    description: "A heavy artillery-type boss bot with a glowing skull core and cannon pods on its armor. It bombards enemies with explosive blasts from a distance.",

    health: 570,
    physicalDefense: "armor6",
    movementSpeed: 64,
    weaponName: "ak47",

    image: "image/boss7.png",
    radius: 16,

    viewRange: 354,
    viewAngle: 90,

    patrolInterval: 3000,
    patrolRadius: 60,

    lookDuration: 2200,

    respawn: 90,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 390,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 8,
    expGet: 360,

    attackSpeed: 1,
    physicalDamage: 29,
    attack: "melee",
    criticalChance: 0.13,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss8: {
    name: "Void Seer",
    description: "A void-type boss bot with a glowing violet eye and jagged spiked armor. It watches from afar and strikes with warped dark energy.",

    health: 615,
    physicalDefense: "armor6",
    movementSpeed: 80,
    weaponName: "sniper",

    image: "image/boss8.png",
    radius: 16,

    viewRange: 363,
    viewAngle: 105,

    patrolInterval: 3000,
    patrolRadius: 110,

    lookDuration: 2400,

    respawn: 95,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 430,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 8,
    expGet: 395,

    attackSpeed: 1,
    physicalDamage: 30,
    attack: "melee",
    criticalChance: 0.135,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss9: {
    name: "Crown Commander",
    description: "A royal elite boss bot in blue and gold armor marked with a golden crown. It commands the battlefield with disciplined, powerful strikes.",

    health: 660,
    physicalDefense: "armor7",
    movementSpeed: 85,
    weaponName: "uzi",

    image: "image/boss9.png",
    radius: 16,

    viewRange: 372,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 120,

    lookDuration: 1800,

    respawn: 100,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 470,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 8,
    expGet: 430,

    attackSpeed: 1,
    physicalDamage: 32,
    attack: "melee",
    criticalChance: 0.14,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss10: {
    name: "Crimson Demon",
    description: "A demon-type boss bot with black armor, glowing red veins and curved horns. It hunts relentlessly and hits with brutal force.",

    health: 705,
    physicalDefense: "armor7",
    movementSpeed: 60,
    weaponName: "shotgun",

    image: "image/boss10.png",
    radius: 16,

    viewRange: 381,
    viewAngle: 80,

    patrolInterval: 3000,
    patrolRadius: 40,

    lookDuration: 2000,

    respawn: 105,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 510,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 465,

    attackSpeed: 1,
    physicalDamage: 34,
    attack: "melee",
    criticalChance: 0.145,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss11: {
    name: "Bloodsight Hunter",
    description: "A hunter-type boss bot with a red targeting eye and spiked black armor. It locks onto its prey and never lets it escape.",

    health: 750,
    physicalDefense: "armor7",
    movementSpeed: 66,
    weaponName: "ak47",

    image: "image/boss11.png",
    radius: 16,

    viewRange: 390,
    viewAngle: 85,

    patrolInterval: 3000,
    patrolRadius: 55,

    lookDuration: 2200,

    respawn: 110,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 550,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 500,

    attackSpeed: 1,
    physicalDamage: 35,
    attack: "melee",
    criticalChance: 0.15,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss12: {
    name: "Azure Dragon",
    description: "A dragon-type boss bot in silver armor with a glowing blue dragon emblem. It fiercely guards its territory and unleashes bursts of blue energy.",

    health: 795,
    physicalDefense: "armor8",
    movementSpeed: 78,
    weaponName: "sniper",

    image: "image/boss12.png",
    radius: 16,

    viewRange: 399,
    viewAngle: 95,

    patrolInterval: 3000,
    patrolRadius: 70,

    lookDuration: 2400,

    respawn: 115,
    active: false,

    spawnItem: "specialstone,armor3,armor4,armor5",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 590,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 9,
    expGet: 535,

    attackSpeed: 1,
    physicalDamage: 36,
    attack: "melee",
    criticalChance: 0.155,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss13: {
    name: "Violet Wyrm",
    description: "A dark dragon-type boss bot with large purple horns and glowing violet plating. Its towering frame overwhelms enemies with heavy, slashing attacks.",

    health: 840,
    physicalDefense: "armor8",
    movementSpeed: 82,
    weaponName: "uzi",

    image: "image/boss13.png",
    radius: 16,

    viewRange: 408,
    viewAngle: 110,

    patrolInterval: 3000,
    patrolRadius: 100,

    lookDuration: 1800,

    respawn: 120,
    active: false,

    spawnItem: "specialstone,armor5,armor6,armor7",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 630,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 570,

    attackSpeed: 1,
    physicalDamage: 38,
    attack: "melee",
    criticalChance: 0.16,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss14: {
    name: "Magma Dragon",
    description: "A molten dragon-type boss bot built from black armor plates glowing with orange heat. It burns everything around it and gets tougher the longer the fight lasts.",

    health: 885,
    physicalDefense: "armor9",
    movementSpeed: 74,
    weaponName: "shotgun",

    image: "image/boss14.png",
    radius: 16,

    viewRange: 417,
    viewAngle: 100,

    patrolInterval: 3000,
    patrolRadius: 90,

    lookDuration: 2000,

    respawn: 125,
    active: false,

    spawnItem: "specialstone,armor5,armor6,armor7",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 670,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 605,

    attackSpeed: 1,
    physicalDamage: 40,
    attack: "melee",
    criticalChance: 0.165,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss15: {
    name: "Glacier Warden",
    description: "An ice-type boss bot with a snowflake core and sharp crystal spikes. It guards its area coldly and punishes anyone who steps in.",

    health: 930,
    physicalDefense: "armor9",
    movementSpeed: 88,
    weaponName: "ak47",

    image: "image/boss15.png",
    radius: 16,

    viewRange: 426,
    viewAngle: 115,

    patrolInterval: 3000,
    patrolRadius: 110,

    lookDuration: 2200,

    respawn: 130,
    active: false,

    spawnItem: "specialstone,armor5,armor6,armor7",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 710,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 10,
    expGet: 640,

    attackSpeed: 1,
    physicalDamage: 41,
    attack: "melee",
    criticalChance: 0.17,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss16: {
    name: "Toxic Behemoth",
    description: "A huge poison-type boss bot with heavy green plating and curved claws around a biohazard core. It is slow but extremely tough, and it poisons the ground it walks on.",

    health: 975,
    physicalDefense: "armor10",
    movementSpeed: 90,
    weaponName: "sniper",

    image: "image/boss16.png",
    radius: 16,

    viewRange: 435,
    viewAngle: 105,

    patrolInterval: 3000,
    patrolRadius: 120,

    lookDuration: 2400,

    respawn: 135,
    active: false,

    spawnItem: "specialstone,armor5,armor6,armor7",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 750,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 675,

    attackSpeed: 1,
    physicalDamage: 42,
    attack: "melee",
    criticalChance: 0.175,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  boss17: {
    name: "Deathbringer",
    description: "The most feared boss bot, a heavy artillery machine with a white skull core and cannon barrels on its armor. It shows no mercy and wipes out anything in its range.",

    health: 1020,
    physicalDefense: "armor10",
    movementSpeed: 68,
    weaponName: "uzi",

    image: "image/boss17.png",
    radius: 16,

    viewRange: 444,
    viewAngle: 120,

    patrolInterval: 3000,
    patrolRadius: 80,

    lookDuration: 1800,

    respawn: 140,
    active: false,

    spawnItem: "specialstone,armor5,armor6,armor7",
    spawnGoldOrbChance: 1.0, // chance to drop a gold orb on death
    goldOrbAmount: 790,       // gold given when this bot's orb is picked up

    unitExplode: "unitexplode",

    level: 11,
    expGet: 710,

    attackSpeed: 1,
    physicalDamage: 44,
    attack: "melee",
    criticalChance: 0.18,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.005,
    manaRegen: 0.01,

    botSkill: "slash1,barrage,cannonblast,deadlystrike"
  },

  // Add more bot classes the same way — and mirror the same entry in the
  // public bot.js's BOT_TYPES (that copy only matters for OFFLINE mode now,
  // but keeping the two in sync avoids confusion later).

};

// =============================================================================
// ONLINE DRAWING — drawBots() (enemy sprite, health bar, NAME and LEVEL)
// =============================================================================
// Functions in a *_server.js file replace the game's own function of the same
// name while you are ONLINE (online.js's netInstallServerCode() — the same way
// character_server.js's functions work), and the original comes back when you
// leave. So this is the real online look of an enemy: change the name/level
// layout here and it only affects online mode. bot.js has its own copy for
// OFFLINE. The name shown is each bot type's `name` field above.
// (server.js only loads this file in Node to read BOT_TYPES — it never calls
// drawBots, so the browser-only names used inside are fine.)
// =============================================================================

function drawBots(ctx, bots, worldOffsetX, worldOffsetY) {

  for (const bot of bots) {
    if (!bot.alive) continue;

    const screenX = worldOffsetX + bot.x;
    const screenY = worldOffsetY + bot.y;
    const imgSize = bot.radius * 2;

    ctx.save();
    ctx.translate(screenX, screenY);

    if (bot.image && bot.image.complete && bot.image.naturalWidth > 0) {
      ctx.drawImage(bot.image, -imgSize / 2, -imgSize / 2, imgSize, imgSize);
    } else {
      ctx.fillStyle = "#f44";
      ctx.beginPath();
      ctx.arc(0, 0, bot.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Movement direction arrow — image/arrow.png, rotated to bot.facingAngle
    // and shown only while the bot is actually moving (bot.isMoving, set in
    // updateBot()'s chase/search/patrol cases above). Sits just outside the
    // bot's own circle, pointing the way it's walking.
    if (bot.isMoving && botArrowImage.complete && botArrowImage.naturalWidth > 0) {
      const arrowSize = Math.max(14, bot.radius * 0.9);
      const arrowDist = bot.radius + 6 + arrowSize / 2;

      ctx.save();
      ctx.rotate(bot.facingAngle);
      ctx.translate(arrowDist, 0);
      // arrow.png is drawn pointing right (angle 0) by default; rotate an
      // extra 90deg here only if the source art actually points up instead.
      ctx.drawImage(botArrowImage, -arrowSize / 2, -arrowSize / 2, arrowSize, arrowSize);
      ctx.restore();
    }

    // WEAPON UPGRADE AURA — colored glow tiered by bot.weapon.upgradeLevel
    if (typeof drawWeaponUpgradeAura === "function") {
      drawWeaponUpgradeAura(ctx, bot.radius, bot.weapon && bot.weapon.upgradeLevel);
    }

    ctx.restore();

    // Health bar — enemy palette (healthborder1.png / healthhud1.png,
    // shared healthempty.png backdrop). drawImageHealthBar is defined in
    // effect.js (loads before bot.js — see index.html script order).
    const hpPercent = Math.max(0, bot.health / bot.maxHealth);
    const barWidth = 30;
    const barHeight = 4;

    drawImageHealthBar(
      ctx,
      screenX - barWidth / 2, screenY - bot.radius - 10, barWidth, barHeight,
      hpPercent,
      healthBorderImage1, healthHudImage1, healthEmptyImage
    );

    // NAME + LEVEL — stacked above the health bar, top to bottom:
    //     Lv 1
    //     Patrol Officer
    //     [health bar]
    // The name is the bot type's `name` field (BOT_TYPES here offline,
    // bot_server.js online — BOT_TYPES is swapped for the server's table
    // while playing online, and guests' puppet bots keep the same `type`,
    // so this works for everyone). A plain lowercase name (old types like
    // "rusher") is shown Title Cased.
    ctx.font = "9px 'Courier New', Courier, monospace";
    ctx.textAlign = "center";
    const botDef = (typeof BOT_TYPES !== "undefined" && BOT_TYPES[bot.type]) || null;
    let nameLabel = (botDef && botDef.name) ? String(botDef.name) : "";
    if (nameLabel && nameLabel === nameLabel.toLowerCase()) {
      nameLabel = nameLabel.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    const nameLabelY = screenY - bot.radius - 13;
    const levelLabel = "Lv " + (bot.level || 1);
    // With a name: name sits right above the bar, Lv stacked above it.
    // Without one: the old single Lv line.
    const levelLabelY = nameLabel ? nameLabelY - 10 : nameLabelY;
    // Cheap "shadow" — draw the text once in dark, 1px offset, then the
    // real color on top. Same readable pop as shadowBlur, no blur cost.
    if (nameLabel) {
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillText(nameLabel, screenX + 1, nameLabelY + 1);
      ctx.fillStyle = "#ff3b3b";   // enemy bots can always be attacked -> red name
      ctx.fillText(nameLabel, screenX, nameLabelY);
    }
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillText(levelLabel, screenX + 1, levelLabelY + 1);
    ctx.fillStyle = "#ffe066";
    ctx.fillText(levelLabel, screenX, levelLabelY);
    ctx.textAlign = "left";
  }
}

// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { BOT_TYPES };
