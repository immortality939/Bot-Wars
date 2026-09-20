// =============================================================================
// Bot Wars — Online Server (PvP arena relay)
// =============================================================================
// The game has 5 SERVERS (max 500 players each). Every server has 2 CHANNELS:
//   CHANNEL 0 — PvP: players can damage each other.
//   CHANNEL 1 — safe: hits between players are ignored (dropped here).
// A player joins one server + channel; only players in that same server +
// channel see each other (each pair is its own "room"). Everyone plays on the
// map in ./server/worldmap_server.js, which is sent to the client on join.
//
// The server is a thin relay: it hands out ids, keeps a list of who is in the
// room, and forwards each player's position / bullets / effects / sounds /
// hits to the others in that room. Each
// client works out its own damage (the "victim" applies a hit it is sent),
// so this is fine for playing with friends but is NOT cheat-proof.
//
// ONLINE GAME DATA: the numbers used in online mode (weapons, armor,
// characters, skills, ...) live in the ./server/*_server.js files. They are
// loaded here and sent to each player inside the "init" message, so they are
// never downloaded as editable files. Offline mode keeps using the public
// armor.js / weapon.js / ... files.
//
// Run:  npm install && npm start        (PORT env var, default 8080)
// =============================================================================

// The *_server.js files are copies of the game's browser files, so give Node
// harmless stand-ins for the few browser globals they touch when loading.
global.window = global.window || {};
global.Image = global.Image || function () {};
global.Audio = global.Audio || function () {};
global.document = global.document || {
  createElement() { return { style: {}, getContext() { return {}; } }; },
  getElementById() { return null; }
};

const http = require("http");
const { WebSocketServer } = require("ws");

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
// The map everyone plays on. worldmap_server.js sets window.CUSTOM_MAPS.worldmap
// (the Map Creator format); it is sent to the client inside the init message.
require("./server/worldmap_server.js");
const WORLD_MAP = global.window.CUSTOM_MAPS && global.window.CUSTOM_MAPS.worldmap;
if (!WORLD_MAP) throw new Error("server/worldmap_server.js must define window.CUSTOM_MAPS[\"worldmap\"]");
GAME_DATA.WORLD_MAP = WORLD_MAP;
JSON.stringify(GAME_DATA); // fail loudly at startup if anything isn't plain data
console.log("Online game data loaded: " + Object.keys(GAME_DATA).join(", "));

const PORT = process.env.PORT || 8080;
const SERVER_COUNT = 5;          // SERVER 1 .. SERVER 5
const SERVER_MAX_PLAYERS = 500;  // per server (both channels together)
const CHANNEL_PVP = 0;           // players can damage each other
const CHANNEL_SAFE = 1;          // no player-vs-player damage

// Safety net against absurd hits (tune if a legit skill ever needs more).
const MAX_DAMAGE_PER_HIT = 5000;
const MAX_HITS_PER_SECOND = 60;   // per attacker; extra hits are dropped

// Plain HTTP: /servers gives the lobby its "0/500" counts; anything else is a
// health check so hosts (Render etc.) know the service is alive.
const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (path === "/servers") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(serverList()));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Wars server OK — players online: " + players.size + "\n");
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

let nextId = 1;
const players = new Map(); // id -> { id, ws, server, channel, room, name, character, x, y, ... }

// rooms: "server:channel" -> Map(id -> player). Only players in the same room
// see and can hit each other.
const rooms = new Map();
for (let s = 1; s <= SERVER_COUNT; s++) {
  for (const c of [CHANNEL_PVP, CHANNEL_SAFE]) rooms.set(s + ":" + c, new Map());
}
const getRoom = (serverId, channel) => rooms.get(serverId + ":" + channel);
const serverPlayerCount = (serverId) =>
  getRoom(serverId, CHANNEL_PVP).size + getRoom(serverId, CHANNEL_SAFE).size;

function serverList() {
  const list = [];
  for (let s = 1; s <= SERVER_COUNT; s++) {
    list.push({
      id: s,
      players: serverPlayerCount(s),
      max: SERVER_MAX_PLAYERS,
      channels: [getRoom(s, CHANNEL_PVP).size, getRoom(s, CHANNEL_SAFE).size]
    });
  }
  return { max: SERVER_MAX_PLAYERS, servers: list };
}

const num = (v, fallback = 0) => (typeof v === "number" && isFinite(v) ? v : fallback);

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// Sends to everyone in `room` (a Map of players) except `exceptId`.
function broadcast(room, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const p of room.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

function publicInfo(p) {
  return {
    id: p.id, name: p.name, character: p.character,
    x: p.x, y: p.y, health: p.health, maxHealth: p.maxHealth,
    alive: p.alive, level: p.level
  };
}

wss.on("connection", (ws) => {
  let me = null; // set once the client sends "join"
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    // ---- JOIN ---------------------------------------------------------
    if (msg.type === "join") {
      if (me) return;

      const serverId = Math.trunc(num(msg.server, 0));
      const channel = Math.trunc(num(msg.channel, -1));
      if (serverId < 1 || serverId > SERVER_COUNT || (channel !== CHANNEL_PVP && channel !== CHANNEL_SAFE)) {
        send(ws, { type: "joinError", reason: "That server or channel does not exist" });
        ws.close();
        return;
      }
      if (serverPlayerCount(serverId) >= SERVER_MAX_PLAYERS) {
        send(ws, { type: "full", max: SERVER_MAX_PLAYERS });
        ws.close();
        return;
      }

      const room = getRoom(serverId, channel);
      const id = nextId++;
      const chars = GAME_DATA.CHARACTERS || {};
      const wanted = String(msg.character || "soldier").slice(0, 24);
      me = {
        id, ws,
        server: serverId, channel, room,
        name: "Player " + id,
        character: chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier"),
        x: 0, y: 0,
        health: 100, maxHealth: 100,
        alive: true,
        level: 1,
        hitWindowStart: 0, hitCount: 0
      };
      players.set(id, me);
      room.set(id, me);
      send(ws, {
        type: "init",
        id,
        name: me.name,
        server: serverId,
        channel,
        pvp: channel === CHANNEL_PVP,
        players: [...room.values()].filter((p) => p.id !== id).map(publicInfo),
        data: GAME_DATA   // the online numbers + the world map
      });
      broadcast(room, { type: "playerAdd", player: publicInfo(me) }, id);
      console.log(`+ ${me.name} (${me.character}) — server ${serverId} channel ${channel} — ${room.size} in room, ${players.size} online`);
      return;
    }

    if (!me) return; // everything below needs a joined player

    switch (msg.type) {
      // Position + health snapshot (client sends ~20x/second).
      case "state":
        me.x = num(msg.x, me.x);
        me.y = num(msg.y, me.y);
        me.health = num(msg.health, me.health);
        me.maxHealth = num(msg.maxHealth, me.maxHealth);
        me.level = num(msg.level, me.level);
        me.alive = !!msg.alive;
        broadcast(me.room, {
          type: "state", id: me.id,
          x: me.x, y: me.y, health: me.health, maxHealth: me.maxHealth,
          level: me.level, alive: me.alive
        }, me.id);
        break;

      // Visual relays: bullets in flight, hit/skill effects, gunshot sounds.
      case "bullet":
      case "fx":
      case "sound":
        msg.from = me.id;
        broadcast(me.room, msg, me.id);
        break;

      // Attacker says "I hit targetId" -> only that player is told.
      case "hit": {
        // CHANNEL 1 is a no-damage channel: drop every player-vs-player hit.
        if (me.channel !== CHANNEL_PVP) break;
        const target = me.room.get(num(msg.targetId, -1));   // same server + channel only
        if (!target || target.id === me.id) break;

        // rate limit per attacker
        const now = Date.now();
        if (now - me.hitWindowStart >= 1000) { me.hitWindowStart = now; me.hitCount = 0; }
        if (++me.hitCount > MAX_HITS_PER_SECOND) break;

        send(target.ws, {
          type: "hit",
          from: me.id,
          physicalDamage: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, num(msg.physicalDamage))),
          magicalDamage: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, num(msg.magicalDamage))),
          isCritical: !!msg.isCritical,
          srcX: num(msg.srcX), srcY: num(msg.srcY),
          knockback: Math.max(0, Math.min(200, num(msg.knockback)))
        });
        break;
      }

      // Victim reports who killed them -> everyone sees the kill feed.
      case "died": {
        const killer = me.room.get(num(msg.killerId, -1));
        me.alive = false;
        broadcast(me.room, {
          type: "kill",
          victimId: me.id, victimName: me.name,
          killerId: killer ? killer.id : null,
          killerName: killer ? killer.name : null
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!me) return;
    players.delete(me.id);
    me.room.delete(me.id);
    broadcast(me.room, { type: "playerRemove", id: me.id });
    console.log(`- ${me.name} — server ${me.server} channel ${me.channel} — ${players.size} online`);
  });

  ws.on("error", () => {});
});

// Drop dead connections and keep the socket warm behind proxies (30s ping).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log("Bot Wars server listening on port " + PORT));
