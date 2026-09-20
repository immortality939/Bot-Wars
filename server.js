// =============================================================================
// Bot Wars — Online Server (PvP arena relay)
// =============================================================================
// The game has 5 SERVERS (max 500 players each). Every server has 2 CHANNELS:
//   CHANNEL 0 — PvP: players can damage each other.
//   CHANNEL 1 — safe: hits between players are ignored (dropped here).
// A player joins one server + channel; only players in that same server +
// channel AND map see each other (each combination is its own "room").
// Maps: every ./server/*_server.js file that defines window.CUSTOM_MAPS[...]
// (worldmap_server.js, or any other map file you drop in) is sent to the client
// on join. Players start on "worldmap" and can walk through portals
// (entrance: "MapName") to the other maps.
//
// The server is a thin relay: it hands out ids, keeps a list of who is in the
// room, and forwards each player's position / bullets / effects / sounds /
// hits to the others in that room. Each
// client works out its own damage (the "victim" applies a hit it is sent),
// so this is fine for playing with friends but is NOT cheat-proof.
//
// ENEMIES (PvE): the server doesn't run enemy AI either. One player per room
// (the "bot host" — whoever has been in that room longest) runs the normal
// enemy simulation locally and streams a snapshot of it ("bots" message,
// ~10x/sec); this server caches and relays that to everyone else in the
// room, exactly like it relays player positions. A hit on an enemy from any
// player ("botHit") is relayed to the host, who applies it and whose next
// snapshot carries the result back out to the room — so everyone sees the
// same enemies, in the same place, dying at the same time. If the host
// leaves, hosting duty is silently handed to whoever's left (see
// reassignHost below).
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
  require("./server/level_server.js"),
  require("./server/bot_server.js")
);
// MAPS. Load every *_server.js file in ./server/ (the data files above are
// already loaded, so this only adds the map files). A map file sets
// window.CUSTOM_MAPS["key"] = { name, worldWidth, ... } (Map Creator format).
const fs = require("fs");
const path = require("path");
for (const f of fs.readdirSync(path.join(__dirname, "server")).filter((n) => /_server\.js$/.test(n)).sort()) {
  require("./server/" + f);
}
const MAPS = (global.window && global.window.CUSTOM_MAPS) || {};
if (!Object.keys(MAPS).length) throw new Error("No map found: server/worldmap_server.js must define window.CUSTOM_MAPS[\"worldmap\"]");
const START_MAP = MAPS.worldmap ? "worldmap" : Object.keys(MAPS)[0];   // where everyone spawns
GAME_DATA.WORLD_MAPS = MAPS;
GAME_DATA.START_MAP = START_MAP;
console.log("Maps loaded: " + Object.keys(MAPS).join(", ") + " (start: " + START_MAP + ")");
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

// rooms: "server:channel:map" -> Map(id -> player). Only players in the same
// room see and can hit each other.
//
// ENEMY BOTS (PvE): the server itself never simulates enemies — one player
// per room ("the host") runs the exact same enemy AI the game already runs
// offline, and streams a snapshot of it here (see "bots" below) for this
// server to relay to everyone else in the room. Each room Map carries two
// extra properties for this: hostId (who's currently hosting) and lastBots
// (the most recent snapshot, handed to anyone who joins mid-match so they
// aren't staring at an empty map until the next tick).
const rooms = new Map();
function getRoom(serverId, channel, mapKey) {
  const k = serverId + ":" + channel + ":" + mapKey;
  let r = rooms.get(k);
  if (!r) { r = new Map(); r.hostId = null; r.lastBots = null; rooms.set(k, r); }
  return r;
}
// Picks anyone else left in the room to take over as bot host.
function pickNewHost(room, excludeId) {
  for (const p of room.values()) if (p.id !== excludeId) return p;
  return null;
}
// Hands bot-hosting duty to `next` (or clears it if the room is now empty),
// wipes the stale snapshot, and tells everyone so nobody is left looking at
// enemies that are no longer being simulated by anyone.
function reassignHost(room, leavingId) {
  if (room.hostId !== leavingId) return;
  const next = pickNewHost(room, leavingId);
  room.hostId = next ? next.id : null;
  room.lastBots = null;
  if (next) send(next.ws, { type: "botHost", host: true });
  broadcast(room, { type: "botsReset" }, next ? next.id : -1);
}
function countPlayers(test) {
  let n = 0;
  for (const p of players.values()) if (test(p)) n++;
  return n;
}
const serverPlayerCount = (serverId) => countPlayers((p) => p.server === serverId);

function serverList() {
  const list = [];
  for (let s = 1; s <= SERVER_COUNT; s++) {
    list.push({
      id: s,
      players: serverPlayerCount(s),
      max: SERVER_MAX_PLAYERS,
      channels: [
        countPlayers((p) => p.server === s && p.channel === CHANNEL_PVP),
        countPlayers((p) => p.server === s && p.channel === CHANNEL_SAFE)
      ]
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

      const room = getRoom(serverId, channel, START_MAP);
      const id = nextId++;
      const chars = GAME_DATA.CHARACTERS || {};
      const wanted = String(msg.character || "soldier").slice(0, 24);
      me = {
        id, ws,
        server: serverId, channel, map: START_MAP, room, lastMapChange: 0,
        name: "Player " + id,
        character: chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier"),
        x: 0, y: 0,
        health: 100, maxHealth: 100,
        alive: true,
        level: 1,
        hitWindowStart: 0, hitCount: 0,
        botHitWindowStart: 0, botHitCount: 0
      };
      const isFirstInRoom = room.size === 0;
      players.set(id, me);
      room.set(id, me);
      if (isFirstInRoom) { room.hostId = id; room.lastBots = null; }
      send(ws, {
        type: "init",
        id,
        name: me.name,
        server: serverId,
        channel,
        pvp: channel === CHANNEL_PVP,
        players: [...room.values()].filter((p) => p.id !== id).map(publicInfo),
        data: GAME_DATA,   // the online numbers + the world map
        // PvE: am I responsible for simulating this room's enemies, and (if
        // not) here's the most recent snapshot so I'm not staring at an
        // empty map until the host's next tick — see "bots" below.
        botHost: room.hostId === id,
        bots: room.lastBots || []
      });
      broadcast(room, { type: "playerAdd", player: publicInfo(me) }, id);
      console.log(`+ ${me.name} (${me.character}) — server ${serverId} channel ${channel} — ${players.size} online`);
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

      // PvE: the room's enemy host streams its enemies' position/health/
      // alive state here (~10x/sec) — cache it (so late joiners see the
      // current fight instantly) and relay it to everyone else in the room.
      case "bots":
        if (me.room.hostId !== me.id || !Array.isArray(msg.list)) break;
        me.room.lastBots = msg.list;
        broadcast(me.room, { type: "bots", list: msg.list }, me.id);
        break;

      // Any player (including the host) can hit an enemy; only the host's
      // own simulation is allowed to actually apply the damage, so relay
      // this straight to them (same rate-limit idea as player "hit" above).
      case "botHit": {
        const hostId = me.room.hostId;
        if (hostId == null || hostId === me.id) break;
        const host = me.room.get(hostId);
        if (!host) break;

        const now = Date.now();
        if (now - me.botHitWindowStart >= 1000) { me.botHitWindowStart = now; me.botHitCount = 0; }
        if (++me.botHitCount > MAX_HITS_PER_SECOND) break;

        send(host.ws, {
          type: "botHit",
          idx: Math.trunc(num(msg.idx, -1)),
          amount: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, num(msg.amount))),
          isCritical: !!msg.isCritical,
          srcX: num(msg.srcX), srcY: num(msg.srcY),
          from: me.id
        });
        break;
      }

      // PvE: the room's bot HOST says one of its enemies just hit a
      // specific player (bullet landed or melee connected — see bot.js /
      // online.js's netBotMortarLanded()/netBotMeleeHit()). Only the
      // current host is trusted to deal this damage (anyone else could
      // otherwise fake enemy hits on people); forward it straight to the
      // victim, same rate-limit idea as "hit" above. Not gated by
      // CHANNEL_SAFE — that only turns off player-vs-player damage, PvE
      // still applies in both channels.
      case "botHitPlayer": {
        if (me.room.hostId !== me.id) break;
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;

        const now = Date.now();
        if (now - me.botHitWindowStart >= 1000) { me.botHitWindowStart = now; me.botHitCount = 0; }
        if (++me.botHitCount > MAX_HITS_PER_SECOND) break;

        send(target.ws, {
          type: "botHitPlayer",
          physicalDamage: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, num(msg.physicalDamage))),
          magicalDamage: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, num(msg.magicalDamage))),
          isCritical: !!msg.isCritical,
          srcX: num(msg.srcX), srcY: num(msg.srcY),
          knockback: Math.max(0, Math.min(200, num(msg.knockback)))
        });
        break;
      }

      // Walked through a portal: move to that map's room (same server + channel).
      case "map": {
        const key = String(msg.map || "");
        const now = Date.now();
        if (!MAPS[key] || key === me.map || now - me.lastMapChange < 300) break;
        me.lastMapChange = now;
        const oldRoom = me.room;
        oldRoom.delete(me.id);
        broadcast(oldRoom, { type: "playerRemove", id: me.id });
        reassignHost(oldRoom, me.id);   // hand off enemy-hosting if I was hosting that map

        me.map = key;
        me.room = getRoom(me.server, me.channel, key);
        const isFirstInNewRoom = me.room.size === 0;
        me.room.set(me.id, me);
        if (isFirstInNewRoom) { me.room.hostId = me.id; me.room.lastBots = null; }
        send(ws, {
          type: "mapChanged", map: key,
          players: [...me.room.values()].filter((p) => p.id !== me.id).map(publicInfo),
          botHost: me.room.hostId === me.id,
          bots: me.room.lastBots || []
        });
        broadcast(me.room, { type: "playerAdd", player: publicInfo(me) }, me.id);
        break;
      }

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
    reassignHost(me.room, me.id);   // hand off enemy-hosting if I was hosting
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
