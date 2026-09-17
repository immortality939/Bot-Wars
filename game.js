// game.js

// Ensure weapon.js and character.js are loaded
if (typeof WEAPONS === "undefined" || typeof getWeapon === "undefined") {
  throw new Error("weapon.js not loaded correctly");
}
if (typeof getCharacter === "undefined" || typeof attachWeaponToCharacter === "undefined") {
  throw new Error("character.js not loaded correctly");
}
if (typeof getAllWeapons === "undefined") {
  throw new Error("getAllWeapons() missing from weapon.js");
}
if (typeof getProjectile === "undefined") {
  throw new Error("projectile.js not loaded correctly");
}
if (typeof getSkill === "undefined") {
  throw new Error("skill.js not loaded correctly");
}
if (typeof getLevel === "undefined") {
  throw new Error("level.js not loaded correctly");
}
if (typeof spawnBotsForLevel === "undefined" || typeof updateBots === "undefined" || typeof drawBots === "undefined") {
  throw new Error("bot.js not loaded correctly");
}
if (typeof spawnItemsOnBotDeath === "undefined" || typeof checkItemPickup === "undefined") {
  throw new Error("item.js not loaded correctly");
}

// Bullet collision no longer depends on the bullet's rendered position —
// it's checked against the full path the bullet traveled this frame
// (prevX,prevY -> new x,y), not just where it ends up. This matters once
// bulletSpeed gets very high (e.g. 9999): at normal speed a bullet moves
// a few px/frame so "am I now overlapping the target" is a fine check,
// but at extreme speed a bullet can cross an entire target (or a wall)
// between one frame and the next and never land exactly on top of it,
// so it would sail through untouched. These helpers test the whole
// segment instead of a single point, so hits register regardless of how
// fast (or visually invisible-between-frames) the bullet is.

// Closest point on segment (x1,y1)-(x2,y2) to point (px,py).
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

// Does segment (x1,y1)-(x2,y2) pass through rect [rx,rx+rw] x [ry,ry+rh]?
// Returns the entry point if so (Liang-Barsky clipping), else null.
function segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rx, (rx + rw) - x1, y1 - ry, (ry + rh) - y1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  return { x: x1 + t0 * dx, y: y1 + t0 * dy };
}

function retireBullet(b, i) {
  bullets.splice(i, 1);
}

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Bullet/projectile images are loaded on demand and cached, same pattern
// as getMapImage/getObstacleImage below. Which image (and size) a given
// bullet uses comes from its "projectile" field (set from the firing
// weapon's projectile name — see weapon.js/projectile.js).
const projectileImageCache = {};

function getProjectileImage(path) {
  if (!projectileImageCache[path]) {
    const img = new Image();
    img.src = path;
    img.loaded = false;
    img.onload = () => {
      img.loaded = true;
    };
    projectileImageCache[path] = img;
  }
  return projectileImageCache[path];
}

// Mortar aim-UI images — a weapon's imagerange (max-range indicator) and
// imageradius (landing/explosion-radius indicator), read from weapon.js
// and drawn in the aim overlay below instead of a plain canvas-drawn
// ring/circle.
const aimUiImageCache = {};

function getAimUiImage(path) {
  if (!path) return null;
  if (!aimUiImageCache[path]) {
    const img = new Image();
    img.src = path;
    img.loaded = false;
    img.onload = () => {
      img.loaded = true;
    };
    aimUiImageCache[path] = img;
  }
  return aimUiImageCache[path];
}

// Map images are no longer hardcoded here. Whatever filename level.js
// specifies for a level's "mapImage" is loaded on demand and cached,
// so editing level.js is enough to change a level's map image.
const mapImageCache = {};

function getMapImage(path) {
  if (!mapImageCache[path]) {
    const img = new Image();
    img.src = path;
    img.loaded = false;
    img.onload = () => {
      img.loaded = true;
    };
    mapImageCache[path] = img;
  }
  return mapImageCache[path];
}

// Current map image (set per level). Default until the first level loads.
let currentMapImage = getMapImage("image/blevel1.png");

// Obstacle images are no longer hardcoded here either. Whatever filename
// level.js specifies for a level's "obstacleImage" is loaded on demand and
// cached, so editing level.js is enough to change a level's wall texture.
// Levels that don't set obstacleImage fall back to the classic woodbox.png.
const obstacleImageCache = {};

function getObstacleImage(path) {
  if (!obstacleImageCache[path]) {
    const img = new Image();
    img.src = path;
    img.loaded = false;
    img.onload = () => {
      img.loaded = true;
    };
    obstacleImageCache[path] = img;
  }
  return obstacleImageCache[path];
}

// Current obstacle image (set per level). Default until the first level loads.
let currentObstacleImage = getObstacleImage("image/woodbox.png");

// For levels that want plain flat-color walls instead of a texture (e.g. a
// simple collision border), level.js can set "obstacleColor" instead of
// "obstacleImage". When set, that solid color is used and no image is drawn.
let currentObstacleColor = null;

// Obstacles array
const obstacles = [];

// Camera & zoom
let WORLD_SIZE_X = 700;      // world width (changes per level)
let WORLD_SIZE_Y = 700;      // world height (changes per level)
let cameraZoom = 2;        // zoom level: 1.0 = normal, >1 = zoomed in

// Fixed analog centers (will be set in resizeCanvas)
let leftAnalogCenter = { x: 0, y: 0 };
let rightAnalogCenter = { x: 0, y: 0 };

const JOYSTICK_RADIUS = 60;
const JOYSTICK_DEADZONE = 0.15;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Fixed positions for analogs (screen space).
  // Using a plain percentage of the width works fine on wide landscape
  // screens, but on a narrow portrait screen a 10% inset can land closer
  // to the edge than the joystick's own radius, clipping it off-screen.
  // Clamp so there's always at least JOYSTICK_RADIUS + padding of room.
  const sideMarginPercent = 0.10;
  const minSideMargin = JOYSTICK_RADIUS + 30; // keeps the whole stick reachable

  const leftX = Math.max(canvas.width * sideMarginPercent, minSideMargin);
  const rightX = Math.min(canvas.width * (1 - sideMarginPercent), canvas.width - minSideMargin);

  leftAnalogCenter = {
    x: leftX,
    y: canvas.height * 0.7
  };
  rightAnalogCenter = {
    x: rightX,
    y: canvas.height * 0.7
  };

  // SKILL BUTTON ARC — skill1-4 arranged in a rising arc that wraps
  // around the top-left of the right analog stick, all the same size,
  // matching the reference layout. All positions/sizes are computed
  // from rightAnalogCenter so they always line up exactly regardless of
  // screen size (style.css's right%/bottom% is just a pre-JS fallback).
  // See index.html/style.css for the buttons themselves (#skillBtn/
  // #skillBtn2/#skillBtn3/#skillBtn4).
  // NOTE: queried fresh here (not via the outer `skillBtn` const etc.)
  // because resizeCanvas() runs once immediately below, before those
  // consts further down this file have been declared/initialized.
  const ARC_GAP = 14; // px between the joystick's edge and a button's edge

  // angleDeg follows the same convention as Math.cos/sin on screen
  // coordinates (0 = to the right of the stick, 90 = straight below,
  // -90 = straight above) — so these run from just above-right of the
  // stick (skill1) counter-clockwise down its left side (skill4).
  function placeAroundStick(id, angleDeg, size, extraGap, fontRatio) {
    const el = document.getElementById(id);
    if (!el) return;
    const angleRad = angleDeg * Math.PI / 180;
    const dist = JOYSTICK_RADIUS + ARC_GAP + (extraGap || 0) + size / 2;
    const x = rightAnalogCenter.x + dist * Math.cos(angleRad);
    const y = rightAnalogCenter.y + dist * Math.sin(angleRad);
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.fontSize = Math.round(size * (fontRatio || 0.2)) + "px";
    el.style.transform = "translate(-50%, -50%)";
  }

  placeAroundStick("skillBtn", -78, 56);
  placeAroundStick("skillBtn2", -128, 56);
  placeAroundStick("skillBtn3", -172, 56);
  placeAroundStick("skillBtn4", 140, 56);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// UI elements
const healthDisplay = document.getElementById("healthDisplay");
const armorDisplay = document.getElementById("armorDisplay");
const weaponDisplay = document.getElementById("weaponDisplay");
const ammoDisplay = document.getElementById("ammoDisplay");
const prevWeaponBtn = document.getElementById("prevWeaponBtn");
const nextWeaponBtn = document.getElementById("nextWeaponBtn");
const skillBtn = document.getElementById("skillBtn");
const skillBtnIcon = document.getElementById("skillBtnIcon");
const skillBtnLabel = document.getElementById("skillBtnLabel");
const skillCooldownText = document.getElementById("skillCooldownText");
const skillBtn2 = document.getElementById("skillBtn2");
const skillBtn2Icon = document.getElementById("skillBtn2Icon");
const skillBtn2Label = document.getElementById("skillBtn2Label");
const skillCooldownText2 = document.getElementById("skillCooldownText2");
const skillBtn3 = document.getElementById("skillBtn3");
const skillBtn3Icon = document.getElementById("skillBtn3Icon");
const skillBtn3Label = document.getElementById("skillBtn3Label");
const skillCooldownText3 = document.getElementById("skillCooldownText3");
const skillBtn4 = document.getElementById("skillBtn4");
const skillBtn4Icon = document.getElementById("skillBtn4Icon");
const skillBtn4Label = document.getElementById("skillBtn4Label");
const skillCooldownText4 = document.getElementById("skillCooldownText4");
const debugErrorOverlay = document.getElementById("debugErrorOverlay");

// Shows a caught frame error on-screen (see loop()'s try/catch below) so
// it can be screenshotted/reported instead of just silently freezing —
// most players have no way to open devtools on a phone. Tap to dismiss;
// only the FIRST error of a session is kept visible (a broken frame can
// throw the same error 60x/sec — overwriting it every frame would just
// flicker uselessly and bury the original cause).
let debugErrorShown = false;
function showDebugError(err) {
  if (!debugErrorOverlay || debugErrorShown) return;
  debugErrorShown = true;
  const msg = (err && err.stack) ? err.stack : String(err);
  debugErrorOverlay.textContent = "Frame error (tap to dismiss):\n" + msg;
  debugErrorOverlay.style.display = "block";
  debugErrorOverlay.onclick = () => {
    debugErrorOverlay.style.display = "none";
    debugErrorShown = false; // allow the next distinct error to show
  };
}
const deathOverlay = document.getElementById("deathOverlay");
const respawnTimerDisplay = document.getElementById("respawnTimer");

// Create player character
const player = attachWeaponToCharacter(getCharacter("soldier"));
attachSkillToCharacter(player); // player.skillData / player.skillLastUsedTime — see character.js
cameraZoom = player.cameraZoom || 2;

// Load player image
const playerImage = new Image();
playerImage.src = player.image || "image/soldier.png";
let imageLoaded = false;
playerImage.onload = () => {
  imageLoaded = true;
};

// Movement direction arrow (left analog stick) — shown next to the player
// only while input.moveVector is past JOYSTICK_DEADZONE, rotated to point
// the way the player is currently moving. See draw() below.
const playerArrowImage = new Image();
playerArrowImage.src = "image/arrowp.png";

// Joystick outer-ring art (both left move stick and right aim stick share
// this one image) — drawn in place of the plain white stroke ring in
// drawJoystick() below.
const joystickOuterlineImage = new Image();
joystickOuterlineImage.src = "image/circleline.png";

// Joystick inner background — fills the area inside the ring, in place of
// the old plain semi-transparent white fill.
const joystickHudImage = new Image();
joystickHudImage.src = "image/circlehud.png";

// The small circle that slides around inside the stick and points the
// current direction — replaces the old plain colored dot.
const joystickControlImage = new Image();
joystickControlImage.src = "image/controlcircle.png";

healthDisplay.textContent = player.currentHealth;
armorDisplay.textContent = Math.round(((player.physicalDefense || 0) + (player.armor || 0)) * 100) / 100;
weaponDisplay.textContent = player.weaponName;
updateAmmoDisplay();

// LEVEL HEALTH GROWTH — adds the pure level-scaling health increase (10%
// compounding per level, getHealthForLevel(), character.js — with NO vit
// baked in) onto player.baseMaxHealth/player.health/player.currentHealth,
// for however many levels were just gained. This is now a plain ADD of
// just that level-scaling slice, not a full recompute-and-overwrite —
// overwriting from getBaseMaxHealthForLevel() (which bakes in this
// character's static, level-1 vit) would silently erase any vit-derived
// health gained since match start from equipped gear, a manually-spent
// vit point, or the automatic per-level attribute growth addCharacterExp()
// (character.js) just applied for this very level-up, since none of
// those live in that static formula. Called from the level-up sites
// below every time addCharacterExp() reports a level gained, passing
// however many levels were gained in that one call (a single big kill
// can cascade through more than one).
function applyLevelHealthGrowth(levelsGained) {
  const levels = (typeof levelsGained === "number" && levelsGained > 0) ? levelsGained : 1;
  const charDef = (typeof CHARACTERS !== "undefined" && player.name) ? CHARACTERS[player.name] : null;
  const rawBaseHealth = (charDef && typeof charDef.health === "number") ? charDef.health : 0;
  const oldLevel = Math.max(1, (player.level || 1) - levels);

  const prevLevelHealth = (typeof getHealthForLevel === "function")
    ? getHealthForLevel(rawBaseHealth, oldLevel)
    : 0;
  const newLevelHealth = (typeof getHealthForLevel === "function")
    ? getHealthForLevel(rawBaseHealth, player.level || 1)
    : 0;
  const delta = newLevelHealth - prevLevelHealth;

  player.baseMaxHealth = (player.baseMaxHealth || 0) + delta;
  player.health = (player.health || 0) + delta;
  if (typeof player.currentHealth === "number") {
    player.currentHealth = delta > 0
      ? Math.min(player.health, player.currentHealth + delta)
      : Math.min(player.currentHealth, player.health);
  }
  if (typeof healthDisplay !== "undefined" && healthDisplay) {
    healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  }
}

// Weapon switching
const weaponList = getAllWeapons().map(w => w.name); // e.g. ["uzi","pistol","shotgun"]
let currentWeaponIndex = weaponList.indexOf(player.weaponName);
if (currentWeaponIndex < 0) currentWeaponIndex = 0;

function updateWeaponDisplay() {
  if (!player.weapon) {
    weaponDisplay.textContent = "No weapon";
    return;
  }
  const lvl = player.weapon.upgradeLevel || 0;
  weaponDisplay.textContent = player.weaponName + (lvl > 0 ? " +" + lvl : "");
}

function updateAmmoDisplay() {
  const w = player.weapon;
  if (!w) {
    ammoDisplay.textContent = "-- / --";
    return;
  }
  ammoDisplay.textContent = player.isReloading ? "(R)" : "";
}

function switchWeapon(delta) {
  currentWeaponIndex += delta;
  if (currentWeaponIndex < 0) currentWeaponIndex = weaponList.length - 1;
  if (currentWeaponIndex >= weaponList.length) currentWeaponIndex = 0;

  const newWeaponName = weaponList[currentWeaponIndex];
  player.weaponName = newWeaponName;
  attachWeaponToCharacter(player);
  updateWeaponDisplay();
  updateAmmoDisplay();
}

if (prevWeaponBtn) prevWeaponBtn.addEventListener("click", () => switchWeapon(-1));
if (nextWeaponBtn) nextWeaponBtn.addEventListener("click", () => switchWeapon(1));

// Game state
const bullets = [];

let laserBlinkTime = 0;
const enemies = [];
const bots = []; // enemy bots for OFFLINE mode (see bot.js)
const itemDrops = []; // dropped pickup items for OFFLINE mode (see item.js)
let isOnline = false;
let onlineWeapons = null;
let onlineCharacters = {};

// ONLINE ROOMS + BOSS FIGHT (see server.js "v2: rooms + boss fights")
let roomCode = null;       // 4-letter room code, or null if not in a room
let isRoomHost = false;    // true if this client is the current room host
let roomSlots = [];        // last roomUpdate's slots array, for the lobby UI
let boss = null;           // { health, maxHealth, x, y, alive } while a boss fight is live
const BOSS_RADIUS = 60;
let lastTime = performance.now();
let enemySpawnTimer = 0;
const enemySpawnInterval = 999999999; // ms (basically never spawn)

let isDead = false; // track if local player is dead
let gameStarted = false;
let gameMode = null; // "offline" or "online"
let respawnCountdownInterval = null;
let isPaused = false;

// Input state for dual analog sticks
const input = {
  moveVector: { x: 0, y: 0 },
  shootVector: { x: 0, y: 0 },
  isShooting: false,

  moveTouchId: null,
  shootTouchId: null,

  // SKILL ARMING — one flag per skill slot (1-4), set by tapping that
  // slot's button — but only when the skill currently equipped there is
  // an "aimed" skill (skill.js's activationType). While a slot is armed,
  // aiming with the right analog previews that skill's maxRange/radius
  // instead of the weapon's, and releasing the stick fires that skill
  // instead of fireBullet(). Only one slot can ever be armed at once —
  // arming any of the 4 disarms the other 3 (see the onSkillBtnNTouch
  // handlers below). Cleared on every stick release, win or not.
  // "instant" skills (e.g. heal) never set their slot's flag at all —
  // tapping their button fires immediately instead of arming.
  skillArmed: false,
  skill2Armed: false,
  skill3Armed: false,
  skill4Armed: false
};

// ONLINE MULTIPLAYER (WebSocket)
// Replace with your Render URL (use wss://)
const SERVER_URL = "wss://bot-wars-1.onrender.com";

let ws = null;
let myId = null;
const otherPlayers = new Map(); // id -> { x, y, color }

function connectToServer() {
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    console.log("Connected to server");
    isOnline = true;
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "init") {
      myId = msg.id;
    } else if (msg.type === "playerAdd") {
      otherPlayers.set(msg.player.id, {
        x: msg.player.x,
        y: msg.player.y,
        color: msg.player.color,
        health: msg.player.health || 100
      });
    } else if (msg.type === "playerMove") {
  if (msg.id === myId) {
    // Local player moved/respawned
    if (msg.alive && isDead) {
      // Just respawned
      isDead = false;
      deathOverlay.style.display = "none";
      if (respawnCountdownInterval) {
        clearInterval(respawnCountdownInterval);
        respawnCountdownInterval = null;
      }
      player.currentHealth = msg.health ?? player.health;
      healthDisplay.textContent = player.currentHealth;
      playerPos.x = msg.x;
      playerPos.y = msg.y;
    } else if (!isDead) {
      // Normal movement update
      playerPos.x = msg.x;
      playerPos.y = msg.y;
      if (msg.health !== undefined) {
        player.currentHealth = msg.health;
        healthDisplay.textContent = player.currentHealth;
      }
    }
    return;
  }

  const p = otherPlayers.get(msg.id);
  if (p) {
    p.x = msg.x;
    p.y = msg.y;
    if (msg.health !== undefined) {
      p.health = msg.health;
    }
    if (msg.alive !== undefined) {
      p.alive = msg.alive;
    }
  } else if (msg.alive) {
    // Player was deleted on death, now respawned: re-add
    otherPlayers.set(msg.id, {
      x: msg.x,
      y: msg.y,
      color: "#fff", // color not used if you draw image
      health: msg.health ?? 100,
      alive: true
    });
  }
}
     else if (msg.type === "playerRemove") {
      otherPlayers.delete(msg.id);
    } else if (msg.type === "shootSound") {
      if (msg.ownerId !== myId) {
        // Distance-based playback: a shot fired far from the local
        // player comes through quieter and more muffled, like real
        // gunfire heard from a distance.
        const dx = (msg.x !== undefined) ? msg.x - playerPos.x : 0;
        const dy = (msg.y !== undefined) ? msg.y - playerPos.y : 0;
        playPositionalSound(msg.sound, dx, dy, { baseVolume: 1.0 });
      }
    } else if (msg.type === "bullet") {

  if (msg.ownerId !== myId) {
    bullets.push({
      x: msg.x,
      y: msg.y,
      vx: msg.vx,
      vy: msg.vy,
      radius: 4,
      damage: msg.damage,
      hitEffect: msg.hitEffect,
      projectile: msg.projectile,
      ownerId: msg.ownerId,
      isMortar: msg.isMortar || false,
      targetX: msg.targetX,
      targetY: msg.targetY,
      explosionRadius: msg.explosionRadius
    });
  }
} else if (msg.type === "playerHealth") {
      const p = otherPlayers.get(msg.id);
      if (p) {
        p.health = msg.health;
      }
      if (msg.id === myId) {
        player.currentHealth = msg.health;
        healthDisplay.textContent = player.currentHealth;
      }
    } else if (msg.type === "playerDied") {
  // Clear bullets for visual clarity (optional)
  bullets.length = 0;

  if (msg.id === myId) {
    // Local player died
    player.currentHealth = 0;
    healthDisplay.textContent = 0;
    isDead = true;

    // Use server's deadUntil, or default to exactly 10 seconds from now
    const deadUntil = msg.deadUntil || (Date.now() + 10000);

    // Compute initial seconds left more accurately
    const msLeft = Math.max(0, deadUntil - Date.now());
    let secondsLeft = Math.floor(msLeft / 1000);
    if (secondsLeft > 10) secondsLeft = 10; // safety cap

    respawnTimerDisplay.textContent = secondsLeft;
    deathOverlay.style.display = "flex";

    if (respawnCountdownInterval) {
      clearInterval(respawnCountdownInterval);
    }

    respawnCountdownInterval = setInterval(() => {
      const nowMsLeft = Math.max(0, deadUntil - Date.now());
      const newSecondsLeft = Math.floor(nowMsLeft / 1000);

      if (newSecondsLeft <= 0) {
        clearInterval(respawnCountdownInterval);
        respawnCountdownInterval = null;
        respawnTimerDisplay.textContent = 0;
        return;
      }

      secondsLeft = newSecondsLeft;
      respawnTimerDisplay.textContent = secondsLeft;
    }, 200); // update more smoothly, but still show whole seconds
  } else {
    // Other player died: remove from otherPlayers so they disappear
    otherPlayers.delete(msg.id);
  }
}
else if (msg.type === "weaponConfig") {
      // Only use online weapon config if we're in online mode
      if (isOnline) {
        onlineWeapons = msg.weapons;

        if (onlineWeapons && onlineWeapons[player.weaponName]) {
          player.weapon = onlineWeapons[player.weaponName];
          updateWeaponDisplay();
          updateAmmoDisplay();
        }
      }
    }
          else if (msg.type === "characterConfig") {
      // Only use online character config if we're in online mode
      if (isOnline) {
        onlineCharacters = msg.characters;

        const charKey = player.name;

        if (onlineCharacters && onlineCharacters[charKey]) {
          const serverChar = onlineCharacters[charKey];

          player.health = serverChar.health;
          player.currentHealth = serverChar.currentHealth;
          player.movementSpeed = serverChar.movementSpeed;
          player.armor = serverChar.armor;
          player.image = serverChar.image;
          player.cameraZoom = serverChar.cameraZoom;

          // Update UI immediately
          healthDisplay.textContent = player.currentHealth;
          armorDisplay.textContent = player.armor;
        }
      }
    }

    // ---- ROOM LIFECYCLE (see server.js) --------------------------------
    else if (msg.type === "roomCreated") {
      roomCode = msg.roomCode;
      isRoomHost = true;
      if (window.onRoomCreated) window.onRoomCreated(msg.roomCode);
    }
    else if (msg.type === "roomJoined") {
      roomCode = msg.roomCode;
      if (window.onRoomJoined) window.onRoomJoined(msg.roomCode);
    }
    else if (msg.type === "roomError") {
      if (window.onRoomError) window.onRoomError(msg.message);
    }
    else if (msg.type === "roomUpdate") {
      roomCode = msg.roomCode;
      isRoomHost = (msg.hostId === myId);
      roomSlots = msg.slots || [];
      if (window.onRoomUpdate) window.onRoomUpdate(msg);
    }

    // ---- BOSS FIGHT -----------------------------------------------------
    else if (msg.type === "bossStart") {
      otherPlayers.clear();
      boss = {
        health: msg.boss.health,
        maxHealth: msg.boss.maxHealth,
        x: msg.boss.x,
        y: msg.boss.y,
        alive: true
      };
      if (window.onBossStart) window.onBossStart(msg.boss);
    }
    else if (msg.type === "bossUpdate") {
      if (boss) boss.health = msg.health;
      if (window.onBossHealthUpdate) window.onBossHealthUpdate(msg.health, boss ? boss.maxHealth : msg.health);
    }
    else if (msg.type === "bossDefeated") {
      if (boss) boss.alive = false;
      if (window.onBossDefeated) window.onBossDefeated(msg.killedBy === myId);
    }
  };

  ws.onclose = () => {
    console.log("Disconnected from server");
  };

  ws.onerror = (err) => {
    console.error("WebSocket error", err);
  };
}

// Sends a message once the socket is open, connecting first if needed
// (the room/lobby buttons in index.html can be clicked before the initial
// connectToServer() below has finished opening its socket).
function sendWhenReady(msgObj) {
  const payload = JSON.stringify(msgObj);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(payload);
  } else if (ws && ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener("open", () => ws.send(payload), { once: true });
  } else {
    connectToServer();
    ws.addEventListener("open", () => ws.send(payload), { once: true });
  }
}

// ---- ROOM / LOBBY API, called from index.html's Online screens ----------
window.createOnlineRoom = function(character) {
  sendWhenReady({ type: "createRoom", character: character || "soldier" });
};

window.joinOnlineRoom = function(code, character) {
  sendWhenReady({ type: "joinRoom", roomCode: (code || "").toUpperCase(), character: character || "soldier" });
};

window.leaveOnlineRoom = function() {
  sendWhenReady({ type: "leaveRoom" });
  roomCode = null;
  isRoomHost = false;
  roomSlots = [];
};

// Host-only: begins the boss fight for everyone currently in the room.
window.startOnlineBossFight = function() {
  sendWhenReady({ type: "startBoss" });
};

window.getGameMode = function() {
  return gameMode;
};

window.isOnlineRoomHost = function() {
  return isRoomHost;
};

// Try to connect
connectToServer();

// ---------------------------------------------------------------------------
// ENEMY BOT STATS POPUP — tap a bot during gameplay to see its class,
// health, armor, weapon, damage and movement speed. Closes on tapping
// outside the small card or on its X button.
// ---------------------------------------------------------------------------
const botStatsOverlay = document.getElementById("botStatsOverlay");
const botStatsCloseBtn = document.getElementById("botStatsCloseBtn");
const botStatsNameEl = document.getElementById("botStatsName");
const botStatsLevelEl = document.getElementById("botStatsLevel");
const botStatsHealthFillEl = document.getElementById("botStatsHealthFill");
const botStatsHealthTextEl = document.getElementById("botStatsHealthText");
const botStatsManaRowEl = document.getElementById("botStatsManaRow");
const botStatsManaFillEl = document.getElementById("botStatsManaFill");
const botStatsManaTextEl = document.getElementById("botStatsManaText");
const botStatsArmorEl = document.getElementById("botStatsArmor");
const botStatsWeaponEl = document.getElementById("botStatsWeapon");
const botStatsDamageEl = document.getElementById("botStatsDamage");
const botStatsCritChanceEl = document.getElementById("botStatsCritChance");
const botStatsCritDamageEl = document.getElementById("botStatsCritDamage");
const botStatsAttackSpeedEl = document.getElementById("botStatsAttackSpeed");
const botStatsSpeedEl = document.getElementById("botStatsSpeed");
const botStatsHpRegenEl = document.getElementById("botStatsHpRegen");
const botStatsManaRegenEl = document.getElementById("botStatsManaRegen");
const botStatsExpGetEl = document.getElementById("botStatsExpGet");

let botStatsTargetBot = null;

function showBotStatsPopup(bot) {
  botStatsTargetBot = bot;
  refreshBotStatsPopup();
  if (botStatsOverlay) botStatsOverlay.style.display = "flex";
}

function hideBotStatsPopup() {
  botStatsTargetBot = null;
  if (botStatsOverlay) botStatsOverlay.style.display = "none";
}

// Same "X.XX%" rounding index.html's own stat popups use for
// criticalChance/criticalDamage/hpRegen/manaRegen (see charStatsCritChanceVal
// etc. in index.html) — keeps this popup's numbers reading the same way.
function formatBotStatsPercent(v) {
  return (Math.round((v || 0) * 10000) / 100) + "%";
}

// Called every frame while the popup is open so the health bar keeps
// moving live as the fight continues behind it.
function refreshBotStatsPopup() {
  const bot = botStatsTargetBot;
  if (!bot || !botStatsOverlay || botStatsOverlay.style.display === "none") return;

  // Bot died while the popup was open — nothing left to show.
  if (!bot.alive) {
    hideBotStatsPopup();
    return;
  }

  botStatsNameEl.textContent = bot.type;
  if (botStatsLevelEl) botStatsLevelEl.textContent = bot.level || 1;

  const maxHealth = bot.maxHealth || 1;
  const pct = Math.max(0, Math.min(1, bot.health / maxHealth));
  botStatsHealthFillEl.style.width = (pct * 100) + "%";
  botStatsHealthTextEl.textContent = `${Math.max(0, Math.round(bot.health))} / ${maxHealth}`;
  botStatsHealthFillEl.classList.toggle("warn", pct <= 0.5 && pct > 0.25);
  botStatsHealthFillEl.classList.toggle("critical", pct <= 0.25);

  // MANA — only bots with an actual mana pool (maxMana > 0) show this
  // row; a bot with no mana (most melee/rusher types) hides it entirely
  // rather than showing a meaningless "0 / 0".
  if (botStatsManaRowEl) {
    const maxMana = bot.maxMana || 0;
    if (maxMana > 0) {
      botStatsManaRowEl.style.display = "";
      const manaPct = Math.max(0, Math.min(1, (bot.mana || 0) / maxMana));
      if (botStatsManaFillEl) botStatsManaFillEl.style.width = (manaPct * 100) + "%";
      if (botStatsManaTextEl) {
        botStatsManaTextEl.textContent = `${Math.max(0, Math.round(bot.mana || 0))} / ${maxMana}`;
      }
    } else {
      botStatsManaRowEl.style.display = "none";
    }
  }

  botStatsArmorEl.textContent = bot.physicalDefense || 0;
  botStatsWeaponEl.textContent = bot.weaponName || "—";
  botStatsDamageEl.textContent = bot.weapon ? bot.weapon.physicalDamage : "—";
  if (botStatsCritChanceEl) botStatsCritChanceEl.textContent = formatBotStatsPercent(bot.criticalChance);
  if (botStatsCritDamageEl) botStatsCritDamageEl.textContent = formatBotStatsPercent(bot.criticalDamage);
  if (botStatsAttackSpeedEl) botStatsAttackSpeedEl.textContent = bot.attackSpeed || 0;
  botStatsSpeedEl.textContent = bot.movementSpeed || 0;
  if (botStatsHpRegenEl) botStatsHpRegenEl.textContent = formatBotStatsPercent(bot.hpRegen);
  if (botStatsManaRegenEl) botStatsManaRegenEl.textContent = formatBotStatsPercent(bot.manaRegen);
  if (botStatsExpGetEl) botStatsExpGetEl.textContent = bot.expGet || 0;
}

if (botStatsCloseBtn) {
  botStatsCloseBtn.addEventListener("click", hideBotStatsPopup);
}
if (botStatsOverlay) {
  // Tapping/clicking anywhere outside the small popup card closes it —
  // the backdrop itself is transparent so gameplay stays visible.
  botStatsOverlay.addEventListener("click", (e) => {
    if (e.target === botStatsOverlay) hideBotStatsPopup();
  });
  botStatsOverlay.addEventListener("touchstart", (e) => {
    if (e.target === botStatsOverlay) {
      e.preventDefault();
      hideBotStatsPopup();
    }
  }, { passive: false });
}

// Hit-tests a touch/click point (in page/client coordinates) against every
// living bot's on-screen position, using the same camera transform draw()
// uses (player centered on screen, scaled by cameraZoom). Returns the
// closest bot within a generous tap radius, or null.
function findBotAtClientPoint(clientX, clientY) {
  if (typeof bots === "undefined" || !bots.length) return null;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  let closestBot = null;
  let closestDist = Infinity;

  for (const bot of bots) {
    if (!bot.alive) continue;

    const screenX = centerX + (bot.x - playerPos.x) * cameraZoom;
    const screenY = centerY + (bot.y - playerPos.y) * cameraZoom;
    const clientBotX = rect.left + screenX / scaleX;
    const clientBotY = rect.top + screenY / scaleY;

    const dist = Math.hypot(clientX - clientBotX, clientY - clientBotY);

    // Generous tap radius (in CSS px) so small/fast enemies are still
    // easy to hit with a fingertip.
    const tapRadius = Math.max(28, (bot.radius * cameraZoom) / scaleX + 14);

    if (dist <= tapRadius && dist < closestDist) {
      closestBot = bot;
      closestDist = dist;
    }
  }

  return closestBot;
}

// Reverses findBotAtClientPoint()'s screen math: converts a touch/click
// point (page/client coordinates) into world coordinates, using the same
// camera transform draw() uses (player centered on screen, scaled by
// cameraZoom). Used by the ground-tap release for "ground"-type skills
// (see handleTouchStart() below and skill.js's barrage).
function clientPointToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top) * scaleY;

  return {
    x: playerPos.x + (canvasX - centerX) / cameraZoom,
    y: playerPos.y + (canvasY - centerY) / cameraZoom
  };
}

// Returns the currently-armed skill slot whose equipped skill is a
// "ground"-type activation (barrage-style — see skill.js), or null if no
// such slot is armed. Used by handleTouchStart()'s ground-release branch
// below so a plain tap on the map fires whichever ground skill is armed,
// instead of the right analog stick.
function getArmedGroundSkill() {
  if (input.skillArmed && player.skillData && player.skillData.activationType === "ground") {
    return { fire: (tx, ty) => fireSkill(tx, ty) };
  }
  if (input.skill2Armed && player.skillData2 && player.skillData2.activationType === "ground") {
    return { fire: (tx, ty) => fireSkill2(tx, ty) };
  }
  if (input.skill3Armed && player.skillData3 && player.skillData3.activationType === "ground") {
    return { fire: (tx, ty) => fireSkill3(tx, ty) };
  }
  if (input.skill4Armed && player.skillData4 && player.skillData4.activationType === "ground") {
    return { fire: (tx, ty) => fireSkill4(tx, ty) };
  }
  return null;
}

// Split screen a bit more toward the sides for left/right sticks
const LEFT_ZONE_MAX_RATIO = 0.55;
const RIGHT_ZONE_MIN_RATIO = 0.45;

canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

function handleTouchStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const x = t.clientX;
    const y = t.clientY;

    // The two joystick zones are physical HUD controls — a touch that
    // starts inside either one must always grab that stick, even if an
    // enemy bot's sprite happens to be rendered underneath it on screen.
    // Only outside both sticks does the touch get tested against bots.
    const inLeftStick = Math.hypot(x - leftAnalogCenter.x, y - leftAnalogCenter.y) <= JOYSTICK_RADIUS;
    const inRightStick = Math.hypot(x - rightAnalogCenter.x, y - rightAnalogCenter.y) <= JOYSTICK_RADIUS;

    // GROUND-TARGET SKILL RELEASE — if a "ground"-type skill (barrage,
    // see skill.js) is currently armed, this tap IS the release: fire it
    // at the tapped world point instead of moving/shooting/opening a bot
    // popup. Takes priority over the bot-stats tap below so tapping
    // directly on a bot while armed still releases the skill there.
    if (gameStarted && !isPaused && !isDead && !inLeftStick && !inRightStick) {
      const armedGroundSkill = getArmedGroundSkill();
      if (armedGroundSkill) {
        const world = clientPointToWorld(x, y);
        armedGroundSkill.fire(world.x, world.y);
        continue;
      }
    }

    // Tapping an enemy bot opens its stats popup instead of moving/
    // shooting — only while a match is actually running and unpaused,
    // and only when the touch isn't meant for a joystick.
    if (gameStarted && !isPaused && !inLeftStick && !inRightStick) {
      const tappedBot = findBotAtClientPoint(x, y);
      if (tappedBot) {
        showBotStatsPopup(tappedBot);
        continue;
      }
    }

    if (x < canvas.width * LEFT_ZONE_MAX_RATIO && input.moveTouchId === null) {
      input.moveTouchId = t.identifier;
      input.moveVector = { x: 0, y: 0 };
    } else if (x > canvas.width * RIGHT_ZONE_MIN_RATIO && input.shootTouchId === null) {
      input.shootTouchId = t.identifier;
      input.shootVector = { x: 0, y: 0 };
      input.isShooting = false;
    }
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === input.moveTouchId) {
      input.moveVector = computeJoystickVector(
        t.clientX, t.clientY,
        leftAnalogCenter.x, leftAnalogCenter.y
      );
    } else if (t.identifier === input.shootTouchId) {
      const v = computeJoystickVector(
        t.clientX, t.clientY,
        rightAnalogCenter.x, rightAnalogCenter.y
      );
      input.shootVector = v;
      const mag = Math.hypot(v.x, v.y);
      input.isShooting = mag > JOYSTICK_DEADZONE;
    }
  }
}

function handleTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === input.moveTouchId) {
      input.moveTouchId = null;
      input.moveVector = { x: 0, y: 0 };
    } else if (t.identifier === input.shootTouchId) {
      // Attacking no longer waits for release — see the auto-attack
      // check in update() (fires as soon as input.isShooting is true,
      // i.e. the moment the stick crosses the deadzone pointed in a
      // direction). Lifting the stick just stops aiming/attacking.
      input.shootTouchId = null;
      input.shootVector = { x: 0, y: 0 };
      input.isShooting = false;
    }
  }
}

// Once the stick is dragged past this fraction of JOYSTICK_RADIUS, movement
// snaps to full (1.0) magnitude — i.e. full character movementSpeed. Without
// this, a bot always moves at 100% of its movementSpeed (moveBotToward()
// normalizes its direction vector to length 1), while the player only hit
// 100% by dragging the stick to the exact physical edge — any less-than-
// perfect drag made the player feel slower than a bot with a lower stat.
const JOYSTICK_FULL_SPEED_RATIO = 0.8;

function computeJoystickVector(touchX, touchY, centerX, centerY) {
  const dx = touchX - centerX;
  const dy = touchY - centerY;
  const dist = Math.hypot(dx, dy);
  const maxDist = JOYSTICK_RADIUS;

  if (dist === 0) return { x: 0, y: 0 };

  const clampedDist = Math.min(dist, maxDist);
  const angle = Math.atan2(dy, dx);

  // Scale 0..(FULL_SPEED_RATIO * maxDist) to 0..1, then clamp — so reaching
  // ~80% of the stick's radius already gives full speed instead of needing
  // the exact edge.
  const rawRatio = clampedDist / maxDist;
  const mag = Math.min(1, rawRatio / JOYSTICK_FULL_SPEED_RATIO);

  if (mag < JOYSTICK_DEADZONE) return { x: 0, y: 0 };

  const nx = Math.cos(angle) * mag;
  const ny = Math.sin(angle) * mag;

  return { x: nx, y: ny };
}

// Player position (inside world, size set per level)
const playerPos = {
  x: 700 / 2, // temporary; real values set in startGameOffline
  y: 700 / 2,
  radius: player.radius || 12 // resized per-character in startGameOffline
};

// Current level's respawn points (real values set in startGameOffline).
// Whenever the player spawns or respawns, one of these is picked at random.
let currentSpawnPoints = [{ x: 700 / 2, y: 700 / 2 }];

function getRandomSpawnPoint() {
  if (!currentSpawnPoints || currentSpawnPoints.length === 0) {
    return { x: WORLD_SIZE_X / 2, y: WORLD_SIZE_Y / 2 };
  }
  const index = Math.floor(Math.random() * currentSpawnPoints.length);
  return currentSpawnPoints[index];
}

// Respawns the local player in OFFLINE mode (full health, random spawn
// point, clears bullets so nothing carries over the death).
function respawnPlayerOffline() {
  resetPlayerItemState(player);

  // NO-GEAR BASELINE -- deliberately NOT getCharacter(player.name).
  // getCharacter() bakes this character's own DEFAULT starting armor
  // (e.g. police's char.armor: "armor1", see the ARMOR block in
  // getCharacter()) straight into several stats. getBaseMaxHealthForLevel()/
  // getBasePhysicalDefense()/getBasePhysicalDamage() are the same
  // no-armor-baked-in helpers startGameOffline() already uses for
  // exactly this reason; rawCharacter (CHARACTERS[player.name] directly)
  // is the equivalent no-gear source for every other stat, which has no
  // dedicated getBase*() helper.
  //
  // EVERY ONE of these fields needs to land back at this true baseline
  // here, not just health/physicalDefense/magicalDefense: a weapon or
  // armor's contribution to ANY of them (physicalDamage, magicalAttack,
  // criticalChance, criticalDamage, hpRegen, manaRegen, mana, vit, dex,
  // int, pow -- see attachWeaponToCharacter()'s trackedFields in
  // character.js) is tracked via player._weaponGearDelta/_armorGearDelta
  // so it can be cleanly undone/redone on re-equip. That only works if
  // the field is at its true gear-free value before the delta is
  // cleared below -- previously only health/movementSpeed/
  // physicalDefense/magicalDefense were reset here, so every other
  // tracked field was left at whatever (already gear-inflated) value it
  // held at the moment of death, and reapplying the still-equipped
  // weapon/armor just below added its bonus AGAIN on top of that -- a
  // little higher every single death, forever, on exactly these fields.
  const rawCharacter = (typeof CHARACTERS !== "undefined" && CHARACTERS[player.name]) || {};
  const baseVit = typeof rawCharacter.vit === "number" ? rawCharacter.vit : 0;
  const baseDex = typeof rawCharacter.dex === "number" ? rawCharacter.dex : 0;
  const baseInt = typeof rawCharacter.int === "number" ? rawCharacter.int : 0;
  const basePow = typeof rawCharacter.pow === "number" ? rawCharacter.pow : 0;

  player.baseMaxHealth = (typeof getBaseMaxHealthForLevel === "function")
    ? getBaseMaxHealthForLevel(player.name, player.level)
    : (rawCharacter.health || 100);
  player.health = player.baseMaxHealth;
  player.currentHealth = player.baseMaxHealth;
  player.movementSpeed = rawCharacter.movementSpeed;
  player.physicalDefense = (typeof getBasePhysicalDefense === "function")
    ? getBasePhysicalDefense(player.name)
    : (rawCharacter.physicalDefense || 0) + (baseVit * 0.25) + (baseDex * 0.5);
  player.physicalDamage = (typeof getBasePhysicalDamage === "function")
    ? getBasePhysicalDamage(player.name)
    : (rawCharacter.physicalDamage || 0) + basePow;
  player.criticalChance = rawCharacter.criticalChance || 0;
  player.criticalDamage = (rawCharacter.criticalDamage || 0) + (baseDex * 0.35);
  player.magicalAttack = (rawCharacter.magicalAttack || 0) + baseInt;
  player.magicalDefense = (rawCharacter.magicalDefense || 0) + (baseInt * 0.5);
  player.mana = (rawCharacter.mana || 0) + (baseInt * 2);
  player.currentMana = player.mana;
  player.hpRegen = rawCharacter.hpRegen || 0;
  player.manaRegen = rawCharacter.manaRegen || 0;
  player.vit = baseVit;
  player.dex = baseDex;
  player.int = baseInt;
  player.pow = basePow;
  player.armor = 0;

  // SPENT STAT POINTS -- respawning must not wipe out attribute points
  // already spent this match (spendGameInvStatPoint() in index.html).
  // The block above reset vit/dex/int/pow (and everything derived from
  // them) to the character's raw, UNSPENT baseline, so re-apply
  // whatever's actually been spent on top, the same way
  // startGameOnline() already does at match start.
  if ((player.spentVit || player.spentDex || player.spentInt || player.spentPow) &&
      typeof applyAttributeBonus === "function") {
    const beforeHealth = player.health || 0;
    applyAttributeBonus(player, player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0);
    player.baseMaxHealth = (player.baseMaxHealth || 0) + ((player.health || 0) - beforeHealth);
    player.currentHealth = player.health;
    player.currentMana = player.mana;
  }

  // player.health/baseMaxHealth/etc were just hard-reset to the bare
  // character baseline above (no weapon/armor bonus at all), but
  // player._weaponGearDelta/_armorGearDelta from BEFORE death still
  // remember what the previously-equipped gear last added. Without
  // clearing them here, attachWeaponToCharacter()/applyEquippedArmorToPlayer()
  // below would try to "undo" that old contribution against the fresh
  // reset value that never had it applied in the first place, corrupting
  // the max health instead of just cleanly reapplying the still-equipped
  // gear's bonus from scratch. startGameOffline()/startGameOnline() (below)
  // already do this same reset for the same reason.
  player._weaponGearDelta = null;
  player._armorGearDelta = null;

  if (player.weaponName) {
    attachWeaponToCharacter(player);
    if (typeof applyEquippedWeaponToPlayer === "function") {
      applyEquippedWeaponToPlayer();
    }
  }

  if (typeof applyEquippedArmorToPlayer === "function") {
    applyEquippedArmorToPlayer();
  }

  healthDisplay.textContent = player.currentHealth;
  bullets.length = 0;

  const spawn = getRandomSpawnPoint();
  playerPos.x = spawn.x;
  playerPos.y = spawn.y;
}

// ---------------------------------------------------------------------------
// BOT MELEE DAMAGE — called by bot.js's tryBotMeleeAttack() once a bot is
// close enough (attackmode.js's meleeRange) to strike the player directly
// instead of lobbing a mortar shot. Same armor-block/shield/death rules as
// a direct bullet hit (see the ENEMY-bullet direct-hit branch in update()):
// armor's block chance can void the hit entirely, otherwise
// applyDamageToPlayer() (item.js) applies it (shield first, then armor-
// reduced health), and a lethal hit respawns the player same as any other
// death.
// ---------------------------------------------------------------------------
function damagePlayerFromBotMelee(bot, attackResult) {
  if (gameMode !== "offline" || isDead) return;

  const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);
  if (!blocked) {
    // attackResult carries physicalDamage/magicalDamage separately (see
    // getAttackDamage() in character.js) — applyDamageToPlayer() (item.js)
    // mitigates each against the player's own physicalDefense/
    // magicalDefense independently.
    applyDamageToPlayer(player, attackResult);
  }

  healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));

  if (player.currentHealth <= 0) {
    respawnPlayerOffline();
  }
}

function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  const margin = 20;
  switch (side) {
    case 0: x = Math.random() * WORLD_SIZE_X; y = margin; break;
    case 1: x = WORLD_SIZE_X - margin; y = Math.random() * WORLD_SIZE_Y; break;
    case 2: x = Math.random() * WORLD_SIZE_X; y = WORLD_SIZE_Y - margin; break;
    case 3: x = margin; y = Math.random() * WORLD_SIZE_Y; break;
  }
  enemies.push({
    x, y,
    radius: 16,
    speed: 60 + Math.random() * 40,
    health: 20
  });
}

function tryReload() {
  if (player.isReloading) return;
  const w = player.weapon;
  if (!w) return; // no weapon equipped — nothing to reload

  player.isReloading = true;

  updateAmmoDisplay();
}

function finishReloadIfReady() {
  if (!player.isReloading) return;
  player.isReloading = false;
  updateAmmoDisplay();
}

// Resolves the player's actual weapon stats — online matches use the
// server-synced onlineWeapons table so damage/etc stay authoritative,
// offline just reads the locally-equipped weapon. Shared by fireBullet()
// and the aim UI (draw()) so both always agree on maxRange/radius.
function getActiveWeapon() {
  return (isOnline && onlineWeapons && onlineWeapons[player.weaponName])
    ? onlineWeapons[player.weaponName]
    : player.weapon;
}

// AOE PROXIMITY FALLOFF — shared by mortar explosion damage and knockback
// (see the isMortar landing branch in update()'s bullet loop). A hit dead
// center of the blast (dist 0) gets the full 100%; a hit right at the
// radius's outer edge (dist === radius) still gets AOE_MIN_FRACTION
// instead of dropping to 0, and everything in between scales linearly by
// how close it is. Example from weapon.js: damage 10, radius 25 — center
// hit takes 10, edge hit takes 2.5 (25%), a hit 10 units out takes 7 (70%).
const AOE_MIN_FRACTION = 0.25;

function getAoeFalloff(dist, radius) {
  if (!radius || radius <= 0) return 1;
  const t = Math.max(0, Math.min(1, dist / radius));
  return 1 - t * (1 - AOE_MIN_FRACTION);
}

// ---------------------------------------------------------------------------
// MELEE ATTACK — the player's own base attack (character.js's `attack`
// field, resolved here via attackmode.js's getAttackMode()). The right
// analog stick no longer previews a maxRange/radius mortar-lob (that UI
// is gone — see draw()); it only sets the direction the character attacks
// (and its animation plays) in. Bot and player can now damage each other
// at melee range this way — see bot.js's tryBotMeleeAttack().
// ---------------------------------------------------------------------------
function performPlayerMeleeAttack(mode, attackResult) {

  // DIRECTION — whatever direction the right stick was held in at
  // release (see fireBullet()/handleTouchEnd()); falls back to the last
  // attacked direction if released dead-center.
  const dir = input.shootVector;
  const mag = Math.hypot(dir.x, dir.y);
  const attackDir = mag > JOYSTICK_DEADZONE
    ? { x: dir.x / mag, y: dir.y / mag }
    : (player.facingDir || { x: 1, y: 0 });

  player.facingDir = attackDir;

  const reach = playerPos.radius + (mode.meleeRange || 10);
  const strikeX = playerPos.x + attackDir.x * reach;
  const strikeY = playerPos.y + attackDir.y * reach;

  // ANIMATE — plays mode.hitEffect (effect.js's "basicattack") right in
  // front of the player, rotated to actually face the attacked direction
  // (attackDir) instead of always drawing as if striking right.
  if (mode.hitEffect && typeof createHitEffect === "function") {
    createHitEffect(strikeX, strikeY, mode.hitEffect, null, Math.atan2(attackDir.y, attackDir.x));
  }

  // Bots are offline-only (see bot.js's file header) — nothing to hit in
  // online mode from this local swing.
  if (gameMode !== "offline" || typeof bots === "undefined") return;

  for (const bot of bots) {
    if (!bot.alive) continue;

    const dx = bot.x - playerPos.x;
    const dy = bot.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + bot.radius) continue;

    // FRONT CONE — only bots roughly in the attacked direction get hit,
    // not anything standing behind the player.
    if (dist > 0.001) {
      const nx = dx / dist, ny = dy / dist;
      const facing = nx * attackDir.x + ny * attackDir.y;
      if (facing < 0.3) continue; // outside ~70 deg half-angle in front
    }

    const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(bot);
    if (!blocked) {
      // physicalDamage vs bot.physicalDefense, magicalDamage vs
      // bot.magicalDefense — mitigated independently (see
      // getMitigatedDamage() in character.js) instead of both being
      // lumped under the old, never-actually-set bot.armor field.
      const mitigated = (typeof getMitigatedDamage === "function")
        ? getMitigatedDamage(attackResult, bot)
        : { totalDamage: Math.max(1, Math.round(attackResult.damage) - (bot.physicalDefense || 0)) };
      damageBot(bot, mitigated.totalDamage, attackResult.isCritical);
    }

    // ELEMENTAL ORB EFFECT — the player's equipped weapon may have an
    // orb attached (see upgrade.js's ORB_TYPES / attachedOrb). This used
    // to be rolled per bullet hit; now that the player's base attack is
    // this melee swing instead of a fired bullet, the swing connecting
    // is the trigger point. Rolls the orb's own effectChance internally
    // (see applyOrbEffect() in bot.js).
    if (bot.alive && typeof applyOrbEffect === "function") {
      const activeWeapon = (typeof getActiveWeapon === "function") ? getActiveWeapon() : null;
      if (activeWeapon && activeWeapon.attachedOrb) {
        applyOrbEffect(bot, activeWeapon.attachedOrb);
      }
    }

    if (!bot.alive) {
      const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
      for (const drop of drops) itemDrops.push(drop);
      // Separate roll from a separate field — see spawnGoldOrb on
      // BOT_TYPES in bot.js.
      const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
      for (const drop of goldDrops) itemDrops.push(drop);
      bot.dropsSpawned = true;

      if (!bot.expAwarded && typeof addCharacterExp === "function") {
        bot.expAwarded = true;
        const expResult = addCharacterExp(player, bot.expGet || 0);
        if (expResult.leveledUp) {
          applyLevelHealthGrowth(expResult.levelsGained);
        }
        if (typeof persistCharacterProgress === "function") {
          persistCharacterProgress(
            player.name, player.level, player.exp, player.statPoints,
            player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
          );
        }
        if (expResult.leveledUp && typeof showHubToast === "function") {
          showHubToast("Level Up! Now level " + player.level);
        }
      }
    } else {
      botGotHit(bot, playerPos.x, playerPos.y);
    }
  }
}

function fireBullet() {
  finishReloadIfReady();

  if (player.isReloading) return;

  // ATTACK SPEED — replaces the old per-weapon `cooldown` (weapon.js,
  // now removed): firing rate is a character stat instead of a weapon
  // one, so it's the same no matter what's equipped. See
  // canCharacterAttack() in character.js.
  const attackNow = performance.now();
  if (typeof canCharacterAttack === "function" && !canCharacterAttack(player, attackNow)) return;

  const w = getActiveWeapon();
  const mode = (typeof getAttackMode === "function") ? getAttackMode(player.attack) : null;

  if (!w && !mode) return; // nothing to attack with

  player.lastAttackTime = attackNow;

  // COMBINED + CRITICAL DAMAGE — folds the player's own base `damage`
  // stat (character.js) into the weapon's damage, then rolls a crit on
  // the total. Rolled once per shot (not per pellet), so a shotgun's
  // whole spread shares the same crit result. See getAttackDamage() in
  // character.js.
  const attackResult = (typeof getAttackDamage === "function")
    ? getAttackDamage(player, w ? w.physicalDamage : 0)
    : { damage: (w && w.physicalDamage) || 0, isCritical: false };

  updateAmmoDisplay();

  // FIRE SOUND LOCAL — routed through the cached Web Audio buffer path
  // (audio.js), same as bot gunfire/hit effects, instead of a brand-new
  // new Audio() decoded from scratch on every single shot. At high fire
  // rates (and with 15-20 bots also firing) that per-shot decode was the
  // single biggest source of lag. dx/dy are 0 since this is the local
  // player's own shot — always full volume, centered, unfiltered.
  if (w && w.fireSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(w.fireSound, 0, 0, { baseVolume: 1.0 });
    } else {
      const audio = new Audio(w.fireSound);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }
  }

  // SEND SOUND TO OTHER PLAYERS (include position so distant players
  // hear it quieter/muffled instead of at full volume)
  if (w && w.fireSound && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "shootSound",
      sound: w.fireSound,
      ownerId: myId,
      x: playerPos.x,
      y: playerPos.y
    }));
  }

  // MELEE — the player's base attack is a short directional strike now
  // (see performPlayerMeleeAttack() above and attackmode.js) instead of
  // a lobbed mortar shot. Every current character has an `attack` mode
  // set, so this is the normal path; the old ranged mortar-lob below is
  // kept only as a fallback for any character with no resolvable mode.
  if (mode) {
    performPlayerMeleeAttack(mode, attackResult);
    return;
  }

  // ---- FALLBACK: old mortar-lob ranged attack (no attack mode set) ----
  const dir = input.shootVector;
  const mag = Math.hypot(dir.x, dir.y);
  let shootDir = mag > JOYSTICK_DEADZONE
    ? { x: dir.x / mag, y: dir.y / mag }
    : { x: 1, y: 0 };
  const pull = Math.min(1, mag);

  // CREATE BULLETS
  const travelDist = pull * (w.maxRange || 300);
  const explosionRadius = w.radius || 40;

  if (w.pellets) {
    // SHOTGUN MULTIPLE PELLETS — each pellet has its own spread angle,
    // but travels the same pull-determined distance before landing, so
    // they fan out and land across a small area rather than one spot.
    for (let i = 0; i < w.pellets; i++) {
      const spreadAngle = (Math.random() - 0.5) * w.spread;
      const cos = Math.cos(spreadAngle);
      const sin = Math.sin(spreadAngle);

      const pelletDir = {
        x: shootDir.x * cos - shootDir.y * sin,
        y: shootDir.x * sin + shootDir.y * cos
      };

      const targetX = playerPos.x + pelletDir.x * travelDist;
      const targetY = playerPos.y + pelletDir.y * travelDist;

      bullets.push({
        x: playerPos.x,
        y: playerPos.y,
        radius: 4,
        damage: attackResult.physicalDamage,
        magicalDamage: attackResult.magicalDamage,
        hitEffect: w.hitEffect,
        projectile: w.projectile,
        attachedOrb: w.attachedOrb || null,
        ownerId: myId,
        ownerType: "player",
        isMortar: true,
        targetX: targetX,
        targetY: targetY,
        explosionRadius: explosionRadius,
        knockback: w.knockback || 0
      });

      // SEND EACH PELLET ONLINE
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "bullet",
          x: playerPos.x,
          y: playerPos.y,
          damage: attackResult.damage,
          hitEffect: w.hitEffect,
          projectile: w.projectile,
          ownerId: myId,
          isMortar: true,
          targetX: targetX,
          targetY: targetY,
          explosionRadius: explosionRadius
        }));
      }
    }
  } else {
    // NORMAL SINGLE BULLET — lobbed toward the aimed landing point
    // instead of flying forever; see the isMortar branch in update()'s
    // bullet loop for the actual travel/landing/explode behavior.
    const targetX = playerPos.x + shootDir.x * travelDist;
    const targetY = playerPos.y + shootDir.y * travelDist;

    const bulletData = {
      type: "bullet",
      x: playerPos.x,
      y: playerPos.y,
      damage: attackResult.physicalDamage,
      hitEffect: w.hitEffect,
      projectile: w.projectile,
      ownerId: myId,
      isMortar: true,
      targetX: targetX,
      targetY: targetY,
      explosionRadius: explosionRadius
    };

    // LOCAL BULLET
    bullets.push({
      x: bulletData.x,
      y: bulletData.y,
      radius: 4,
      damage: bulletData.damage,
      magicalDamage: attackResult.magicalDamage,
      hitEffect: bulletData.hitEffect,
      projectile: bulletData.projectile,
      attachedOrb: w.attachedOrb || null,
      ownerId: myId,
      ownerType: "player",
      isMortar: true,
      targetX: bulletData.targetX,
      targetY: bulletData.targetY,
      explosionRadius: bulletData.explosionRadius,
      knockback: w.knockback || 0
    });

    // SEND BULLET TO OTHER PLAYERS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(bulletData));
    }
  }
}

// ---------------------------------------------------------------------------
// SKILL FIRING — separate from fireBullet()/the equipped weapon entirely.
// Armed via skillBtn (see its touch handlers below), aimed with the same
// right analog stick, and released the same way (handleTouchEnd), but it
// reads player.skillData (skill.js, attached in character.js) instead of
// getActiveWeapon(), doesn't touch ammo/magazine, and fires its own
// projectileCount-bullet burst spaced bulletInterval seconds apart instead
// of a single shot.
// ---------------------------------------------------------------------------
let activeSkillBurst = null; // { remaining, intervalMs, timer, targetX, targetY, ... } or null

// In-progress melee skill (slash1-style): the first hit lands the instant
// the skill button is tapped (see runMeleeSkillEffect()), then this drips
// out the remaining hits every hitInterval seconds, same drip pattern as
// activeSkillBurst above — just re-checking the player's CURRENT position
// each tick instead of chasing a fixed target point, since melee has no
// aim/travel step.
let activeMeleeSkill = null; // { remaining, intervalMs, timer, damage, radius, hitEffect, criticalChance, criticalDamage } or null

function isSkillOnCooldown() {
  if (!player.skillData) return true;
  const now = performance.now();
  return (now - (player.skillLastUsedTime || 0)) < (player.skillData.cooldown || 0);
}

function skillCooldownRemainingMs() {
  if (!player.skillData) return 0;
  const now = performance.now();
  return Math.max(0, (player.skillData.cooldown || 0) - (now - (player.skillLastUsedTime || 0)));
}

function meetsSkillLevelRequirement() {
  return !!player.skillData && player.level >= (player.skillData.requiredLevel || 1);
}

// Reflects armed/cooldown/locked state onto skillBtn every frame (called
// from update() below) — see the .armed/.onCooldown/.locked rules in
// style.css.
function updateSkillButtonUI() {
  if (!skillBtn) return;

  // EMPTY — no skill dragged into equip slot 1 yet. Shown as a dimmed,
  // non-interactive placeholder (reuses the .locked look) with the
  // plain SKILL1 label and no icon, instead of hiding the button — same
  // always-visible-but-blank treatment as skillBtn3/skillBtn4 below.
  if (!player.skillData) {
    skillBtn.style.display = "";
    skillBtn.classList.add("locked");
    skillBtn.classList.remove("onCooldown", "armed");
    if (skillBtnIcon) skillBtnIcon.style.display = "none";
    if (skillBtnLabel) {
      skillBtnLabel.style.display = "";
      skillBtnLabel.textContent = "SKILL1";
    }
    if (skillCooldownText) skillCooldownText.textContent = "";
    return;
  }

  const locked = !meetsSkillLevelRequirement();
  const onCooldown = !locked && isSkillOnCooldown();

  skillBtn.classList.toggle("locked", locked);
  skillBtn.classList.toggle("onCooldown", onCooldown);
  skillBtn.classList.toggle("armed", input.skillArmed && !locked && !onCooldown);

  // ICON — skill.js's `icon` field for whatever skill actually sits in
  // player.skillData right now (the character's default, or something
  // dragged into equip slot 1 on the Inventory screen's SKILL loadout —
  // see applyEquippedSkillsToPlayer() in index.html). Shown in place of
  // the SKILL1 text label once unlocked; falls back to the text label
  // if this particular skill has no icon set.
  if (skillBtnIcon) {
    if (player.skillData.icon) {
      skillBtnIcon.src = player.skillData.icon;
      skillBtnIcon.style.display = locked ? "none" : "block";
    } else {
      skillBtnIcon.style.display = "none";
    }
  }

  if (locked) {
    if (skillBtnLabel) {
      skillBtnLabel.style.display = "";
      skillBtnLabel.textContent = "SKILL";
    }
    if (skillCooldownText) skillCooldownText.textContent = "";
  } else if (onCooldown) {
    if (skillBtnLabel) skillBtnLabel.style.display = "none";
    if (skillCooldownText) skillCooldownText.textContent = (skillCooldownRemainingMs() / 1000).toFixed(1);
  } else {
    if (skillBtnLabel) {
      skillBtnLabel.style.display = player.skillData.icon ? "none" : "";
      skillBtnLabel.textContent = "SKILL1";
    }
    if (skillCooldownText) skillCooldownText.textContent = "";
  }
}

// isSkillOnCooldown()/skillCooldownRemainingMs()/meetsSkillLevelRequirement()
// above are skill 1's (player.skillData). These are the same checks for
// skill 2 (player.skillData2, e.g. "heal") — kept separate so the two
// skills' cooldowns/unlock levels never interfere with each other.
function isSkill2OnCooldown() {
  if (!player.skillData2) return true;
  const now = performance.now();
  return (now - (player.skill2LastUsedTime || 0)) < (player.skillData2.cooldown || 0);
}

function skill2CooldownRemainingMs() {
  if (!player.skillData2) return 0;
  const now = performance.now();
  return Math.max(0, (player.skillData2.cooldown || 0) - (now - (player.skill2LastUsedTime || 0)));
}

function meetsSkill2LevelRequirement() {
  return !!player.skillData2 && player.level >= (player.skillData2.requiredLevel || 1);
}

// Reflects armed/cooldown/locked state onto skillBtn2 every frame
// (called from update() below). Whether it ever actually shows "armed"
// depends on the equipped skill's activationType (skill.js) — instant
// skills never set skill2Armed, so the class simply never lands.
function updateSkillButton2UI() {
  if (!skillBtn2) return;

  // EMPTY — no skill dragged into equip slot 2 yet. Same
  // always-visible-but-blank treatment as skillBtn/skillBtn3/skillBtn4.
  if (!player.skillData2) {
    skillBtn2.style.display = "";
    skillBtn2.classList.add("locked");
    skillBtn2.classList.remove("onCooldown");
    if (skillBtn2Icon) skillBtn2Icon.style.display = "none";
    if (skillBtn2Label) {
      skillBtn2Label.style.display = "";
      skillBtn2Label.textContent = "SKILL2";
    }
    if (skillCooldownText2) skillCooldownText2.textContent = "";
    return;
  }

  const locked = !meetsSkill2LevelRequirement();
  const onCooldown = !locked && isSkill2OnCooldown();

  skillBtn2.classList.toggle("locked", locked);
  skillBtn2.classList.toggle("onCooldown", onCooldown);
  skillBtn2.classList.toggle("armed", input.skill2Armed && !locked && !onCooldown);

  // ICON — same idea as skillBtn's above, for player.skillData2 / equip
  // slot 2.
  if (skillBtn2Icon) {
    if (player.skillData2.icon) {
      skillBtn2Icon.src = player.skillData2.icon;
      skillBtn2Icon.style.display = locked ? "none" : "block";
    } else {
      skillBtn2Icon.style.display = "none";
    }
  }

  if (locked) {
    if (skillBtn2Label) {
      skillBtn2Label.style.display = "";
      skillBtn2Label.textContent = "SKILL";
    }
    if (skillCooldownText2) skillCooldownText2.textContent = "";
  } else if (onCooldown) {
    if (skillBtn2Label) skillBtn2Label.style.display = "none";
    if (skillCooldownText2) skillCooldownText2.textContent = (skill2CooldownRemainingMs() / 1000).toFixed(1);
  } else {
    if (skillBtn2Label) {
      skillBtn2Label.style.display = player.skillData2.icon ? "none" : "";
      skillBtn2Label.textContent = "SKILL2";
    }
    if (skillCooldownText2) skillCooldownText2.textContent = "";
  }
}

// isSkillOnCooldown()/skillCooldownRemainingMs()/meetsSkillLevelRequirement()
// above are skill 1's. These are the same checks for skill 3
// (player.skillData3 — equip slot 3, only ever populated by dragging a
// skill into the Inventory screen's SKILL loadout, no character default).
function isSkill3OnCooldown() {
  if (!player.skillData3) return true;
  const now = performance.now();
  return (now - (player.skill3LastUsedTime || 0)) < (player.skillData3.cooldown || 0);
}

function skill3CooldownRemainingMs() {
  if (!player.skillData3) return 0;
  const now = performance.now();
  return Math.max(0, (player.skillData3.cooldown || 0) - (now - (player.skill3LastUsedTime || 0)));
}

function meetsSkill3LevelRequirement() {
  return !!player.skillData3 && player.level >= (player.skillData3.requiredLevel || 1);
}

// Reflects armed/cooldown/locked state onto skillBtn3 every frame (called
// from update() below) — same aim-and-arm style as updateSkillButtonUI()
// above (skillBtn3 shares the right analog stick with skillBtn, see
// input.skill3Armed).
function updateSkillButton3UI() {
  if (!skillBtn3) return;

  // EMPTY — no skill dragged into equip slot 3 yet. Shown as a dimmed,
  // non-interactive placeholder (reuses the .locked look) with the slot
  // number instead of hiding the button outright, so all 4 skill slots
  // are always visible in gameplay even before anything's equipped.
  if (!player.skillData3) {
    skillBtn3.style.display = "";
    skillBtn3.classList.add("locked");
    skillBtn3.classList.remove("onCooldown", "armed");
    if (skillBtn3Icon) skillBtn3Icon.style.display = "none";
    if (skillBtn3Label) {
      skillBtn3Label.style.display = "";
      skillBtn3Label.textContent = "SKILL";
    }
    if (skillCooldownText3) skillCooldownText3.textContent = "";
    return;
  }

  const locked = !meetsSkill3LevelRequirement();
  const onCooldown = !locked && isSkill3OnCooldown();

  skillBtn3.classList.toggle("locked", locked);
  skillBtn3.classList.toggle("onCooldown", onCooldown);
  skillBtn3.classList.toggle("armed", input.skill3Armed && !locked && !onCooldown);

  if (skillBtn3Icon) {
    if (player.skillData3.icon) {
      skillBtn3Icon.src = player.skillData3.icon;
      skillBtn3Icon.style.display = locked ? "none" : "block";
    } else {
      skillBtn3Icon.style.display = "none";
    }
  }

  if (locked) {
    if (skillBtn3Label) {
      skillBtn3Label.style.display = "";
      skillBtn3Label.textContent = "SKILL";
    }
    if (skillCooldownText3) skillCooldownText3.textContent = "";
  } else if (onCooldown) {
    if (skillBtn3Label) skillBtn3Label.style.display = "none";
    if (skillCooldownText3) skillCooldownText3.textContent = (skill3CooldownRemainingMs() / 1000).toFixed(1);
  } else {
    if (skillBtn3Label) {
      skillBtn3Label.style.display = player.skillData3.icon ? "none" : "";
      skillBtn3Label.textContent = "SKILL3";
    }
    if (skillCooldownText3) skillCooldownText3.textContent = "";
  }
}

// Same checks as skill 2's, for skill 4 (player.skillData4 — equip slot
// 4, instant-activate on tap like skillBtn2, no arm/aim step).
function isSkill4OnCooldown() {
  if (!player.skillData4) return true;
  const now = performance.now();
  return (now - (player.skill4LastUsedTime || 0)) < (player.skillData4.cooldown || 0);
}

function skill4CooldownRemainingMs() {
  if (!player.skillData4) return 0;
  const now = performance.now();
  return Math.max(0, (player.skillData4.cooldown || 0) - (now - (player.skill4LastUsedTime || 0)));
}

function meetsSkill4LevelRequirement() {
  return !!player.skillData4 && player.level >= (player.skillData4.requiredLevel || 1);
}

// Reflects armed/cooldown/locked state onto skillBtn4 every frame
// (called from update() below). Same note as skillBtn2's comment above —
// "armed" only ever shows if an aimed skill ends up equipped here.
function updateSkillButton4UI() {
  if (!skillBtn4) return;

  // EMPTY — same placeholder treatment as updateSkillButton3UI() above,
  // for equip slot 4.
  if (!player.skillData4) {
    skillBtn4.style.display = "";
    skillBtn4.classList.add("locked");
    skillBtn4.classList.remove("onCooldown");
    if (skillBtn4Icon) skillBtn4Icon.style.display = "none";
    if (skillBtn4Label) {
      skillBtn4Label.style.display = "";
      skillBtn4Label.textContent = "SKILL";
    }
    if (skillCooldownText4) skillCooldownText4.textContent = "";
    return;
  }

  const locked = !meetsSkill4LevelRequirement();
  const onCooldown = !locked && isSkill4OnCooldown();

  skillBtn4.classList.toggle("locked", locked);
  skillBtn4.classList.toggle("onCooldown", onCooldown);
  skillBtn4.classList.toggle("armed", input.skill4Armed && !locked && !onCooldown);

  if (skillBtn4Icon) {
    if (player.skillData4.icon) {
      skillBtn4Icon.src = player.skillData4.icon;
      skillBtn4Icon.style.display = locked ? "none" : "block";
    } else {
      skillBtn4Icon.style.display = "none";
    }
  }

  if (locked) {
    if (skillBtn4Label) {
      skillBtn4Label.style.display = "";
      skillBtn4Label.textContent = "SKILL";
    }
    if (skillCooldownText4) skillCooldownText4.textContent = "";
  } else if (onCooldown) {
    if (skillBtn4Label) skillBtn4Label.style.display = "none";
    if (skillCooldownText4) skillCooldownText4.textContent = (skill4CooldownRemainingMs() / 1000).toFixed(1);
  } else {
    if (skillBtn4Label) {
      skillBtn4Label.style.display = player.skillData4.icon ? "none" : "";
      skillBtn4Label.textContent = "SKILL4";
    }
    if (skillCooldownText4) skillCooldownText4.textContent = "";
  }
}

// Fires one bullet of an in-progress skill burst toward its (fixed) target
// point — same isMortar/explosionRadius landing behavior fireBullet()'s
// bullets use (see the isMortar branch in update() below), just built from
// skill stats instead of weapon stats, and with no ammo/magazine involved.
function fireSkillBullet(burst) {
  const dx = burst.targetX - playerPos.x;
  const dy = burst.targetY - playerPos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;

  const bulletData = {
    type: "bullet",
    x: playerPos.x,
    y: playerPos.y,
    damage: burst.damage,
    hitEffect: burst.hitEffect,
    projectile: burst.projectile,
    ownerId: myId,
    isMortar: true,
    targetX: burst.targetX,
    targetY: burst.targetY,
    explosionRadius: burst.explosionRadius,
    knockback: burst.knockback || 0
  };

  bullets.push({
    x: bulletData.x,
    y: bulletData.y,
    radius: 4,
    damage: bulletData.damage,
    // MAGICAL DAMAGE — a skill's magicalAttack (skill.js, combined with
    // the player's own total via getSkillEffectiveStats()) rides on the
    // bullet the same way a weapon bullet's magicalDamage does (see
    // fireBullet() above) — mitigated separately against a bot's
    // magicalDefense wherever this bullet lands (update()'s isMortar
    // AOE branch, getMitigatedDamage() in character.js).
    magicalDamage: burst.magicalDamage || 0,
    hitEffect: bulletData.hitEffect,
    projectile: bulletData.projectile,
    ownerId: myId,
    ownerType: "player",
    isMortar: true,
    targetX: bulletData.targetX,
    targetY: bulletData.targetY,
    explosionRadius: bulletData.explosionRadius,
    knockback: bulletData.knockback
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(bulletData));
  }
}

// ---------------------------------------------------------------------------
// SKILL ACTIVATION — shared by all 4 skill buttons/slots. Which of the
// two behaviors below actually runs is decided by the equipped skill's
// own activationType (skill.js), not by which button/slot it happens
// to sit in — dragging "barrage" into ANY of the 4 slots always arms
// that button and aims/fires it with the right analog stick, and
// dragging "heal1" into ANY slot always fires immediately on tap. A
// skill with no activationType set falls back to "aimed" (the more
// common case).
// ---------------------------------------------------------------------------

// AIMED / GROUND — armed by tapping the button (see onSkillSlotTouch()
// below). A "ground"-type skill (barrage, see skill.js) is released by
// tapping the map: explicitTarget is that tapped world point, passed in
// from fireSkill()/fireSkill2()/fireSkill3()/fireSkill4() via
// handleTouchStart()'s ground-release branch. Falls back to the older
// right-analog-stick pull/direction (input.shootVector) when no explicit
// target is given, for any skill still using the legacy "aimed" type.
function runAimedSkillBurst(s, explicitTarget) {
  if (s.skillSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(s.skillSound, 0, 0, { baseVolume: 1.0 });
    } else {
      const audio = new Audio(s.skillSound);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "shootSound",
        sound: s.skillSound,
        ownerId: myId,
        x: playerPos.x,
        y: playerPos.y
      }));
    }
  }

  let shootDir, pull;

  if (explicitTarget) {
    // GROUND TAP — fire straight toward the tapped world point, capped
    // at maxRange (pull scales 0..1 the same way the old stick pull did,
    // so a tap just past maxRange still lands right at the edge instead
    // of overshooting).
    const dx = explicitTarget.x - playerPos.x;
    const dy = explicitTarget.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    shootDir = dist > 0.001 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    pull = Math.min(1, dist / (s.maxRange || 300));
  } else {
    const dir = input.shootVector;
    const mag = Math.hypot(dir.x, dir.y);
    shootDir = mag > JOYSTICK_DEADZONE
      ? { x: dir.x / mag, y: dir.y / mag }
      : { x: 1, y: 0 };
    pull = Math.min(1, mag);
  }

  const travelDist = pull * (s.maxRange || 300);

  // DAMAGE — FIX: this used to read s.damage, a field that doesn't exist
  // on any skill.js entry (they set physicalDamage/magicalAttack), so
  // every burst bullet dealt undefined/NaN damage. Now rolled once for
  // the whole burst (same as a shotgun's pellet spread sharing one crit,
  // see fireBullet() above) from skill.js's getSkillDamageResult(), which
  // combines this skill's own physicalDamage/magicalAttack/crit stats
  // with the PLAYER's own current totals of those same stats (see
  // skill.js's SKILL_SCALABLE_STATS comment) — so e.g. a skill with
  // physicalDamage: 100 on a player whose own physicalDamage totals 100
  // deals 100 + 100 = 200.
  const skillDamageResult = (typeof getSkillDamageResult === "function")
    ? getSkillDamageResult(s, player)
    : { physicalDamage: s.physicalDamage || 0, magicalDamage: s.magicalAttack || 0, isCritical: false };

  activeSkillBurst = {
    remaining: s.projectileCount || 1,
    intervalMs: (s.bulletInterval || 0) * 1000,
    timer: 0,
    targetX: playerPos.x + shootDir.x * travelDist,
    targetY: playerPos.y + shootDir.y * travelDist,
    damage: skillDamageResult.physicalDamage,
    magicalDamage: skillDamageResult.magicalDamage,
    hitEffect: s.hitEffect,
    projectile: s.projectile,
    explosionRadius: s.radius || 40,
    knockback: s.knockback || 0,
    homing: !!s.homing // TODO: homing steering isn't implemented yet — bullets fly straight to targetX/Y regardless of this flag.
  };

  // First bullet releases immediately; the rest follow every
  // bulletInterval seconds (see the activeSkillBurst tick in update()).
  fireSkillBullet(activeSkillBurst);
  activeSkillBurst.remaining--;
  if (activeSkillBurst.remaining <= 0) activeSkillBurst = null;
}

// INSTANT — fires the moment the button is tapped, no arm/aim step
// (heal-style): heals the player and any nearby teammate (otherPlayers,
// online only) within s.radius, plus a brief speed boost.
function runInstantSkillEffect(s) {
  const now = performance.now();

  // HEAL SELF — capped at max health. player.health already carries the
  // level+armor-scaled max (see applyLevelHealthGrowth()/getCharacter()),
  // same field used everywhere else in this file for that cap.
  const maxHealth = player.health || player.baseMaxHealth || 100;
  player.currentHealth = Math.min(maxHealth, (player.currentHealth || 0) + (s.healAmount || 0));
  if (healthDisplay) healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));

  // HEAL EFFECT — attached to (follows) the player instead of playing at
  // a fixed impact point, since this skill has no aimed target. Passing
  // playerPos as followTarget keeps it centered on the player every
  // frame (see updateHitEffects() in effect.js).
  if (s.hitEffect && typeof createHitEffect === "function") {
    createHitEffect(playerPos.x, playerPos.y, s.hitEffect, playerPos);
  }

  // SKILL SOUND — once per activation.
  if (s.skillSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(s.skillSound, 0, 0, { baseVolume: 1.0 });
    } else {
      const audio = new Audio(s.skillSound);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "shootSound",
        sound: s.skillSound,
        ownerId: myId,
        x: playerPos.x,
        y: playerPos.y
      }));
    }
  }

  // HEAL NEARBY TEAMMATES — online only; otherPlayers are this player's
  // real teammates in the shared coop arena (see startGameOnline()
  // above). Applied optimistically on this client so it's visible right
  // away, and best-effort sent to the server as a "heal" message (mirrors
  // the existing "hit" message the bullet/otherPlayers collision code
  // sends for damage) so every client converges on the same health once
  // the server's own "playerHealth" broadcast comes back.
  if (isOnline && s.radius) {
    for (const [id, p] of otherPlayers) {
      const dist = Math.hypot(p.x - playerPos.x, p.y - playerPos.y);
      if (dist > s.radius) continue;

      if (typeof p.health === "number") {
        p.health += (s.healAmount || 0);
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "heal",
          targetId: id,
          amount: s.healAmount || 0
        }));
      }
    }
  }

  // SPEED BOOST — temporary movement-speed bump, reverted after
  // speedBoostTime (ms) by the tick in update() below. Only remembers
  // the pre-boost base speed once, so re-using the skill before the
  // previous boost expires refreshes the duration instead of stacking.
  if (s.speedBoost) {
    if (player.speedBoostEndTime == null) {
      player.speedBoostBaseSpeed = player.movementSpeed;
    }
    player.movementSpeed = player.speedBoostBaseSpeed + s.speedBoost;
    player.speedBoostEndTime = now + (s.speedBoostTime || 0);
  }
}

// MELEE — fires centered on the player the moment the button is tapped,
// no arm/aim step (same as "instant", see onSkillSlotTouch() below), but
// deals damage instead of healing: every bot within s.radius of the
// player gets hit, s.hitNum separate times, s.hitInterval seconds apart
// (see activeMeleeSkill's tick in update()), each hit independently
// rolling s.criticalChance for a crit that adds s.criticalDamage worth
// of the character's currently equipped weapon damage (weapon.js) on
// top of s.damage.
function runMeleeSkillEffect(s) {
  // SKILL SOUND — once per activation, same pattern as the other two
  // activation types above.
  if (s.skillSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(s.skillSound, 0, 0, { baseVolume: 1.0 });
    } else {
      const audio = new Audio(s.skillSound);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "shootSound",
        sound: s.skillSound,
        ownerId: myId,
        x: playerPos.x,
        y: playerPos.y
      }));
    }
  }

  // STAT SCALING — combines this skill's own physicalDamage/magicalAttack/
  // criticalChance/criticalDamage with the PLAYER's own current totals of
  // those same stats (skill.js's getSkillEffectiveStats() —
  // SKILL_SCALABLE_STATS comment there has the full field list/example).
  // FIX: this used to read s.damage, a field no skill.js entry actually
  // sets (they set physicalDamage), so every melee skill hit dealt
  // undefined/NaN damage. Each of the hitNum hits below still rolls its
  // own independent crit (see applyMeleeSkillHit()) — this just supplies
  // the combined base numbers to roll against.
  const effectiveStats = (typeof getSkillEffectiveStats === "function")
    ? getSkillEffectiveStats(s, player)
    : {};

  activeMeleeSkill = {
    remaining: (s.hitNum || 1) - 1,
    intervalMs: (s.hitInterval || 0) * 1000,
    timer: 0,
    physicalDamage: effectiveStats.physicalDamage || 0,
    magicalDamage: effectiveStats.magicalAttack || 0,
    radius: s.radius || 60,
    hitEffect: s.hitEffect,
    criticalChance: effectiveStats.criticalChance || 0,
    criticalDamage: effectiveStats.criticalDamage || 0
  };

  // First hit lands immediately; any remaining hits drip out via the
  // activeMeleeSkill tick in update().
  applyMeleeSkillHit(activeMeleeSkill);
  if (activeMeleeSkill.remaining <= 0) activeMeleeSkill = null;
}

// Runs one melee hit against every living bot currently inside m.radius
// of the player. Mirrors the AOE mortar-landing branch in update()'s
// bullet loop (armor block, damageBot(), death -> drops/exp, else
// botGotHit()), just centered on the player every tick instead of a
// fixed landing spot, and with no falloff/knockback (a slash hits flat,
// full damage out to the edge of its radius). Unlike that bullet-impact
// pattern, the hitEffect here plays once on the PLAYER per swing (see
// below) instead of once per bot actually hit — a slash should be
// visible even if nothing was in range to connect with.
function applyMeleeSkillHit(m) {
  // TODO: offline-only for now, same as barrage's AOE branch — no
  // server message sent for a melee hit yet, so this skill won't be
  // visible to teammates in online mode.
  if (gameMode !== "offline") return;

  // SWING EFFECT — plays on the player every time this skill swings,
  // whether or not it actually connects with a bot (a slash should be
  // visible even swinging at empty air). followTarget keeps it glued to
  // the player, same as heal1's effect in runInstantSkillEffect().
  if (m.hitEffect && typeof createHitEffect === "function") {
    createHitEffect(playerPos.x, playerPos.y, m.hitEffect, playerPos);
  }

  // CRIT ROLL — each of the hitNum hits independently rolls m's combined
  // criticalChance (skill + player, see runMeleeSkillEffect() above)
  // against m's combined physicalDamage/magicalDamage, same pattern as
  // getAttackDamage()/rollCharacterCritical() in character.js (falls back
  // to a local roll if that isn't loaded for some reason).
  const critRoller = (typeof rollCharacterCritical === "function")
    ? rollCharacterCritical
    : function (critContext, baseDamage) {
        const isCritical = Math.random() < (critContext.criticalChance || 0);
        const damage = isCritical ? baseDamage * (1 + (critContext.criticalDamage || 0)) : baseDamage;
        return { damage, isCritical };
      };
  const critContext = { criticalChance: m.criticalChance, criticalDamage: m.criticalDamage };

  for (const bot of bots) {
    if (!bot.alive) continue;

    const dist = Math.hypot(bot.x - playerPos.x, bot.y - playerPos.y);
    if (dist > m.radius) continue;

    const physicalResult = critRoller(critContext, m.physicalDamage);
    const magicalResult = critRoller(critContext, m.magicalDamage);
    const isCrit = physicalResult.isCritical || magicalResult.isCritical;

    const botBlocked = (typeof rollArmorBlock === "function") && rollArmorBlock(bot);
    if (!botBlocked) {
      // DEFENSE — physicalDamage vs bot.physicalDefense, magicalDamage vs
      // bot.magicalDefense, mitigated separately (see getMitigatedDamage()
      // in character.js), same as every other damage source in this file.
      const mitigated = (typeof getMitigatedDamage === "function")
        ? getMitigatedDamage({ physicalDamage: physicalResult.damage, magicalDamage: magicalResult.damage }, bot)
        : { totalDamage: Math.max(1, Math.round(physicalResult.damage) - (bot.physicalDefense || 0)) };
      damageBot(bot, mitigated.totalDamage, isCrit);
    }

    // ELEMENTAL ORB EFFECT — same trigger as the basic melee attack (see
    // performPlayerMeleeAttack() above): a skill hit connecting rolls the
    // equipped weapon's attached orb (upgrade.js), instead of the old
    // per-bullet roll. Applies to any melee-type skill hit (e.g. slash1).
    if (bot.alive && typeof applyOrbEffect === "function") {
      const activeWeapon = (typeof getActiveWeapon === "function") ? getActiveWeapon() : null;
      if (activeWeapon && activeWeapon.attachedOrb) {
        applyOrbEffect(bot, activeWeapon.attachedOrb);
      }
    }

    if (!bot.alive) {
      const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
      for (const drop of drops) itemDrops.push(drop);
      // Separate roll from a separate field — see spawnGoldOrb on
      // BOT_TYPES in bot.js.
      const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
      for (const drop of goldDrops) itemDrops.push(drop);
      bot.dropsSpawned = true;

      if (!bot.expAwarded && typeof addCharacterExp === "function") {
        bot.expAwarded = true;
        const expResult = addCharacterExp(player, bot.expGet || 0);
        if (expResult.leveledUp) {
          applyLevelHealthGrowth(expResult.levelsGained);
        }
        if (typeof persistCharacterProgress === "function") {
          persistCharacterProgress(
            player.name, player.level, player.exp, player.statPoints,
            player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
          );
        }
        if (expResult.leveledUp && typeof showHubToast === "function") {
          showHubToast("Level Up! Now level " + player.level);
        }
      }
    } else {
      botGotHit(bot, playerPos.x, playerPos.y);
    }
  }
}

// BEAM / VACUUM — a "ground"-type skill whose attackType is "beam" (see
// skill.js's barrage) routes here instead of runAimedSkillBurst() above.
// Released the same way (arm the button, tap the ground) but the tap
// only picks a DIRECTION — the vacuum path always travels the skill's
// full `range` that way, not just as far as the tap. Everything alive
// inside the resulting range x width rectangle takes one instant hit,
// same crit/armor/death/exp handling as applyMeleeSkillHit() above, just
// with a rectangle-vs-bot check instead of radius-vs-bot.
function runBeamSkillEffect(s, explicitTarget) {
  // SKILL SOUND — once per activation, same pattern as the other
  // activation types.
  if (s.skillSound) {
    if (typeof playPositionalSound === "function") {
      playPositionalSound(s.skillSound, 0, 0, { baseVolume: 1.0 });
    } else {
      const audio = new Audio(s.skillSound);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "shootSound",
        sound: s.skillSound,
        ownerId: myId,
        x: playerPos.x,
        y: playerPos.y
      }));
    }
  }

  // DIRECTION — same tap-toward-point math as runAimedSkillBurst(), but
  // with no pull/distance scaling: a beam always reaches its full
  // `range` in whichever direction the tap points, regardless of how
  // close or far the tap itself landed. Falls back to the right-stick
  // direction if this is ever fired with no explicit ground tap.
  let shootDir;
  if (explicitTarget) {
    const dx = explicitTarget.x - playerPos.x;
    const dy = explicitTarget.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    shootDir = dist > 0.001 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
  } else {
    const dir = input.shootVector;
    const mag = Math.hypot(dir.x, dir.y);
    shootDir = mag > JOYSTICK_DEADZONE
      ? { x: dir.x / mag, y: dir.y / mag }
      : { x: 1, y: 0 };
  }

  const range = s.range || 300;
  const halfWidth = (s.width || 80) / 2;

  // TODO: offline-only for now, same as slash1's applyMeleeSkillHit() —
  // no server message sent for this skill yet, so neither the vacuum
  // visual nor its damage will show up for teammates in online mode.
  if (gameMode !== "offline") return;

  // VISUAL — the "vacuum" hit effect (effect.js) stretched to exactly
  // range x width via createHitEffect()'s sizeOverride, anchored at the
  // PLAYER's own position (anchorAtStart) and rotated to face shootDir,
  // so it visibly starts at the player and reaches forward toward the
  // tapped point instead of hovering centered between the two. It
  // disappears on its own once its animation finishes playing (see
  // updateHitEffects() in effect.js).
  if (s.hitEffect && typeof createHitEffect === "function") {
    const angle = Math.atan2(shootDir.y, shootDir.x);
    createHitEffect(playerPos.x, playerPos.y, s.hitEffect, null, angle, {
      width: range,
      height: halfWidth * 2,
      anchorAtStart: true,
      // FLIP — the "vacuum" sprite's own animation appears to be
      // authored flowing right-to-left (suction pulling inward), which
      // read as moving toward the player once anchored/rotated to face
      // the target. This mirrors just the artwork so it flows outward
      // (player -> target) instead. If this ever looks wrong again (or
      // the art gets swapped for one that already flows outward), just
      // flip this back to false.
      flipX: true,
      // TRAVEL SPEED — how fast (world px/second) the beam's leading
      // edge visibly reaches out toward `range` (skill.js's own
      // travelSpeed field). Purely visual — the damage loop below
      // already resolves instantly against the full rectangle the
      // moment the skill fires, regardless of how long the beam takes
      // to finish animating outward.
      travelSpeed: s.travelSpeed || 900
    });
  }

  // STAT SCALING — combines this skill's own physicalDamage/magicalAttack/
  // criticalChance/criticalDamage with the PLAYER's own current totals
  // (skill.js's getSkillEffectiveStats()), same as applyMeleeSkillHit().
  const effectiveStats = (typeof getSkillEffectiveStats === "function")
    ? getSkillEffectiveStats(s, player)
    : {};

  const critRoller = (typeof rollCharacterCritical === "function")
    ? rollCharacterCritical
    : function (critContext, baseDamage) {
        const isCritical = Math.random() < (critContext.criticalChance || 0);
        const damage = isCritical ? baseDamage * (1 + (critContext.criticalDamage || 0)) : baseDamage;
        return { damage, isCritical };
      };
  const critContext = {
    criticalChance: effectiveStats.criticalChance || 0,
    criticalDamage: effectiveStats.criticalDamage || 0
  };
  const physicalTotal = effectiveStats.physicalDamage || 0;
  const magicalTotal = effectiveStats.magicalAttack || 0;

  for (const bot of bots) {
    if (!bot.alive) continue;

    // RECTANGLE HIT TEST — project the bot's offset from the player onto
    // shootDir to see how far along the path it sits (`along`, must fall
    // between 0 and range), then measure its sideways distance from that
    // line (`perp`, must be within halfWidth, plus the bot's own radius
    // so a bot's edge counts, not just its exact center point).
    const relX = bot.x - playerPos.x;
    const relY = bot.y - playerPos.y;
    const along = relX * shootDir.x + relY * shootDir.y;
    if (along < 0 || along > range) continue;

    const perp = Math.abs(relX * -shootDir.y + relY * shootDir.x);
    if (perp > halfWidth + (bot.radius || 0)) continue;

    const physicalResult = critRoller(critContext, physicalTotal);
    const magicalResult = critRoller(critContext, magicalTotal);
    const isCrit = physicalResult.isCritical || magicalResult.isCritical;

    const botBlocked = (typeof rollArmorBlock === "function") && rollArmorBlock(bot);
    if (!botBlocked) {
      const mitigated = (typeof getMitigatedDamage === "function")
        ? getMitigatedDamage({ physicalDamage: physicalResult.damage, magicalDamage: magicalResult.damage }, bot)
        : { totalDamage: Math.max(1, Math.round(physicalResult.damage) - (bot.physicalDefense || 0)) };
      damageBot(bot, mitigated.totalDamage, isCrit);
    }

    // ELEMENTAL ORB EFFECT — same trigger as slash1's melee hit above.
    if (bot.alive && typeof applyOrbEffect === "function") {
      const activeWeapon = (typeof getActiveWeapon === "function") ? getActiveWeapon() : null;
      if (activeWeapon && activeWeapon.attachedOrb) {
        applyOrbEffect(bot, activeWeapon.attachedOrb);
      }
    }

    if (!bot.alive) {
      const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
      for (const drop of drops) itemDrops.push(drop);
      const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
      for (const drop of goldDrops) itemDrops.push(drop);
      bot.dropsSpawned = true;

      if (!bot.expAwarded && typeof addCharacterExp === "function") {
        bot.expAwarded = true;
        const expResult = addCharacterExp(player, bot.expGet || 0);
        if (expResult.leveledUp) {
          applyLevelHealthGrowth(expResult.levelsGained);
        }
        if (typeof persistCharacterProgress === "function") {
          persistCharacterProgress(
            player.name, player.level, player.exp, player.statPoints,
            player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
          );
        }
        if (expResult.leveledUp && typeof showHubToast === "function") {
          showHubToast("Level Up! Now level " + player.level);
        }
      }
    } else {
      botGotHit(bot, playerPos.x, playerPos.y);
    }
  }
}

// Runs whichever of the four shared behaviors above fits s.activationType
// (plus s.attackType for "ground" skills). target is only used by
// "ground"/legacy "aimed" skills — see runAimedSkillBurst()/
// runBeamSkillEffect() above.
function runSkillActivation(s, target) {
  if (s.activationType === "instant") {
    runInstantSkillEffect(s);
  } else if (s.activationType === "melee") {
    runMeleeSkillEffect(s);
  } else if (s.activationType === "ground" && s.attackType === "beam") {
    runBeamSkillEffect(s, target);
  } else {
    runAimedSkillBurst(s, target);
  }
}

// SHARED COOLDOWN — if the same skill (matched by its skill.js identity,
// s.skill, e.g. "heal1") is sitting in more than one of the 4 equip
// slots (dragging a catalog icon onto a slot COPIES it, so this is
// allowed — see setSlotEntry()'s skillCatalog no-op in index.html),
// using it from any one of those slots now puts every slot holding that
// same skill on cooldown together, not just the slot that was tapped.
// Without this, equipping one skill into every slot would let the
// player fire it back-to-back by tapping a different button each time,
// bypassing its cooldown entirely instead of actually waiting it out.
function syncSharedSkillCooldown(usedSkill, usedTime) {
  if (!usedSkill || !usedSkill.skill) return;

  if (player.skillData && player.skillData.skill === usedSkill.skill) {
    player.skillLastUsedTime = usedTime;
  }
  if (player.skillData2 && player.skillData2.skill === usedSkill.skill) {
    player.skill2LastUsedTime = usedTime;
  }
  if (player.skillData3 && player.skillData3.skill === usedSkill.skill) {
    player.skill3LastUsedTime = usedTime;
  }
  if (player.skillData4 && player.skillData4.skill === usedSkill.skill) {
    player.skill4LastUsedTime = usedTime;
  }
}

// SKILL 1 — reads/writes player.skillData/skillLastUsedTime, same as
// before, but the actual effect (aimed burst vs instant heal) now comes
// from whatever skill is actually equipped in this slot. See
// syncSharedSkillCooldown() above for why every OTHER slot holding this
// same skill also starts cooling down right here.
function fireSkill(targetX, targetY) {
  const s = player.skillData;
  if (!s || !meetsSkillLevelRequirement() || isSkillOnCooldown()) return;

  const usedTime = performance.now();
  player.skillLastUsedTime = usedTime;
  syncSharedSkillCooldown(s, usedTime);
  input.skillArmed = false;
  updateSkillButtonUI();
  runSkillActivation(s, targetX !== undefined ? { x: targetX, y: targetY } : null);
}

// SKILL 2 — same idea, for player.skillData2/skill2LastUsedTime.
function fireSkill2(targetX, targetY) {
  const s = player.skillData2;
  if (isDead || !s || !meetsSkill2LevelRequirement() || isSkill2OnCooldown()) return;

  const usedTime = performance.now();
  player.skill2LastUsedTime = usedTime;
  syncSharedSkillCooldown(s, usedTime);
  input.skill2Armed = false;
  updateSkillButton2UI();
  runSkillActivation(s, targetX !== undefined ? { x: targetX, y: targetY } : null);
}

// SKILL 3 — same idea, for player.skillData3/skill3LastUsedTime.
function fireSkill3(targetX, targetY) {
  const s = player.skillData3;
  if (!s || !meetsSkill3LevelRequirement() || isSkill3OnCooldown()) return;

  const usedTime = performance.now();
  player.skill3LastUsedTime = usedTime;
  syncSharedSkillCooldown(s, usedTime);
  input.skill3Armed = false;
  updateSkillButton3UI();
  runSkillActivation(s, targetX !== undefined ? { x: targetX, y: targetY } : null);
}

// SKILL 4 — same idea, for player.skillData4/skill4LastUsedTime.
function fireSkill4(targetX, targetY) {
  const s = player.skillData4;
  if (isDead || !s || !meetsSkill4LevelRequirement() || isSkill4OnCooldown()) return;

  const usedTime = performance.now();
  player.skill4LastUsedTime = usedTime;
  syncSharedSkillCooldown(s, usedTime);
  input.skill4Armed = false;
  updateSkillButton4UI();
  runSkillActivation(s, targetX !== undefined ? { x: targetX, y: targetY } : null);
}

// SKILL BUTTON TOUCH — one handler shape shared by all 4 slots. If the
// skill equipped in this slot is "instant", tapping fires it right away
// (fireFn). Otherwise (aimed), tapping arms this slot and disarms the
// other 3 — they all share the same right analog stick, so only one
// can ever be armed at a time. Kept separate from the canvas's own
// touchstart/touchend (handleTouchStart/handleTouchEnd below) since
// these are real DOM buttons, not canvas joystick zones.
function onSkillSlotTouch(getSkillData, meetsLevel, onCooldown, armedKey, fireFn) {
  return (e) => {
    if (e.cancelable) e.preventDefault();
    if (isDead) return;

    const s = getSkillData();
    if (!s || !meetsLevel() || onCooldown()) return;

    // INSTANT + MELEE both fire the moment the button is tapped — no
    // arm step, no ground tap involved (see runInstantSkillEffect()/
    // runMeleeSkillEffect() above). Only "ground" skills (barrage-style)
    // need the arm-then-tap-the-ground-to-release flow below.
    if (s.activationType === "instant" || s.activationType === "melee") {
      fireFn();
      return;
    }

    input.skillArmed = false;
    input.skill2Armed = false;
    input.skill3Armed = false;
    input.skill4Armed = false;
    input[armedKey] = !input[armedKey];

    updateSkillButtonUI();
    updateSkillButton2UI();
    updateSkillButton3UI();
    updateSkillButton4UI();
  };
}

if (skillBtn) {
  const onSkillBtnTouch = onSkillSlotTouch(
    () => player.skillData, meetsSkillLevelRequirement, isSkillOnCooldown, "skillArmed", fireSkill
  );
  skillBtn.addEventListener("touchstart", onSkillBtnTouch, { passive: false });
  skillBtn.addEventListener("mousedown", onSkillBtnTouch);
}

if (skillBtn2) {
  const onSkillBtn2Touch = onSkillSlotTouch(
    () => player.skillData2, meetsSkill2LevelRequirement, isSkill2OnCooldown, "skill2Armed", fireSkill2
  );
  skillBtn2.addEventListener("touchstart", onSkillBtn2Touch, { passive: false });
  skillBtn2.addEventListener("mousedown", onSkillBtn2Touch);
}

if (skillBtn3) {
  const onSkillBtn3Touch = onSkillSlotTouch(
    () => player.skillData3, meetsSkill3LevelRequirement, isSkill3OnCooldown, "skill3Armed", fireSkill3
  );
  skillBtn3.addEventListener("touchstart", onSkillBtn3Touch, { passive: false });
  skillBtn3.addEventListener("mousedown", onSkillBtn3Touch);
}

if (skillBtn4) {
  const onSkillBtn4Touch = onSkillSlotTouch(
    () => player.skillData4, meetsSkill4LevelRequirement, isSkill4OnCooldown, "skill4Armed", fireSkill4
  );
  skillBtn4.addEventListener("touchstart", onSkillBtn4Touch, { passive: false });
  skillBtn4.addEventListener("mousedown", onSkillBtn4Touch);
}

function update(dt) {
  finishReloadIfReady();
  laserBlinkTime += dt;

  // ARMOR REGEN — ticks player.currentHealth back up while wearing an
  // armor with an hpRegen/mpRegen/millisec pair (armor.js). This was
  // defined in armor.js but never actually called anywhere, so equipped
  // armor's regen never did anything — wiring it in here.
  if (!isDead && typeof tickArmorRegeneration === "function") {
    tickArmorRegeneration(player, dt * 1000);
    if (healthDisplay) healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  }

  // CHARACTER-STYLE REGEN — the player's own hpRegen/manaRegen percentage
  // stats (character.js's tickCharacterRegen()), separate from and
  // additive with the armor regen above.
  if (!isDead && typeof tickCharacterRegen === "function") {
    tickCharacterRegen(player, dt * 1000);
    if (healthDisplay) healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  }

  // Keep the enemy bot stats popup's health bar live if it's open.
  if (botStatsTargetBot) refreshBotStatsPopup();

  // UPDATE HIT EFFECT ANIMATION
  updateHitEffects(dt);

  // UPDATE DAMAGE NUMBER POPUPS — see number.js.
  if (typeof updateDamageNumbers === "function") updateDamageNumbers(dt);

  if (!isDead) {
  const moveSpeed = player.movementSpeed;
  playerPos.x += input.moveVector.x * moveSpeed * dt;
  playerPos.y += input.moveVector.y * moveSpeed * dt;
}

  // AUTO-ATTACK — fires as soon as the right stick is pointed in a
  // direction (input.isShooting, set in handleTouchMove once it crosses
  // JOYSTICK_DEADZONE), instead of waiting for the stick to be released.
  // fireBullet() is still gated by canCharacterAttack()'s attack-speed
  // cooldown internally, so holding the stick pointed one way attacks
  // repeatedly at the character's attack speed rather than spamming
  // every frame.
  if (!isDead && input.isShooting) {
    fireBullet();
  }

  // Clamp player inside world bounds
  playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x));
  playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y));
  
    // Player collision with obstacles
  if (!isDead) {
    for (const obs of obstacles) {
      const closestX = Math.max(obs.x, Math.min(playerPos.x, obs.x + obs.width));
      const closestY = Math.max(obs.y, Math.min(playerPos.y, obs.y + obs.height));

      const dx = playerPos.x - closestX;
      const dy = playerPos.y - closestY;
      const dist = Math.hypot(dx, dy);

      if (dist < playerPos.radius) {
        const overlap = playerPos.radius - dist;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;

        playerPos.x += nx * overlap;
        playerPos.y += ny * overlap;
      }
    }
  }

  // Player collision - push away from other players
  for (const [id, p] of otherPlayers) {
    const dx = playerPos.x - p.x;
    const dy = playerPos.y - p.y;
    const dist = Math.hypot(dx, dy);
    const minDist = playerPos.radius * 2;

    if (dist < minDist && dist > 0) {
      const pushX = dx / dist;
      const pushY = dy / dist;
      const overlap = minDist - dist;

      playerPos.x += pushX * overlap * 0.5;
      playerPos.y += pushY * overlap * 0.5;
    }
  }

  // Send position to server (message type + fields must match the
  // server's "playerMove" handler — it also relays health/alive so
  // teammates' health bars and death state stay in sync).
  if (ws && ws.readyState === WebSocket.OPEN && myId != null) {
    ws.send(JSON.stringify({
      type: "playerMove",
      x: playerPos.x,
      y: playerPos.y,
      health: player.currentHealth,
      alive: !isDead
    }));
  }

  // NOTE: firing no longer happens continuously while the shoot stick is
  // held — it's a hold-to-aim / release-to-fire mortar lob now. The
  // actual fireBullet() call happens once, on stick release, in
  // handleTouchEnd (below), so it can use the aim vector at the exact
  // moment of release.

  // SKILL BURST TICK — releases the rest of an in-progress skill burst's
  // bullets, bulletInterval seconds apart (see fireSkill()/
  // fireSkillBullet() above). The first bullet already fired the instant
  // the stick was released; this just drips out the remaining ones.
  if (activeSkillBurst) {
    activeSkillBurst.timer += dt * 1000;
    if (activeSkillBurst.timer >= activeSkillBurst.intervalMs) {
      activeSkillBurst.timer = 0;
      fireSkillBullet(activeSkillBurst);
      activeSkillBurst.remaining--;
      if (activeSkillBurst.remaining <= 0) activeSkillBurst = null;
    }
  }

  // MELEE SKILL TICK — releases the rest of an in-progress melee skill's
  // hits (slash1-style), hitInterval seconds apart (see
  // runMeleeSkillEffect()/applyMeleeSkillHit() above). The first hit
  // already landed the instant the skill button was tapped; this just
  // drips out the remaining ones, re-checking the player's current
  // position each time.
  if (activeMeleeSkill) {
    activeMeleeSkill.timer += dt * 1000;
    if (activeMeleeSkill.timer >= activeMeleeSkill.intervalMs) {
      activeMeleeSkill.timer = 0;
      applyMeleeSkillHit(activeMeleeSkill);
      activeMeleeSkill.remaining--;
      if (activeMeleeSkill.remaining <= 0) activeMeleeSkill = null;
    }
  }

  // Keeps skillBtn's armed/cooldown/locked visuals + countdown text in
  // sync every frame (cooldown needs to tick down even while not aiming).
  updateSkillButtonUI();

  // Keeps skillBtn2's cooldown/locked visuals + countdown text in sync
  // every frame, same as skillBtn above.
  updateSkillButton2UI();

  // Keeps skillBtn3/skillBtn4's visuals + countdown text in sync every
  // frame, same as skillBtn/skillBtn2 above.
  updateSkillButton3UI();
  updateSkillButton4UI();

  // SPEED BOOST TICK — reverts player.movementSpeed back to its
  // pre-boost value once skillData2's speedBoostTime has elapsed since
  // fireSkill2() was used (see the "SPEED BOOST" block there).
  if (player.speedBoostEndTime != null && performance.now() >= player.speedBoostEndTime) {
    player.movementSpeed = player.speedBoostBaseSpeed;
    player.speedBoostEndTime = null;
    player.speedBoostBaseSpeed = null;
  }

  // Bullets - movement and collision
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    // GUARD — respawnPlayerOffline() (and a couple other paths) can call
    // bullets.length = 0 to clear the field, and it can be triggered
    // from INSIDE this very loop (a bot's exploding mortar shot dropping
    // the player's health to 0, a few lines below). That empties the
    // array out from under us mid-iteration, so any remaining index this
    // loop still visits comes back undefined instead of a bullet. More
    // bullets in flight at once (e.g. a skill burst) just made this easy
    // to hit — skip the now-invalid slot instead of crashing on it.
    if (!b) continue;

    // MORTAR LOB — fired toward a fixed target point (see fireBullet())
    // instead of flying forever. It arcs over obstacles/players/bots
    // (no collision along the way) and only interacts with the world
    // once it actually lands on its target, where it explodes into AoE
    // damage + knockback against every bot in range (see below).
    if (b.isMortar) {
      const toTargetX = b.targetX - b.x;
      const toTargetY = b.targetY - b.y;
      const distToTarget = Math.hypot(toTargetX, toTargetY);
      const moveDist = Math.hypot(b.vx, b.vy) * dt;

      if (moveDist >= distToTarget) {
        // Reached (or passed) the target this frame — land exactly on it.
        b.x = b.targetX;
        b.y = b.targetY;

        createHitEffect(b.x, b.y, b.hitEffect);

        // AOE DAMAGE + KNOCKBACK — every bot inside b.explosionRadius of
        // the landing spot gets hit, scaled by getAoeFalloff() above:
        // full damage/knockback dead-center, tapering to 25% right at the
        // radius's edge instead of an all-or-nothing hit. Mirrors the
        // direct bullet-vs-bot logic further below (armor block, orb
        // effect, death/drops/exp handling) since it's the same kind of
        // hit, just applied to every bot in range instead of one.
        if (gameMode === "offline" && b.ownerType === "player" && b.explosionRadius) {
          // Knockback now travels WITH the bullet (b.knockback), set at
          // creation time from whatever fired it — weapon (fireBullet())
          // or skill (fireSkillBullet()) — instead of always reading
          // whatever weapon happens to be equipped right now. Falls back
          // to the old getActiveWeapon() lookup for any bullet that
          // predates this field.
          const knockback = b.knockback !== undefined
            ? b.knockback
            : ((getActiveWeapon() && getActiveWeapon().knockback) || 0);

          for (const bot of bots) {
            if (!bot.alive) continue;

            const dx = bot.x - b.x;
            const dy = bot.y - b.y;
            const dist = Math.hypot(dx, dy);

            if (dist > b.explosionRadius) continue;

            const falloff = getAoeFalloff(dist, b.explosionRadius);
            const aoeDamage = Math.max(1, Math.round(b.damage * falloff));
            const aoeMagicalDamage = Math.round((b.magicalDamage || 0) * falloff);

            // DEFENSE — physicalDamage vs bot.physicalDefense,
            // magicalDamage vs bot.magicalDefense, mitigated
            // independently (see getMitigatedDamage() in character.js)
            // instead of both being lumped under the old, never-set
            // bot.armor field.
            const botBlocked = (typeof rollArmorBlock === "function") && rollArmorBlock(bot);
            if (!botBlocked) {
              const mitigated = (typeof getMitigatedDamage === "function")
                ? getMitigatedDamage({ physicalDamage: aoeDamage, magicalDamage: aoeMagicalDamage }, bot)
                : { totalDamage: Math.max(1, aoeDamage - (bot.physicalDefense || 0)) };
              damageBot(bot, mitigated.totalDamage);
            }

            // KNOCKBACK — pushes the bot away from the blast center,
            // scaled by the same falloff as damage: standing closer to
            // the landing spot means a harder hit and a longer shove.
            if (knockback > 0 && dist > 0) {
              const pushDist = knockback * falloff;
              const nx = dx / dist;
              const ny = dy / dist;
              bot.x = Math.max(bot.radius, Math.min(WORLD_SIZE_X - bot.radius, bot.x + nx * pushDist));
              bot.y = Math.max(bot.radius, Math.min(WORLD_SIZE_Y - bot.radius, bot.y + ny * pushDist));
            }

            // ELEMENTAL ORB EFFECT — this AoE landing spot is how an
            // aimed skill (e.g. barrage, skill.js) lands its hit, so this
            // is that skill's orb trigger point: rolls the equipped
            // weapon's attached orb (upgrade.js) instead of the old
            // per-bullet roll.
            if (bot.alive && typeof applyOrbEffect === "function") {
              const activeWeapon = (typeof getActiveWeapon === "function") ? getActiveWeapon() : null;
              if (activeWeapon && activeWeapon.attachedOrb) {
                applyOrbEffect(bot, activeWeapon.attachedOrb);
              }
            }

            if (!bot.alive) {
              const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
              for (const drop of drops) itemDrops.push(drop);
              // Separate roll from a separate field — see spawnGoldOrb on
              // BOT_TYPES in bot.js.
              const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
              for (const drop of goldDrops) itemDrops.push(drop);
              bot.dropsSpawned = true;

              if (!bot.expAwarded && typeof addCharacterExp === "function") {
                bot.expAwarded = true;
                const expResult = addCharacterExp(player, bot.expGet || 0);
                if (expResult.leveledUp) {
                  applyLevelHealthGrowth(expResult.levelsGained);
                }
                if (typeof persistCharacterProgress === "function") {
                  persistCharacterProgress(
                    player.name, player.level, player.exp, player.statPoints,
                    player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
                  );
                }
                if (expResult.leveledUp && typeof showHubToast === "function") {
                  showHubToast("Level Up! Now level " + player.level);
                }
              }
            } else {
              botGotHit(bot, playerPos.x, playerPos.y);
            }
          }
        } else if (gameMode === "offline" && b.ownerType === "bot" && b.explosionRadius && !isDead) {
          // Same landing-spot AoE, mirrored for a bot's shot hitting the
          // player: proximity-scaled damage + knockback (see
          // getAoeFalloff() above), armor block chance, and shield
          // absorption via applyDamageToPlayer() — same rules a direct
          // hit already used, just triggered at this mortar's landing
          // point instead of a bullet-line touch.
          const dx = playerPos.x - b.x;
          const dy = playerPos.y - b.y;
          const dist = Math.hypot(dx, dy);

          if (dist <= b.explosionRadius) {
            const falloff = getAoeFalloff(dist, b.explosionRadius);
            const aoeDamage = Math.max(1, Math.round(b.damage * falloff));
            const aoeMagicalDamage = Math.round((b.magicalDamage || 0) * falloff);

            const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);
            if (!blocked) {
              applyDamageToPlayer(player, { physicalDamage: aoeDamage, magicalDamage: aoeMagicalDamage });

              // KNOCKBACK — scaled by the same falloff as damage: a
              // landing spot dead-center of the player shoves them the
              // full knockback distance, tapering toward the edge.
              if (b.knockback && dist > 0 && player.currentHealth > 0) {
                const pushDist = b.knockback * falloff;
                const nx = dx / dist;
                const ny = dy / dist;
                playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x + nx * pushDist));
                playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y + ny * pushDist));
              }
            }

            healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));

            if (player.currentHealth <= 0) {
              respawnPlayerOffline();
            }
          }
        }

        retireBullet(b, i);
        continue;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      continue;
    }

    const prevX = b.x;
    const prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Bullet collision with obstacles — swept against the whole path the
    // bullet traveled this frame (see segmentIntersectsRect above), so a
    // very fast bullet can't skip clean through a wall between frames.
    let hitObstacle = false;
    let hitObstacleX = b.x;
    let hitObstacleY = b.y;
    for (const obs of obstacles) {
      const hit = segmentIntersectsRect(prevX, prevY, b.x, b.y, obs.x, obs.y, obs.width, obs.height);
      if (hit) {
        hitObstacle = true;
        hitObstacleX = hit.x;
        hitObstacleY = hit.y;
        createHitEffect(hit.x, hit.y, b.hitEffect);
        break;
      }
    }

    if (hitObstacle) {
      b.x = hitObstacleX;
      b.y = hitObstacleY;
      retireBullet(b, i);
      continue;
    }

    // Remove bullets out of bounds + wall hit effect
    if (
      b.x < 0 ||
      b.x > WORLD_SIZE_X ||
      b.y < 0 ||
      b.y > WORLD_SIZE_Y
    ) {
      let hitX = b.x;
      let hitY = b.y;

      hitX = Math.max(0, Math.min(WORLD_SIZE_X, hitX));
      hitY = Math.max(0, Math.min(WORLD_SIZE_Y, hitY));

      createHitEffect(hitX, hitY, b.hitEffect);

      b.x = hitX;
      b.y = hitY;
      retireBullet(b, i);
      continue;
    }

    // MY bullet - ONLY BULLET OWNER DEALS DAMAGE
    if (b.ownerId === myId) {
      let hitSomething = false;

      if (gameMode === "online") {
        // ONLINE (coop boss fight): bullets damage the shared boss, not
        // teammates — see server.js's "bossDamage" handler. Damage is
        // trusted client-side, same trust model the old PvP "hit"
        // message used.
        if (boss && boss.alive) {
          const cp = closestPointOnSegment(boss.x, boss.y, prevX, prevY, b.x, b.y);
          const dx = cp.x - boss.x;
          const dy = cp.y - boss.y;
          const dist = Math.hypot(dx, dy);

          if (dist < b.radius + BOSS_RADIUS) {
            createHitEffect(cp.x, cp.y, b.hitEffect);

            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "bossDamage",
                damage: b.damage
              }));
            }

            b.x = cp.x;
            b.y = cp.y;
            retireBullet(b, i);
            hitSomething = true;
          }
        }
      } else {
        for (const [id, p] of otherPlayers) {
          const cp = closestPointOnSegment(p.x, p.y, prevX, prevY, b.x, b.y);
          const dx = cp.x - p.x;
          const dy = cp.y - p.y;
          const dist = Math.hypot(dx, dy);

          if (dist < b.radius + playerPos.radius) {
            createHitEffect(cp.x, cp.y, b.hitEffect);

            if (ws && ws.readyState === WebSocket.OPEN) {
  ws.send(JSON.stringify({
    type: "hit",
    targetId: id,
    damage: b.damage
  }));
}

            b.x = cp.x;
            b.y = cp.y;
            retireBullet(b, i);
            hitSomething = true;
            break;
          }
        }
      }

      // OFFLINE: my bullets also hit enemy bots
      if (!hitSomething && gameMode === "offline") {
        for (const bot of bots) {
          if (!bot.alive) continue;

          const cp = closestPointOnSegment(bot.x, bot.y, prevX, prevY, b.x, b.y);
          const dx = cp.x - bot.x;
          const dy = cp.y - bot.y;
          const dist = Math.hypot(dx, dy);

          if (dist < b.radius + bot.radius) {
            createHitEffect(cp.x, cp.y, b.hitEffect);

            // DEFENSE — physicalDamage (b.damage) vs bot.physicalDefense,
            // magicalDamage (b.magicalDamage) vs bot.magicalDefense,
            // mitigated independently (see getMitigatedDamage() in
            // character.js) instead of both being lumped under the old,
            // never-actually-set bot.armor field. Mirrors
            // applyDamageToPlayer()'s defense math in item.js, but only
            // for direct bullet hits (burn/status-tick damage below still
            // calls damageBot() directly, unmitigated, same as shield
            // damage ignores defense for the player).
            const botBlocked = (typeof rollArmorBlock === "function") && rollArmorBlock(bot);
            if (!botBlocked) {
              const mitigated = (typeof getMitigatedDamage === "function")
                ? getMitigatedDamage({ physicalDamage: b.damage, magicalDamage: b.magicalDamage || 0 }, bot)
                : { totalDamage: Math.max(1, b.damage - (bot.physicalDefense || 0)) };
              damageBot(bot, mitigated.totalDamage);
            }

            // NOTE: no orb-effect roll here anymore — this direct
            // segment-collision path is for a non-mortar traveling
            // bullet, and every current weapon/skill fires as a melee
            // swing or a mortar-lob (isMortar) instead (see
            // performPlayerMeleeAttack()/fireSkillBullet() and the
            // isMortar AoE branch above), so this branch is legacy/
            // unreachable in practice. The orb effect now triggers from
            // an actual melee-attack or skill hit landing instead of a
            // bullet — see performPlayerMeleeAttack(), applyMeleeSkillHit()
            // and the isMortar AoE branch above.

            if (!bot.alive) {
              // Bot just died — roll its item drops (see spawnItem on
              // the bot's BOT_TYPES entry in bot.js) and drop them where
              // it died.
              const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
              for (const drop of drops) itemDrops.push(drop);
              // Separate roll from a separate field — see spawnGoldOrb on
              // BOT_TYPES in bot.js.
              const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
              for (const drop of goldDrops) itemDrops.push(drop);
              bot.dropsSpawned = true; // so the burn-death catch-all below doesn't double-drop

              // LEVELING — grant this bot's expGet to the player (see
              // character.js's addCharacterExp()/getExpForLevel()).
              // expAwarded mirrors dropsSpawned so a respawned bot pays
              // out again on its next kill, but never twice for the
              // same death.
              if (!bot.expAwarded && typeof addCharacterExp === "function") {
                bot.expAwarded = true;
                const expResult = addCharacterExp(player, bot.expGet || 0);
                // HEALTH GROWTH — +10% max health per level, compounding
                // (see applyLevelHealthGrowth() above).
                if (expResult.leveledUp) {
                  applyLevelHealthGrowth(expResult.levelsGained);
                }
                // Mirror the new level/exp into localStorage (see
                // persistCharacterProgress() in index.html) so it isn't
                // lost on reload and is there for the next match/Save
                // Game/Inventory hold-popup to read back.
                if (typeof persistCharacterProgress === "function") {
                  persistCharacterProgress(
                    player.name, player.level, player.exp, player.statPoints,
                    player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
                  );
                }
                if (expResult.leveledUp && typeof showHubToast === "function") {
                  showHubToast("Level Up! Now level " + player.level);
                }
              }
            } else {
              // Bot now knows where the shot came from and fights back,
              // even if it hadn't spotted the player yet.
              botGotHit(bot, playerPos.x, playerPos.y);
            }

            b.x = cp.x;
            b.y = cp.y;
            retireBullet(b, i);
            hitSomething = true;
            break;
          }
        }
      }
    } else {
      // ENEMY bullet hits me — DIRECT HIT fallback for any non-mortar
      // enemy bullet. Bots currently always fire mortar-style shots (see
      // fireOnePellet() in bot.js and the isMortar branch above), so this
      // path isn't hit by them anymore; kept as a fallback in case a
      // future enemy bullet type isn't a lobbed/AoE shot.
      // Online: visual only (server tracks real health via playerHealth msgs).
      // Offline: bot bullets deal real damage here.
      if (!isDead) {
        const cp = closestPointOnSegment(playerPos.x, playerPos.y, prevX, prevY, b.x, b.y);
        const dx = cp.x - playerPos.x;
        const dy = cp.y - playerPos.y;
        const dist = Math.hypot(dx, dy);

        if (dist < b.radius + playerPos.radius) {
          createHitEffect(cp.x, cp.y, b.hitEffect);

          if (gameMode === "offline" && b.ownerType === "bot") {
            // ARMOR BLOCK CHANCE — equipped armor's `block` percent (armor.js)
            // gives a chance to fully block the hit, same as rollArmorBlock()
            // was already wired for elsewhere. Was defined but never called.
            const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);

            if (!blocked) {
              // Shield hitpoints (from a shield item pickup) absorb damage
              // before health, and defense doesn't reduce shield damage —
              // see applyDamageToPlayer() in item.js.
              applyDamageToPlayer(player, { physicalDamage: b.damage, magicalDamage: b.magicalDamage || 0 });

              // KNOCKBACK — this is a direct hit (the bullet actually had
              // to travel and touch the player, not a mortar shot landing
              // on a ground point), so there's no proximity falloff like
              // the player's own AoE splash gets — just push the player
              // back the bot weapon's full `knockback` distance, along
              // the direction the bullet was already traveling.
              if (b.knockback && player.currentHealth > 0) {
                const travelSpeed = Math.hypot(b.vx, b.vy);
                if (travelSpeed > 0) {
                  const nx = b.vx / travelSpeed;
                  const ny = b.vy / travelSpeed;
                  playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x + nx * b.knockback));
                  playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y + ny * b.knockback));
                }
              }
            }
            healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));

            if (player.currentHealth <= 0) {
              respawnPlayerOffline();
            }
          }

          b.x = cp.x;
          b.y = cp.y;
          retireBullet(b, i);
          break;
        }
      }
    }
  }

  // Enemies
  for (const e of enemies) {
    const dx = playerPos.x - e.x;
    const dy = playerPos.y - e.y;
    const len = Math.hypot(dx, dy) || 1;

    e.x += (dx / len) * e.speed * dt;
    e.y += (dy / len) * e.speed * dt;

    const dist = Math.hypot(playerPos.x - e.x, playerPos.y - e.y);

    if (dist < playerPos.radius + e.radius) {
      // Both defense sources are real and additive: player.physicalDefense
      // (vit/dex attributes + character.js armor combining) and
      // player.armor (the separate equipped-armor-SLOT value from
      // applyEquippedArmorToPlayer() in index.html).
      const dmg = Math.max(1, 10 - ((player.physicalDefense || 0) + (player.armor || 0)));
      player.currentHealth -= dmg;
      healthDisplay.textContent = player.currentHealth;

      if (player.currentHealth <= 0) {
        player.currentHealth = player.health;
        healthDisplay.textContent = player.currentHealth;
        enemies.length = 0;
        bullets.length = 0;
        const spawn = getRandomSpawnPoint();
        playerPos.x = spawn.x;
        playerPos.y = spawn.y;
      }

      e.x -= (dx / len) * 40;
      e.y -= (dy / len) * 40;
    }
  }

  enemySpawnTimer += dt * 1000;

  if (enemySpawnTimer >= enemySpawnInterval) {
    enemySpawnTimer = 0;
    spawnEnemy();
  }

  // ENEMY BOTS (offline mode only)
  if (gameMode === "offline") {
    updateBots(bots, dt, {
      playerPos,
      isPlayerDead: isDead,
      obstacles,
      worldWidth: WORLD_SIZE_X,
      worldHeight: WORLD_SIZE_Y,
      bullets
    });

    // Bots can also die from a burn (fireorb) tick inside updateBots()
    // above, outside the direct bullet-hit collision check — that death
    // never goes through the "roll item drops" step above, so catch it
    // here: any bot that's dead but hasn't had its drops rolled yet
    // (bulletHit already marks dropsSpawned when it handles the kill
    // itself) gets its items dropped where it died.
    for (const bot of bots) {
      if (!bot.alive && !bot.dropsSpawned) {
        bot.dropsSpawned = true;
        const drops = spawnItemsOnBotDeath(bot.spawnItem, bot.x, bot.y);
        for (const drop of drops) itemDrops.push(drop);
        // Separate roll from a separate field — see spawnGoldOrb on
        // BOT_TYPES in bot.js.
        const goldDrops = spawnItemsOnBotDeath(bot.spawnGoldOrb, bot.x, bot.y);
        for (const drop of goldDrops) itemDrops.push(drop);
      }
      if (!bot.alive && !bot.expAwarded && typeof addCharacterExp === "function") {
        bot.expAwarded = true;
        const expResult = addCharacterExp(player, bot.expGet || 0);
        // HEALTH GROWTH — same +10% per level as the direct-bullet-kill
        // path above, for bots that died from a burn/status tick instead.
        if (expResult.leveledUp) {
          applyLevelHealthGrowth(expResult.levelsGained);
        }
        // Same mirror-to-localStorage as the direct-bullet-kill path
        // above, for bots that died from a burn/status tick instead.
        if (typeof persistCharacterProgress === "function") {
          persistCharacterProgress(
            player.name, player.level, player.exp, player.statPoints,
            player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
          );
        }
        if (expResult.leveledUp && typeof showHubToast === "function") {
          showHubToast("Level Up! Now level " + player.level);
        }
      }
    }

    // ITEM PICKUPS (offline mode only) — see item.js
    updateItemDrops(itemDrops, dt);

    if (!isDead) {
      checkItemPickup(itemDrops, player, playerPos);
    }

    updateActiveEffects(player);
    healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  }
}

function drawJoystick(centerX, centerY, vector, color) {
  const baseRadius = JOYSTICK_RADIUS;
  const stickRadius = 20;

  // Inner background — image/circlehud.png, filling the area inside the
  // ring. Falls back to the old plain white fill if not loaded yet.
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  if (joystickHudImage.complete && joystickHudImage.naturalWidth > 0) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(
      joystickHudImage,
      centerX - baseRadius, centerY - baseRadius,
      baseRadius * 2, baseRadius * 2
    );
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
  }

  // Outer ring — image/circleline.png, stretched to frame the base circle.
  // Falls back to the old plain white stroke if the image hasn't loaded.
  if (joystickOuterlineImage.complete && joystickOuterlineImage.naturalWidth > 0) {
    ctx.drawImage(
      joystickOuterlineImage,
      centerX - baseRadius, centerY - baseRadius,
      baseRadius * 2, baseRadius * 2
    );
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const dx = vector.x * baseRadius;
  const dy = vector.y * baseRadius;
  const stickX = centerX + dx;
  const stickY = centerY + dy;

  // The moving stick — image/controlcircle.png, rotated to point in the
  // current direction (vector). Falls back to a plain colored dot.
  if (joystickControlImage.complete && joystickControlImage.naturalWidth > 0) {
    const stickAngle = Math.atan2(vector.y, vector.x);
    ctx.save();
    ctx.translate(stickX, stickY);
    ctx.rotate(stickAngle);
    ctx.drawImage(
      joystickControlImage,
      -stickRadius, -stickRadius,
      stickRadius * 2, stickRadius * 2
    );
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(stickX, stickY, stickRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Save context for camera/zoom
  ctx.save();

  // Center of screen in pixels
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Move origin to screen center
  ctx.translate(centerX, centerY);

  // Apply zoom
  ctx.scale(cameraZoom, cameraZoom);

  // Now draw world so that player is at (0,0) in this transformed space
  const worldOffsetX = -playerPos.x;
  const worldOffsetY = -playerPos.y;

  // World background (map changes per level)
  ctx.drawImage(currentMapImage, worldOffsetX, worldOffsetY, WORLD_SIZE_X, WORLD_SIZE_Y);
  
    // Draw obstacles
  for (const obs of obstacles) {
    if (currentObstacleColor) {
      // Plain flat-color wall (no texture) - just the collision box itself
      ctx.fillStyle = currentObstacleColor;
      ctx.fillRect(
        worldOffsetX + obs.x,
        worldOffsetY + obs.y,
        obs.width,
        obs.height
      );
    } else if (currentObstacleImage.loaded) {
      ctx.drawImage(
        currentObstacleImage,
        worldOffsetX + obs.x,
        worldOffsetY + obs.y,
        obs.width,
        obs.height
      );
    } else {
      // Fallback: draw brown box
      ctx.fillStyle = "#8B4513";
      ctx.fillRect(
        worldOffsetX + obs.x,
        worldOffsetY + obs.y,
        obs.width,
        obs.height
      );
    }
  }

  // World border
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.strokeRect(worldOffsetX, worldOffsetY, WORLD_SIZE_X, WORLD_SIZE_Y);

  // Player
  if (!isDead && imageLoaded) {
    const imgSize = playerPos.radius * 2;

    ctx.save();

    ctx.drawImage(
      playerImage,
      -imgSize / 2,
      -imgSize / 2,
      imgSize,
      imgSize
    );

    ctx.restore();

    // Level tag — short "Lv X", drawn just above the player's own
    // sprite (same treatment bot.js gives every enemy bot).
    ctx.save();
    ctx.font = "9px 'Courier New', Courier, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe066";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3;
    ctx.fillText("Lv " + (player.level || 1), 0, -playerPos.radius - 13);
    ctx.restore();

    // WEAPON UPGRADE AURA — colored glow tiered by player.weapon.upgradeLevel
    if (typeof drawWeaponUpgradeAura === "function") {
      drawWeaponUpgradeAura(ctx, playerPos.radius, player.weapon && player.weapon.upgradeLevel);
    }

    // SHIELD DOME — gold glowing bubble shown while player.shield > 0
    if (gameMode === "offline") {
      drawShieldEffect(ctx, playerPos.radius, player.shield, ITEM_TYPES.shield.shieldHitpoints);
    }

    // GUN AIM POINTER / LASER
    const aim = input.shootVector;
    const aimLength = Math.hypot(aim.x, aim.y);

    if (aimLength > JOYSTICK_DEADZONE && Math.floor(laserBlinkTime * 20) % 2 === 0) {
      const dirX = aim.x / aimLength;
      const dirY = aim.y / aimLength;

      ctx.save();
      ctx.shadowColor = "red";
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.moveTo(dirX * 12, dirY * 12);
      ctx.lineTo(dirX * 100, dirY * 100);

      ctx.strokeStyle = "rgba(255,0,0,0.9)";
      ctx.lineWidth = 0.5;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.restore();
    }

    // NOTE: the old "MORTAR AIM UI" maxRange/radius ring preview that used
    // to draw here while the right stick was held has been removed — the
    // stick now only sets the player's melee attack direction (see
    // fireBullet() -> performPlayerMeleeAttack() and attackmode.js), and
    // "ground"-type skills (barrage) are aimed by tapping the map instead
    // (see handleTouchStart()), so neither needs a maxRange/radius preview
    // tied to this stick anymore. The laser direction pointer above still
    // shows which way the next attack will fire.

    // PLAYER HEALTH BAR — border/fill/backdrop images loaded in effect.js
    // (see HEALTH BAR ART there); healthborder.png frames it, healthhud.png
    // is the green current-health fill, healthempty.png shows through the
    // portion that's been lost.
    const hpPercent = Math.max(0, player.currentHealth / player.health);

    drawImageHealthBar(
      ctx,
      -20, -playerPos.radius - 10, 40, 5,
      hpPercent,
      healthBorderImage, healthHudImage, healthEmptyImage
    );

    // SHIELD BAR — gold, shown just under the health bar while shield > 0
    if (gameMode === "offline") {
      drawShieldBar(ctx, -20, -playerPos.radius - 3, 40, player.shield, ITEM_TYPES.shield.shieldHitpoints);
    }

    // Active item-effect icons (speedup / powerup) — see item.js
    if (gameMode === "offline") {
      drawActiveEffectIcons(ctx, player, 0, -playerPos.radius - 32);
    }
  } else {
    ctx.fillStyle = "#4af";
    ctx.beginPath();
    ctx.arc(0, 0, playerPos.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ATTACK DIRECTION ARROW — image/arrowp.png, right analog stick
  // (input.shootVector). Shown only while the player is actively
  // shooting/attacking (input.isShooting, right stick past deadzone),
  // rotated to point the way the attack is aimed, just outside the
  // player's own circle/sprite.
  if (!isDead && input.isShooting) {
    const aimDir = input.shootVector;
    const aimLen = Math.hypot(aimDir.x, aimDir.y);

    if (aimLen > JOYSTICK_DEADZONE && playerArrowImage.complete && playerArrowImage.naturalWidth > 0) {
      const aimAngle = Math.atan2(aimDir.y, aimDir.x);
      const arrowSize = Math.max(16, playerPos.radius);
      const arrowDist = playerPos.radius + 6 + arrowSize / 2;

      ctx.save();
      ctx.rotate(aimAngle);
      ctx.translate(arrowDist, 0);
      // arrowp.png is drawn pointing right (angle 0) by default; rotate an
      // extra 90deg here only if the source art actually points up instead.
      ctx.drawImage(playerArrowImage, -arrowSize / 2, -arrowSize / 2, arrowSize, arrowSize);
      ctx.restore();
    }
  }

  // Bullets — drawn using each bullet's projectile image (see
  // projectile.js), not a hardcoded shape/color.
  for (const b of bullets) {
    const proj = getProjectile(b.projectile);
    if (!proj) continue;

    const img = getProjectileImage(proj.image);
    if (!img.loaded) continue;

    const angle = Math.atan2(b.vy, b.vx);

    ctx.save();
    ctx.translate(
      worldOffsetX + b.x,
      worldOffsetY + b.y
    );
    ctx.rotate(angle);

    ctx.drawImage(
      img,
      -proj.width / 2,
      -proj.height / 2,
      proj.width,
      proj.height
    );

    ctx.restore();
  }

  // Enemies
  ctx.fillStyle = "#f44";
  for (const e of enemies) {
    ctx.beginPath();
    ctx.arc(worldOffsetX + e.x, worldOffsetY + e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemy bots (offline mode only)
  if (gameMode === "offline") {
    drawBots(ctx, bots, worldOffsetX, worldOffsetY);
    drawItemDrops(ctx, itemDrops, worldOffsetX, worldOffsetY);
  }

  // Draw other players
  for (const [id, p] of otherPlayers) {
    const imgSize = playerPos.radius * 2;

    if (imageLoaded) {
      ctx.drawImage(
        playerImage,
        worldOffsetX + p.x - imgSize / 2,
        worldOffsetY + p.y - imgSize / 2,
        imgSize,
        imgSize
      );
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(
        worldOffsetX + p.x,
        worldOffsetY + p.y,
        playerPos.radius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // OTHER PLAYER HEALTH BAR — same player-palette images as above.
    const hp = Math.max(0, Math.min(100, p.health || 100));
    const barWidth = 30;
    const barHeight = 4;
    const barX = worldOffsetX + p.x - barWidth / 2;
    const barY = worldOffsetY + p.y - playerPos.radius - 10;

    drawImageHealthBar(
      ctx,
      barX, barY, barWidth, barHeight,
      hp / 100,
      healthBorderImage, healthHudImage, healthEmptyImage
    );
  }

  // Boss (online mode coop fight — see server.js)
  if (gameMode === "online" && boss && boss.alive) {
    ctx.save();
    ctx.fillStyle = "#a11";
    ctx.beginPath();
    ctx.arc(worldOffsetX + boss.x, worldOffsetY + boss.y, BOSS_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#500";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("BOSS", worldOffsetX + boss.x, worldOffsetY + boss.y + 5);
    ctx.restore();

    // In-world health bar above the boss (mirrors the top-screen bar,
    // which index.html keeps in sync via window.onBossHealthUpdate)
    const bw = 140, bh = 10;
    const bx = worldOffsetX + boss.x - bw / 2;
    const by = worldOffsetY + boss.y - BOSS_RADIUS - 24;
    ctx.fillStyle = "#300";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#e33";
    ctx.fillRect(bx, by, bw * Math.max(0, boss.health / boss.maxHealth), bh);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(bx, by, bw, bh);
  }

  // HIT EFFECTS — drawn last (still in world space) so fire/electric/ice
  // animations render on top of enemies, bots, and other players instead
  // of getting painted over by their sprites.
  drawHitEffects(ctx, worldOffsetX, worldOffsetY);

  // DAMAGE NUMBERS — drawn after hit effects so "-123" popups float on
  // top of everything, including any fire/electric/ice animation
  // currently playing on the same bot. See number.js.
  if (typeof drawDamageNumbers === "function") drawDamageNumbers(ctx, worldOffsetX, worldOffsetY);

  // Restore context so UI/joysticks are drawn in screen space
  ctx.restore();

  // Joysticks
  if (input.moveTouchId !== null) {
    drawJoystick(leftAnalogCenter.x, leftAnalogCenter.y, input.moveVector, "rgba(68,170,255,0.9)");
  } else {
    drawJoystick(leftAnalogCenter.x, leftAnalogCenter.y, { x: 0, y: 0 }, "rgba(68,170,255,0.35)");
  }

  if (input.shootTouchId !== null) {
    drawJoystick(rightAnalogCenter.x, rightAnalogCenter.y, input.shootVector, "rgba(255,80,80,0.9)");
  } else {
    drawJoystick(rightAnalogCenter.x, rightAnalogCenter.y, { x: 0, y: 0 }, "rgba(255,80,80,0.35)");
  }
}

function loop(now) {
  if (!gameStarted) return; // safety

  if (isPaused) {
    lastTime = now; // avoid a big dt jump when resuming
    requestAnimationFrame(loop);
    return;
  }

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  // SAFETY NET — update()/draw() used to run unguarded, so a single
  // uncaught exception on any one frame (e.g. a bad interaction between
  // the skill burst and a normal shot landing at the same time) would
  // throw BEFORE the requestAnimationFrame(loop) call below ever ran —
  // silently killing the whole animation loop for good. Everything else
  // (SAVE/EXIT/PAUSE) has its own click handlers unrelated to this loop,
  // so those kept working while the game world just froze on its last
  // drawn frame — exactly the "stuck" symptom this guards against.
  // Catching here means a bad frame gets skipped and logged instead of
  // freezing the game permanently, and showDebugError() surfaces the
  // actual error on-screen so it can be reported/fixed.
  try {
    update(dt);
    draw();
  } catch (err) {
    console.error("Frame error (game kept running):", err);
    if (typeof showDebugError === "function") showDebugError(err);
  }

  requestAnimationFrame(loop);
}

// Do NOT start immediately; wait for menu choice
// requestAnimationFrame(loop);

// Toggle pause/resume for the current match. Returns the new paused state.
window.togglePauseGame = function() {
  if (!gameStarted) return false;
  isPaused = !isPaused;
  return isPaused;
};

// ---------------------------------------------------------------------
// GAMEPLAY STATE SNAPSHOT — lets Save Game / Load Game (index.html)
// resume the exact scene the player was in (position, which bots are
// alive and their health, ground item drops) instead of just dropping
// them back at the level's spawn point. Only plain, JSON-safe data is
// captured here — bots/items still get created fresh by
// startGameOffline()/spawnBotsForLevel() first (with their own
// images/weapons/AI state), and applyGameplayState() just overwrites
// their position/health/alive on top of that, matched by array index
// since the same level always spawns the same bots in the same order.
// ---------------------------------------------------------------------
window.captureGameplayState = function() {
  if (!gameStarted) return null;
  return {
    playerX: playerPos.x,
    playerY: playerPos.y,
    playerHealth: player.currentHealth,
    bots: bots.map((b) => ({ x: b.x, y: b.y, health: b.health, alive: b.alive })),
    // Weapons/armor/upgrades carry an Image object (not JSON-safe), so
    // only type+position is saved; createItemDrop() (item.js) rebuilds
    // the rest fresh on restore, same as when a bot first drops it.
    itemDrops: itemDrops.map((d) => ({ type: d.type, x: d.x, y: d.y }))
  };
};

window.applyGameplayState = function(state) {
  if (!state) return;

  if (typeof state.playerX === "number") playerPos.x = state.playerX;
  if (typeof state.playerY === "number") playerPos.y = state.playerY;

  if (typeof state.playerHealth === "number") {
    player.currentHealth = state.playerHealth;
    if (typeof healthDisplay !== "undefined" && healthDisplay) {
      healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
    }
  }

  if (Array.isArray(state.bots)) {
    state.bots.forEach((saved, i) => {
      const b = bots[i];
      if (!b || !saved) return;
      b.x = saved.x;
      b.y = saved.y;
      b.health = saved.health;
      b.alive = saved.alive;
    });
  }

  if (Array.isArray(state.itemDrops) && typeof createItemDrop === "function") {
    itemDrops.length = 0;
    for (const drop of state.itemDrops) {
      try {
        itemDrops.push(createItemDrop(drop.type, drop.x, drop.y));
      } catch (e) {
        console.error("Failed to restore item drop:", drop, e);
      }
    }
  }
};

// Fully stop the current match and hand control back to the level
// select screen (called from the in-game EXIT button)
window.exitOfflineGame = function() {
  gameStarted = false;
  isPaused = false;
  hideBotStatsPopup();

  // NOTE: menu music for whichever screen this lands on (see index.html's
  // exitGameBtn handler, which shows the level select / Choose Map screen)
  // is started explicitly there, right after this call — not here, since
  // this function doesn't know which screen the player is being sent back
  // to.

  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  obstacles.length = 0;
};

// Called from index.html when Offline is clicked
// level: 1 = 700x700, 2 = 1000x400, etc.
// characterName: "police" | "soldier" | "swat" (falls back to "soldier" if omitted)
window.startGameOffline = function(level, characterName) {
  if (gameStarted) return;
  gameStarted = true;
  isPaused = false;
  hideBotStatsPopup();
  gameMode = "offline";

  // Don't play the menu's background music (music/intro.mp3, see
  // index.html) during actual gameplay — silence it here and bring it
  // back in exitOfflineGame() once the player returns to the menu.
  if (typeof window.pauseBackgroundMusic === "function") {
    window.pauseBackgroundMusic();
  }

  // Clear obstacles
  obstacles.length = 0;

  // Load level settings from level.js (falls back to level 1 if unknown).
  // Map Maker (index.html) passes a fully-built level object directly
  // instead of a level.js number — use it as-is when that happens.
  let levelData;
  if (level && typeof level === "object") {
    levelData = level;
  } else {
    try {
      levelData = getLevel(level);
    } catch (e) {
      levelData = getLevel(1);
    }
  }

  // Set world size and map based on level data
  WORLD_SIZE_X = levelData.worldWidth;
  WORLD_SIZE_Y = levelData.worldHeight;
  currentMapImage = getMapImage(levelData.mapImage);
  currentObstacleColor = levelData.obstacleColor || null;
  currentObstacleImage = getObstacleImage(levelData.obstacleImage || "image/woodbox.png");

  // Add this level's obstacles
  for (const obs of levelData.obstacles) {
    obstacles.push(obs);
  }

  // Load this level's respawn points (falls back to world-center if none)
  currentSpawnPoints = levelData.spawnPoints;

  // Place player at one of the level's spawn points, picked at random
  const startSpawn = getRandomSpawnPoint();
  playerPos.x = startSpawn.x;
  playerPos.y = startSpawn.y;

  // Spawn this level's enemy bots (random spots, kept away from the
  // player's spawn point according to each bot's own view range)
  bots.length = 0;
  try {
    const spawnedBots = spawnBotsForLevel(levelData, startSpawn, obstacles);
    for (const b of spawnedBots) bots.push(b);
  } catch (e) {
    console.error("Failed to spawn enemy bots:", e);
  }

  // Clear leftover item drops/effects from any previous run (see item.js)
  itemDrops.length = 0;
  resetPlayerItemState(player);

  // In offline mode, we don't need WebSocket
  if (ws) {
    try { ws.close(); } catch (e) {}
  }
  isOnline = false;

  // Force reload offline character stats from character.js, using
  // whichever character was chosen on the character-select screen
  const offlineChar = getCharacter(characterName || "soldier");
  player.name = characterName || "soldier";

  // LEVEL / EXP — restore this character's persisted progress (see
  // persistCharacterProgress()/getCharacterProgress() in index.html) so
  // returning to a match keeps whatever level/exp was earned in earlier
  // matches (or loaded from a save slot) instead of resetting to level 1
  // every time a match starts. Falls back to the character's own
  // starting level/exp (offlineChar, from character.js) the first time
  // this character is ever played.
  const savedProgress = (typeof getCharacterProgress === "function")
    ? getCharacterProgress(player.name)
    : null;
  player.level = savedProgress ? savedProgress.level : offlineChar.level;
  // MAX LEVEL — clamp here too (not just in getCharacter()'s own
  // offlineChar path) in case a saved slot/localStorage entry predates
  // the cap or was hand-edited past it.
  if (typeof MAX_LEVEL === "number" && player.level > MAX_LEVEL) {
    player.level = MAX_LEVEL;
  }
  player.exp = savedProgress ? savedProgress.exp : offlineChar.exp;
  player.maxExp = (typeof getExpForLevel === "function")
    ? getExpForLevel(player.level)
    : offlineChar.maxExp;
  // True base max health, with NO armor bonus baked in -- CHARACTERS[...]
  // holds the character's raw level-1 stat; getHealthForLevel() (character.js)
  // scales that up 10% per level for player.level (just restored above),
  // same compounding curve getCharacter() itself uses. getCharacter() above
  // additionally bakes the starting armor's health bonus on top, which we
  // don't want here since that bonus is meant to come from the Armor slot,
  // dynamically. applyEquippedArmorToPlayer() (called right after
  // startGameOffline() returns, alongside the armor value) adds back
  // whatever's actually equipped on top of this baseline, the same way it
  // now handles armor.
  player.baseMaxHealth = (typeof getBaseMaxHealthForLevel === "function")
    ? getBaseMaxHealthForLevel(player.name, player.level)
    : offlineChar.baseHealth;
  player.health = player.baseMaxHealth;
  player.currentHealth = player.baseMaxHealth;
  player.movementSpeed = offlineChar.movementSpeed;
const rawCharacter = (typeof CHARACTERS !== "undefined" && CHARACTERS[player.name])
  ? CHARACTERS[player.name]
  : offlineChar;

player.baseStatValues = {};

const nonEquipmentStats = new Set([
  "health",
  "currentHealth",
  "armor",
  "radius",
  "cameraZoom",
  "level",
  "exp",
  "maxExp",
  "lastShotTime",
  "reloadFinishTime"
]);

for (const [stat, value] of Object.entries(rawCharacter || {})) {
  if (nonEquipmentStats.has(stat)) continue;

  if (typeof value === "number" && Number.isFinite(value)) {
    player.baseStatValues[stat] = value;
    player[stat] = value;
  }
}
  // COMBAT STATS — force-refresh every stat getCharacter() (offlineChar,
  // above) just computed from character.js/attributes, the same way
  // baseMaxHealth/movementSpeed just above already do. Without this,
  // `player` (a single object created once at page load — see the
  // top-level `const player = ...` near the top of this file) keeps
  // carrying whatever stats it had from the LAST character played (or
  // its original page-load default), so switching characters — or just
  // editing a stat in character.js and starting a new match — silently
  // had no effect on damage/crit/mana/etc. physicalDefense is the one
  // exception: it's read from getBasePhysicalDefense() instead of
  // offlineChar.physicalDefense, since offlineChar's version already has
  // this character's starting armor baked in (see getCharacter()'s
  // ARMOR block in character.js) and the Armor slot adds that same
  // bonus back separately via player.armor (applyEquippedArmorToPlayer()
  // in index.html) — using offlineChar's value here would double-count it.
  // physicalDamage has the exact same problem when an armor def carries
  // a physicalDamage field (e.g. armor1): offlineChar.physicalDamage
  // already has that baked in via getCharacter()'s ARMOR block, and
  // applyEquippedArmorToPlayer() adds it again from the Armor slot — so
  // read the no-armor baseline from getBasePhysicalDamage() here too,
  // for the same reason and the same fix as physicalDefense above.
  // COMBAT STATS
// Start with CHARACTER BASE stats only.
// Armor is applied separately by applyEquippedArmorToPlayer().
// This prevents armor bonuses from being added twice.

const baseVit = typeof rawCharacter.vit === "number"
  ? rawCharacter.vit
  : 0;

const baseDex = typeof rawCharacter.dex === "number"
  ? rawCharacter.dex
  : 0;

const baseInt = typeof rawCharacter.int === "number"
  ? rawCharacter.int
  : 0;

const basePow = typeof rawCharacter.pow === "number"
  ? rawCharacter.pow
  : 0;

// Physical Damage — character base only
player.physicalDamage =
  typeof getBasePhysicalDamage === "function"
    ? getBasePhysicalDamage(player.name)
    : (rawCharacter.physicalDamage || 0) + basePow;

// Physical Defense — character base only
player.physicalDefense =
  typeof getBasePhysicalDefense === "function"
    ? getBasePhysicalDefense(player.name)
    : (rawCharacter.physicalDefense || 0)
      + (baseVit * 0.25)
      + (baseDex * 0.5);

// Critical
player.criticalChance =
  rawCharacter.criticalChance || 0;

player.criticalDamage =
  (rawCharacter.criticalDamage || 0)
  + (baseDex * 0.35);

// Magic
player.magicalAttack =
  (rawCharacter.magicalAttack || 0)
  + baseInt;

player.magicalDefense =
  (rawCharacter.magicalDefense || 0)
  + (baseInt * 0.5);

// Mana
player.mana =
  (rawCharacter.mana || 0)
  + (baseInt * 2);

player.currentMana = player.mana;

// Other stats
player.attackSpeed =
  rawCharacter.attackSpeed || 1;

player.hpRegen =
  rawCharacter.hpRegen || 0;

player.manaRegen =
  rawCharacter.manaRegen || 0;

// BASE ATTRIBUTES — armor NOT included
player.vit = baseVit;
player.dex = baseDex;
player.int = baseInt;
player.pow = basePow;

player.attack =
  rawCharacter.attack || "melee";
  player.lastAttackTime = 0;
  player._hpRegenAcc = 0;
  player._manaRegenAcc = 0;
  // Clear any leftover skill-2 speed boost from a previous match so it
  // doesn't carry over (or get reverted to a stale base speed) here.
  player.speedBoostEndTime = null;
  player.speedBoostBaseSpeed = null;
  // Armor is no longer a separate character stat added to whatever's
  // equipped -- the Armor slot is the only source of it. This just
  // zeroes it out for the moment; index.html calls
  // applyEquippedArmorToPlayer() right after startGameOffline() returns,
  // which sets the real value from whatever's actually sitting in the
  // slot (typically this character's starting armor piece).
  player.armor = 0;
  // Also clear any armor-gear delta (vit/dex/int/pow/etc bonus) tracked
  // from a PREVIOUS match -- player.vit/dex/int/pow/etc were just
  // force-refreshed from offlineChar above, so a leftover delta here
  // would get wrongly subtracted from this match's fresh stats the next
  // time applyEquippedArmorToPlayer() runs (see index.html).
  player._armorGearDelta = null;
  // Same reasoning, for the weapon slot -- player.vit/dex/int/pow/etc
  // were just force-refreshed from offlineChar above, so a leftover
  // weapon delta from a PREVIOUS match would get wrongly subtracted from
  // this match's fresh stats by attachWeaponToCharacter() just below.
  player._weaponGearDelta = null;
  player.image = offlineChar.image;
  player.weaponName = offlineChar.weaponName;
  player.cameraZoom = offlineChar.cameraZoom;
  player.radius = offlineChar.radius;
  playerPos.radius = player.radius || 12;
  cameraZoom = player.cameraZoom || 2;

  // Force reload offline weapon from weapon.js, now that weaponName
  // matches the chosen character
  attachWeaponToCharacter(player);

  // Keep the weapon-switch UI (prev/next buttons) in sync with the
  // chosen character's starting weapon
  currentWeaponIndex = weaponList.indexOf(player.weaponName);
  if (currentWeaponIndex < 0) currentWeaponIndex = 0;

  // Swap the on-screen sprite to match the chosen character
  if (playerImage.src.indexOf(player.image) === -1) {
    imageLoaded = false;
    playerImage.src = player.image;
  }

  // Update UI
  healthDisplay.textContent = player.currentHealth;
  armorDisplay.textContent = Math.round(((player.physicalDefense || 0) + (player.armor || 0)) * 100) / 100;
  updateWeaponDisplay();
  updateAmmoDisplay();

  // Start the loop
  lastTime = performance.now();
  requestAnimationFrame(loop);
};

// Fully leaves the current online room/fight and hands control back to
// the Online hub screen (called from the in-game EXIT button when
// gameMode is "online" — see index.html's exitGameBtn handler). Unlike
// exitOfflineGame(), this does NOT close the websocket, since the player
// stays connected and can create/join another room right away.
window.exitOnlineGame = function() {
  gameStarted = false;
  isPaused = false;
  hideBotStatsPopup();

  sendWhenReady({ type: "leaveRoom" });
  roomCode = null;
  isRoomHost = false;
  roomSlots = [];
  boss = null;
  otherPlayers.clear();
  bullets.length = 0;
  obstacles.length = 0;
};

// Called once the room's host starts the fight (bossStart broadcast —
// see window.onBossStart in index.html). Sets up a shared arena and
// drops the player into it as a coop shooter facing the room's boss.
// characterName: "police" | "soldier" | "swat" (falls back to "soldier")
window.startGameOnline = function(characterName) {
  if (gameStarted) return;
  gameStarted = true;
  isPaused = false;
  hideBotStatsPopup();
  gameMode = "online";
  isOnline = true;

  if (typeof window.pauseBackgroundMusic === "function") {
    window.pauseBackgroundMusic();
  }

  // Shared arena — a plain, obstacle-free box (Level 1's dimensions from
  // level.js) works well for a coop boss fight since every player needs
  // clean line of sight to the boss.
  obstacles.length = 0;
  let levelData;
  try {
    levelData = getLevel(1);
  } catch (e) {
    levelData = { worldWidth: 700, worldHeight: 700, mapImage: null };
  }
  WORLD_SIZE_X = levelData.worldWidth;
  WORLD_SIZE_Y = levelData.worldHeight;
  currentMapImage = getMapImage(levelData.mapImage);
  currentObstacleColor = levelData.obstacleColor || null;
  currentObstacleImage = getObstacleImage(levelData.obstacleImage || "image/woodbox.png");

  // The boss always spawns in the middle of the arena (server sends a
  // placeholder x:0,y:0 since it doesn't know the client's world size).
  if (boss) {
    boss.x = WORLD_SIZE_X / 2;
    boss.y = WORLD_SIZE_Y / 2;
  }

  // Spawn the local player somewhere away from the boss, near an edge.
  playerPos.x = WORLD_SIZE_X / 2;
  playerPos.y = Math.max(40, WORLD_SIZE_Y * 0.15);

  bullets.length = 0;
  itemDrops.length = 0;
  otherPlayers.clear();
  resetPlayerItemState(player);

  // Load this character's base stats from character.js, same as offline
  // (progression/leveling still applies — coop kills grant no exp yet,
  // but the character's saved level/gear carries in).
  const onlineChar = getCharacter(characterName || "soldier");
  player.name = characterName || "soldier";

  const savedProgress = (typeof getCharacterProgress === "function")
    ? getCharacterProgress(player.name)
    : null;
  player.level = savedProgress ? savedProgress.level : onlineChar.level;
  if (typeof MAX_LEVEL === "number" && player.level > MAX_LEVEL) {
    player.level = MAX_LEVEL;
  }
  player.exp = savedProgress ? savedProgress.exp : onlineChar.exp;
  player.maxExp = (typeof getExpForLevel === "function")
    ? getExpForLevel(player.level)
    : onlineChar.maxExp;

  player.baseMaxHealth = (typeof getBaseMaxHealthForLevel === "function")
    ? getBaseMaxHealthForLevel(player.name, player.level)
    : onlineChar.baseHealth;
  player.health = player.baseMaxHealth;
  player.currentHealth = player.baseMaxHealth;
  player.movementSpeed = onlineChar.movementSpeed;

  // COMBAT STATS — same force-refresh as startOfflineGame() above, and
  // for the same reason: `player` is a single long-lived object, so
  // every stat getCharacter() (onlineChar) just computed needs to be
  // copied over explicitly or a character switch / character.js edit
  // silently has no effect. See startOfflineGame()'s version of this
  // block for why physicalDefense specifically uses
  // getBasePhysicalDefense() instead of onlineChar.physicalDefense. Same
  // fix applies to physicalDamage now too — see startOfflineGame()'s
  // version of this block for why.
  player.physicalDamage = (typeof getBasePhysicalDamage === "function")
    ? getBasePhysicalDamage(player.name)
    : onlineChar.physicalDamage;
  player.physicalDefense = (typeof getBasePhysicalDefense === "function")
    ? getBasePhysicalDefense(player.name)
    : 0;
  player.criticalChance = onlineChar.criticalChance;
  player.criticalDamage = onlineChar.criticalDamage;
  player.magicalAttack = onlineChar.magicalAttack;
  player.magicalDefense = onlineChar.magicalDefense;
  player.mana = onlineChar.mana;
  player.currentMana = onlineChar.mana;
  player.attackSpeed = onlineChar.attackSpeed;
  player.hpRegen = onlineChar.hpRegen;
  player.manaRegen = onlineChar.manaRegen;
  player.vit = onlineChar.vit;
  player.dex = onlineChar.dex;
  player.int = onlineChar.int;
  player.pow = onlineChar.pow;

  // STAT POINTS — same restore as startGameOffline() above.
  player.statPoints = savedProgress ? (savedProgress.statPoints || 0) : 0;
  player.spentVit = savedProgress ? (savedProgress.spentVit || 0) : 0;
  player.spentDex = savedProgress ? (savedProgress.spentDex || 0) : 0;
  player.spentInt = savedProgress ? (savedProgress.spentInt || 0) : 0;
  player.spentPow = savedProgress ? (savedProgress.spentPow || 0) : 0;
  if ((player.spentVit || player.spentDex || player.spentInt || player.spentPow) &&
      typeof applyAttributeBonus === "function") {
    const beforeHealth = player.health || 0;
    applyAttributeBonus(player, player.spentVit, player.spentDex, player.spentInt, player.spentPow);
    // Keep baseMaxHealth (the no-armor baseline applyEquippedArmorToPlayer()
    // in index.html recomputes player.health FROM) in sync with this
    // vit-derived health too, same reason as spendGameInvStatPoint()'s
    // own baseMaxHealth update in index.html.
    player.baseMaxHealth = (player.baseMaxHealth || 0) + ((player.health || 0) - beforeHealth);
    player.currentHealth = player.health;
    player.currentMana = player.mana;
  }

  player.attack = onlineChar.attack;
  player.lastAttackTime = 0;
  player._hpRegenAcc = 0;
  player._manaRegenAcc = 0;
  // Clear any leftover skill-2 speed boost from a previous match so it
  // doesn't carry over (or get reverted to a stale base speed) here.
  player.speedBoostEndTime = null;
  player.speedBoostBaseSpeed = null;
  player.armor = 0;
  // Same reasoning as startGameOffline() above -- clear any armor-gear
  // delta left from a previous match so it doesn't get wrongly
  // subtracted from this match's freshly-reset stats.
  player._armorGearDelta = null;
  // Same reasoning, for the weapon slot -- see startGameOffline() above.
  player._weaponGearDelta = null;
  player.image = onlineChar.image;
  player.weaponName = onlineChar.weaponName;
  player.cameraZoom = onlineChar.cameraZoom;
  player.radius = onlineChar.radius;
  playerPos.radius = player.radius || 12;
  cameraZoom = player.cameraZoom || 2;

  attachWeaponToCharacter(player);
  currentWeaponIndex = weaponList.indexOf(player.weaponName);
  if (currentWeaponIndex < 0) currentWeaponIndex = 0;

  if (playerImage.src.indexOf(player.image) === -1) {
    imageLoaded = false;
    playerImage.src = player.image;
  }

  healthDisplay.textContent = player.currentHealth;
  armorDisplay.textContent = Math.round(((player.physicalDefense || 0) + (player.armor || 0)) * 100) / 100;
  updateWeaponDisplay();
  updateAmmoDisplay();

  isDead = false;

  lastTime = performance.now();
  requestAnimationFrame(loop);
};