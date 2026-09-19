/**
 * Bot-Wars server — WebSocket game server + account system.
 *
 * Rebuilt from what the game client (data/game.js + index.html) sends and expects:
 *
 *   ACCOUNTS (handled by auth.js)
 *     register / login / forgotPassword / changePassword  ->  *Result
 *     GET /verify?token=...   (the link in the confirmation email)
 *
 *   ROOMS (must be logged in)
 *     createRoom {character}          -> roomCreated {roomCode}
 *     joinRoom {roomCode, character}  -> roomJoined {roomCode}   (or roomError {message})
 *     leaveRoom
 *     startBoss  (host only)          -> bossStart {boss}  to everyone in the room
 *     roomUpdate {roomCode, hostId, slots[6]} is broadcast on every change
 *
 *   COOP BOSS FIGHT (only while the room's fight is running)
 *     playerMove {x,y,health,alive}   -> relayed to teammates (never echoed back to the sender)
 *     bullet / shootSound             -> relayed to teammates
 *     bossDamage {damage}             -> bossUpdate {health} to all, then bossDefeated {killedBy}
 *     heal {targetId, amount}         -> playerHealth {id, health} to all
 *
 * Not included on purpose:
 *   - weaponConfig / characterConfig: the client keeps using its own local weapon and
 *     character data when the server doesn't send these.
 *   - "hit" (player-vs-player damage): the online mode is coop, so friendly fire is ignored.
 *
 * Run:  npm install && npm start        (Node 18+)
 * Env:  PORT, PUBLIC_URL (falls back to Render's RENDER_EXTERNAL_URL), MAIL_PROVIDER,
 *       MAIL_API_KEY, MAIL_FROM, MAIL_FROM_NAME, DATA_DIR  — see auth.js
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { createAuth, createHttpMailer } = require("./auth");

// ------------------------------------------------------------------ tuning
const MAX_ROOM_PLAYERS = 6; // the room screen shows 6 slots
const BOSS_BASE_HEALTH = 10000; // boss health for a solo player...
const BOSS_HEALTH_PER_EXTRA_PLAYER = 5000; // ...plus this for every additional player
const MAX_BOSS_HIT = 5000; // a single bossDamage message is capped at this
const MAX_HEAL = 1000;
const MAX_MSGS_PER_SEC = 400; // per connection; the client sends ~60 moves/s plus shots
const MAX_COORD = 100000;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I / O (easy to misread)

const AUTH_TYPES = new Set(["register", "login", "forgotPassword", "changePassword"]);
const EMAIL_TYPES = new Set(["register", "forgotPassword"]); // these send an email

// ------------------------------------------------------------------ small helpers
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

function makeLimiter(max, windowMs) {
  const hits = new Map(); // key -> [timestamps]
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
  }, 60 * 1000);
  timer.unref();
  return {
    allow(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now);
      hits.set(key, arr);
      return true;
    },
  };
}

// Only these fields are relayed to teammates (and only simple values), so a
// modified client can't push arbitrary junk through the server.
function pickRelayFields(msg, fields) {
  const out = {};
  for (const f of fields) {
    const v = msg[f];
    if (v === undefined) continue;
    if (typeof v === "boolean") out[f] = v;
    else if (isNum(v)) out[f] = v;
    else if (typeof v === "string" && v.length <= 64) out[f] = v;
    else if (v && typeof v === "object" && JSON.stringify(v).length <= 512) out[f] = v;
  }
  return out;
}

const BULLET_FIELDS = ["x", "y", "vx", "vy", "damage", "hitEffect", "projectile", "isMortar", "targetX", "targetY", "explosionRadius"];

// ------------------------------------------------------------------ server factory
function createGameServer({ port = process.env.PORT || 3000, auth: authOptions = {} } = {}) {
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  const auth = createAuth({
    baseUrl: publicUrl,
    mailer: createHttpMailer(),
    ...authOptions,
  });

  const rooms = new Map(); // code -> room
  let nextId = 1;

  // Limits for account messages (protects the mail quota and stops password guessing).
  const emailPerIp = makeLimiter(5, 10 * 60 * 1000);
  const emailGlobal = makeLimiter(100, 60 * 60 * 1000);
  const authPerIp = makeLimiter(30, 5 * 60 * 1000);

  // ---- HTTP: /verify + a tiny health page (Render pings / wakes the server with it)
  const server = http.createServer((req, res) => {
    if (auth.handleHttp(req, res)) return;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bot-Wars server is running.\n");
  });

  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

  const send = (ws, obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };
  const broadcastRoom = (room, obj, except) => {
    const data = JSON.stringify(obj);
    for (const m of room.members) if (m !== except && m.readyState === 1) m.send(data);
  };
  const roomError = (ws, message) => send(ws, { type: "roomError", message });

  // ---- rooms ----------------------------------------------------------
  function makeRoomCode() {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function roomUpdate(room) {
    const slots = [];
    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
      const m = room.members[i];
      slots.push(m ? { id: m.id, character: m.character, isHost: m === room.host } : null);
    }
    broadcastRoom(room, { type: "roomUpdate", roomCode: room.code, hostId: room.host.id, slots });
  }

  function leaveRoom(ws) {
    const room = ws.room;
    if (!room) return;
    ws.room = null;
    room.members = room.members.filter((m) => m !== ws);
    if (room.members.length === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.host === ws) room.host = room.members[0];
    if (room.state === "fight") broadcastRoom(room, { type: "playerRemove", id: ws.id });
    roomUpdate(room);
  }

  function cleanCharacter(c) {
    return typeof c === "string" && /^[A-Za-z0-9_ -]{1,24}$/.test(c) ? c : null;
  }

  function handleGameMessage(ws, msg) {
    switch (msg.type) {
      case "createRoom": {
        if (!ws.user) return roomError(ws, "Please log in first.");
        const character = cleanCharacter(msg.character);
        if (!character) return roomError(ws, "Pick a character first.");
        leaveRoom(ws);
        const room = { code: makeRoomCode(), host: ws, members: [ws], state: "lobby", boss: null };
        rooms.set(room.code, room);
        ws.room = room;
        ws.character = character;
        send(ws, { type: "roomCreated", roomCode: room.code });
        roomUpdate(room);
        return;
      }

      case "joinRoom": {
        if (!ws.user) return roomError(ws, "Please log in first.");
        const character = cleanCharacter(msg.character);
        if (!character) return roomError(ws, "Pick a character first.");
        const code = String(msg.roomCode || "").trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return roomError(ws, "Room not found. Check the code and try again.");
        if (ws.room === room) { // double tap: just re-sync
          send(ws, { type: "roomJoined", roomCode: room.code });
          return roomUpdate(room);
        }
        if (room.state !== "lobby") return roomError(ws, "That fight has already started.");
        if (room.members.length >= MAX_ROOM_PLAYERS) return roomError(ws, "That room is full.");
        leaveRoom(ws);
        ws.room = room;
        ws.character = character;
        room.members.push(ws);
        send(ws, { type: "roomJoined", roomCode: room.code });
        roomUpdate(room);
        return;
      }

      case "leaveRoom":
        return leaveRoom(ws);

      case "startBoss": {
        const room = ws.room;
        if (!room) return roomError(ws, "You're not in a room.");
        if (room.host !== ws) return roomError(ws, "Only the host can start the fight.");
        if (room.state !== "lobby") return roomError(ws, "The fight has already started.");
        const maxHealth = BOSS_BASE_HEALTH + (room.members.length - 1) * BOSS_HEALTH_PER_EXTRA_PLAYER;
        room.state = "fight";
        room.boss = { health: maxHealth, maxHealth, alive: true };
        for (const m of room.members) { m.alive = true; m.hp = undefined; m.hpMax = 0; }
        // The client places the boss in the middle of its arena; x/y here are placeholders.
        broadcastRoom(room, { type: "bossStart", boss: { health: maxHealth, maxHealth, x: 0, y: 0 } });
        return;
      }

      // ---- everything below only matters while a fight is running ----
      case "playerMove": {
        const room = ws.room;
        if (!room || room.state !== "fight") return;
        const { x, y } = msg;
        if (!isNum(x) || !isNum(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return;
        if (isNum(msg.health)) {
          ws.hp = msg.health;
          ws.hpMax = Math.max(ws.hpMax || 0, msg.health);
        }
        ws.alive = msg.alive !== false;
        // Never echoed to the sender: the client would snap itself back to a stale position.
        broadcastRoom(room, { type: "playerMove", id: ws.id, x, y, health: ws.hp, alive: ws.alive }, ws);
        return;
      }

      case "bullet": {
        const room = ws.room;
        if (!room || room.state !== "fight") return;
        broadcastRoom(room, { type: "bullet", ownerId: ws.id, ...pickRelayFields(msg, BULLET_FIELDS) }, ws);
        return;
      }

      case "shootSound": {
        const room = ws.room;
        if (!room || room.state !== "fight") return;
        broadcastRoom(room, { type: "shootSound", ownerId: ws.id, ...pickRelayFields(msg, ["sound", "x", "y"]) }, ws);
        return;
      }

      case "bossDamage": {
        const room = ws.room;
        if (!room || room.state !== "fight" || !room.boss || !room.boss.alive || ws.alive === false) return;
        if (!isNum(msg.damage) || msg.damage <= 0) return;
        room.boss.health = Math.max(0, room.boss.health - Math.min(msg.damage, MAX_BOSS_HIT));
        broadcastRoom(room, { type: "bossUpdate", health: Math.ceil(room.boss.health) });
        if (room.boss.health <= 0) {
          room.boss.alive = false;
          broadcastRoom(room, { type: "bossDefeated", killedBy: ws.id });
          room.state = "lobby"; // host can start another fight; players leave via leaveRoom
          room.boss = null;
        }
        return;
      }

      case "heal": {
        const room = ws.room;
        if (!room || room.state !== "fight" || ws.alive === false) return;
        const target = room.members.find((m) => m.id === msg.targetId);
        if (!target || target.alive === false || !isNum(target.hp) || !isNum(msg.amount) || msg.amount <= 0) return;
        target.hp = Math.min(target.hpMax || target.hp, target.hp + Math.min(msg.amount, MAX_HEAL));
        broadcastRoom(room, { type: "playerHealth", id: target.id, health: Math.round(target.hp) });
        return;
      }

      default:
        return; // unknown / unsupported (e.g. old "hit") — ignore
    }
  }

  // ---- connections -----------------------------------------------------
  wss.on("connection", (ws, req) => {
    ws.id = nextId++;
    ws.isAlive = true;
    ws.msgCount = 0;
    ws.room = null;
    ws.user = null;
    // Render puts the real client address in X-Forwarded-For.
    ws.ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();

    send(ws, { type: "init", id: ws.id });

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", async (data, isBinary) => {
      if (isBinary) return;
      if (++ws.msgCount > MAX_MSGS_PER_SEC) return; // flood control
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (_) { return; }
      if (!msg || typeof msg.type !== "string") return;

      try {
        if (AUTH_TYPES.has(msg.type)) {
          const tooMany = EMAIL_TYPES.has(msg.type)
            ? !emailPerIp.allow(ws.ip) || !emailGlobal.allow("all")
            : !authPerIp.allow(ws.ip);
          if (tooMany) {
            return send(ws, { type: `${msg.type}Result`, success: false, message: "Too many requests. Please wait a few minutes and try again." });
          }
          await auth.handleMessage(ws, msg);
          return;
        }
        handleGameMessage(ws, msg);
      } catch (err) {
        console.error(`[server] ${msg.type} failed:`, err);
      }
    });

    ws.on("close", () => leaveRoom(ws));
    ws.on("error", (err) => console.error("[server] socket error:", err.message));
  });

  // Drop dead connections (phones that lost signal) and reset the flood counters.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30 * 1000);
  const floodReset = setInterval(() => { for (const ws of wss.clients) ws.msgCount = 0; }, 1000);
  heartbeat.unref();
  floodReset.unref();

  return {
    server, wss, auth, rooms,
    listen: () => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat); clearInterval(floodReset);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => server.close(() => resolve()));
    }),
  };
}

module.exports = { createGameServer };

// ------------------------------------------------------------------ start
if (require.main === module) {
  if (!process.env.MAIL_PROVIDER || !process.env.MAIL_API_KEY || !process.env.MAIL_FROM) {
    console.warn("[server] MAIL_PROVIDER / MAIL_API_KEY / MAIL_FROM are not set: sign-up and password emails will fail until they are.");
  }
  const app = createGameServer();
  app.listen().then((p) => console.log(`[server] Bot-Wars server listening on port ${p}`));
  process.on("SIGTERM", () => app.close().then(() => process.exit(0)));
  process.on("unhandledRejection", (err) => console.error("[server] unhandled rejection:", err));
}
