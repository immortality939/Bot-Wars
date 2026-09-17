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
// Run locally:   npm install ws   ->   node server.js
// Deploy (Render/etc.): same as before — just point your existing service
// at this file. It reads PORT from the environment like the old one did.
// =============================================================================

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

// -----------------------------------------------------------------------
// MAP DOWNLOAD SYSTEM
// -----------------------------------------------------------------------

const mapDownloads = new Map();
const MAP_DOWNLOAD_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_MAP_SIZE = 2 * 1024 * 1024; // 2 MB

function cleanMapFileName(name) {
  const cleaned = String(name || "map")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  return (cleaned || "map").slice(0, 100) + ".js";
}

const httpServer = http.createServer((req, res) => {

  // -------------------------------------------------------------
  // CREATE MAP DOWNLOAD
  // -------------------------------------------------------------
  if (req.method === "POST" && req.url === "/download-map") {

    let body = "";
    let bodySize = 0;

    req.on("data", (chunk) => {
      bodySize += chunk.length;

      if (bodySize > MAX_MAP_SIZE) {
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {

      try {
        const data = JSON.parse(body);

        if (typeof data.content !== "string") {
          res.writeHead(400, {
            "Content-Type": "application/json"
          });

          res.end(JSON.stringify({
            error: "Invalid map content."
          }));

          return;
        }

        if (
          Buffer.byteLength(data.content, "utf8") >
          MAX_MAP_SIZE
        ) {
          res.writeHead(413, {
            "Content-Type": "application/json"
          });

          res.end(JSON.stringify({
            error: "Map file is too large."
          }));

          return;
        }

        const token = crypto
          .randomBytes(16)
          .toString("hex");

        const fileName = cleanMapFileName(
          data.fileName
        );

        mapDownloads.set(token, {
          content: data.content,
          fileName: fileName,
          expires: Date.now() + MAP_DOWNLOAD_TTL
        });

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        });

        res.end(JSON.stringify({
          url: "/download-map/" + token
        }));

      } catch (err) {

        res.writeHead(400, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "Invalid request."
        }));
      }
    });

    return;
  }


  // -------------------------------------------------------------
  // ACTUAL MAP FILE DOWNLOAD
  // -------------------------------------------------------------
  if (
    req.method === "GET" &&
    req.url.startsWith("/download-map/")
  ) {

    const token = req.url
      .slice("/download-map/".length)
      .split("?")[0];

    const download = mapDownloads.get(token);

    if (
      !download ||
      download.expires < Date.now()
    ) {

      mapDownloads.delete(token);

      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("Download expired or not found.");

      return;
    }

    mapDownloads.delete(token);

    const fileBuffer = Buffer.from(
      download.content,
      "utf8"
    );

    res.writeHead(200, {
      "Content-Type":
        "application/javascript; charset=utf-8",

      "Content-Disposition":
        'attachment; filename="' +
        download.fileName +
        '"',

      "Content-Length":
        fileBuffer.length,

      "Cache-Control":
        "no-store"
    });

    res.end(fileBuffer);

    return;
  }


  // -------------------------------------------------------------
  // UNKNOWN HTTP REQUEST
  // -------------------------------------------------------------
  res.writeHead(404, {
    "Content-Type":
      "text/plain; charset=utf-8"
  });

  res.end("Not found.");
});


// IMPORTANT:
// WebSocket now uses the same HTTP server.
const wss = new WebSocket.Server({
  server: httpServer
});

httpServer.listen(PORT, () => {
  console.log(
    "Bot Wars server listening on port " + PORT
  );
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
