// =============================================================================
// Bot Wars — Online Multiplayer Server (v3: accounts + rooms + boss fights)
// =============================================================================
// This file now does two jobs on the same port:
//
//   1) A small HTTP JSON API for player accounts:
//        POST /api/signup   — create an account (unverified until confirmed)
//        GET  /api/verify   — confirm an account from its emailed link
//        POST /api/login    — log in, returns the player's saved progress
//        POST /api/save     — push the player's latest save data up
//        POST /api/forgot   — start a password reset
//        POST /api/reset    — finish a password reset with a new password
//
//   2) The original WebSocket room/boss-fight relay (unchanged below the
//      ACCOUNTS section) — rooms, movement, bullets, boss HP, etc.
//
// Accounts are stored in accounts.json next to this file. That's plenty
// for now and survives restarts; swap loadAccounts()/saveAccounts() for a
// real database later without touching anything else.
//
// EMAIL: there is no real email service wired in. /api/signup and
// /api/forgot hand back the confirmation/reset link directly in their
// JSON response instead of emailing it, and the game's front-end shows
// that link inside a simulated "inbox" popup so the whole flow can be
// tested end-to-end. Search for "TODO(EMAIL)" below for exactly where to
// plug in a real mail service (e.g. nodemailer + SMTP, SendGrid, Mailgun)
// once you have one — at that point, stop returning the link in the
// response and only send it by email instead.
//
// Run locally:   npm install ws   ->   node server.js
// Deploy (Render/etc.): same as before — just point your existing service
// at this file. It reads PORT from the environment like the old one did.
// =============================================================================

import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";

// Your package.json has "type": "module", so this file is loaded as an
// ES module — that's why we use import instead of require() above.
// ES modules don't get __dirname for free like CommonJS files do, so
// it's derived here from the module's own URL instead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

// -----------------------------------------------------------------------
// ACCOUNTS — storage
// -----------------------------------------------------------------------
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

function loadAccounts() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch (e) {
    return {}; // no file yet, or unreadable — start fresh
  }
}

// accounts: usernameLower -> {
//   username, email, passwordSalt, passwordHash,
//   verified, verifyToken,
//   resetToken, resetTokenExpires,
//   save: {...} | null   <- the player's last localStorage save blob
// }
const accounts = loadAccounts();

let writeTimer = null;
function saveAccounts() {
  // Debounced so a burst of writes (e.g. several /api/save calls in a
  // row) doesn't hammer the disk.
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), (err) => {
      if (err) console.error("Failed to write accounts.json:", err);
    });
  }, 200);
}

// sessionToken -> usernameLower. In-memory on purpose — if the server
// restarts, players just log in again; nothing else is lost since their
// save data already lives in accounts.json.
const sessions = new Map();

// -----------------------------------------------------------------------
// ACCOUNTS — helpers
// -----------------------------------------------------------------------
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha256").toString("hex");
}
function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}
function isValidUsername(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{3,20}$/.test(name);
}
function isValidPassword(pw) {
  return typeof pw === "string" && pw.length > 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function findAccountByEmail(email) {
  const lower = String(email).toLowerCase();
  return Object.values(accounts).find((a) => a.email.toLowerCase() === lower);
}
function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return proto + "://" + req.headers.host;
}

// -----------------------------------------------------------------------
// HTTP API plumbing
// -----------------------------------------------------------------------
function readJsonBody(req, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy(); // guard against huge bodies
  });
  req.on("end", () => {
    try {
      callback(null, body ? JSON.parse(body) : {});
    } catch (e) {
      callback(e);
    }
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(obj));
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://placeholder");
  const pathName = url.pathname;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (pathName === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot Wars server is running.");
    return;
  }

  // ---- SIGN UP ---------------------------------------------------------
  if (pathName === "/api/signup" && req.method === "POST") {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, message: "Bad request." });

      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const email = String(body.email || "").trim();
      const key = username.toLowerCase();

      if (!isValidUsername(username)) {
        return sendJson(res, 400, { ok: false, message: "Username must be 3-20 characters: letters, numbers, underscore." });
      }
      if (!isValidPassword(password)) {
        return sendJson(res, 400, { ok: false, message: "Password must be more than 8 characters and include letters and numbers." });
      }
      if (!isValidEmail(email)) {
        return sendJson(res, 400, { ok: false, message: "Enter a valid email address." });
      }
      if (accounts[key]) {
        return sendJson(res, 400, { ok: false, message: "That username is already taken." });
      }
      if (findAccountByEmail(email)) {
        return sendJson(res, 400, { ok: false, message: "That email is already registered." });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const verifyToken = makeToken();

      accounts[key] = {
        username,
        email,
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        verified: false,
        verifyToken,
        resetToken: null,
        resetTokenExpires: 0,
        save: null
      };
      saveAccounts();

      // TODO(EMAIL): email `email` this link instead of returning it.
      const verifyLink = baseUrlFromReq(req) + "/api/verify?token=" + verifyToken;
      sendJson(res, 200, { ok: true, verifyLink });
    });
    return;
  }

  // ---- CONFIRM ACCOUNT (the link from the signup email) ---------------
  if (pathName === "/api/verify" && req.method === "GET") {
    const token = url.searchParams.get("token");
    const account = Object.values(accounts).find((a) => a.verifyToken === token);

    if (!account) return sendJson(res, 400, { ok: false, message: "Invalid or expired confirmation link." });

    account.verified = true;
    account.verifyToken = null;
    saveAccounts();
    sendJson(res, 200, { ok: true });
    return;
  }

  // ---- LOG IN ------------------------------------------------------------
  if (pathName === "/api/login" && req.method === "POST") {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, message: "Bad request." });

      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const key = username.toLowerCase();
      const account = accounts[key];

      if (!account) return sendJson(res, 400, { ok: false, message: "No account with that username." });
      if (!account.verified) return sendJson(res, 400, { ok: false, message: "Confirm your email before logging in." });

      const hash = hashPassword(password, account.passwordSalt);
      if (hash !== account.passwordHash) {
        return sendJson(res, 400, { ok: false, message: "Wrong password." });
      }

      const sessionToken = makeToken();
      sessions.set(sessionToken, key);

      sendJson(res, 200, {
        ok: true,
        username: account.username,
        sessionToken,
        save: account.save // player's last progress, or null if brand-new
      });
    });
    return;
  }

  // ---- SAVE PROGRESS (client calls this while signed in, any time its
  // local save data changes) ---------------------------------------------
  if (pathName === "/api/save" && req.method === "POST") {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, message: "Bad request." });

      const key = sessions.get(body.sessionToken);
      if (!key || key !== String(body.username || "").trim().toLowerCase()) {
        return sendJson(res, 401, { ok: false, message: "Not logged in." });
      }

      accounts[key].save = body.save || {};
      saveAccounts();
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  // ---- FORGOT PASSWORD ---------------------------------------------------
  if (pathName === "/api/forgot" && req.method === "POST") {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, message: "Bad request." });

      const identifier = String(body.identifier || "").trim();
      const account = accounts[identifier.toLowerCase()] || findAccountByEmail(identifier);

      if (!account) {
        // Don't reveal whether that username/email exists.
        return sendJson(res, 200, { ok: true });
      }

      const resetToken = makeToken();
      account.resetToken = resetToken;
      account.resetTokenExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
      saveAccounts();

      // TODO(EMAIL): email account.email this link instead of returning it.
      // (Purely a display link — the token in it is read client-side and
      // sent to /api/reset; nothing needs to GET this URL.)
      const resetLink = baseUrlFromReq(req) + "/reset-password?token=" + resetToken;
      sendJson(res, 200, { ok: true, resetLink, email: account.email });
    });
    return;
  }

  // ---- RESET PASSWORD -----------------------------------------------------
  if (pathName === "/api/reset" && req.method === "POST") {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, message: "Bad request." });

      const token = String(body.token || "");
      const newPassword = String(body.newPassword || "");
      const account = Object.values(accounts).find(
        (a) => a.resetToken === token && a.resetTokenExpires > Date.now()
      );

      if (!account) return sendJson(res, 400, { ok: false, message: "Invalid or expired reset link." });
      if (!isValidPassword(newPassword)) {
        return sendJson(res, 400, { ok: false, message: "Password must be more than 8 characters and include letters and numbers." });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      account.passwordSalt = salt;
      account.passwordHash = hashPassword(newPassword, salt);
      account.resetToken = null;
      account.resetTokenExpires = 0;
      saveAccounts();

      sendJson(res, 200, { ok: true });
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: "Not found." });
});

// -----------------------------------------------------------------------
// WEBSOCKET — attached to the same HTTP server/port as the API above
// -----------------------------------------------------------------------
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log("Bot Wars server (HTTP API + WS) listening on port " + PORT);
});

// -----------------------------------------------------------------------
// STATE (rooms / gameplay relay — unchanged from before)
// -----------------------------------------------------------------------
// Every connected socket gets a unique numeric id.
let nextClientId = 1;

// clientId -> { ws, id, roomCode, character, x, y, health, alive }
const clients = new Map();

// roomCode -> Room
// Room = {
//   code, hostId,
//   slots: [clientId|null, clientId|null, ...] (length 6, index = slot 0-4),
//   started: bool,
//   boss: null | { health, maxHealth, x, y }
// }
const rooms = new Map();

const MAX_PLAYERS_PER_ROOM = 6;

// -----------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------

function makeRoomCode() {
  // 4-letter code, avoids ambiguous chars (0/O, 1/I).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(client, msg) {
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

function roomClients(room) {
  return room.slots
    .filter((id) => id !== null)
    .map((id) => clients.get(id))
    .filter(Boolean);
}

function broadcastToRoom(room, msg, exceptId) {
  for (const c of roomClients(room)) {
    if (c.id !== exceptId) send(c, msg);
  }
}

// Sends the current 6-slot roster (id + character per slot, or null) to
// everyone in the room. This is what the client's Room popup renders.
function broadcastRoomUpdate(room) {
  const slots = room.slots.map((id) => {
    if (id === null) return null;
    const c = clients.get(id);
    if (!c) return null;
    return { id: c.id, character: c.character, isHost: id === room.hostId };
  });

  broadcastToRoom(room, {
    type: "roomUpdate",
    roomCode: room.code,
    hostId: room.hostId,
    started: room.started,
    slots
  });
}

function removeClientFromRoom(client) {
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  const slotIndex = room.slots.indexOf(client.id);
  if (slotIndex !== -1) room.slots[slotIndex] = null;

  // Let everyone still in the room know this player left.
  broadcastToRoom(room, { type: "playerRemove", id: client.id });

  const remaining = room.slots.filter((id) => id !== null);

  if (remaining.length === 0) {
    // Room's empty — remove it entirely.
    rooms.delete(room.code);
    return;
  }

  // If the host left, hand hosting to whoever's in the next lowest slot.
  if (room.hostId === client.id) {
    room.hostId = remaining[0];
  }

  broadcastRoomUpdate(room);
}

// -----------------------------------------------------------------------
// BOSS FIGHT (very simple placeholder pattern — expand as needed)
// -----------------------------------------------------------------------
// One boss per room, health pooled across however many players joined.
// Damage is currently trusted from the client (same trust model the old
// bullet-relay server used) — see the note near "bossDamage" below if you
// want to harden this later with server-side hit validation.

function startBossFight(room) {
  const playerCount = room.slots.filter((id) => id !== null).length;
  const maxHealth = 500 + playerCount * 400; // scales with room size

  room.started = true;
  room.boss = {
    health: maxHealth,
    maxHealth,
    x: 0,
    y: 0
  };

  broadcastToRoom(room, {
    type: "bossStart",
    boss: room.boss
  });

  broadcastRoomUpdate(room);
}

function applyBossDamage(room, amount, attackerId) {
  if (!room.boss || room.boss.health <= 0) return;

  room.boss.health = Math.max(0, room.boss.health - amount);

  broadcastToRoom(room, {
    type: "bossUpdate",
    health: room.boss.health
  });

  if (room.boss.health <= 0) {
    broadcastToRoom(room, { type: "bossDefeated", killedBy: attackerId });
    room.started = false;
    room.boss = null;
  }
}

// -----------------------------------------------------------------------
// CONNECTION HANDLING
// -----------------------------------------------------------------------

wss.on("connection", (ws) => {
  const id = nextClientId++;
  const client = {
    ws,
    id,
    roomCode: null,
    character: null,
    x: 0,
    y: 0,
    health: 100,
    alive: true
  };
  clients.set(id, client);

  send(client, { type: "init", id });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return; // ignore malformed messages
    }

    switch (msg.type) {

      // ---- ROOM LIFECYCLE -------------------------------------------
      case "createRoom": {
        // Player becomes the host of a brand-new room, slot 1.
        const code = makeRoomCode();
        const slots = new Array(MAX_PLAYERS_PER_ROOM).fill(null);
        slots[0] = id;

        const room = { code, hostId: id, slots, started: false, boss: null };
        rooms.set(code, room);

        client.roomCode = code;
        client.character = msg.character || null;

        send(client, { type: "roomCreated", roomCode: code });
        broadcastRoomUpdate(room);
        break;
      }

      case "joinRoom": {
        const room = rooms.get((msg.roomCode || "").toUpperCase());

        if (!room) {
          send(client, { type: "roomError", message: "Room not found." });
          break;
        }
        if (room.started) {
          send(client, { type: "roomError", message: "That room's fight already started." });
          break;
        }
        const freeSlot = room.slots.indexOf(null);
        if (freeSlot === -1) {
          send(client, { type: "roomError", message: "Room is full (6/6)." });
          break;
        }

        room.slots[freeSlot] = id;
        client.roomCode = room.code;
        client.character = msg.character || null;

        send(client, { type: "roomJoined", roomCode: room.code });
        broadcastRoomUpdate(room);
        break;
      }

      case "setCharacter": {
        client.character = msg.character || null;
        const room = rooms.get(client.roomCode);
        if (room) broadcastRoomUpdate(room);
        break;
      }

      case "leaveRoom": {
        removeClientFromRoom(client);
        break;
      }

      // Host-only: begin the boss fight for everyone currently in the room.
      case "startBoss": {
        const room = rooms.get(client.roomCode);
        if (!room) break;
        if (room.hostId !== id) {
          send(client, { type: "roomError", message: "Only the host can start the fight." });
          break;
        }
        if (room.started) break;
        startBossFight(room);
        break;
      }

      // Client reports damage it landed on the boss. Trusted for now —
      // same trust model your old bullet relay used for player-vs-player.
      case "bossDamage": {
        const room = rooms.get(client.roomCode);
        if (!room || !room.boss) break;
        const amount = Number(msg.damage) || 0;
        if (amount > 0) applyBossDamage(room, amount, id);
        break;
      }

      // ---- GAMEPLAY RELAY (room-scoped versions of the old messages) --
      case "playerMove": {
        client.x = msg.x;
        client.y = msg.y;
        if (msg.health !== undefined) client.health = msg.health;
        if (msg.alive !== undefined) client.alive = msg.alive;

        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, {
          type: "playerMove",
          id,
          x: msg.x,
          y: msg.y,
          health: msg.health,
          alive: msg.alive
        }, id);
        break;
      }

      case "shootSound": {
        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, {
          type: "shootSound",
          ownerId: id,
          sound: msg.sound,
          x: msg.x,
          y: msg.y
        }, id);
        break;
      }

      case "bullet": {
        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, {
          type: "bullet",
          ownerId: id,
          x: msg.x,
          y: msg.y,
          vx: msg.vx,
          vy: msg.vy,
          damage: msg.damage,
          hitEffect: msg.hitEffect
        }, id);
        break;
      }

      case "muzzleFlash": {
        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, {
          type: "muzzleFlash",
          ownerId: id,
          x: msg.x,
          y: msg.y,
          dirX: msg.dirX,
          dirY: msg.dirY
        }, id);
        break;
      }

      case "playerHealth": {
        client.health = msg.health;
        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, { type: "playerHealth", id, health: msg.health });
        break;
      }

      case "playerDied": {
        client.alive = false;
        const room = rooms.get(client.roomCode);
        if (!room) break;
        broadcastToRoom(room, {
          type: "playerDied",
          id,
          deadUntil: msg.deadUntil || (Date.now() + 10000)
        });
        break;
      }

      default:
        // Unknown message type — ignore.
        break;
    }
  });

  ws.on("close", () => {
    removeClientFromRoom(client);
    clients.delete(id);
  });

  ws.on("error", () => {
    removeClientFromRoom(client);
    clients.delete(id);
  });
});
