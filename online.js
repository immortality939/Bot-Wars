// =============================================================================
// online.js — ONLINE MODE (client side): a shared PvP arena.
// =============================================================================
// Tapping "Online" on the start menu picks a character, connects to the
// server (server/server.js) and drops the player into a shared arena with
// everyone else who is connected. Offline mode is completely separate and
// never touches any of this (game.js only calls into here when
// gameMode === "online").
//
// HOW DAMAGE WORKS (simple, friend-friendly trust model):
//   * The ATTACKER works out who their attack hit (netHitPlayers(),
//     netMeleeStrike(), netMortarLanded()) and sends a "hit" for each victim.
//   * The VICTIM applies it to themselves (netApplyHit()) using their own
//     armor / defense / block chance, and handles their own death + respawn.
//   * Everyone else just sees positions, health bars, bullets, effects and
//     sounds relayed by the server.
// Loaded after game.js, so it can use game.js's globals (player, playerPos,
// bullets, isDead, respawnPlayerOffline() ...).
// =============================================================================

// ---- SERVER ADDRESS ---------------------------------------------------------
// Put your deployed server's address here (wss:// for https sites). While
// testing on your computer (http://localhost) it uses ws://localhost:8080.
const ONLINE_SERVER_PROD_URL = "wss://bot-wars-1.onrender.com";

function getOnlineServerUrl() {
  if (window.BOTWARS_SERVER_URL) return window.BOTWARS_SERVER_URL; // manual override
  const h = location.hostname;
  // NOTE: opening index.html straight from a phone/file (file://) is NOT
  // "local" — there is no server on the phone — so it uses the real server.
  const isLocal = h === "localhost" || h === "127.0.0.1";
  const isLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  if (isLocal) return "ws://localhost:8080";
  if (isLan) return "ws://" + h + ":8080";
  return ONLINE_SERVER_PROD_URL;
}

const ONLINE_LEVEL = 1;              // arena map (level.js) — same for everyone
const NET_STATE_INTERVAL = 50;       // ms between position updates (~20/s)
const NET_RESPAWN_SECONDS = 5;
const NET_SPAWN_PROTECT_MS = 2000;   // brief invulnerability after respawning

let netSocket = null;
const otherPlayers = new Map();      // id -> remote player (see netAddRemote)
let netStateTimer = 0;
let netSpawnProtectUntil = 0;
let netRespawnInterval = null;
const netCharCache = {};             // character name -> { image, radius }

// ---------------------------------------------------------------------------
// Low-level send
// ---------------------------------------------------------------------------
function netIsOnline() {
  return gameMode === "online" && netSocket && netSocket.readyState === WebSocket.OPEN;
}

function netSend(obj) {
  if (netSocket && netSocket.readyState === WebSocket.OPEN) {
    netSocket.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------------------
// Small on-screen status / kill-feed text
// ---------------------------------------------------------------------------
function netStatus(text) {
  let el = document.getElementById("netStatus");
  if (!text) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "netStatus";
    el.style.cssText =
      "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
      "flex-direction:column;background:rgba(0,0,0,0.75);color:#dff;z-index:20000;" +
      "font-family:'Courier New',monospace;font-size:18px;letter-spacing:2px;text-align:center;padding:20px;";
    document.body.appendChild(el);
  }
  el.textContent = text;
}

function netToast(text) {
  let feed = document.getElementById("netFeed");
  if (!feed) {
    feed = document.createElement("div");
    feed.id = "netFeed";
    feed.style.cssText =
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9000;" +
      "display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;";
    document.body.appendChild(feed);
  }
  const line = document.createElement("div");
  line.textContent = text;
  line.style.cssText =
    "background:rgba(0,0,0,0.6);color:#fff;font:12px 'Courier New',monospace;" +
    "padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);";
  feed.appendChild(line);
  setTimeout(() => line.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Remote players
// ---------------------------------------------------------------------------
function netCharInfo(name) {
  if (!netCharCache[name]) {
    let c = null;
    try { c = getCharacter(name); } catch (e) { /* unknown character */ }
    const info = { image: null, radius: (c && c.radius) || 12 };
    if (c && c.image) {
      const img = new Image();
      img.src = c.image;
      info.image = img;
    }
    netCharCache[name] = info;
  }
  return netCharCache[name];
}

function netAddRemote(p) {
  const info = netCharInfo(p.character);
  otherPlayers.set(p.id, {
    id: p.id,
    name: p.name || ("Player " + p.id),
    character: p.character,
    x: p.x || 0, y: p.y || 0,
    tx: p.x || 0, ty: p.y || 0,
    health: p.health != null ? p.health : 100,
    maxHealth: p.maxHealth || 100,
    level: p.level || 1,
    alive: p.alive !== false,
    radius: info.radius
  });
}

function drawRemotePlayers(ctx, offX, offY) {
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const info = netCharInfo(p.character);
    const size = p.radius * 2;
    const sx = offX + p.x;
    const sy = offY + p.y;

    if (info.image && info.image.complete && info.image.naturalWidth) {
      ctx.drawImage(info.image, sx - size / 2, sy - size / 2, size, size);
    } else {
      ctx.fillStyle = "#f55";
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name + level tag, health bar (same art as the local player's).
    ctx.save();
    ctx.font = "9px 'Courier New', Courier, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff8080";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3;
    ctx.fillText(p.name + "  Lv " + p.level, sx, sy - p.radius - 13);
    ctx.restore();

    const pct = Math.max(0, Math.min(1, p.health / (p.maxHealth || 100)));
    if (typeof drawImageHealthBar === "function") {
      drawImageHealthBar(ctx, sx - 20, sy - p.radius - 10, 40, 5, pct,
        healthBorderImage, healthHudImage, healthEmptyImage);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-frame tick (called from game.js update() while online)
// ---------------------------------------------------------------------------
function netUpdate(dt) {
  // Smooth remote players toward their last reported position.
  const k = Math.min(1, dt * 15);
  for (const p of otherPlayers.values()) {
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
  }

  // Send my own state ~20 times a second.
  netStateTimer += dt * 1000;
  if (netStateTimer >= NET_STATE_INTERVAL) {
    netStateTimer = 0;
    netSendState();
  }
}

function netSendState() {
  netSend({
    type: "state",
    x: Math.round(playerPos.x * 10) / 10,
    y: Math.round(playerPos.y * 10) / 10,
    health: Math.max(0, Math.round(player.currentHealth)),
    maxHealth: Math.round(player.health || 100),
    level: player.level || 1,
    alive: !isDead
  });
}

// ---------------------------------------------------------------------------
// Outgoing visuals (game.js calls these; they do nothing outside online mode)
// ---------------------------------------------------------------------------
function netSendBullet(b) {
  if (!netIsOnline() || !b.isMortar) return;
  netSend({
    type: "bullet",
    x: b.x, y: b.y, vx: b.vx, vy: b.vy,
    targetX: b.targetX, targetY: b.targetY,
    hitEffect: b.hitEffect, projectile: b.projectile,
    explosionRadius: b.explosionRadius
  });
}

function netFx(effect, x, y, follow, angle, size) {
  if (!netIsOnline() || !effect) return;
  netSend({ type: "fx", effect, x, y, follow: !!follow, angle, size });
}

function netSound(url) {
  if (!netIsOnline() || !url) return;
  netSend({ type: "sound", sound: url, x: playerPos.x, y: playerPos.y });
}

// ---------------------------------------------------------------------------
// Dealing damage to other players (attacker side)
// ---------------------------------------------------------------------------
function netRollCrit(critContext, base) {
  if (typeof rollCharacterCritical === "function") return rollCharacterCritical(critContext, base);
  const isCritical = Math.random() < (critContext.criticalChance || 0);
  return { damage: isCritical ? base * (1 + (critContext.criticalDamage || 0)) : base, isCritical };
}

function netSendHit(targetId, physicalDamage, magicalDamage, isCritical, knockback) {
  netSend({
    type: "hit",
    targetId,
    physicalDamage: Math.round(physicalDamage),
    magicalDamage: Math.round(magicalDamage),
    isCritical: !!isCritical,
    srcX: playerPos.x, srcY: playerPos.y,
    knockback: knockback || 0
  });
}

// Hits every living remote player for which test(p) is true. Each target
// rolls its own crit. Used by melee skills, beams and blasts.
function netHitPlayers(test, physicalDamage, magicalDamage, critContext) {
  if (!netIsOnline() || isDead) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive || !test(p)) continue;
    const phys = netRollCrit(critContext, physicalDamage || 0);
    const mag = netRollCrit(critContext, magicalDamage || 0);
    netSendHit(p.id, phys.damage, mag.damage, phys.isCritical || mag.isCritical, 0);
  }
}

// Basic melee swing: short reach, front cone only (same shape as vs bots).
function netMeleeStrike(attackDir, reach, attackResult) {
  if (!netIsOnline() || isDead) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const dx = p.x - playerPos.x;
    const dy = p.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + p.radius) continue;
    if (dist > 0.001 && (dx / dist) * attackDir.x + (dy / dist) * attackDir.y < 0.3) continue;
    netSendHit(p.id, attackResult.physicalDamage || 0, attackResult.magicalDamage || 0, attackResult.isCritical, 0);
  }
}

// My mortar shot landed: everyone inside its radius is hit, weaker toward
// the edge (same falloff as against bots) and pushed away from the blast.
function netMortarLanded(b) {
  if (!netIsOnline() || isDead) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - b.x, p.y - b.y);
    if (dist > b.explosionRadius + p.radius) continue;
    const falloff = getAoeFalloff(Math.min(dist, b.explosionRadius), b.explosionRadius);
    const phys = Math.max(1, Math.round((b.damage || 0) * falloff));
    const mag = Math.round((b.magicalDamage || 0) * falloff);
    // srcX/srcY = blast center, so the victim is pushed away from it.
    netSend({
      type: "hit", targetId: p.id,
      physicalDamage: phys, magicalDamage: mag, isCritical: false,
      srcX: b.x, srcY: b.y,
      knockback: (b.knockback || 0) * falloff
    });
  }
}

// ---------------------------------------------------------------------------
// Taking damage (victim side)
// ---------------------------------------------------------------------------
function netApplyHit(msg) {
  if (isDead || performance.now() < netSpawnProtectUntil) return;

  const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);
  if (!blocked) {
    applyDamageToPlayer(player, {
      physicalDamage: msg.physicalDamage || 0,
      magicalDamage: msg.magicalDamage || 0,
      isCritical: !!msg.isCritical
    });

    // Knockback — away from the attack's source point.
    if (msg.knockback > 0 && player.currentHealth > 0) {
      const dx = playerPos.x - msg.srcX;
      const dy = playerPos.y - msg.srcY;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) {
        playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x + (dx / d) * msg.knockback));
        playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y + (dy / d) * msg.knockback));
      }
    }
  }

  healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  if (player.currentHealth <= 0) netOnDeath(msg.from);
}

function netOnDeath(killerId) {
  if (isDead) return;
  isDead = true;
  player.currentHealth = 0;
  healthDisplay.textContent = 0;
  bullets.length = 0;

  netSend({ type: "died", killerId });
  netSendState();

  let secondsLeft = NET_RESPAWN_SECONDS;
  respawnTimerDisplay.textContent = secondsLeft;
  deathOverlay.style.display = "flex";

  if (netRespawnInterval) clearInterval(netRespawnInterval);
  netRespawnInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      respawnTimerDisplay.textContent = secondsLeft;
      return;
    }
    clearInterval(netRespawnInterval);
    netRespawnInterval = null;
    netRespawn();
  }, 1000);
}

function netRespawn() {
  respawnPlayerOffline();   // full health, random arena spawn point, gear re-applied
  isDead = false;
  deathOverlay.style.display = "none";
  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
  netSendState();
}

// ---------------------------------------------------------------------------
// Incoming messages
// ---------------------------------------------------------------------------
function netHandle(msg) {
  switch (msg.type) {
    case "playerAdd":
      netAddRemote(msg.player);
      netToast(msg.player.name + " joined");
      break;

    case "playerRemove": {
      const p = otherPlayers.get(msg.id);
      if (p) netToast(p.name + " left");
      otherPlayers.delete(msg.id);
      break;
    }

    case "state": {
      const p = otherPlayers.get(msg.id);
      if (!p) break;
      const wasAlive = p.alive;
      p.tx = msg.x; p.ty = msg.y;
      p.health = msg.health; p.maxHealth = msg.maxHealth;
      p.level = msg.level; p.alive = msg.alive;
      // Snap (don't glide) after they respawn somewhere else.
      if (!wasAlive && p.alive) { p.x = p.tx; p.y = p.ty; }
      break;
    }

    case "bullet":
      bullets.push({
        x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
        radius: 4, damage: 0,
        hitEffect: msg.hitEffect, projectile: msg.projectile,
        ownerId: msg.from, ownerType: "remote",
        isMortar: true,
        targetX: msg.targetX, targetY: msg.targetY,
        explosionRadius: msg.explosionRadius
      });
      break;

    case "fx": {
      if (typeof createHitEffect !== "function") break;
      const p = otherPlayers.get(msg.from);
      createHitEffect(msg.x, msg.y, msg.effect, (msg.follow && p) ? p : null, msg.angle, msg.size || undefined);
      break;
    }

    case "sound":
      if (typeof playPositionalSound === "function") {
        playPositionalSound(msg.sound, (msg.x || 0) - playerPos.x, (msg.y || 0) - playerPos.y, { baseVolume: 1.0 });
      }
      break;

    case "hit":
      netApplyHit(msg);
      break;

    case "kill":
      if (msg.killerName) netToast(msg.killerName + " eliminated " + msg.victimName);
      else netToast(msg.victimName + " was eliminated");
      break;
  }
}

// ---------------------------------------------------------------------------
// Connecting / starting / leaving
// ---------------------------------------------------------------------------
function netConnect(character) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sock;
    try {
      sock = new WebSocket(getOnlineServerUrl());
    } catch (e) {
      reject(new Error("Bad server address"));
      return;
    }

    // Free hosting can take up to a minute to wake a sleeping server.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch (e) {}
      reject(new Error("Connection timed out"));
    }, 60000);

    sock.onopen = () => sock.send(JSON.stringify({ type: "join", character }));

    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (!settled) {
        if (msg.type === "init") {
          settled = true;
          clearTimeout(timer);
          netSocket = sock;
          myId = msg.id;   // bullet-owner id used by game.js
          otherPlayers.clear();
          for (const p of msg.players) netAddRemote(p);
          resolve(msg);
        } else if (msg.type === "full") {
          settled = true;
          clearTimeout(timer);
          reject(new Error("The arena is full — try again in a moment"));
        }
        return;
      }
      netHandle(msg);
    };

    sock.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Could not reach the server"));
    };

    sock.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Server closed the connection"));
      } else if (netSocket === sock) {
        netSocket = null;
        if (gameMode === "online" && gameStarted) {
          netToast("Disconnected from server");
          if (typeof window.onOnlineDisconnected === "function") window.onOnlineDisconnected();
        }
      }
    };
  });
}

// Called from the character-select screen once an Online character is
// chosen. Returns true if the match started, false (after showing why) if not.
window.startGameOnline = async function (characterName) {
  characterName = characterName || "soldier";
  netStatus("Connecting to server...\n(a sleeping server can take up to a minute)");

  try {
    await netConnect(characterName);
  } catch (err) {
    netStatus("");
    alert("Online mode: " + err.message);
    return false;
  }
  netStatus("");

  window.startGameOffline(ONLINE_LEVEL, characterName, "online");

  // Same loadout hook-up the offline level buttons do after starting.
  if (typeof ensureDefaultWeaponLoaded === "function") ensureDefaultWeaponLoaded(characterName);
  if (typeof ensureDefaultArmorLoaded === "function") ensureDefaultArmorLoaded(characterName);
  if (typeof ensureDefaultSkillsLoaded === "function") ensureDefaultSkillsLoaded(characterName);
  if (typeof applyEquippedWeaponToPlayer === "function") applyEquippedWeaponToPlayer();
  if (typeof applyEquippedArmorToPlayer === "function") applyEquippedArmorToPlayer();
  if (typeof applyEquippedSkillsToPlayer === "function") applyEquippedSkillsToPlayer();

  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
netStateTimer = 0;
netSendState();

if (typeof startOnlineAutoSave === "function") {
  startOnlineAutoSave();
}

return true;
};

// Leave the arena and close the connection (EXIT button / disconnect).
window.exitOnlineGame = function () {
  saveOnlinePlayerData();
  stopOnlineAutoSave();

  // existing lines...
  if (netRespawnInterval) {
    clearInterval(netRespawnInterval);
    netRespawnInterval = null;
  }
  const sock = netSocket;
  netSocket = null;               // so onclose doesn't treat this as a drop
  if (sock) { try { sock.close(); } catch (e) {} }

  otherPlayers.clear();
  bullets.length = 0;
  isDead = false;
  deathOverlay.style.display = "none";
  myId = null;

  window.exitOfflineGame();       // stops the loop, clears obstacles
  gameMode = null;
  netStatus("");
};
// =============================================================================
// ONLINE ACCOUNT SYSTEM — Supabase
// =============================================================================

let onlineAccountScreen = null;

console.log("ONLINE.JS: account section reached");

// ============================================================
// SUPABASE ONLINE PLAYER DATA
// ============================================================

async function loadOnlinePlayerData() {
  if (!window.supabaseClient) {
    console.log("Supabase client not loaded.");
    return false;
  }

  const {
    data: { user },
    error: userError
  } = await window.supabaseClient.auth.getUser();

  if (userError || !user) {
    console.log("No online user to load.");
    return false;
  }

  try {
    const { data, error } = await window.supabaseClient
      .from("player_data")
      .select("game_data")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Load online player data error:", error);
      return false;
    }

    if (data && data.game_data) {
      if (typeof window.applyLoadedSaveData === "function") {
        window.applyLoadedSaveData(data.game_data);
      }

      console.log("Online player data loaded.");
      return true;
    }

    // First time this account is being used.
    // Create its player_data row using the current local progress.
    if (typeof window.captureSaveData === "function") {
      const initialSaveData = window.captureSaveData();

      const { error: insertError } = await window.supabaseClient
        .from("player_data")
        .insert({
          id: user.id,
          username: user.email || "",
          game_data: initialSaveData
        });

      if (insertError) {
        console.error("Create online player data error:", insertError);
        return false;
      }

      console.log("New online player data created.");
      return true;
    }

    console.log("No saved online player data yet.");
    return false;

  } catch (err) {
    console.error("Load online player data exception:", err);
    return false;
  }
}


async function saveOnlinePlayerData() {
  if (!window.supabaseClient) {
    console.log("Supabase client not loaded.");
    return false;
  }

  const {
    data: { user },
    error: userError
  } = await window.supabaseClient.auth.getUser();

  if (userError || !user) {
    console.log("No online user to save.");
    return false;
  }

  if (typeof window.captureSaveData !== "function") {
    console.log("captureSaveData() is not available.");
    return false;
  }

  try {
    const saveData = window.captureSaveData();

    const { error } = await window.supabaseClient
      .from("player_data")
      .upsert({
        id: user.id,
        username: user.email || "",
        game_data: saveData
      }, {
        onConflict: "id"
      });

    if (error) {
      console.error("Save online player data error:", error);
      return false;
    }

    console.log("Online player data saved.");
    return true;

  } catch (err) {
    console.error("Save online player data exception:", err);
    return false;
  }
}


window.loadOnlinePlayerData = loadOnlinePlayerData;
window.saveOnlinePlayerData = saveOnlinePlayerData;

// ============================================================
// AUTOMATIC ONLINE SAVE
// ============================================================

let onlineAutoSaveTimer = null;

function startOnlineAutoSave() {
  stopOnlineAutoSave();

  onlineAutoSaveTimer = setInterval(() => {
    if (window.getGameMode && window.getGameMode() === "online") {
      saveOnlinePlayerData();
    }
  }, 30000);
}

function stopOnlineAutoSave() {
  if (onlineAutoSaveTimer) {
    clearInterval(onlineAutoSaveTimer);
    onlineAutoSaveTimer = null;
  }
}

window.startOnlineAutoSave = startOnlineAutoSave;
window.stopOnlineAutoSave = stopOnlineAutoSave;

function openOnlineAccountScreen() {
  if (onlineAccountScreen) {
    onlineAccountScreen.style.display = "flex";
    return;
  }

  onlineAccountScreen = document.createElement("div");
  onlineAccountScreen.id = "onlineAccountScreen";
  onlineAccountScreen.style.cssText =
    "position:fixed;inset:0;z-index:30000;background:#050505;color:#fff;" +
    "display:flex;align-items:center;justify-content:center;" +
    "font-family:'Courier New',monospace;padding:20px;box-sizing:border-box;";

  onlineAccountScreen.innerHTML = `
    <div style="
      width:min(420px,100%);
      background:#101010;
      border:2px solid #4df;
      border-radius:12px;
      box-shadow:0 0 25px rgba(68,221,255,.35);
      padding:24px;
      box-sizing:border-box;
    ">
      <div style="
        text-align:center;
        color:#4df;
        font-size:24px;
        font-weight:bold;
        letter-spacing:3px;
        margin-bottom:24px;
      ">ONLINE ACCOUNT</div>

      <input id="onlineEmailInput"
        type="email"
        autocomplete="email"
        placeholder="Email / Gmail"
        style="
          width:100%;
          padding:14px;
          margin-bottom:12px;
          box-sizing:border-box;
          background:#181818;
          color:#fff;
          border:1px solid #555;
          border-radius:6px;
          font:16px Arial;
        ">

      <input id="onlinePasswordInput"
        type="password"
        autocomplete="current-password"
        placeholder="Password"
        style="
          width:100%;
          padding:14px;
          margin-bottom:16px;
          box-sizing:border-box;
          background:#181818;
          color:#fff;
          border:1px solid #555;
          border-radius:6px;
          font:16px Arial;
        ">

      <button id="onlineLoginBtn" style="
        width:100%;
        padding:13px;
        margin-bottom:10px;
        background:#168aad;
        color:#fff;
        border:0;
        border-radius:6px;
        font:bold 16px Arial;
      ">LOGIN</button>

      <button id="onlineCreateBtn" style="
        width:100%;
        padding:13px;
        margin-bottom:10px;
        background:#333;
        color:#fff;
        border:1px solid #777;
        border-radius:6px;
        font:bold 16px Arial;
      ">CREATE ACCOUNT</button>

      <button id="onlineForgotBtn" style="
        width:100%;
        padding:10px;
        margin-bottom:8px;
        background:none;
        color:#4df;
        border:0;
        font:14px Arial;
      ">FORGOT PASSWORD?</button>

      <button id="onlineChangeBtn" style="
        width:100%;
        padding:10px;
        margin-bottom:14px;
        background:none;
        color:#aaa;
        border:0;
        font:14px Arial;
      ">CHANGE PASSWORD</button>

      <button id="onlineAccountBackBtn" style="
        width:100%;
        padding:11px;
        background:#222;
        color:#fff;
        border:1px solid #555;
        border-radius:6px;
        font:bold 14px Arial;
      ">BACK</button>

      <div id="onlineAccountMessage" style="
        min-height:20px;
        margin-top:16px;
        text-align:center;
        color:#aaa;
        font:14px Arial;
      "></div>
    </div>
  `;

  document.body.appendChild(onlineAccountScreen);

  const emailInput = document.getElementById("onlineEmailInput");
  const passwordInput = document.getElementById("onlinePasswordInput");
  const message = document.getElementById("onlineAccountMessage");

  function showAccountMessage(text, good = false) {
    message.textContent = text;
    message.style.color = good ? "#6f6" : "#ff8888";
  }

  document.getElementById("onlineLoginBtn").onclick = async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showAccountMessage("Enter your email and password.");
      return;
    }

    showAccountMessage("Logging in...", true);

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    if (!data.user) {
      showAccountMessage("Login failed.");
      return;
    }

    showAccountMessage("Login successful.", true);

    setTimeout(() => {
      onlineAccountScreen.style.display = "none";
      await loadOnlinePlayerData();
openCharacterSelectFromHub("online");
    }, 500);
  };

  document.getElementById("onlineCreateBtn").onclick = async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showAccountMessage("Enter an email and password.");
      return;
    }

    if (password.length < 6) {
      showAccountMessage("Password must be at least 6 characters.");
      return;
    }

    showAccountMessage("Creating account...", true);

    const { data, error } = await window.supabaseClient.auth.signUp({
      email,
      password
    });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    if (data.session) {
      showAccountMessage("Account created successfully.", true);

      setTimeout(() => {
        onlineAccountScreen.style.display = "none";
        await loadOnlinePlayerData();
openCharacterSelectFromHub("online");
      }, 500);
    } else {
      showAccountMessage(
        "Account created. Check your email to confirm your account.",
        true
      );
    }
  };

  document.getElementById("onlineForgotBtn").onclick = async () => {
    const email = emailInput.value.trim();

    if (!email) {
      showAccountMessage("Enter your email first.");
      return;
    }

    showAccountMessage("Sending password reset email...", true);

    const redirectUrl = window.location.href.split("#")[0];

    const { error } =
      await window.supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
      });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    showAccountMessage(
      "Password reset email sent. Check your inbox.",
      true
    );
  };

  document.getElementById("onlineChangeBtn").onclick = async () => {
    const newPassword = passwordInput.value;

    if (!newPassword || newPassword.length < 6) {
      showAccountMessage("Enter a new password (minimum 6 characters).");
      return;
    }

    const {
      data: { user }
    } = await window.supabaseClient.auth.getUser();

    if (!user) {
      showAccountMessage("You must be logged in to change your password.");
      return;
    }

    showAccountMessage("Changing password...", true);

    const { error } =
      await window.supabaseClient.auth.updateUser({
        password: newPassword
      });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    showAccountMessage("Password changed successfully.", true);
    passwordInput.value = "";
  };

  document.getElementById("onlineAccountBackBtn").onclick = () => {
    onlineAccountScreen.style.display = "none";
    startMenu.style.display = "flex";
    showAccountMessage("");
  };
}

window.openOnlineAccountScreen = openOnlineAccountScreen;
