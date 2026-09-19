// =============================================================================
// Metal-Wars / Bot Wars — ONLINE SERVER (Render)
// =============================================================================
// Speaks the protocol the game's online.js expects:
//   client -> join, state, bullet, fx, sound, hit, died
//   server -> init, full, playerAdd, playerRemove, state, bullet, fx, sound,
//             hit, kill
//
// ONLINE GAME DATA: the *_server.js files in ./server/ hold the numbers used
// in online mode (weapons, armor, characters, skills, ...). They are loaded
// HERE and sent to every player inside the "init" message, so the browser
// never downloads them as editable files. Offline mode keeps using the public
// armor.js / weapon.js / ... files.
//
// Run locally:  npm install   ->   node server.js
// Render:       Build command "npm install", Start command "node server.js"
// =============================================================================

// The *_server.js files are copies of the game's browser files, so give Node
// harmless stand-ins for the few browser globals they touch at load time.
global.window = global.window || {};
global.Image = global.Image || function () {};
global.Audio = global.Audio || function () {};
global.document = global.document || {
  createElement() { return { style: {}, getContext() { return {}; } }; },
  getElementById() { return null; }
};

const WebSocket = require("ws");

// ---- ONLINE GAME DATA (edit the *_server.js files, not this) ----------------
const GAME_DATA = Object.assign(
  {},
  require("./server/weapon_server.js"),
  require("./server/armor_server.js"),
  require("./server/attackmode_server.js"),
  require("./server/character_server.js"),
  require("./server/skill_server.js"),
  require("./server/upgrade_server.js"),
  require("./server/shop_server.js"),
  require("./server/item_server.js"),
  require("./server/level_server.js")
);
// Make sure everything is plain JSON (and fail loudly at startup if not).
const GAME_DATA_JSON = JSON.stringify(GAME_DATA);
console.log("Online game data loaded: " + Object.keys(GAME_DATA).join(", "));

// ---- SAFETY LIMITS ----------------------------------------------------------
const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 20;
const MAX_DAMAGE_PER_HIT = 5000;   // a single hit above this is clamped
const MAX_HITS_PER_SECOND = 60;    // per attacker; extra hits are dropped
const MAX_KNOCKBACK = 400;
const MAX_MESSAGE_BYTES = 4096;

const wss = new WebSocket.Server({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });
console.log("Online server listening on port " + PORT);

let nextId = 1;
const clients = new Map(); // id -> client

function send(c, msg) {
  if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const text = JSON.stringify(msg);
  for (const c of clients.values()) {
    if (c.joined && c.id !== exceptId && c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
  }
}

function num(v, fallback) {
  v = Number(v);
  return Number.isFinite(v) ? v : fallback;
}

function publicPlayer(c) {
  return {
    id: c.id, name: c.name, character: c.character,
    x: c.x, y: c.y, health: c.health, maxHealth: c.maxHealth,
    level: c.level, alive: c.alive
  };
}

wss.on("connection", (ws) => {
  const client = {
    ws, id: nextId++, joined: false, announced: false,
    name: "", character: "soldier",
    x: 0, y: 0, health: 100, maxHealth: 100, level: 1, alive: true,
    hitWindowStart: 0, hitCount: 0
  };
  clients.set(client.id, client);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;

    // ---- JOIN -----------------------------------------------------------
    if (msg.type === "join") {
      if (client.joined) return;
      if ([...clients.values()].filter((c) => c.joined).length >= MAX_PLAYERS) {
        send(client, { type: "full" });
        return;
      }
      const chars = GAME_DATA.CHARACTERS || {};
      const wanted = String(msg.character || "soldier");
      client.character = chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier");
      client.name = "Player " + client.id;
      client.joined = true;

      send(client, {
        type: "init",
        id: client.id,
        players: [...clients.values()].filter((c) => c.announced && c.id !== client.id).map(publicPlayer),
        data: GAME_DATA
      });
      return;
    }

    if (!client.joined) return;

    switch (msg.type) {
      // ---- POSITION / HEALTH ---------------------------------------------
      case "state": {
        client.x = num(msg.x, client.x);
        client.y = num(msg.y, client.y);
        client.health = num(msg.health, client.health);
        client.maxHealth = num(msg.maxHealth, client.maxHealth);
        client.level = num(msg.level, client.level);
        client.alive = msg.alive !== false;

        if (!client.announced) {
          // First real position: now tell everyone else this player exists.
          client.announced = true;
          broadcast({ type: "playerAdd", player: publicPlayer(client) }, client.id);
        } else {
          broadcast({
            type: "state", id: client.id,
            x: client.x, y: client.y, health: client.health,
            maxHealth: client.maxHealth, level: client.level, alive: client.alive
          }, client.id);
        }
        break;
      }

      // ---- VISUALS / SOUND (relayed to everyone else) ----------------------
      case "bullet":
        broadcast({
          type: "bullet", from: client.id,
          x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
          targetX: msg.targetX, targetY: msg.targetY,
          hitEffect: msg.hitEffect, projectile: msg.projectile,
          explosionRadius: msg.explosionRadius
        }, client.id);
        break;

      case "fx":
        broadcast({
          type: "fx", from: client.id,
          effect: msg.effect, x: msg.x, y: msg.y,
          follow: !!msg.follow, angle: msg.angle, size: msg.size
        }, client.id);
        break;

      case "sound":
        broadcast({ type: "sound", from: client.id, sound: msg.sound, x: msg.x, y: msg.y }, client.id);
        break;

      // ---- DAMAGE ----------------------------------------------------------
      case "hit": {
        const target = clients.get(msg.targetId);
        if (!target || !target.joined || target.id === client.id) break;
        if (!client.alive) break;

        // rate limit per attacker
        const now = Date.now();
        if (now - client.hitWindowStart >= 1000) { client.hitWindowStart = now; client.hitCount = 0; }
        if (++client.hitCount > MAX_HITS_PER_SECOND) break;

        const clampDmg = (v) => Math.max(0, Math.min(MAX_DAMAGE_PER_HIT, num(v, 0)));
        send(target, {
          type: "hit", from: client.id,
          physicalDamage: clampDmg(msg.physicalDamage),
          magicalDamage: clampDmg(msg.magicalDamage),
          isCritical: !!msg.isCritical,
          srcX: num(msg.srcX, client.x), srcY: num(msg.srcY, client.y),
          knockback: Math.max(0, Math.min(MAX_KNOCKBACK, num(msg.knockback, 0)))
        });
        break;
      }

      case "died": {
        client.alive = false;
        const killer = clients.get(msg.killerId);
        const feed = { type: "kill", victimName: client.name };
        if (killer && killer.id !== client.id) feed.killerName = killer.name;
        broadcast(feed);
        break;
      }

      default:
        break;
    }
  });

  const leave = () => {
    if (!clients.has(client.id)) return;
    clients.delete(client.id);
    if (client.announced) broadcast({ type: "playerRemove", id: client.id });
  };
  ws.on("close", leave);
  ws.on("error", leave);
});
