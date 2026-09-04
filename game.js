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

// Load map image
const mapImage = new Image();
mapImage.src = "map.jpg";
let mapLoaded = false;
mapImage.onload = () => {
  mapLoaded = true;
};

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
    x: canvas.width * 0.10,
    y: canvas.height * 0.7
  };
  rightAnalogCenter = {
    x: canvas.width * 0.90,
    y: canvas.height * 0.7
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
cameraZoom = player.cameraZoom || 2;

// Load player image
const playerImage = new Image();
playerImage.src = player.image || "soldier.png";
let imageLoaded = false;
playerImage.onload = () => {
  imageLoaded = true;
};

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
let laserBlinkTime = 0;
const enemies = [];
const muzzleFlashes = []; // <-- new
let isOnline = false;
let onlineWeapons = null; // will hold server weapon config when online
let lastTime = performance.now();
let enemySpawnTimer = 0;
const enemySpawnInterval = 999999999; // ms (basically never spawn)

// Load muzzle flash sprite sheet
const muzzleImage = new Image();
muzzleImage.src = "muzzleflash.png";
let muzzleImageLoaded = false;
muzzleImage.onload = () => {
  muzzleImageLoaded = true;
};

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
    const p = otherPlayers.get(msg.id);
    if (p) {
      p.x = msg.x;
      p.y = msg.y;
      if (msg.health !== undefined) {
        p.health = msg.health;
      }
    }
  } else if (msg.type === "playerRemove") {
    otherPlayers.delete(msg.id);
  } else if (msg.type === "shootSound") {
    if (msg.ownerId !== myId) {
      const audio = new Audio(msg.sound);
      audio.volume = 1.0;
      audio.play().catch(err => {
        console.log("Sound error:", err);
      });
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
        ownerId: msg.ownerId
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
    bullets.length = 0;

    if (msg.id === myId) {
      player.currentHealth = 100;
      healthDisplay.textContent = player.currentHealth;
      playerPos.x = WORLD_SIZE / 2;
      playerPos.y = WORLD_SIZE / 2;
    }
  } else if (msg.type === "muzzleFlash") {
    if (msg.ownerId !== myId) {
      // Spawn muzzle flash for other player
      muzzleFlashes.push({
        x: msg.x,
        y: msg.y,
        dirX: msg.dirX,
        dirY: msg.dirY,
        life: 0.15,
        frameTime: 0,
        currentFrame: 0,
        config: {
          frameWidth: 268,
          frameHeight: 140,
          numFrames: 3,
          fps: 25,
          width: 20,
          height: 20,
          scale: 1
        }
      });
    }
  } else if (msg.type === "weaponConfig") {
    // Server sends full weapon data for online play
    onlineWeapons = msg.weapons;

    // Re-attach weapon using server config
    if (onlineWeapons && onlineWeapons[player.weaponName]) {
      player.weapon = onlineWeapons[player.weaponName];
      updateWeaponDisplay();
      updateAmmoDisplay();
    }
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

  // Use online weapon stats if playing online
  const w = (isOnline && onlineWeapons && onlineWeapons[player.weaponName])
    ? onlineWeapons[player.weaponName]
    : player.weapon;

  if (w.magazine <= 0) {
    tryReload();
    return;
  }

  const timeSinceLastShot = now - player.lastShotTime;
  const minInterval = 1000 / w.fireRate;

  if (timeSinceLastShot < minInterval) return;

  player.lastShotTime = now;
  w.magazine--;
  updateAmmoDisplay();

  // FIRE SOUND LOCAL
  const audio = new Audio(w.fireSound);
  audio.volume = 1.0;
  audio.play();

  // SEND SOUND TO OTHER PLAYERS
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "shootSound",
      sound: w.fireSound,
      ownerId: myId
    }));
  }

  const dir = input.shootVector;
  const mag = Math.hypot(dir.x, dir.y);
  let shootDir = mag > JOYSTICK_DEADZONE
    ? { x: dir.x / mag, y: dir.y / mag }
    : { x: 1, y: 0 };

  // WEAPON RECOIL
  if (w.recoil) {
    const recoilAngle = (Math.random() - 0.5) * w.recoil;
    const cos = Math.cos(recoilAngle);
    const sin = Math.sin(recoilAngle);
    shootDir = {
      x: shootDir.x * cos - shootDir.y * sin,
      y: shootDir.x * sin + shootDir.y * cos
    };
  }

  // Spawn muzzle flash
  if (w.muzzleFlash && muzzleImageLoaded) {
    const flashDist = 20; // distance in front of character

  if (w.muzzleFlash && muzzleImageLoaded) {
    const flashDist = 20;

    muzzleFlashes.push({
      x: playerPos.x + shootDir.x * flashDist,
      y: playerPos.y + shootDir.y * flashDist,
      dirX: shootDir.x,
      dirY: shootDir.y,
      life: w.muzzleFlash.numFrames / w.muzzleFlash.fps,
      frameTime: 0,
      currentFrame: 0,
      config: w.muzzleFlash
    });

    // SEND MUZZLE FLASH TO OTHER PLAYERS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "muzzleFlash",
        x: playerPos.x + shootDir.x * flashDist,
        y: playerPos.y + shootDir.y * flashDist,
        dirX: shootDir.x,
        dirY: shootDir.y,
        ownerId: myId
      }));
    }
  }
  }

  // CREATE BULLETS
  if (w.pellets) {
    // SHOTGUN MULTIPLE PELLETS
    for (let i = 0; i < w.pellets; i++) {
      const spreadAngle = (Math.random() - 0.5) * w.spread;
      const cos = Math.cos(spreadAngle);
      const sin = Math.sin(spreadAngle);

      const pelletDir = {
        x: shootDir.x * cos - shootDir.y * sin,
        y: shootDir.x * sin + shootDir.y * cos
      };

      bullets.push({
        x: playerPos.x,
        y: playerPos.y,
        vx: pelletDir.x * w.bulletSpeed,
        vy: pelletDir.y * w.bulletSpeed,
        radius: 4,
        damage: w.damage,
        hitEffect: w.hitEffect,
        ownerId: myId
      });

      // SEND EACH PELLET ONLINE
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "bullet",
          x: playerPos.x,
          y: playerPos.y,
          vx: pelletDir.x * w.bulletSpeed,
          vy: pelletDir.y * w.bulletSpeed,
          damage: w.damage,
          hitEffect: w.hitEffect,
          ownerId: myId
        }));
      }
    }
  } else {
    // NORMAL SINGLE BULLET
    const bulletData = {
      type: "bullet",
      x: playerPos.x,
      y: playerPos.y,
      vx: shootDir.x * w.bulletSpeed,
      vy: shootDir.y * w.bulletSpeed,
      damage: w.damage,
      hitEffect: w.hitEffect,
      ownerId: myId
    };

    // LOCAL BULLET
    bullets.push({
      x: bulletData.x,
      y: bulletData.y,
      vx: bulletData.vx,
      vy: bulletData.vy,
      radius: 4,
      damage: bulletData.damage,
      hitEffect: bulletData.hitEffect,
      ownerId: myId
    });

    // SEND BULLET TO OTHER PLAYERS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(bulletData));
    }
  }
}

function update(dt) {
  finishReloadIfReady();
  laserBlinkTime += dt;

  // UPDATE HIT EFFECT ANIMATION
  updateHitEffects(dt);

  // Update muzzle flashes
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const f = muzzleFlashes[i];
    f.life -= dt;
    f.frameTime += dt;

    const frameDuration = 1 / f.config.fps;
    if (f.frameTime >= frameDuration) {
      f.frameTime -= frameDuration;
      f.currentFrame++;
      if (f.currentFrame >= f.config.numFrames) {
        f.currentFrame = f.config.numFrames - 1;
      }
    }

    if (f.life <= 0) {
      muzzleFlashes.splice(i, 1);
    }
  }

  const moveSpeed = player.movementSpeed;
  playerPos.x += input.moveVector.x * moveSpeed * dt;
  playerPos.y += input.moveVector.y * moveSpeed * dt;

  // Clamp player inside 700x700 world
  playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE - playerPos.radius, playerPos.x));
  playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE - playerPos.radius, playerPos.y));

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

  // Send position to server
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

  // Bullets - movement and collision
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Remove bullets out of bounds + wall hit effect
    if (
      b.x < 0 ||
      b.x > WORLD_SIZE ||
      b.y < 0 ||
      b.y > WORLD_SIZE
    ) {
      let hitX = b.x;
      let hitY = b.y;

      hitX = Math.max(0, Math.min(WORLD_SIZE, hitX));
      hitY = Math.max(0, Math.min(WORLD_SIZE, hitY));

      createHitEffect(hitX, hitY, b.hitEffect);

      bullets.splice(i, 1);
      continue;
    }

    // MY bullet - ONLY BULLET OWNER DEALS DAMAGE
    if (b.ownerId === myId) {
      for (const [id, p] of otherPlayers) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist < b.radius + playerPos.radius) {
          createHitEffect(b.x, b.y, b.hitEffect);

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "hit",
              targetId: id,
              damage: b.damage
            }));
          }

          bullets.splice(i, 1);
          break;
        }
      }
    } else {
      // ENEMY bullet hits me (visual only, no hit message)
      const dx = b.x - playerPos.x;
      const dy = b.y - playerPos.y;
      const dist = Math.hypot(dx, dy);

      if (dist < b.radius + playerPos.radius) {
        createHitEffect(b.x, b.y, b.hitEffect);

        bullets.splice(i, 1);
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
  const worldOffsetX = -playerPos.x;
  const worldOffsetY = -playerPos.y;

  // World background (map.jpg)
  ctx.drawImage(mapImage, worldOffsetX, worldOffsetY, WORLD_SIZE, WORLD_SIZE);

  // World border
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.strokeRect(worldOffsetX, worldOffsetY, WORLD_SIZE, WORLD_SIZE);

  // Player
  if (imageLoaded) {
    const imgSize = playerPos.radius * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;

    ctx.drawImage(
      playerImage,
      -imgSize / 2,
      -imgSize / 2,
      imgSize,
      imgSize
    );

    ctx.restore();

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

    // PLAYER HEALTH BAR
    const hpPercent = Math.max(0, player.currentHealth / player.health);

    ctx.fillStyle = "#300";
    ctx.fillRect(-20, -playerPos.radius - 15, 40, 5);

    ctx.fillStyle = "#00ff55";
    ctx.fillRect(-20, -playerPos.radius - 15, 40 * hpPercent, 5);
  } else {
    ctx.fillStyle = "#4af";
    ctx.beginPath();
    ctx.arc(0, 0, playerPos.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Muzzle flashes
  if (muzzleImageLoaded) {
    for (const f of muzzleFlashes) {
      const cfg = f.config;

      ctx.save();

      // Position in world space
      ctx.translate(
        worldOffsetX + f.x,
        worldOffsetY + f.y
      );

      // Rotate to face shoot direction
      const angle = Math.atan2(f.dirY, f.dirX);
      ctx.rotate(angle);

      // Source rectangle in sprite sheet
      const sx = f.currentFrame * cfg.frameWidth;
      const sy = 0;
      const sWidth = cfg.frameWidth;
      const sHeight = cfg.frameHeight;

      // Final drawn size
      const drawWidth = cfg.width * cfg.scale;
      const drawHeight = cfg.height * cfg.scale;

      // Draw centered
      ctx.drawImage(
        muzzleImage,
        sx, sy, sWidth, sHeight,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      );

      ctx.restore();
    }
  }

  // Bullets
  for (const b of bullets) {
    const angle = Math.atan2(b.vy, b.vx);

    ctx.save();
    ctx.translate(
      worldOffsetX + b.x,
      worldOffsetY + b.y
    );
    ctx.rotate(angle);

    ctx.shadowColor = "#b56cff";
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(10, 0);

    const bulletGlow = ctx.createLinearGradient(-8, 0, 10, 0);
    bulletGlow.addColorStop(0, "#4b0082");
    bulletGlow.addColorStop(0.5, "#d8a6ff");
    bulletGlow.addColorStop(1, "#ffffff");

    ctx.strokeStyle = bulletGlow;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(10, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.restore();
  }

  // HIT EFFECTS
  drawHitEffects(ctx, worldOffsetX, worldOffsetY);

  // Enemies
  ctx.fillStyle = "#f44";
  for (const e of enemies) {
    ctx.beginPath();
    ctx.arc(worldOffsetX + e.x, worldOffsetY + e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw other players
  for (const [id, p] of otherPlayers) {
    const imgSize = playerPos.radius * 2;

    if (imageLoaded) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 6;

      ctx.drawImage(
        playerImage,
        worldOffsetX + p.x - imgSize / 2,
        worldOffsetY + p.y - imgSize / 2,
        imgSize,
        imgSize
      );

      ctx.restore();
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

    // OTHER PLAYER HEALTH BAR
    const hp = Math.max(0, Math.min(100, p.health || 100));
    const barWidth = 30;
    const barHeight = 4;
    const barX = worldOffsetX + p.x - barWidth / 2;
    const barY = worldOffsetY + p.y - playerPos.radius - 10;

    ctx.fillStyle = "#550000";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "#00ff55";
    ctx.fillRect(barX, barY, barWidth * (hp / 100), barHeight);
  }

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
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);