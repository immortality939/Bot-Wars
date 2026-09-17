// bot.js
//
// Enemy bots for OFFLINE mode.
//
// A bot is built the same way a character is (character.js) plus a
// weapon (weapon.js), but it also gets an AI state machine that makes it:
//   - patrol randomly, pausing every few seconds to pick a new spot
//   - stop and "look around" (rotate through random angles) when idle
//   - see the player within a view range (blocked by obstacles)
//   - chase the player once seen, and shoot once in shooting range
//     (only if this bot's `active` setting is on, or it's already been
//     shot by the player this life — see ACTIVE / AGGRO below)
//   - if the player breaks line of sight, walk to the player's last
//     known position before giving up and going back to patrol
//   - if hit by the player (even from outside its view range / from
//     behind), turn and fight back toward where the shot came from
//   - collide with walls/boxes (obstacles), the player, and each other
//     — bots never walk through any of these
//   - respawn automatically back at its original spawn point some time
//     after dying — see RESPAWN below
//
// ACTIVE / AGGRO (BOT_TYPES[...].active):
//   - active: true  -> the bot behaves normally: sees the player, chases
//     into range, and shoots — from the moment it spawns (this was the
//     only behavior before this setting existed).
//   - active: false -> the bot is passive: it completely ignores the
//     player — keeps patrolling/looking around on its own patrol loop
//     even while the player is standing right in its view cone — until
//     the player actually lands a hit on it. That first hit "aggroes"
//     it (bot.aggroed = true) and it immediately turns hostile (chases,
//     shoots) for the rest of that life, exactly like an active bot.
//     If it then loses sight of the player continuously for
//     aggroForgetTime (BOT_TYPES[...].aggroForgetTime, seconds, default
//     3), it forgets and goes back to fully ignoring the player until
//     hit again. A respawn also resets it back to passive/forgotten.
//
// RESPAWN (BOT_TYPES[...].respawn, in seconds):
//   - When a bot dies (bullet kill or a burn/fire-orb tick killing it),
//     its death time is recorded. Once `respawn` seconds have passed,
//     updateBots() automatically resets it back to full health/ammo/
//     state at the exact x/y it was originally spawned at when the
//     level started (bot.spawnX/spawnY), as if it were never killed.
//
// Load order required:
//   weapon.js -> armor.js -> character.js -> effect.js -> level.js -> bot.js -> game.js
//
// BOT_TYPES[...].physicalDefense is an armor.js type name now (e.g.
// "armor1"), resolved into a real armor value + max-health bonus via
// getArmorStats() (armor.js) in createBot()/respawnBot() below —
// still falls back to a plain number (or 0) if armor.js isn't loaded.
//
// game.js is responsible for:
//   - calling spawnBotsForLevel() when an offline level starts
//   - calling updateBots() every frame (this also handles respawning
//     dead bots once their respawn timer elapses)
//   - calling drawBots() every frame
//   - checking player-bullet vs bot collisions (calling damageBot() +
//     botGotHit() on a hit)
//   - checking bot-bullet vs player collisions (bot bullets are pushed
//     straight into game.js's own shared `bullets` array, so the
//     existing bullet movement/obstacle/out-of-bounds code already
//     handles them for free)


if (typeof getWeapon === "undefined") {
  throw new Error("bot.js requires weapon.js to be loaded first");
}


// ---------------------------------------------------------------------------
// BOT TYPES
// Add new bot "classes" here the same way CHARACTERS works in character.js.
// Levels reference these by name in their `enemyBots` list (see level.js).
// ---------------------------------------------------------------------------
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

    // How far (px) this bot can SEE the player.
    // Also used when spawning: bots are kept at least this far from the
    // player's spawn point.
    viewRange: 260,

    // NOTE: shooting range is no longer set here — it's taken straight
    // from this bot's weapon (uzi's maxRange, weapon.js) at spawn time.
    // See createBot()'s `shootRange: weaponTemplate.maxRange`.

    // FIELD OF VIEW (degrees, total cone width centered on facingAngle).
    // The player must be within this cone AND within viewRange AND in
    // line of sight to be spotted — a bot looking left won't magically
    // notice someone standing behind it.
    viewAngle: 80,

    // PATROL: every patrolInterval ms (or sooner if it reaches its target),
    // the bot stops. patrolRadius is how far (in x and y) the next random
    // patrol point can be from where it stopped.
    patrolInterval: 3000,
    patrolRadius: 100,

    // LOOK: after stopping, the bot scans left/right around the direction
    // it was facing for this long before patrolling again.
    lookDuration: 1500,

    // RESPAWN: seconds after dying before this bot resets back to full
    // health/ammo at its original spawn point (see RESPAWN in the file
    // header comment above).
    respawn: 10,

    // ACTIVE: false = passive until shot at (see ACTIVE / AGGRO in the
    // file header comment above). true = always shoots on sight.
    active: false,

    // ITEM DROPS — comma-separated list of item types (see item.js) this
    // bot type can drop when it dies. Each type rolls its OWN spawn
    // chance independently (item.js's ITEM_TYPES[...].spawnChance), so a
    // single death can drop zero, one, or several of these. A weapon name
    // (e.g. "ak47") can be mixed into this list too — any WEAPONS entry
    // in weapon.js marked category: "weapon" is droppable the same way,
    // using its own spawnChance from weapon.js. A dropped weapon goes
    // straight into the storage grid inventory to be equipped later,
    // instead of applying an instant effect like the others.
    spawnItem: "specialstone",
    spawnGoldOrb: "goldOrb",

    // DEATH ANIMATION — see UNIT EXPLODE in effect.js and
    // damageBot() below, which plays this the moment this bot dies.
    unitExplode: "unitexplode",

    // LEVELING — see character.js's getExpForLevel()/addCharacterExp().
    // Killing this bot grants the player expGet exp, every time (bots
    // respawn indefinitely, so this pays out again on each kill, not
    // just the first).
    level: 1,
    expGet: 300,

    // ---- COMBAT STATS — same fields/meaning as CHARACTERS in
    // character.js (see its comments): attackSpeed replaces the old
    // per-weapon `cooldown`, damage always combines with this bot's
    // weapon damage, criticalChance/criticalDamage roll on every shot,
    // mana/manaRegen/hpRegen are tracked the same way (see
    // tickCharacterRegen() in character.js) even though bots don't cast
    // skills yet. ----
    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01
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
    // shooting range now comes from shotgun's maxRange (weapon.js) — see
    // createBot()'s `shootRange: weaponTemplate.maxRange`.
    viewAngle: 110,

    patrolInterval: 3500,
    patrolRadius: 50,
    lookDuration: 2200,

    respawn: 10,
    active: false,

    spawnItem: "shield,speedup,powerup,health,shotgun",
    spawnGoldOrb: "goldOrb",

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
  
    assaulter: {
    name: "assaulter",

    health: 120,
    physicalDefense: "armor2",
    movementSpeed: 100,
    weaponName: "ak47",

    image: "image/soldier.png",
    radius: 13,

    // viewRange must be >= ak47's maxRange (320, weapon.js) — a bot
    // can't shoot past what it can see, so this was quietly capping the
    // weapon's real range before shootRange started tracking maxRange.
    viewRange: 320,
    // shooting range now comes from ak47's maxRange (weapon.js) — see
    // createBot()'s `shootRange: weaponTemplate.maxRange`.
    viewAngle: 140,

    patrolInterval: 3500,
    patrolRadius: 70,
    lookDuration: 2200,

    respawn: 10,
    active: false,

    spawnItem: "armor1",
    spawnGoldOrb: "goldOrb",

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

    // viewRange must be >= sniper's maxRange (500, weapon.js) — same
    // reasoning as assaulter above, so this bot can actually snipe out
    // to the weapon's full real range instead of being capped short.
    viewRange: 500,
    // shooting range now comes from sniper's maxRange (weapon.js) — see
    // createBot()'s `shootRange: weaponTemplate.maxRange`.
    viewAngle: 40,

    patrolInterval: 4000,
    patrolRadius: 30,
    lookDuration: 2500,

    respawn: 10,
    active: false,

    spawnItem: "shield,speedup,powerup,health,sniper",
    spawnGoldOrb: "goldOrb",

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

  // Add more bot classes the same way, e.g.:
  // guard: { name: "guard", health: 140, armor: 3, movementSpeed: 70,
  //          weaponName: "shotgun", image: "swat.png", radius: 13,
  //          viewRange: 200, shootRange: 160, viewAngle: 90,
  //          patrolInterval: 3000, patrolRadius: 60, lookDuration: 2000 }

};



// ---------------------------------------------------------------------------
// IMAGE CACHE — bots reuse one Image object per sprite file, no matter how
// many bots use it.
// ---------------------------------------------------------------------------
const botImageCache = {};

function getBotImage(filename) {
  if (!botImageCache[filename]) {
    const img = new Image();
    img.src = filename;
    botImageCache[filename] = img;
  }
  return botImageCache[filename];
}

// Direction-indicator arrow shown next to every bot while it's actually
// walking somewhere (chase/search/patrol — see bot.isMoving, set in
// updateBot() above). One shared Image, same idea as botImageCache.
const botArrowImage = new Image();
botArrowImage.src = "image/arrow.png";

// ---------------------------------------------------------------------------
// CREATE A BOT
// ---------------------------------------------------------------------------
let nextBotId = 1;

function createBot(typeName, x, y) {

  const def = BOT_TYPES[typeName];

  if (!def) {
    throw new Error("Bot type not found: " + typeName);
  }

  const weaponTemplate = getWeapon(def.weaponName);

  if (!weaponTemplate) {
    throw new Error("Bot weapon not found: " + def.weaponName);
  }

  // ARMOR — def.physicalDefense is now an armor.js type name (e.g.
  // "armor1") for most bot types instead of a flat number;
  // getArmorStats() (armor.js) resolves that into an actual armor value +
  // max-health bonus + every other "connected stat" the armor def
  // carries (bonuses — magicalAttack, magicalDefense, physicalDamage,
  // etc., see ARMOR_CONNECTED_STAT_FIELDS there). Still falls back
  // cleanly to a plain number (shooter's physicalDefense: 0) or to no
  // bonus at all if armor.js isn't loaded.
  const armorStats = (typeof getArmorStats === "function")
    ? getArmorStats(def.physicalDefense)
    : { armorValue: (typeof def.physicalDefense === "number" ? def.physicalDefense : 0), health: 0, def: null, bonuses: {} };
  const armorBonuses = armorStats.bonuses || {};

  // HEALTH SCALING — same 10% compounding per level as the player (see
  // getHealthForLevel() in character.js): def.health is this bot type's
  // level-1 baseline, scaled up for def.level, then armor's health
  // bonus is layered on top, same as before.
  const scaledHealth = (typeof getHealthForLevel === "function")
    ? getHealthForLevel(def.health, def.level || 1)
    : def.health;

  const maxHealth = scaledHealth + armorStats.health;

  return {
    id: nextBotId++,
    type: typeName,

    x: x,
    y: y,
    radius: def.radius || 12,

    // Original spawn point (fixed for this bot's whole lifetime, even
    // across respawns) — see RESPAWN in the file header comment above
    // and respawnBot() below.
    spawnX: x,
    spawnY: y,
    respawnTime: (typeof def.respawn === "number" ? def.respawn : 10) * 1000,
    deathTime: 0,

    // ACTIVE / AGGRO — see the file header comment above. A bot with
    // active:true always shoots on sight; active:false stays passive
    // (aggroed stays false) until the player actually lands a hit on
    // it, at which point botGotHit() flips aggroed to true. Once
    // aggroed, aggroLostTimer counts up every frame it can't see the
    // player; hitting aggroForgetTime resets aggroed back to false
    // (only checked for active:false bots — see updateSingleBot).
    active: def.active === true,
    aggroed: false,
    aggroLostTimer: 0,
    aggroForgetTime: (typeof def.aggroForgetTime === "number" ? def.aggroForgetTime : 3) * 1000,

    health: maxHealth,
    maxHealth: maxHealth,
    physicalDefense: armorStats.armorValue,
    equippedArmor: armorStats.def,   // armor.js def, or null — used by tickArmorRegeneration()/rollArmorBlock()
    movementSpeed: def.movementSpeed + (armorBonuses.movementSpeed || 0),
    baseMovementSpeed: def.movementSpeed,

    // ORB STATUS EFFECTS — set by applyOrbEffect() when hit by a bullet
    // fired from a weapon with an attachedOrb (see upgrade.js/game.js).
    // null/false when not currently affected.
    statusFire: null,       // { endTime, damagePerMs }
    statusIce: null,        // { endTime, slowAmount }
    statusElectric: null,   // { endTime }
    stunned: false,

    // References to this bot's currently-playing orb animation instance
    // per element (see effect.js's createHitEffect / playOrRefreshOrbAnimation
    // above) — null when nothing's playing.
    fireAnim: null,
    iceAnim: null,
    electricAnim: null,

    // Bot gets its own copy of the weapon (independent from the
    // player's) — there's no reload mechanic, so nothing else to track
    // here.
    weaponName: def.weaponName,
    weapon: JSON.parse(JSON.stringify(weaponTemplate)),

    viewRange: def.viewRange,
    // SHOOT RANGE — this bot's effective attack range, taken directly
    // from its equipped weapon's own maxRange (weapon.js) instead of a
    // separate hand-tuned number, so a bot's engagement distance always
    // matches what that weapon can actually do (same source of truth
    // the player's own aim UI uses).
    shootRange: weaponTemplate.maxRange,
    viewAngle: def.viewAngle || 80,
    patrolInterval: def.patrolInterval,
    patrolRadius: def.patrolRadius,
    lookDuration: def.lookDuration,

    // Which item types (see item.js) this bot can drop when it dies.
    spawnItem: def.spawnItem,

    // Separate from spawnItem above — this bot's own independent chance
    // to drop a goldOrb (item.js) on death. Kept as its own field/roll
    // instead of folding "goldOrb" into the spawnItem list so a bot's
    // gold drop and its regular item drop don't share one outcome.
    spawnGoldOrb: def.spawnGoldOrb,

    // DEATH ANIMATION — played once by damageBot() below the
    // moment this bot's health hits 0 (see UNIT EXPLODE in effect.js).
    unitExplode: def.unitExplode || "unitexplode",

    // LEVELING — see character.js's getExpForLevel()/addCharacterExp().
    // level is just this bot's own difficulty tier for now; expGet is
    // how much exp the player is granted for killing it (game.js reads
    // this once per death, gated by expAwarded below, same pattern as
    // dropsSpawned).
    level: def.level || 1,
    expGet: typeof def.expGet === "number" ? def.expGet : 30,
    expAwarded: false,

    // COMBAT STATS — see the matching comment block on CHARACTERS in
    // character.js. attackSpeed/lastAttackTime replace the old
    // per-weapon `cooldown` (weapon.js) — see canCharacterAttack() there
    // and tryBotShoot() below. Each of these adds this bot type's own
    // def value PLUS whatever its equipped armor grants (armorBonuses,
    // from getArmorStats() above) — mirrors combineEquipmentStats()
    // (character.js) folding a player's equipped gear onto their own
    // stats the same way.
    attackSpeed: typeof def.attackSpeed === "number" ? def.attackSpeed : 1,
    physicalDamage: (typeof def.physicalDamage === "number" ? def.physicalDamage : 0) + (armorBonuses.physicalDamage || 0),
    attack: def.attack || "melee",
    // MAGIC STATS — magicalAttack/magicalDefense previously weren't
    // read here at ALL (unlike physicalDamage/criticalChance/etc. right
    // next to them), so a bot's magicalAttack and magicalDefense were
    // always 0 no matter what its own def or its armor said: it could
    // never deal magic damage, and any magic damage a player dealt to
    // it went through completely unmitigated.
    magicalAttack: (typeof def.magicalAttack === "number" ? def.magicalAttack : 0) + (armorBonuses.magicalAttack || 0),
    magicalDefense: (typeof def.magicalDefense === "number" ? def.magicalDefense : 0) + (armorBonuses.magicalDefense || 0),
    criticalChance: (typeof def.criticalChance === "number" ? def.criticalChance : 0) + (armorBonuses.criticalChance || 0),
    criticalDamage: (typeof def.criticalDamage === "number" ? def.criticalDamage : 0) + (armorBonuses.criticalDamage || 0),
    hpRegen: (typeof def.hpRegen === "number" ? def.hpRegen : 0) + (armorBonuses.hpRegen || 0),
    manaRegen: (typeof def.manaRegen === "number" ? def.manaRegen : 0) + (armorBonuses.manaRegen || 0),
    lastAttackTime: 0,
    _hpRegenAcc: 0,
    _manaRegenAcc: 0,

    // MANA — bot.js tracks current/max as mana/maxMana (mirrors
    // health/maxHealth's current/cap split above), unlike character.js's
    // currentMana/mana — see tickCharacterRegen()'s dual-style support.
    // Armor's own mana bonus (armorBonuses.mana) is included in maxMana
    // the same way armor's health bonus is already folded into
    // maxHealth above.
    mana: (typeof def.mana === "number" ? def.mana : 0) + (armorBonuses.mana || 0),
    maxMana: (typeof def.mana === "number" ? def.mana : 0) + (armorBonuses.mana || 0),

    // Set true once this bot's death drops have been rolled — a bot can
    // die either from a direct bullet hit (game.js's bullet-collision
    // check) or from a burn tick (bot.js's updateBotStatusEffects); this
    // flag stops both paths from spawning the same bot's loot twice.
    dropsSpawned: false,

    image: getBotImage(def.image),

    facingAngle: Math.random() * Math.PI * 2,

    // AI state: "patrol" | "look" | "chase" | "search" | "attack"
    state: "patrol",
    stateTimer: 0,

    patrolTarget: { x: x, y: y },

    // LOOK state scans left/right around lookBaseAngle instead of
    // spinning through fully random directions.
    lookBaseAngle: 0,
    lookTargetAngle: Math.random() * Math.PI * 2,
    lookSide: 1,

    lastKnownPlayerPos: null,

    // LINE-OF-SIGHT THROTTLE — see updateSingleBot() below. The obstacle
    // raycast is the expensive part of vision, so it's only re-run on a
    // short interval instead of every single frame; these hold the timer
    // and the most recent result to reuse in between.
    visionCheckTimer: 0,
    lastVisionResult: false,

    alive: true
  };
}



// ---------------------------------------------------------------------------
// SPAWNING — used by game.js when an offline level starts.
// levelData.enemyBots looks like:
//   enemyBots: [ { name: "rusher", quantity: 4 } ]
// ---------------------------------------------------------------------------
function spawnBotsForLevel(levelData, playerSpawnPoint, obstacles) {

  const bots = [];
  const list = levelData.enemyBots || [];

  const worldWidth = levelData.worldWidth;
  const worldHeight = levelData.worldHeight;

  for (const entry of list) {

    const typeName = entry.name;
    const quantity = entry.quantity || 0;
    const def = BOT_TYPES[typeName];

    if (!def) {
      console.warn("bot.js: unknown bot type in level data:", typeName);
      continue;
    }

    for (let i = 0; i < quantity; i++) {
      const pos = findBotSpawnPosition(
        def, playerSpawnPoint, obstacles, worldWidth, worldHeight
      );
      bots.push(createBot(typeName, pos.x, pos.y));
    }
  }

  return bots;
}


// Finds a random spot at least `def.viewRange` away from the player's
// spawn point (so a bot never spawns already staring at the player) and
// never sitting inside an obstacle. Falls back through looser passes
// rather than ever placing a bot inside a wall/box.
function findBotSpawnPosition(def, playerSpawnPoint, obstacles, worldWidth, worldHeight) {

  const minDistFromPlayer = def.viewRange;
  const margin = 30;
  const maxAttempts = 60;

  // Pass 1: random point, far enough from the player AND clear of obstacles
  for (let attempt = 0; attempt < maxAttempts; attempt++) {

    const x = margin + Math.random() * (worldWidth - margin * 2);
    const y = margin + Math.random() * (worldHeight - margin * 2);

    const distToPlayer = Math.hypot(x - playerSpawnPoint.x, y - playerSpawnPoint.y);
    if (distToPlayer < minDistFromPlayer) continue;

    if (isInsideAnyObstacle(x, y, obstacles, margin)) continue;

    return { x, y };
  }

  // Pass 2: the map may be too small/cramped to satisfy the distance-from-
  // player requirement — drop that, but a bot must still never spawn
  // inside an obstacle.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {

    const x = margin + Math.random() * (worldWidth - margin * 2);
    const y = margin + Math.random() * (worldHeight - margin * 2);

    if (isInsideAnyObstacle(x, y, obstacles, margin)) continue;

    return { x, y };
  }

  // Pass 3: last resort for very obstacle-heavy levels — sweep the map
  // in a grid and return the first clear spot found, so a bot is never
  // dropped inside a wall/box even when random sampling keeps missing.
  const step = 40;
  for (let y = margin; y <= worldHeight - margin; y += step) {
    for (let x = margin; x <= worldWidth - margin; x += step) {
      if (!isInsideAnyObstacle(x, y, obstacles, margin)) {
        return { x, y };
      }
    }
  }

  // Truly no clear space anywhere on the map (extreme edge case) —
  // spawn on the player's own spawn point rather than inside an obstacle.
  return { x: playerSpawnPoint.x, y: playerSpawnPoint.y };
}


function isInsideAnyObstacle(x, y, obstacles, pad) {
  for (const obs of obstacles) {
    if (
      x >= obs.x - pad && x <= obs.x + obs.width + pad &&
      y >= obs.y - pad && y <= obs.y + obs.height + pad
    ) {
      return true;
    }
  }
  return false;
}



// ---------------------------------------------------------------------------
// LINE OF SIGHT — a simple segment-vs-rectangle test so bots can't "see"
// the player through a wall/box.
// ---------------------------------------------------------------------------
function hasLineOfSight(x1, y1, x2, y2, obstacles) {
  for (const obs of obstacles) {
    if (lineIntersectsRect(x1, y1, x2, y2, obs)) {
      return false;
    }
  }
  return true;
}

function lineIntersectsRect(x1, y1, x2, y2, rect) {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  return (
    segmentsIntersect(x1, y1, x2, y2, left, top, right, top) ||
    segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom) ||
    segmentsIntersect(x1, y1, x2, y2, right, bottom, left, bottom) ||
    segmentsIntersect(x1, y1, x2, y2, left, bottom, left, top)
  );
}

function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;

  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}



// ---------------------------------------------------------------------------
// SMALL MATH HELPERS
// ---------------------------------------------------------------------------
function angleDiff(a, b) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function degToRad(deg) {
  return deg * (Math.PI / 180);
}

function rotateToward(current, target, dt) {
  const turnSpeed = Math.PI * 1.5; // radians/sec
  const diff = angleDiff(current, target);
  const step = turnSpeed * dt;

  if (Math.abs(diff) <= step) return target;
  return current + Math.sign(diff) * step;
}

function moveBotToward(bot, targetX, targetY, dt) {
  const dx = targetX - bot.x;
  const dy = targetY - bot.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;

  bot.x += (dx / dist) * bot.movementSpeed * dt;
  bot.y += (dy / dist) * bot.movementSpeed * dt;
}

function pickNewPatrolTarget(bot, worldWidth, worldHeight) {
  const offsetX = (Math.random() * 2 - 1) * bot.patrolRadius;
  const offsetY = (Math.random() * 2 - 1) * bot.patrolRadius;

  const tx = Math.max(bot.radius, Math.min(worldWidth - bot.radius, bot.x + offsetX));
  const ty = Math.max(bot.radius, Math.min(worldHeight - bot.radius, bot.y + offsetY));

  bot.patrolTarget = { x: tx, y: ty };
}



// ---------------------------------------------------------------------------
// COLLISION — same "push out of the way" approach game.js already uses
// for the player.
// ---------------------------------------------------------------------------
function resolveBotObstacleCollision(bot, obstacles) {
  for (const obs of obstacles) {
    const closestX = Math.max(obs.x, Math.min(bot.x, obs.x + obs.width));
    const closestY = Math.max(obs.y, Math.min(bot.y, obs.y + obs.height));

    const dx = bot.x - closestX;
    const dy = bot.y - closestY;
    const dist = Math.hypot(dx, dy);

    if (dist < bot.radius) {
      const overlap = bot.radius - dist;
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;

      bot.x += nx * overlap;
      bot.y += ny * overlap;
    }
  }
}

// Pushes `bot` away from `other` (a {x,y,radius} point — the player or
// another bot). pushRatio is how much of the separation `bot` absorbs;
// if `otherMovable` is passed, the rest is applied to it too (used for
// bot-vs-bot so both sides move apart).
function resolveCircleCollision(bot, other, pushRatio, otherMovable) {
  const dx = bot.x - other.x;
  const dy = bot.y - other.y;
  const dist = Math.hypot(dx, dy);
  const minDist = bot.radius + (other.radius || 12);

  if (dist > 0 && dist < minDist) {
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    bot.x += nx * overlap * pushRatio;
    bot.y += ny * overlap * pushRatio;

    if (otherMovable) {
      otherMovable.x -= nx * overlap * (1 - pushRatio);
      otherMovable.y -= ny * overlap * (1 - pushRatio);
    }
  } else if (dist === 0) {
    bot.x += 0.5; // exactly overlapping — nudge apart
  }
}



// ---------------------------------------------------------------------------
// SHOOTING — bots have no reload mechanic, they fire on cooldown only
// (see canCharacterAttack() in character.js).
// ---------------------------------------------------------------------------
// dx/dy/dist = vector FROM bot TO player (already computed by the caller).
// Pushes new bullets/muzzle flashes into game.js's shared arrays so the
// existing rendering + movement + hit-effect code handles them for free.
function tryBotShoot(bot, dx, dy, dist, bullets) {

  // ATTACK SPEED — replaces the old per-weapon `cooldown` (weapon.js);
  // see canCharacterAttack() in character.js. A bot simply skips firing
  // this frame if it isn't ready yet — it'll try again next frame while
  // still in the "attack" state.
  const attackNow = performance.now();
  if (typeof canCharacterAttack === "function" && !canCharacterAttack(bot, attackNow)) return;

  const w = bot.weapon;

  // COMBINED + CRITICAL DAMAGE — rolled once per shot (not per pellet),
  // so a shotgun-wielding bot's whole spread shares the same crit result.
  // See getAttackDamage() in character.js.
  const attackResult = (typeof getAttackDamage === "function")
    ? getAttackDamage(bot, w.physicalDamage)
    : { damage: w.physicalDamage, isCritical: false };

  bot.lastAttackTime = attackNow;

  const len = dist || 1;
  let shootDir = { x: dx / len, y: dy / len };

  // Bot gunfire, a bit quieter than the player's own shots, and
  // distance-shaped: a bot shooting from far off sounds faint and
  // muffled instead of the same volume as one right next to you.
  // dx/dy here point FROM the bot TO the player, so flip them to get
  // the direction FROM the player TO the sound's source.
  if (w.fireSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(w.fireSound, -dx, -dy, { baseVolume: 0.4 });
    } else {
      const audio = new Audio(w.fireSound);
      audio.volume = 0.4;
      audio.play().catch(() => {});
    }
  }

  // MORTAR LANDING SPOT — same system as the player's own weapon (see
  // weapon.js's maxRange/radius and game.js's fireBullet()): the shot
  // travels toward the player and lands/explodes there, capped at this
  // weapon's maxRange so a bot can never lob one further than its
  // equipped weapon actually allows. dist is the real distance to the
  // player right now, so travelDist normally just equals that (the bot
  // only fires within its shootRange anyway — see createBot()'s
  // `shootRange: weaponTemplate.maxRange`); the cap is a safety clamp.
  const travelDist = Math.min(dist || 0, w.maxRange || 300);
  const explosionRadius = w.radius || 40;

  const fireOnePellet = (dir) => {
    bullets.push({
      x: bot.x,
      y: bot.y,
      radius: 4,
      damage: attackResult.physicalDamage,
      magicalDamage: attackResult.magicalDamage,
      // KNOCKBACK — applied with the same proximity falloff as damage
      // when this shot lands (see getAoeFalloff() in game.js): a hit
      // dead-center of the blast shoves the player the full distance,
      // tapering toward the radius's edge.
      knockback: w.knockback || 0,
      hitEffect: w.hitEffect,
      ownerId: "bot_" + bot.id,
      ownerType: "bot",
      botId: bot.id,
      isMortar: true,
      targetX: bot.x + dir.x * travelDist,
      targetY: bot.y + dir.y * travelDist,
      explosionRadius: explosionRadius
    });
  };

  if (w.pellets) {
    for (let i = 0; i < w.pellets; i++) {
      const spreadAngle = (Math.random() - 0.5) * w.spread;
      const cos = Math.cos(spreadAngle);
      const sin = Math.sin(spreadAngle);
      fireOnePellet({
        x: shootDir.x * cos - shootDir.y * sin,
        y: shootDir.x * sin + shootDir.y * cos
      });
    }
  } else {
    fireOnePellet(shootDir);
  }
}



// ---------------------------------------------------------------------------
// MELEE ATTACK — attackmode.js's "melee" mode (bot.attack, the same field
// character.js uses for the player). Called instead of tryBotShoot() from
// the "attack" state above once the bot is actually close enough to land
// it (see meleeReach there) — bot and player can now damage each other
// directly at close range, not just via ranged/mortar fire. Deals the same
// combined weapon+base damage tryBotShoot() does (getAttackDamage()),
// shares the same attackSpeed cooldown (canCharacterAttack()/
// bot.lastAttackTime), and hands the actual health loss off to game.js's
// damagePlayerFromBotMelee() — bot.js has no direct access to the player
// object's shield/armor/death handling, same reason tryBotShoot() pushes
// its bullets into game.js's own shared array instead of resolving the
// hit itself.
// ---------------------------------------------------------------------------
function tryBotMeleeAttack(bot, mode, ctx) {

  const attackNow = performance.now();
  if (typeof canCharacterAttack === "function" && !canCharacterAttack(bot, attackNow)) return;

  const w = bot.weapon;

  const attackResult = (typeof getAttackDamage === "function")
    ? getAttackDamage(bot, w ? w.physicalDamage : 0)
    : { damage: (w && w.physicalDamage) || 0, isCritical: false };

  bot.lastAttackTime = attackNow;

  // STRIKE POINT — in front of the bot, along its current facing, at
  // meleeRange (see effect.js's "basicattack" — mode.hitEffect).
  const reach = bot.radius + (mode.meleeRange || 10);
  const strikeX = bot.x + Math.cos(bot.facingAngle) * reach;
  const strikeY = bot.y + Math.sin(bot.facingAngle) * reach;

  if (mode.hitEffect && typeof createHitEffect === "function") {
    createHitEffect(strikeX, strikeY, mode.hitEffect, null, bot.facingAngle);
  }

  if (typeof damagePlayerFromBotMelee === "function") {
    // Pass the full attackResult (physicalDamage + magicalDamage), not
    // just the flat .damage mirror, so damagePlayerFromBotMelee() /
    // applyDamageToPlayer() (item.js) can mitigate each damage type
    // against the player's own physicalDefense/magicalDefense — see
    // getMitigatedDamage() in character.js.
    damagePlayerFromBotMelee(bot, attackResult);
  }
}



// ---------------------------------------------------------------------------
// DAMAGE — called by game.js
// ---------------------------------------------------------------------------
function damageBot(bot, amount, isCritical, showDamageNumber) {
  if (!bot.alive) return;

  bot.health -= amount;

  // DAMAGE NUMBER — floating "-123" popup above the bot (see number.js).
  // isCritical is optional — only melee paths that actually roll a crit
  // pass it through; bullet hits just show the plain size.
  //
  // showDamageNumber defaults to true for direct hits (bullets/melee),
  // but the fire-orb burn tick below passes false explicitly: that path
  // calls damageBot() every single frame with a tiny fractional amount,
  // and a fresh popup every frame would just spam the screen instead of
  // reading as one hit — the burn's own looping fire animation already
  // shows that it's ticking.
  if (showDamageNumber !== false && amount >= 1 && typeof createDamageNumber === "function") {
    createDamageNumber(bot.x, bot.y - bot.radius, amount, { isCritical: !!isCritical });
  }

  if (bot.health <= 0) {
    bot.health = 0;
    bot.alive = false;
    // Timestamp the kill so updateBots() knows when this bot's
    // respawnTime has elapsed — see RESPAWN in the file header comment
    // and respawnBot() below. Covers both a direct bullet kill and a
    // burn (fireorb) tick death, since both paths call damageBot().
    bot.deathTime = performance.now();

    // UNIT EXPLODE — plays this bot's death animation + sound once, right
    // at the spot it died, no matter what killed it (direct bullet or a
    // burn/fire-orb tick), since both paths call damageBot(). See UNIT
    // EXPLODE in effect.js for the sprite sheet.
    if (bot.unitExplode && typeof createHitEffect === "function") {
      createHitEffect(bot.x, bot.y, bot.unitExplode);
    }

  }
}

// ---------------------------------------------------------------------------
// ORB ELEMENTAL EFFECTS — called by game.js right after damageBot() when
// the bullet that hit this bot was fired from a weapon with an
// attachedOrb (see upgrade.js for effect/effectDuration/effectChance/
// damage/slow on each orb, and index.html's "Attach" button for how it
// gets attached to a weapon).
// ---------------------------------------------------------------------------
function applyOrbEffect(bot, orb) {
  if (!bot || !bot.alive || !orb || !orb.effect) return;

  // effectChance is a 0-1 roll odds (some orbs are authored >1, meaning
  // "always triggers").
  const chance = orb.effectChance != null ? orb.effectChance : 1;
  if (Math.random() >= chance) return;

  const duration = orb.effectDuration || 3000;
  const now = performance.now();

  // Play (or extend) the orb's animation, glued to the bot so it moves
  // with it. If this bot is already showing this same effect's
  // animation, refresh it in place instead of letting it finish and
  // spawning a fresh one later — that's what was causing the visible
  // gap between "burn ends" and "burn starts again".
  playOrRefreshOrbAnimation(bot, orb);

  if (orb.effect === "fire") {
    // Burn: damagePerMs applied continuously for `duration` ms.
    bot.statusFire = {
      endTime: now + duration,
      damagePerMs: orb.millisec || 0.05
    };
  } else if (orb.effect === "ice") {
    // Slow: flat add (negative) to movementSpeed for `duration` ms.
    bot.statusIce = {
      endTime: now + duration,
      slowAmount: orb.slow || 0
    };
  } else if (orb.effect === "electric") {
    // Stun: can't move or shoot for `duration` ms.
    bot.statusElectric = {
      endTime: now + duration
    };
  }
}

// Each bot tracks its own currently-playing fire/ice/electric animation
// instance (see effect.js's createHitEffect) so a re-proc while it's
// still on-screen just resets its clock and keeps it glued to the bot,
// rather than piling up a second overlapping animation or leaving a gap
// once the first one finishes.
function playOrRefreshOrbAnimation(bot, orb) {
  if (!orb.orbEffect || typeof createHitEffect !== "function") return;

  const key = orb.effect + "Anim"; // fireAnim / iceAnim / electricAnim
  const existing = bot[key];

  if (!(existing && typeof hitEffects !== "undefined" && hitEffects.indexOf(existing) !== -1)) {
    bot[key] = createHitEffect(bot.x, bot.y, orb.orbEffect, bot);
  }
}

// Ticks the bot's active fire/ice/electric status effects for this frame.
// Called at the top of updateSingleBot(), every frame, for every living
// bot — regardless of whether it's currently visible/active — so a burn
// or slow that started while the bot was mid-fight keeps counting down
// (and dealing damage) even if the player breaks line of sight.
function updateBotStatusEffects(bot, dt) {
  const now = performance.now();

  // FIRE — deals damagePerMs continuously while active.
  if (bot.statusFire) {
    if (now < bot.statusFire.endTime) {
      // showDamageNumber=false — see damageBot()'s comment on why a
      // per-frame burn tick doesn't spawn its own popup every frame.
      damageBot(bot, bot.statusFire.damagePerMs * dt * 1000, false, false);
    } else {
      bot.statusFire = null;
    }
  }

  // ICE — flat movementSpeed penalty while active, restored after.
  if (bot.statusIce) {
    if (now < bot.statusIce.endTime) {
      bot.movementSpeed = Math.max(0, bot.baseMovementSpeed + bot.statusIce.slowAmount);
    } else {
      bot.statusIce = null;
      bot.movementSpeed = bot.baseMovementSpeed;
    }
  }

  // ELECTRIC — stunned flag read by updateSingleBot() to block movement
  // and shooting while active.
  if (bot.statusElectric) {
    if (now < bot.statusElectric.endTime) {
      bot.stunned = true;
    } else {
      bot.statusElectric = null;
      bot.stunned = false;
    }
  } else {
    bot.stunned = false;
  }
}

// Called by game.js when a player's bullet hits this bot — even if the
// bot never saw the player coming, it now knows where the shot came
// from and turns to fight back from that direction.
function botGotHit(bot, shooterX, shooterY) {
  if (!bot.alive) return;

  // Getting shot turns a passive (active:false) bot hostile for the
  // rest of its life — see ACTIVE / AGGRO in the file header comment.
  // Has no effect on an already-active bot, but it's harmless to set.
  bot.aggroed = true;
  bot.aggroLostTimer = 0;

  bot.lastKnownPlayerPos = { x: shooterX, y: shooterY };
  bot.state = "chase";
  bot.stateTimer = 0;
  bot.facingAngle = Math.atan2(shooterY - bot.y, shooterX - bot.x);
}



// ---------------------------------------------------------------------------
// RESPAWN — a dead bot comes back to life at its original spawn point
// once its respawnTime has elapsed. See RESPAWN in the file header
// comment above.
// ---------------------------------------------------------------------------
function updateBotRespawn(bot) {
  if (performance.now() - bot.deathTime < bot.respawnTime) return;
  respawnBot(bot);
}

// Resets a dead bot back to a fresh, full-health, full-ammo state at the
// exact x/y it was originally placed at when the level started
// (bot.spawnX/spawnY), as if it had just spawned for the first time —
// same defaults createBot() would give it, minus generating a new id.
function respawnBot(bot) {
  const def = BOT_TYPES[bot.type];
  const weaponTemplate = getWeapon(bot.weaponName);

  bot.x = bot.spawnX;
  bot.y = bot.spawnY;

  bot.health = bot.maxHealth;

  const armorStats = (def && typeof getArmorStats === "function")
    ? getArmorStats(def.physicalDefense)
    : { armorValue: (def && typeof def.physicalDefense === "number" ? def.physicalDefense : 0), def: null };
  bot.physicalDefense = armorStats.armorValue;
  bot.equippedArmor = armorStats.def;

  bot.baseMovementSpeed = (def && def.movementSpeed) || bot.baseMovementSpeed;
  bot.movementSpeed = bot.baseMovementSpeed;

  bot.statusFire = null;
  bot.statusIce = null;
  bot.statusElectric = null;
  bot.stunned = false;
  bot.fireAnim = null;
  bot.iceAnim = null;
  bot.electricAnim = null;

  bot.weapon = weaponTemplate ? JSON.parse(JSON.stringify(weaponTemplate)) : bot.weapon;

  bot.dropsSpawned = false;
  bot.expAwarded = false;

  bot.mana = bot.maxMana;
  bot.lastAttackTime = 0;
  bot._hpRegenAcc = 0;
  bot._manaRegenAcc = 0;

  bot.facingAngle = Math.random() * Math.PI * 2;
  bot.state = "patrol";
  bot.stateTimer = 0;
  bot.patrolTarget = { x: bot.spawnX, y: bot.spawnY };

  bot.lookBaseAngle = 0;
  bot.lookTargetAngle = Math.random() * Math.PI * 2;
  bot.lookSide = 1;

  bot.lastKnownPlayerPos = null;

  bot.visionCheckTimer = 0;
  bot.lastVisionResult = false;

  // Passive bots forget having been shot on respawn — has to be
  // provoked again before it turns hostile. See ACTIVE / AGGRO above.
  bot.aggroed = false;
  bot.aggroLostTimer = 0;

  bot.deathTime = 0;
  bot.alive = true;
}



// ---------------------------------------------------------------------------
// MAIN UPDATE
// ---------------------------------------------------------------------------
// ctx = {
//   playerPos, isPlayerDead, obstacles,
//   worldWidth, worldHeight,
//   bullets
// }
function updateBots(bots, dt, ctx) {
  for (const bot of bots) {
    if (!bot.alive) {
      updateBotRespawn(bot);
      continue;
    }
    updateSingleBot(bot, dt, bots, ctx);
  }
}

function updateSingleBot(bot, dt, allBots, ctx) {

  const { playerPos, isPlayerDead, obstacles, worldWidth, worldHeight, bullets } = ctx;

  // Tick any active orb status effects (burn/slow/stun) first — burn
  // damage can kill the bot this frame, so bail out immediately if so.
  updateBotStatusEffects(bot, dt);
  if (!bot.alive) return;

  // ARMOR REGEN — see armor.js's tickArmorRegeneration(); was defined
  // but never called for bots (or for the player, see game.js), so an
  // equipped armor's hpRegen/mpRegen/millisec pair never did anything.
  if (typeof tickArmorRegeneration === "function") {
    tickArmorRegeneration(bot, dt * 1000);
  }

  // CHARACTER-STYLE REGEN — this bot's own hpRegen/manaRegen percentage
  // stats (see tickCharacterRegen() in character.js), separate from and
  // additive with the armor regen above.
  if (typeof tickCharacterRegen === "function") {
    tickCharacterRegen(bot, dt * 1000);
  }

  const dxPlayer = playerPos.x - bot.x;
  const dyPlayer = playerPos.y - bot.y;
  const distToPlayer = Math.hypot(dxPlayer, dyPlayer);

  let canSeePlayer = false;

  // VISION THROTTLE — hasLineOfSight() below does 4 segment-intersection
  // tests per obstacle. Running that every single frame for every bot
  // adds up fast once there are 15-20 bots on screen; a result that's
  // stale by up to ~120ms is imperceptible to the player, so it's only
  // re-checked on that cadence and the cached result is reused on the
  // frames in between. The cheap range/FOV checks below still run every
  // frame as before — only the obstacle raycast itself is throttled.
  const VISION_CHECK_INTERVAL = 120; // ms

  if (!isPlayerDead && distToPlayer <= bot.viewRange) {
    // Must also be within the bot's forward field of view — a bot facing
    // left doesn't spot someone standing behind it just because there's
    // a clear line to them.
    const angleToPlayer = Math.atan2(dyPlayer, dxPlayer);
    const halfFov = degToRad(bot.viewAngle / 2);
    const withinFov = Math.abs(angleDiff(bot.facingAngle, angleToPlayer)) <= halfFov;

    if (withinFov) {
      bot.visionCheckTimer += dt * 1000;
      if (bot.visionCheckTimer >= VISION_CHECK_INTERVAL) {
        bot.visionCheckTimer = 0;
        bot.lastVisionResult = hasLineOfSight(bot.x, bot.y, playerPos.x, playerPos.y, obstacles);
      }
      canSeePlayer = bot.lastVisionResult;
    } else {
      bot.lastVisionResult = false;
    }
  } else {
    bot.lastVisionResult = false;
  }

  // ---- AGGRO DECAY (active:false bots only) ----
  // A passive bot that got shot stays hostile only while it keeps
  // sighting the player; once it loses sight for aggroForgetTime, it
  // forgets and goes back to ignoring the player until hit again. An
  // active:true bot is always hostile regardless, so this never runs
  // for it. See ACTIVE / AGGRO in the file header comment above.
  if (bot.aggroed && !bot.active) {
    if (canSeePlayer) {
      bot.aggroLostTimer = 0;
    } else {
      bot.aggroLostTimer += dt * 1000;
      if (bot.aggroLostTimer >= bot.aggroForgetTime) {
        bot.aggroed = false;
        bot.aggroLostTimer = 0;
        bot.lastKnownPlayerPos = null;
      }
    }
  }

  // ---- Decide state for this frame ----
  // A passive bot (active:false and never yet hit) ignores the player
  // entirely here — it doesn't chase, doesn't search, just keeps
  // patrolling/looking as if it hadn't seen anyone. Only once it's
  // hostile (active:true, or aggroed by being shot — see botGotHit())
  // does spotting the player actually change its state. See ACTIVE /
  // AGGRO in the file header comment above.
  const isHostile = bot.active || bot.aggroed;

  // Reset each frame; only the moving states below (chase/search/patrol)
  // set it back to true. Drives the arrow.png direction indicator in
  // drawBots() — it only shows while the bot is actually walking
  // somewhere, not while it's standing still attacking or scanning.
  bot.isMoving = false;

  // ATTACK-MODE — resolved here (not just inside the "attack" case below)
  // so the state decision right below can also use meleeReach: a melee
  // bot's shootRange comes from its equipped weapon's old mortar-lob
  // maxRange (see createBot()'s `shootRange: weaponTemplate.maxRange`),
  // which is much farther than its actual melee reach. Without this, the
  // bot flipped to "attack" the moment the player entered that long
  // shootRange and just stood there taking ranged pot-shots instead of
  // closing the distance to actually melee — see tryBotMeleeAttack()
  // below.
  const attackMode = (typeof getAttackMode === "function") ? getAttackMode(bot.attack) : null;
  const meleeReach = attackMode ? bot.radius + (attackMode.meleeRange || 0) + (playerPos.radius || 12) : 0;
  const engageRange = attackMode ? meleeReach : bot.shootRange;

  if (isHostile && canSeePlayer) {
    bot.lastKnownPlayerPos = { x: playerPos.x, y: playerPos.y };
    bot.state = distToPlayer <= engageRange ? "attack" : "chase";
  } else if (isHostile && bot.lastKnownPlayerPos) {
    bot.state = "search";
  } else if (bot.state !== "look") {
    bot.state = "patrol";
  }

  // ---- Act on current state ----
  // Stunned (electricorb) bots skip movement AND shooting entirely for
  // the duration — they still track state above so they resume exactly
  // where they left off once the stun wears off.
  if (bot.stunned) {
    // no-op: can't move or fire while stunned
  } else {
  switch (bot.state) {

    case "attack": {
      bot.facingAngle = Math.atan2(dyPlayer, dxPlayer);
      // isHostile already gates whether this state is ever reached (see
      // "Decide state for this frame" above), but the check is kept
      // here too as a harmless safety net.
      if (bot.active || bot.aggroed) {
        // MELEE — attackmode.js's "melee" mode (bot.attack, same field
        // character.js uses). The state decision above now only enters
        // "attack" once the bot is within meleeReach, so this always
        // melees; the ranged tryBotShoot() call is kept only as a
        // harmless fallback for a bot with no resolvable attack mode.
        if (attackMode && distToPlayer <= meleeReach) {
          tryBotMeleeAttack(bot, attackMode, ctx);
        } else {
          tryBotShoot(bot, dxPlayer, dyPlayer, distToPlayer, bullets);
        }
      }
      break;
    }

    case "chase": {
      bot.facingAngle = Math.atan2(dyPlayer, dxPlayer);
      moveBotToward(bot, playerPos.x, playerPos.y, dt);
      bot.isMoving = true;
      break;
    }

    case "search": {
      const target = bot.lastKnownPlayerPos;
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        // Nothing here — give up and scan left/right before patrolling again
        bot.lastKnownPlayerPos = null;
        bot.state = "look";
        bot.stateTimer = 0;
        bot.lookBaseAngle = bot.facingAngle;
        bot.lookSide = 1;
        bot.lookTargetAngle = bot.lookBaseAngle - degToRad(50);
      } else {
        bot.facingAngle = Math.atan2(dy, dx);
        moveBotToward(bot, target.x, target.y, dt);
        bot.isMoving = true;
      }
      break;
    }

    case "look": {
      bot.stateTimer += dt * 1000;
      bot.facingAngle = rotateToward(bot.facingAngle, bot.lookTargetAngle, dt);

      if (Math.abs(angleDiff(bot.facingAngle, bot.lookTargetAngle)) < 0.05) {
        // Reached this side of the scan — swing to the other side
        bot.lookSide = -bot.lookSide;
        bot.lookTargetAngle = bot.lookBaseAngle + bot.lookSide * degToRad(50);
      }

      if (bot.stateTimer >= bot.lookDuration) {
        bot.state = "patrol";
        bot.stateTimer = 0;
        pickNewPatrolTarget(bot, worldWidth, worldHeight);
      }
      break;
    }

    case "patrol":
    default: {
      bot.stateTimer += dt * 1000;

      const dx = bot.patrolTarget.x - bot.x;
      const dy = bot.patrolTarget.y - bot.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 5 || bot.stateTimer >= bot.patrolInterval) {
        // Reached the point (or time's up) — stop and scan left/right
        bot.state = "look";
        bot.stateTimer = 0;
        bot.lookBaseAngle = bot.facingAngle;
        bot.lookSide = 1;
        bot.lookTargetAngle = bot.lookBaseAngle - degToRad(50);
      } else {
        bot.facingAngle = Math.atan2(dy, dx);
        moveBotToward(bot, bot.patrolTarget.x, bot.patrolTarget.y, dt);
        bot.isMoving = true;
      }
      break;
    }
  }
  }

  // ---- World bounds ----
  bot.x = Math.max(bot.radius, Math.min(worldWidth - bot.radius, bot.x));
  bot.y = Math.max(bot.radius, Math.min(worldHeight - bot.radius, bot.y));

  // ---- Collision: walls / boxes ----
  resolveBotObstacleCollision(bot, obstacles);

  // ---- Collision: player (can't walk through the player) ----
  if (!isPlayerDead) {
    resolveCircleCollision(bot, playerPos, 1);
  }

  // ---- Collision: other bots (can't walk through each other) ----
  for (const other of allBots) {
    if (other === bot || !other.alive) continue;
    resolveCircleCollision(bot, other, 0.5, other);
  }
}



// ---------------------------------------------------------------------------
// DRAWING
// ---------------------------------------------------------------------------
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

    // Level tag — short "Lv X", drawn just above the health bar (same
    // idea as the player's own LVL badge above their HUD health bar).
    ctx.font = "9px 'Courier New', Courier, monospace";
    ctx.textAlign = "center";
    const levelLabel = "Lv " + (bot.level || 1);
    const levelLabelY = screenY - bot.radius - 13;
    // Cheap "shadow" — draw the text once in dark, 1px offset, then the
    // real color on top. Same readable pop as shadowBlur, no blur cost.
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillText(levelLabel, screenX + 1, levelLabelY + 1);
    ctx.fillStyle = "#ffe066";
    ctx.fillText(levelLabel, screenX, levelLabelY);
    ctx.textAlign = "left";
  }
}



// ---------------------------------------------------------------------------
// MISC
// ---------------------------------------------------------------------------
function getAllBotTypes() {
  return Object.keys(BOT_TYPES);
}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    BOT_TYPES,
    createBot,
    spawnBotsForLevel,
    updateBots,
    drawBots,
    damageBot,
    applyOrbEffect,
    botGotHit,
    tryBotMeleeAttack,
    getAllBotTypes
  };

}
