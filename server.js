// =============================================================================
// Bot Wars — Online Server (PvP arena relay)
// =============================================================================
// Everyone who taps Online joins the same arena. The server is a thin relay:
// it hands out ids, keeps a list of who is in the arena, and forwards each
// player's position / bullets / effects / sounds / hits to the others. Each
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
JSON.stringify(GAME_DATA); // fail loudly at startup if anything isn't plain data
console.log("Online game data loaded: " + Object.keys(GAME_DATA).join(", "));

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;

// Safety net against absurd hits (tune if a legit skill ever needs more).
const MAX_DAMAGE_PER_HIT = 5000;
const MAX_HITS_PER_SECOND = 60;   // per attacker; extra hits are dropped

// Plain HTTP response so hosts (Render etc.) can health-check the service.
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Wars server OK — players online: " + players.size + "\n");
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

let nextId = 1;
const players = new Map(); // id -> { id, ws, name, character, x, y, health, maxHealth, alive, level }

const num = (v, fallback = 0) => (typeof v === "number" && isFinite(v) ? v : fallback);

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const p of players.values()) {
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
      if (players.size >= MAX_PLAYERS) {
        send(ws, { type: "full", max: MAX_PLAYERS });
        ws.close();
        return;
      }
      const id = nextId++;
      const chars = GAME_DATA.CHARACTERS || {};
      const wanted = String(msg.character || "soldier").slice(0, 24);
      me = {
        id, ws,
        name: "Player " + id,
        character: chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier"),
        x: 0, y: 0,
        health: 100, maxHealth: 100,
        alive: true,
        level: 1,
        hitWindowStart: 0, hitCount: 0
      };
      players.set(id, me);
      send(ws, {
        type: "init",
        id,
        name: me.name,
        players: [...players.values()].filter((p) => p.id !== id).map(publicInfo),
        data: GAME_DATA   // the online numbers (from the *_server.js files)
      });
      broadcast({ type: "playerAdd", player: publicInfo(me) }, id);
      console.log(`+ ${me.name} (${me.character}) — ${players.size} online`);
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
        broadcast({
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
        broadcast(msg, me.id);
        break;

      // Attacker says "I hit targetId" -> only that player is told.
      case "hit": {
        const target = players.get(num(msg.targetId, -1));
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
        const killer = players.get(num(msg.killerId, -1));
        me.alive = false;
        broadcast({
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
    broadcast({ type: "playerRemove", id: me.id });
    console.log(`- ${me.name} — ${players.size} online`);
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
