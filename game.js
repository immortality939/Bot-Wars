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

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Camera & zoom
const WORLD_SIZE = 700;      // 700 x 700 world
let cameraZoom = 2;        // zoom level: 1.0 = normal, >1 = zoomed in

// Fixed analog centers (will be set in resizeCanvas)
let leftAnalogCenter = { x: 0, y: 0 };
let rightAnalogCenter = { x: 0, y: 0 };

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Fixed positions for analogs (screen space)
  leftAnalogCenter = {
    x: canvas.width * 0.15,
    y: canvas.height * 0.6
  };
  rightAnalogCenter = {
    x: canvas.width * 0.85,
    y: canvas.height * 0.6
  };
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
const reloadBtn = document.getElementById("reloadBtn");

// Create player character
const player = attachWeaponToCharacter(getCharacter("player"));
healthDisplay.textContent = player.currentHealth;
armorDisplay.textContent = player.armor;
weaponDisplay.textContent = player.weaponName;
updateAmmoDisplay();

// Weapon switching
const weaponList = getAllWeapons(); // e.g. ["uzi","pistol","shotgun"]
let currentWeaponIndex = weaponList.indexOf(player.weaponName);
if (currentWeaponIndex < 0) currentWeaponIndex = 0;

function updateWeaponDisplay() {
  weaponDisplay.textContent = player.weaponName;
}

function updateAmmoDisplay() {
  const w = player.weapon;
  if (player.isReloading) {
    ammoDisplay.textContent = `${w.magazine} / ${w.maxMagazine} (R)`;
  } else {
    ammoDisplay.textContent = `${w.magazine} / ${w.maxMagazine}`;
  }
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

prevWeaponBtn.addEventListener("click", () => switchWeapon(-1));
nextWeaponBtn.addEventListener("click", () => switchWeapon(1));
reloadBtn.addEventListener("click", () => {
  tryReload();
});
reloadBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  tryReload();
});

// Game state
const bullets = [];
const enemies = [];
let lastTime = performance.now();
let enemySpawnTimer = 0;
const enemySpawnInterval = 1500; // ms

// Input state for dual analog sticks
const input = {
  moveVector: { x: 0, y: 0 },
  shootVector: { x: 0, y: 0 },
  isShooting: false,

  moveTouchId: null,
  shootTouchId: null
};

const JOYSTICK_RADIUS = 60;
const JOYSTICK_DEADZONE = 0.15;
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
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "init") {
      myId = msg.id;
    } else if (msg.type === "playerAdd") {
      otherPlayers.set(msg.player.id, {
        x: msg.player.x,
        y: msg.player.y,
        color: msg.player.color
      });
    } else if (msg.type === "playerMove") {
      const p = otherPlayers.get(msg.id);
      if (p) {
        p.x = msg.x;
        p.y = msg.y;
      }
    } else if (msg.type === "playerRemove") {
      otherPlayers.delete(msg.id);
    }
  };

  ws.onclose = () => {
    console.log("Disconnected from server");
  };

  ws.onerror = (err) => {
    console.error("WebSocket error", err);
  };
}

// Try to connect
connectToServer();
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
      input.shootTouchId = null;
      input.shootVector = { x: 0, y: 0 };
      input.isShooting = false;
    }
  }
}

function computeJoystickVector(touchX, touchY, centerX, centerY) {
  const dx = touchX - centerX;
  const dy = touchY - centerY;
  const dist = Math.hypot(dx, dy);
  const maxDist = JOYSTICK_RADIUS;

  if (dist === 0) return { x: 0, y: 0 };

  const clampedDist = Math.min(dist, maxDist);
  const angle = Math.atan2(dy, dx);
  const nx = Math.cos(angle) * (clampedDist / maxDist);
  const ny = Math.sin(angle) * (clampedDist / maxDist);

  const mag = Math.hypot(nx, ny);
  if (mag < JOYSTICK_DEADZONE) return { x: 0, y: 0 };

  return { x: nx, y: ny };
}

// Player position (inside 700x700 world)
const playerPos = {
  x: WORLD_SIZE / 2,
  y: WORLD_SIZE / 2,
  radius: 12
};

function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  const margin = 20;
  switch (side) {
    case 0: x = Math.random() * WORLD_SIZE; y = margin; break;
    case 1: x = WORLD_SIZE - margin; y = Math.random() * WORLD_SIZE; break;
    case 2: x = Math.random() * WORLD_SIZE; y = WORLD_SIZE - margin; break;
    case 3: x = margin; y = Math.random() * WORLD_SIZE; break;
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
  if (w.magazine >= w.maxMagazine) return;

  player.isReloading = true;
  player.reloadFinishTime = performance.now() + w.reloadTime;

  updateAmmoDisplay();
}

function finishReloadIfReady() {
  if (!player.isReloading) return;
  const now = performance.now();
  if (now >= player.reloadFinishTime) {
    player.weapon.magazine = player.weapon.maxMagazine;
    player.isReloading = false;
    updateAmmoDisplay();
  }
}

function fireBullet() {
  const now = performance.now();

  finishReloadIfReady();
  if (player.isReloading) return;

  const w = player.weapon;

  if (w.magazine <= 0) {
    tryReload();
    return;
  }

  const timeSinceLastShot = now - player.lastShotTime;
  const minInterval = 1000 / w.fireRate;
  if (timeSinceLastShot < minInterval) return;

  player.lastShotTime = now;
  w.magazine -= 1;
  updateAmmoDisplay();

  const dir = input.shootVector;
  const mag = Math.hypot(dir.x, dir.y);
  const shootDir = mag > JOYSTICK_DEADZONE
    ? { x: dir.x / mag, y: dir.y / mag }
    : { x: 1, y: 0 };

  if (w.pellets && w.pellets > 1) {
    const baseAngle = Math.atan2(shootDir.y, shootDir.x);
    const spread = w.spread || 0.2;
    const pellets = w.pellets;

    for (let i = 0; i < pellets; i++) {
      const t = pellets === 1 ? 0 : i / (pellets - 1);
      const angle = baseAngle - spread / 2 + t * spread;
      const vx = Math.cos(angle) * w.bulletSpeed;
      const vy = Math.sin(angle) * w.bulletSpeed;

      bullets.push({
        x: playerPos.x,
        y: playerPos.y,
        vx, vy,
        radius: 4,
        damage: w.damage
      });
    }
  } else {
    bullets.push({
      x: playerPos.x,
      y: playerPos.y,
      vx: shootDir.x * w.bulletSpeed,
      vy: shootDir.y * w.bulletSpeed,
      radius: 4,
      damage: w.damage
    });
  }
}

function update(dt) {
  finishReloadIfReady();

  const moveSpeed = player.movementSpeed;
  playerPos.x += input.moveVector.x * moveSpeed * dt;
  playerPos.y += input.moveVector.y * moveSpeed * dt;

  // Clamp player inside 700x700 world
  playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE - playerPos.radius, playerPos.x));
  playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE - playerPos.radius, playerPos.y));
// Send position to server (if connected)
if (ws && ws.readyState === WebSocket.OPEN && myId != null) {
  ws.send(JSON.stringify({
    type: "move",
    x: playerPos.x,
    y: playerPos.y
  }));
}
  if (input.isShooting) {
    fireBullet();
  }

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < 0 || b.x > WORLD_SIZE || b.y < 0 || b.y > WORLD_SIZE) {
      bullets.splice(i, 1);
      continue;
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const dx = b.x - e.x;
      const dy = b.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist < b.radius + e.radius) {
        e.health -= b.damage;
        bullets.splice(i, 1);
        if (e.health <= 0) enemies.splice(j, 1);
        break;
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
      const dmg = Math.max(1, 10 - player.armor);
      player.currentHealth -= dmg;
      healthDisplay.textContent = player.currentHealth;

      if (player.currentHealth <= 0) {
        player.currentHealth = player.health;
        healthDisplay.textContent = player.currentHealth;
        enemies.length = 0;
        bullets.length = 0;
        playerPos.x = WORLD_SIZE / 2;
        playerPos.y = WORLD_SIZE / 2;
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
}

function drawJoystick(centerX, centerY, vector, color) {
  const baseRadius = JOYSTICK_RADIUS;
  const stickRadius = 20;

  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const dx = vector.x * baseRadius;
  const dy = vector.y * baseRadius;
  const stickX = centerX + dx;
  const stickY = centerY + dy;

  ctx.beginPath();
  ctx.arc(stickX, stickY, stickRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
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
  // That means: world offset = (-playerPos.x, -playerPos.y)
  const worldOffsetX = -playerPos.x;
  const worldOffsetY = -playerPos.y;

  // World background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(worldOffsetX, worldOffsetY, WORLD_SIZE, WORLD_SIZE);

  // Grid
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x <= WORLD_SIZE; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(worldOffsetX + x, worldOffsetY);
    ctx.lineTo(worldOffsetX + x, worldOffsetY + WORLD_SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_SIZE; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(worldOffsetX, worldOffsetY + y);
    ctx.lineTo(worldOffsetX + WORLD_SIZE, worldOffsetY + y);
    ctx.stroke();
  }

  // World border
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.strokeRect(worldOffsetX, worldOffsetY, WORLD_SIZE, WORLD_SIZE);

  // Player (at origin now, because of the transform)
  ctx.fillStyle = "#4af";
  ctx.beginPath();
  ctx.arc(0, 0, playerPos.radius, 0, Math.PI * 2);
  ctx.fill();

  // Bullets
  ctx.fillStyle = "#ff6";
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(worldOffsetX + b.x, worldOffsetY + b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemies
  ctx.fillStyle = "#f44";
  for (const e of enemies) {
    ctx.beginPath();
    ctx.arc(worldOffsetX + e.x, worldOffsetY + e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Draw other players
  for (const [id, p] of otherPlayers) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(worldOffsetX + p.x, worldOffsetY + p.y, playerPos.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Restore context so UI/joysticks are drawn in screen space
  ctx.restore();
  // Restore context so UI/joysticks are in screen space
  ctx.restore();

  // Joysticks (screen space, not affected by camera/zoom)
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
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);