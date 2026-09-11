// =============================================================================
// Bot Wars — Online Multiplayer Server (v2: rooms + boss fights)
// =============================================================================
// Replaces the old flat "everyone is in one world" server with proper rooms:
//   - A player CREATEs a room and gets a short ROOM CODE to share.
//   - Up to 5 more players JOIN using that code (6 players per room, max).
//   - Every player picks a character; the room roster (who's in each of the
//     6 slots, and which character they picked) is broadcast to everyone in
//     the room any time it changes.
//   - The host can START the fight once ready. That spawns one shared BOSS
//     for that room only — its health is tracked server-side and synced to
//     every player in the room.
//   - All the existing gameplay messages (movement, shooting, bullets,
//     health, death, muzzle flashes) now only reach players in the SAME
//     room, instead of everyone connected to the server.
//
// Run locally:   npm install   ->   node server.js
// Deploy (Render/etc.): same as before — just point your existing service
// at this file. It reads PORT from the environment like the old one did.
//
// ACCOUNTS (login / create account / email verification / forgot password)
// ---------------------------------------------------------------------------
// This file also now runs a small HTTP server alongside the WebSocket
// server (same port), so it can handle the links sent in verification and
// password-reset emails:
//   GET  /verify?token=...            confirms an account
//   GET  /reset?token=...             shows a "set new password" form
//   POST /reset                       applies the new password
// Everything else (register, login, forgot-password request) happens over
// the existing WebSocket connection as new message types — see the
// "ACCOUNTS" section in the switch statement below. See email.js for the
// SMTP setup required to actually deliver these emails.
// =============================================================================

import http from "http";
import { URL } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  createPlayer,
  loginPlayer,
  verifyEmailToken,
  regenerateVerifyToken,
  createPasswordResetToken,
  resetPasswordWithToken
} from "./database.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email.js";

const PORT = process.env.PORT || 8080;
// Where players go after clicking a confirm/reset link — set this env var
// on your host once the game's front end has its own URL.
const GAME_URL = process.env.GAME_URL || "";

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log("Bot Wars server listening on port " + PORT);
});

// -----------------------------------------------------------------------
// STATE
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
// HTTP — verification links + password reset form
// (the WebSocket upgrade for gameplay/login connections passes straight
// through this same server via wss's own "upgrade" handling)
// -----------------------------------------------------------------------

function htmlPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{background:#04080a;color:#cdfff2;font-family:'Courier New',Courier,monospace;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
  .card{max-width:420px;width:100%;background:linear-gradient(160deg,rgba(8,20,22,.95),rgba(3,10,12,.97));
        border:1px solid rgba(0,255,210,.5);border-radius:10px;padding:28px 24px;
        box-shadow:0 0 16px rgba(0,255,210,.25);text-align:center;}
  h1{font-size:18px;letter-spacing:2px;text-transform:uppercase;color:#dff;margin:0 0 14px;}
  p{font-size:14px;line-height:1.5;color:#9fe;}
  a.btn,button{display:inline-block;margin-top:14px;padding:12px 22px;border-radius:6px;
     background:rgba(0,255,210,.15);border:1px solid rgba(0,255,210,.55);color:#dff;
     font-family:inherit;font-weight:bold;letter-spacing:1px;text-decoration:none;cursor:pointer;font-size:13px;}
  input{width:100%;box-sizing:border-box;padding:10px;margin:8px 0;border-radius:6px;
     border:1px solid rgba(100,220,255,.35);background:rgba(0,20,26,.7);color:#dff;font-family:inherit;}
  .err{color:#ffb3b3;font-size:13px;margin-top:10px;}
</style></head>
<body><div class="card">${bodyHtml}</div></body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // basic guard against huge bodies
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFormBody(raw) {
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

async function handleHttpRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- GET /verify?token=... -> confirm the account -------------------
  if (req.method === "GET" && url.pathname === "/verify") {
    const token = url.searchParams.get("token");
    const result = verifyEmailToken(token);

    const backLink = GAME_URL ? `${GAME_URL}#login` : null;

    if (!result.success) {
      return sendHtml(res, 400, htmlPage("Verification failed", `
        <h1>Verification failed</h1>
        <p>${escapeHtml(result.message)}</p>
        ${backLink ? `<a class="btn" href="${backLink}">Back to Bot Wars</a>` : ""}
      `));
    }

    return sendHtml(res, 200, htmlPage("Account verified", `
      <h1>Account verified!</h1>
      <p>Your email is confirmed. You can log in now.</p>
      ${backLink
        ? `<a class="btn" href="${backLink}">Go to Log In</a>`
        : `<p>Head back to the game and log in.</p>`}
    `));
  }

  // ---- GET /reset?token=... -> show "set new password" form -----------
  if (req.method === "GET" && url.pathname === "/reset") {
    const token = url.searchParams.get("token") || "";
    return sendHtml(res, 200, htmlPage("Reset password", `
      <h1>Set a new password</h1>
      <form method="POST" action="/reset">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <input type="password" name="newPassword" placeholder="New password" required>
        <input type="password" name="confirmPassword" placeholder="Confirm new password" required>
        <div><button type="submit">Reset Password</button></div>
      </form>
      <p style="font-size:11px;color:#789;">Must be more than 8 characters and include both letters and numbers.</p>
    `));
  }

  // ---- POST /reset -> apply the new password ---------------------------
  if (req.method === "POST" && url.pathname === "/reset") {
    const raw = await readRequestBody(req);
    const { token, newPassword, confirmPassword } = parseFormBody(raw);

    if (newPassword !== confirmPassword) {
      return sendHtml(res, 400, htmlPage("Reset password", `
        <h1>Passwords didn't match</h1>
        <p class="err">Please go back to your email and click the reset link again.</p>
      `));
    }

    const result = resetPasswordWithToken(token, newPassword);
    const backLink = GAME_URL ? `${GAME_URL}#login` : null;

    if (!result.success) {
      return sendHtml(res, 400, htmlPage("Reset failed", `
        <h1>Couldn't reset password</h1>
        <p>${escapeHtml(result.message)}</p>
      `));
    }

    return sendHtml(res, 200, htmlPage("Password updated", `
      <h1>Password updated!</h1>
      <p>You can log in with your new password now.</p>
      ${backLink ? `<a class="btn" href="${backLink}">Go to Log In</a>` : ""}
    `));
  }

  sendHtml(res, 200, htmlPage("Bot Wars server", `<h1>Bot Wars server is running</h1><p>This is the game server — nothing to see here directly.</p>`));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// -----------------------------------------------------------------------
// CONNECTION HANDLING
// -----------------------------------------------------------------------

wss.on("connection", (ws) => {
  const id = nextClientId++;
  const client = {
    ws,
    id,
    username: null,
    roomCode: null,
    character: null,
    x: 0,
    y: 0,
    health: 100,
    alive: true
  };
  clients.set(id, client);

  send(client, { type: "init", id });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return; // ignore malformed messages
    }

    switch (msg.type) {

      // ---- ACCOUNTS: register / login / forgot password --------------
      case "register": {
        const result = createPlayer(msg.username, msg.password, msg.email);

        if (!result.success) {
          send(client, { type: "registerResult", success: false, message: result.message });
          break;
        }

        const sendResult = await sendVerificationEmail(result.player.email, result.player.username, result.verifyToken);

        send(client, {
          type: "registerResult",
          success: true,
          message: sendResult.sent
            ? "Account created! Check your email for a confirmation link before logging in."
            : "Account created, but the confirmation email couldn't be sent. Use this link to verify: "
              + `${process.env.PUBLIC_URL || ""}/verify?token=${result.verifyToken}`
        });
        break;
      }

      case "resendVerification": {
        const result = regenerateVerifyToken(msg.username);
        if (!result.success) {
          send(client, { type: "resendVerificationResult", success: false, message: result.message });
          break;
        }
        const sendResult = await sendVerificationEmail(result.email, result.username, result.verifyToken);
        send(client, {
          type: "resendVerificationResult",
          success: true,
          message: sendResult.sent
            ? "Confirmation email sent again — check your inbox."
            : "Couldn't send the email. Use this link to verify: "
              + `${process.env.PUBLIC_URL || ""}/verify?token=${result.verifyToken}`
        });
        break;
      }

      case "login": {
        const result = loginPlayer(msg.username, msg.password);

        if (!result.success) {
          send(client, {
            type: "loginResult",
            success: false,
            needsVerification: !!result.needsVerification,
            message: result.message
          });
          break;
        }

        client.username = result.player.username;

        send(client, { type: "loginResult", success: true, player: result.player });
        break;
      }

      case "forgotPassword": {
        const result = createPasswordResetToken(msg.email);
        if (result.success) {
          await sendPasswordResetEmail(msg.email, result.username, result.resetToken);
        }
        // Same message whether or not the email exists, so this can't be
        // used to probe which addresses have accounts.
        send(client, {
          type: "forgotPasswordResult",
          success: true,
          message: "If that email is registered, a password reset link has been sent."
        });
        break;
      }

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
