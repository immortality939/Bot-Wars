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

// SKILL LOCK — server-authoritative enforcement (see game_server.js's
// isPlayerSkillLocked()/lockPlayerSkillUse() comment for why this can't 
// just live in game.js/online.js alone).
const { isPlayerSkillLocked, lockPlayerSkillUse } = require("./server/game_server.js");

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
  require("./server/bot_server.js"),
  require("./server/game_server.js")
);
// MAPS. Load every *_server.js file in ./server/ (the data files above are
// already loaded, so this only adds the map files). A map file sets
// window.CUSTOM_MAPS["key"] = { name, worldWidth, ... } (Map Creator format).
const fs = require("fs");
const path = require("path");
const SERVER_JS_FILES = fs.readdirSync(path.join(__dirname, "server")).filter((n) => /_server\.js$/.test(n)).sort();
for (const f of SERVER_JS_FILES) {
  require("./server/" + f);
}
const MAPS = (global.window && global.window.CUSTOM_MAPS) || {};
if (!Object.keys(MAPS).length) throw new Error("No map found: server/worldmap_server.js must define window.CUSTOM_MAPS[\"worldmap\"]");
const START_MAP = MAPS.worldmap ? "worldmap" : Object.keys(MAPS)[0];   // where everyone spawns
GAME_DATA.WORLD_MAPS = MAPS;
GAME_DATA.START_MAP = START_MAP;

// CODE — the raw SOURCE of every ./server/*_server.js file, sent to each
// client inside GAME_DATA (as GAME_DATA.CODE) so online.js's
// netInstallServerCode() can actually run their top-level FUNCTIONS/FORMULAS
// (attrRate, applyAttributeBonus, pickUpWeaponDrop, ...), not just their data
// tables. Without this, a *_server.js file's hardcoded NUMBERS (ATTRIBUTE_RATES,
// GAME_RULES, anything not in online.js's netTableRefs() table list) never
// actually reach the client — only the plain data tables client-side already
// tracks do, via the regular GAME_DATA fields above.
// IMPORTANT: online.js's NET_PROTECTED_FUNCTIONS list must stay in sync with
// every name online.js overrides for multiplayer networking (party loot,
// exp sharing, PvP damage) — this swap installs EVERY top-level function
// from these files, so any override name missing from that list silently
// gets replaced by the plain, non-networked version the moment this ships.
const SERVER_CODE = {};
for (const f of SERVER_JS_FILES) {
  SERVER_CODE[f] = fs.readFileSync(path.join(__dirname, "server", f), "utf8");
}
GAME_DATA.CODE = SERVER_CODE;

console.log("Maps loaded: " + Object.keys(MAPS).join(", ") + " (start: " + START_MAP + ")");
JSON.stringify(GAME_DATA); // fail loudly at startup if anything isn't plain data
console.log("Online game data loaded: " + Object.keys(GAME_DATA).join(", "));
console.log("Server code sent to clients: " + SERVER_JS_FILES.join(", "));

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

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

let nextId = 1;
const players = new Map(); // id -> { id, ws, server, channel, room, name, character, x, y, ... }

// ---------------------------------------------------------------------------
// PARTIES — up to PARTY_MAX_SIZE players sharing kill exp (see "partyExpAward"
// below and computePartyExpShare() in server/character_server.js). A party is
// just { id, members: [ids] }; members[0] is whoever created it (the only one
// who can "partyKick"). Membership persists across map changes — only
// "partyLeave", "partyKick", or the member disconnecting removes them — but
// this server never tracks player POSITIONS across rooms, so it has no idea
// who was actually near a kill: online.js works that out itself
// (computePartyExpShare()) and sends the already-split amount here for this
// server to relay to the right socket, same "friend-friendly trust model" as
// "hit"/"botHit" above (not cheat-proof, just convenient). Like the
// friendRequest/friendResponse system above, this is in-memory only — a
// reconnect drops you from your party and you'll need to be re-invited.
// ---------------------------------------------------------------------------
let nextPartyId = 1;
const parties = new Map(); // partyId -> { id, members: [ids], lootTurnIndex }
// Was a separate hardcoded "6" here before — now reads the ONE canonical
// value in character_server.js's GAME_RULES so the two can never drift apart.
const PARTY_MAX_SIZE = GAME_DATA.GAME_RULES.PARTY_MAX_SIZE;

// Friendly-fire helper and party-loot-turn helpers, same pure functions
// online.js's client code uses (see character_server.js's "PARTY FRIENDLY
// FIRE" and "PARTY LOOT TURN" sections) — pulled from GAME_DATA so both
// sides never drift apart. partyLootRuleForCategory() comes from the new
// server/game_server.js (ALTERNATE / SPLIT / SHARED per item category).
const { isPartyFriendlyFire, isClanFriendlyFire, getPartyLootTurnId, advancePartyLootTurn, partyLootRuleForCategory, prunePartyMembers } = GAME_DATA;

function getParty(p) {
  return p.partyId != null ? parties.get(p.partyId) : null;
}

function partyRosterPayload(party) {
  return {
    type: "partyUpdate",
    partyId: party.id,
    members: party.members.map((id) => {
      const m = players.get(id);
      return { id, name: m ? m.name : ("Player " + id) };
    })
  };
}

function broadcastPartyUpdate(party) {
  const payload = partyRosterPayload(party);
  for (const id of party.members) {
    const m = players.get(id);
    if (m) send(m.ws, payload);
  }
}

// Removes p from whatever party it's in. A party with only 1 member left
// dissolves entirely (that last member is told their party is gone too)
// instead of sitting around as a "party" nobody can share exp with.
function removeFromParty(p) {
  const party = getParty(p);
  if (!party) return;
  party.members = party.members.filter((id) => id !== p.id);
  p.partyId = null;
  send(p.ws, { type: "partyUpdate", partyId: null, members: [] });
  if (party.members.length <= 1) {
    for (const id of party.members) {
      const m = players.get(id);
      if (m) {
        m.partyId = null;
        send(m.ws, { type: "partyUpdate", partyId: null, members: [] });
      }
    }
    parties.delete(party.id);
  } else {
    broadcastPartyUpdate(party);
  }
}

// ---------------------------------------------------------------------------
// CLANS — formed via CREATE CLAN in the OPTIONS popup, then grown via the
// ADD CLAN button on the player-touch menu (see playerTouchClanBtn in
// online.js).
//
// PERSISTENT: a clan belongs to the ACCOUNT (the Supabase user id), not to
// a connection or a character. So it survives logging out, closing the app,
// logging in on another phone, deleting + re-creating the character, and
// server restarts. The server is the source of truth:
//   * the account is proven by the access token the client sends in "join"
//     (checked against Supabase Auth — see verifyAccountToken());
//   * clans + members are saved to two Supabase tables (see
//     clans_setup.sql) using the SERVICE key, which only ever lives in
//     this server's environment (SUPABASE_SERVICE_KEY on Render);
//   * everything is loaded back into memory at startup.
// If SUPABASE_SERVICE_KEY isn't set, clans still work but only live in
// memory (they survive log out / re-login, not a server restart).
// ---------------------------------------------------------------------------
const crypto = require("crypto");
const SB_URL = (process.env.SUPABASE_URL || "https://qumhiffgbmcnlsdstbux.supabase.co").replace(/\/+$/, "");
const SB_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_Ssjk_M8lMetBMWbUhha-6g_eM2do4gn";
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const CLAN_DB_ON = !!SB_SERVICE_KEY && typeof fetch === "function";
const CLAN_MAX_SIZE = 25; // matches the "MEMBERS x/25" readout in index.html

// clanId -> { id, name, leaderUid, members: [{ uid, name }] }  (members in join order)
const clans = new Map();
const clanOfUid = new Map();    // account uid -> clanId
const onlineByUid = new Map();  // account uid -> connected player (latest connection)
let clanLoaded = false;

async function sbRest(method, pathQuery, body) {
  const headers = { apikey: SB_SERVICE_KEY, "Content-Type": "application/json" };
  // New-style "sb_secret_..." keys go in apikey only; old JWT service keys also go in Authorization.
  if (!SB_SERVICE_KEY.startsWith("sb_")) headers.Authorization = "Bearer " + SB_SERVICE_KEY;
  if (method !== "GET") headers.Prefer = "return=minimal";
  const r = await fetch(SB_URL + "/rest/v1/" + pathQuery, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(method + " " + pathQuery + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return method === "GET" ? r.json() : null;
}

// Saves happen one after another (a clan row must exist before its member
// rows), in the background — gameplay never waits on the database.
let clanDbQueue = Promise.resolve();
function clanDb(op) {
  if (!CLAN_DB_ON) return;
  clanDbQueue = clanDbQueue.then(op).catch((e) => console.error("[clans] save failed:", e && e.message || e));
}
const q = encodeURIComponent;

async function loadClans() {
  if (!CLAN_DB_ON) {
    console.log("[clans] SUPABASE_SERVICE_KEY not set — clans are memory-only (lost on server restart).");
    clanLoaded = true;
    return;
  }
  for (let attempt = 1; !clanLoaded; attempt++) {
    try {
      const cs = await sbRest("GET", "clans?select=id,name,leader_uid");
      const ms = await sbRest("GET", "clan_members?select=uid,clan_id,name&order=joined_at.asc");
      clans.clear(); clanOfUid.clear();
      for (const c of cs) clans.set(c.id, { id: c.id, name: c.name, leaderUid: c.leader_uid, members: [] });
      for (const m of ms) {
        const c = clans.get(m.clan_id);
        if (!c) continue;
        c.members.push({ uid: m.uid, name: m.name || "Player" });
        clanOfUid.set(m.uid, c.id);
      }
      for (const c of [...clans.values()]) {
        if (!c.members.length) { clans.delete(c.id); continue; }
        if (!c.members.some((m) => m.uid === c.leaderUid)) c.leaderUid = c.members[0].uid;
      }
      clanLoaded = true;
      console.log("[clans] loaded " + clans.size + " clan(s) from the database.");
      // anyone who connected while this was loading gets their clan now
      for (const [uid, p] of onlineByUid) {
        const c = clanOf(p);
        if (c) { p.clanId = c.id; send(p.ws, clanRosterPayload(c)); }
      }
    } catch (e) {
      console.error("[clans] load failed (attempt " + attempt + "): " + (e && e.message || e));
      await new Promise((res) => setTimeout(res, Math.min(30000, 3000 * attempt)));
    }
  }
}
loadClans();

// Proves which account a connection belongs to. Returns the Supabase user
// id, or null if the token is missing/invalid/expired.
async function verifyAccountToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4000 || typeof fetch !== "function") return null;
  try {
    const r = await fetch(SB_URL + "/auth/v1/user", {
      headers: { apikey: SB_ANON_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && typeof u.id === "string" ? u.id : null;
  } catch { return null; }
}

// Runs right after "join": works out the account, then hands the player
// their clan (if the account has one) and tells the clan they're online.
async function attachAccount(p, token) {
  const uid = await verifyAccountToken(token);
  p.uid = uid;
  p.uidChecked = true;
  if (!uid) return;
  if (p.ws.readyState !== 1) return; // already gone
  onlineByUid.set(uid, p);
  if (!clanLoaded) return; // loadClans() sends the roster the moment it finishes
  const clan = clanOf(p);
  if (!clan) return;
  p.clanId = clan.id;
  const mem = clan.members.find((m) => m.uid === uid);
  if (mem && mem.name !== p.name) {   // keep the stored display name fresh
    mem.name = p.name;
    clanDb(() => sbRest("PATCH", "clan_members?uid=eq." + q(uid), { name: p.name }));
  }
  broadcastClanUpdate(clan); // includes me, and shows my clanmates I'm back online
}

function clanOf(p) {
  const id = p.uid ? clanOfUid.get(p.uid) : null;
  return id ? (clans.get(id) || null) : null;
}

// Sends the reason and returns false when this player can't use clans yet.
function clanAccountReady(p) {
  if (!p.uidChecked) { send(p.ws, { type: "clanError", reason: "Still signing you in — try again in a moment" }); return false; }
  if (!p.uid) { send(p.ws, { type: "clanError", reason: "Sign in again to use clans" }); return false; }
  if (!clanLoaded) { send(p.ws, { type: "clanError", reason: "Clan data is loading — try again in a moment" }); return false; }
  return true;
}

// Ids in the roster are the live player id when that member is online, or
// "u:<uid>" when they're offline — index.html only compares them
// (leaderId === myId decides DISBAND vs LEAVE CLAN), so this stays
// compatible with the existing client.
function clanRosterPayload(clan) {
  const idOf = (uid) => { const o = onlineByUid.get(uid); return o ? o.id : "u:" + uid; };
  const nameOf = (m) => { const o = onlineByUid.get(m.uid); return o ? o.name : m.name; };
  const leader = clan.members.find((m) => m.uid === clan.leaderUid) || clan.members[0];
  return {
    type: "clanUpdate",
    clanId: clan.id,
    name: clan.name,
    leaderId: idOf(clan.leaderUid),
    leaderName: leader ? nameOf(leader) : "",
    members: clan.members.map((m) => ({ id: idOf(m.uid), name: nameOf(m), online: onlineByUid.has(m.uid) }))
  };
}

function broadcastClanUpdate(clan) {
  const payload = clanRosterPayload(clan);
  for (const m of clan.members) {
    const o = onlineByUid.get(m.uid);
    if (o) send(o.ws, payload);
  }
}

// Removes p from their clan. A clan with nobody left is deleted; if the
// leader left, leadership passes to whoever's been in the clan longest.
function removeFromClan(p) {
  const clan = clanOf(p);
  if (!clan) return;
  clan.members = clan.members.filter((m) => m.uid !== p.uid);
  clanOfUid.delete(p.uid);
  p.clanId = null;
  send(p.ws, { type: "clanUpdate", clanId: null, members: [] });
  clanDb(() => sbRest("DELETE", "clan_members?uid=eq." + q(p.uid)));
  if (!clan.members.length) {
    clans.delete(clan.id);
    clanDb(() => sbRest("DELETE", "clans?id=eq." + q(clan.id)));
    return;
  }
  if (clan.leaderUid === p.uid) {
    clan.leaderUid = clan.members[0].uid;
    clanDb(() => sbRest("PATCH", "clans?id=eq." + q(clan.id), { leader_uid: clan.leaderUid }));
  }
  broadcastClanUpdate(clan);
}

// Leader pressed DISBAND (after CONFIRM): the whole clan is removed and
// every member — leader included, online or not — loses it. Offline members
// find no clan the next time they log in.
function disbandClan(p) {
  const clan = clanOf(p);
  if (!clan || clan.leaderUid !== p.uid) return;
  for (const m of clan.members) {
    clanOfUid.delete(m.uid);
    const o = onlineByUid.get(m.uid);
    if (o) {
      o.clanId = null;
      send(o.ws, { type: "clanUpdate", clanId: null, members: [] });
    }
  }
  clans.delete(clan.id);
  clanDb(() => sbRest("DELETE", "clans?id=eq." + q(clan.id))); // members go with it (cascade)
}

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
  if (!r) { r = new Map(); r.hostId = null; r.lastBots = null; r.drops = new Map(); r.nextDropId = 1; rooms.set(k, r); }
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
// Loot lying on the ground in a room (dropped by enemies). The server keeps it
// so people who join / come back later still see it. Cleared when the room empties.
// Loot stays even when the room is empty (so someone logging in later still finds
// it) until it is DROP_MAX_AGE_MS old. NOTE: it lives in the server's memory, so it
// is lost whenever the server restarts / goes to sleep (Render free plan).
// MAX_ROOM_DROPS now lives in server/game_server.js (see that file).
const { MAX_ROOM_DROPS } = GAME_DATA;
const DROP_MAX_AGE_MS = 72 * 60 * 60 * 1000;
// Works out a stored drop's item CATEGORY so "dropTake" knows which
// PARTY_LOOT_RULES rule (see server/game_server.js) applies to it. Mirrors
// the same lookup order item_server.js's createItemDrop() uses client-side
// — kept independent here since the server only has the plain data tables
// (WEAPONS/ARMOR_TYPES/STONE_TYPES/ORB_TYPES/ITEM_TYPES from GAME_DATA), not
// the browser-only functions that build on them. A manual inventory drop
// (drop.k === "inv") is always "invItem" — createInventoryItemDrop() never
// tags it any other way. An unrecognized bot-loot type name falls back to
// "item" (SHARED), the safe default from game_server.js.
function categoryForDrop(drop) {
  if (drop.k === "inv") return "invItem";
  const t = drop.t;
  // Gold orbs are kept separate from ITEM_TYPES on purpose (see
  // server/item_server.js) — their chance/amount come from BOT_TYPES per
  // bot instead of a shared table entry, so there's no ITEM_TYPES.goldOrb
  // to look up here.
  if (t === "goldOrb") return "gold";
  const w = GAME_DATA.WEAPONS && GAME_DATA.WEAPONS[t];
  if (w && w.category === "weapon") return "weapon";
  const a = GAME_DATA.ARMOR_TYPES && GAME_DATA.ARMOR_TYPES[t];
  if (a && a.category === "armor") return "armor";
  if (GAME_DATA.STONE_TYPES && GAME_DATA.STONE_TYPES[t]) return "stone";
  if (GAME_DATA.ORB_TYPES && GAME_DATA.ORB_TYPES[t]) return "orb";
  const itemDef = GAME_DATA.ITEM_TYPES && GAME_DATA.ITEM_TYPES[t];
  if (itemDef) return itemDef.category || "item";
  return "item";
}

function pruneDrops(room) {
  const cutoff = Date.now() - DROP_MAX_AGE_MS;
  for (const [id, d] of room.drops) if (d.at < cutoff) room.drops.delete(id);
}
function dropList(room) {
  pruneDrops(room);
  return [...room.drops.values()].map((d) => d.k === "inv"
    ? { id: d.id, k: "inv", invType: d.invType, name: d.name, data: d.data, qty: d.qty, x: d.x, y: d.y }
    : { id: d.id, t: d.t, x: d.x, y: d.y });
}
function clearDropsIfEmpty() { /* intentionally keeps loot in empty rooms */ }
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
      // Player-typed name from the "Name Your Character" popup (see
      // olOpenNamePopup in online.js) — falls back to "Player N" if it's
      // missing, blank, or just whitespace/control characters.
      const wantedName = typeof msg.name === "string"
        ? msg.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 16)
        : "";
      me = {
        id, ws,
        server: serverId, channel, map: START_MAP, room, lastMapChange: 0,
        name: wantedName || ("Player " + id),
        character: chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier"),
        x: 0, y: 0,
        health: 100, maxHealth: 100,
        alive: true,
        level: 1,
        hitWindowStart: 0, hitCount: 0,
        botHitWindowStart: 0, botHitCount: 0,
        skillGlobalLockedUntil: 0, // see game_server.js's isPlayerSkillLocked()
        partyId: null,
        clanId: null,
        uid: null, uidChecked: false   // Supabase account id, filled in by attachAccount()
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
        bots: room.lastBots || [],
        drops: dropList(room)
      });
      // Start with "no clan" (clears anything stale on the client), then work
      // out which account this is and send its real clan, if it has one.
      send(ws, { type: "clanUpdate", clanId: null, members: [] });
      attachAccount(me, msg.token);
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

      // A player took damage: tell everyone else in the room so they see the
      // floating damage number above that player too (attacker + onlookers).
      case "dmgNum":
        broadcast(me.room, {
          type: "dmgNum", from: me.id,
          x: num(msg.x), y: num(msg.y),
          amount: Math.min(MAX_DAMAGE_PER_HIT, Math.max(0, Math.round(num(msg.amount)))),
          isCritical: !!msg.isCritical
        }, me.id);
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

        // SKILL LOCK — same enforcement as the "hit" case above, for a
        // player-vs-bot skill hit (online.js's damageBot() override).
        if (msg.isSkillHit) {
          if (isPlayerSkillLocked(me, now)) break;
          lockPlayerSkillUse(me, now);
        }

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

      // PvE loot: only the room's enemy host may create ground items (it's
      // the one that knows an enemy just died). The server numbers them and
      // tells EVERYONE (host included) so all clients hold identical drops.
      case "dropAdd": {
        if (me.room.hostId !== me.id || !Array.isArray(msg.drops)) break;
        const added = [];
        for (const d of msg.drops.slice(0, 20)) {
          if (!d || typeof d.t !== "string" || d.t.length > 40) continue;
          const drop = { id: me.room.nextDropId++, t: d.t, x: num(d.x), y: num(d.y), at: Date.now() };
          // Gold orbs carry their own amount (varies per bot type — see
          // spawnGoldOrbChance/goldOrbAmount on BOT_TYPES), instead of a
          // single shared amount looked up from ITEM_TYPES. Clamped to a
          // sane range so a hacked host can't mint arbitrary gold.
          if (d.t === "goldOrb") drop.amt = Math.max(0, Math.min(10000, Math.trunc(num(d.amt))));
          me.room.drops.set(drop.id, drop);
          added.push(drop);
        }
        while (me.room.drops.size > MAX_ROOM_DROPS) me.room.drops.delete(me.room.drops.keys().next().value);
        if (added.length) broadcast(me.room, { type: "dropAdd", drops: added.map(({ id, t, x, y, amt }) => ({ id, t, x, y, amt })) }, -1);
        break;
      }

      // Manual drop: any player (not just the bot host) dragging a weapon/
      // armor/stone out of their Inventory/Equip popup onto open ground.
      // Unlike bot loot above, this carries the actual inventory entry
      // (name/data/qty) along instead of a looked-up type name, so armor
      // stats etc. survive being dropped and picked back up. Server numbers
      // it and echoes it to EVERYONE including the dropper, same as bot
      // loot, so the ground copy only ever exists once, server-confirmed.
      case "invDropAdd": {
        const entry = msg.entry;
        if (!entry || typeof entry.name !== "string" || !entry.name || entry.name.length > 60) break;
        let data = entry.data;
        try {
          if (data != null && JSON.stringify(data).length > 4000) data = null;
        } catch (e) { data = null; }
        const drop = {
          id: me.room.nextDropId++,
          k: "inv",
          invType: typeof entry.invType === "string" ? entry.invType.slice(0, 30) : "",
          name: entry.name.slice(0, 60),
          data,
          qty: Math.max(1, Math.min(999, Math.trunc(num(entry.qty, 1)))),
          x: num(msg.x), y: num(msg.y), at: Date.now()
        };
        me.room.drops.set(drop.id, drop);
        while (me.room.drops.size > MAX_ROOM_DROPS) me.room.drops.delete(me.room.drops.keys().next().value);
        broadcast(me.room, {
          type: "invDropAdd",
          drop: { id: drop.id, k: "inv", invType: drop.invType, name: drop.name, data: drop.data, qty: drop.qty, x: drop.x, y: drop.y }
        }, -1);
        break;
      }

      // Someone picked an item up: it's gone for everybody (and for late
      // joiners). Any party member (or solo player) can claim any ground
      // drop — first valid claim wins. "dropStillThere" only fires now if
      // the drop is already gone by the time this message arrives (e.g. a
      // party member beat you to it a moment ago); see the id check right
      // above it.
      //
      // PARTY LOOT: solo players (or a broken/1-member party record) keep
      // the old behavior exactly — online.js already applied the pickup to
      // itself locally before sending this, so there's nothing more to do
      // here. In a real party (2+ members), online.js does NOT apply
      // anything locally for a shared drop — it just reports the claim and
      // waits — so this is where the item actually gets awarded, per
      // whichever PARTY_LOOT_RULES rule (server/game_server.js) the drop's
      // category maps to:
      //   ALTERNATE — one "partyLootAward" to the current turn holder only,
      //     then advance the turn so the NEXT claim (by anyone) goes to
      //     whoever's next.
      //   SPLIT     — gold divided evenly across every member (remainder
      //     handed out one-each from the front of the turn order).
      //   SHARED    — one "partyLootAward" to EVERY member (claimer
      //     included), so a speedup/health/shield/powerup benefits the
      //     whole party at once.
      // Each recipient's own client applies the effect using its own local
      // functions (pickUpWeaponDrop/pickUpArmorDrop/pickUpInventoryDrop/
      // pickUpUpgradeDrop/pickUpGoldOrb/applyItemEffect) — same
      // "server relays, each client applies to itself" pattern already used
      // for party exp ("partyExpAward" above).
      case "dropTake": {
        const id = Math.trunc(num(msg.id, -1));
        const drop = me.room.drops.get(id);
        if (!drop) {
          send(ws, { type: "dropStillThere", id, taken: true });
          break;
        }

        me.room.drops.delete(id);
        broadcast(me.room, { type: "dropGone", id }, me.id);

        const party = getParty(me);
        if (party) {
          // Drop any stale/disconnected member (see prunePartyMembers() in
          // server/game_server.js) BEFORE looking at party.members.length or
          // computing a rule — this is the actual fix for loot repeatedly
          // landing back on the picker instead of alternating.
          if (prunePartyMembers(party, players)) broadcastPartyUpdate(party);
        }
        if (party && party.members.length >= 2) {
          const category = categoryForDrop(drop);
          const rule = partyLootRuleForCategory(category);
          // Temporary diagnostic — safe to remove later. Shows up in Render's
          // logs so you can confirm the party really had 2+ members and see
          // exactly what category/rule/turn each claim resolved to.
          console.log("[partyLoot] picker=" + me.id + " category=" + category + " rule=" + rule +
            " partyMembers=" + JSON.stringify(party.members) + " turnIndex=" + (party.lootTurnIndex || 0));
          // itemType (NOT "type") on purpose — Object.assign lets the LAST
          // object's keys win on conflict, and every award message needs
          // its outer "type" to stay "partyLootAward" (that's the field
          // online.js's switch dispatches the whole message on). A plain
          // weapon/armor/stone/orb drop's own type name (e.g. "uzi") used
          // to be stored under this same "type" key, so Object.assign below
          // silently overwrote "partyLootAward" with "uzi" before the
          // message ever left the server — online.js's "partyLootAward"
          // case then never matched on the receiving client, and that
          // player's award just vanished with no error on either side.
          // invItem was never affected (it already used "invType"), and
          // neither was gold/SPLIT or the buff/SHARED path (they build
          // their own message objects with unique field names instead of
          // merging itemPayload in at all) — exactly why gold and
          // health/shield/speedup/powerup always worked while weapon,
          // armor, and stone/orb (upgrade_server.js) didn't.
          const itemPayload = drop.k === "inv"
            ? { category, invType: drop.invType, name: drop.name, data: drop.data, qty: drop.qty }
            : { category, itemType: drop.t };

          if (rule === "SPLIT") {
            // Gold orbs carry their own amount per drop (varies by which
            // bot dropped them — see spawnGoldOrbChance/goldOrbAmount on
            // BOT_TYPES), stored on the drop itself in the dropAdd handler
            // above, instead of a single shared amount looked up from
            // ITEM_TYPES.
            const total = drop.amt || 0;
            const share = Math.floor(total / party.members.length);
            let remainder = total - share * party.members.length;
            for (const pid of party.members) {
              const m = players.get(pid);
              if (!m) continue;
              const amount = share + (remainder > 0 ? 1 : 0);
              if (remainder > 0) remainder--;
              send(m.ws, { type: "partyLootAward", mode: "gold", amount });
            }
          } else if (rule === "SHARED") {
            for (const pid of party.members) {
              const m = players.get(pid);
              if (!m) continue;
              send(m.ws, { type: "partyLootAward", mode: "effect", itemType: drop.t });
            }
          } else { // ALTERNATE
            // party.members is now pruned to live ids only (see above), so
            // this should always resolve to a real, connected player — the
            // "|| me" is just a last-resort safety net, not the normal path.
            const recipientId = getPartyLootTurnId(party);
            const recipient = (recipientId != null && players.get(recipientId)) || me;
            // itemPayload spread FIRST, { type, mode } applied LAST — so the
            // "partyLootAward" discriminator always wins even if itemPayload
            // ever grows a field that happens to be named "type" or "mode"
            // again. This is the actual fix for the field-collision bug
            // above; the itemType rename alone already fixes today's case,
            // this just stops the same class of bug from coming back.
            send(recipient.ws, Object.assign({}, itemPayload, { type: "partyLootAward", mode: "item" }));
            advancePartyLootTurn(party);
          }
        }
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
        clearDropsIfEmpty(oldRoom);

        me.map = key;
        me.room = getRoom(me.server, me.channel, key);
        const isFirstInNewRoom = me.room.size === 0;
        me.room.set(me.id, me);
        if (isFirstInNewRoom) { me.room.hostId = me.id; me.room.lastBots = null; }
        send(ws, {
          type: "mapChanged", map: key,
          players: [...me.room.values()].filter((p) => p.id !== me.id).map(publicInfo),
          botHost: me.room.hostId === me.id,
          bots: me.room.lastBots || [],
          drops: dropList(me.room)
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

        // Party members never damage each other, even on a PvP channel.
        if (isPartyFriendlyFire(me.partyId, target.partyId)) break;

        // Clanmates never damage each other, either.
        if (isClanFriendlyFire(me.clanId, target.clanId)) break;

        // rate limit per attacker
        const now = Date.now();
        if (now - me.hitWindowStart >= 1000) { me.hitWindowStart = now; me.hitCount = 0; }
        if (++me.hitCount > MAX_HITS_PER_SECOND) break;

        // SKILL LOCK — server-authoritative version of game.js's
        // player.skillGlobalLockedUntil (see game_server.js). Only
        // hits the client tagged isSkillHit go through this; drop it
        // if this player's own skill lock (tracked here, not on the
        // client) hasn't expired yet, no matter what that client claims.
        if (msg.isSkillHit) {
          if (isPlayerSkillLocked(me, now)) break;
          lockPlayerSkillUse(me, now);
        }

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

      // A player tapped ADD FRIEND on someone they're near — relay the
      // request to that specific player (same targeted-send pattern as
      // "hit" above), same server + channel + map room only.
      case "friendRequest": {
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;
        send(target.ws, { type: "friendRequest", from: me.id, fromName: me.name });
        break;
      }

      // ACCEPT / DECLINE reply, relayed back to whoever sent the request.
      case "friendResponse": {
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;
        send(target.ws, { type: "friendResponse", from: me.id, fromName: me.name, accept: !!msg.accept });
        break;
      }

      // Sent when the INVITE PARTY button is tapped on a nearby player (see
      // playerTouchInviteBtn in online.js) — relay it to that player, same
      // targeted-send pattern as "friendRequest" above (proximity was
      // already enforced client-side by NET_TOUCH_RANGE).
      case "partyInvite": {
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;
        const myParty = getParty(me);
        if (myParty && myParty.members.length >= PARTY_MAX_SIZE) {
          send(ws, { type: "partyError", reason: "Your party is full (max " + PARTY_MAX_SIZE + ")" });
          break;
        }
        if (getParty(target)) {
          send(ws, { type: "partyError", reason: (target.name || "That player") + " is already in a party" });
          break;
        }
        send(target.ws, { type: "partyInvite", from: me.id, fromName: me.name });
        break;
      }

      // ACCEPT / DECLINE reply to a party invite. Looked up by player id
      // across the whole server (not just this room) — the inviter may have
      // walked to a different map by now and this should still reach them,
      // same as party membership itself persists across map changes.
      case "partyResponse": {
        const inviter = players.get(num(msg.targetId, -1));
        if (!inviter || inviter.id === me.id) break;
        if (!msg.accept) {
          send(inviter.ws, { type: "partyResponse", from: me.id, fromName: me.name, accept: false });
          break;
        }
        if (getParty(me)) { send(ws, { type: "partyError", reason: "You're already in a party" }); break; }
        let party = getParty(inviter);
        if (!party) {
          party = { id: nextPartyId++, members: [inviter.id], lootTurnIndex: 0 };
          parties.set(party.id, party);
          inviter.partyId = party.id;
        }
        if (party.members.length >= PARTY_MAX_SIZE) {
          send(ws, { type: "partyError", reason: "That party is full" });
          break;
        }
        party.members.push(me.id);
        me.partyId = party.id;
        send(inviter.ws, { type: "partyResponse", from: me.id, fromName: me.name, accept: true });
        broadcastPartyUpdate(party);
        break;
      }

      // Leaving my own party.
      case "partyLeave":
        removeFromParty(me);
        break;

      // Only the party's creator (members[0]) can kick someone out.
      case "partyKick": {
        const party = getParty(me);
        if (!party || party.members[0] !== me.id) break;
        const target = players.get(num(msg.targetId, -1));
        if (!target || getParty(target) !== party) break;
        removeFromParty(target);
        send(target.ws, { type: "partyKicked" });
        break;
      }

      // A party member's client worked out (via computePartyExpShare() in
      // server/character_server.js) that a fellow member within range gets a
      // share of a kill they just landed — pass it straight to that member.
      // Same trust model as "hit"/"botHit" above: the amount is taken on
      // faith, so this is only as cheat-proof as everything else online.
      case "partyExpAward": {
        const party = getParty(me);
        if (!party) break;
        const target = players.get(num(msg.targetId, -1));
        if (!target || target.id === me.id || !party.members.includes(target.id)) break;
        const amount = Math.max(0, Math.round(num(msg.amount, 0)));
        if (amount <= 0) break;
        send(target.ws, { type: "partyExpAward", amount, fromId: me.id });
        break;
      }

      // Player pressed CREATE CLAN in the OPTIONS popup (see
      // submitClanCreate() in index.html). The clan is saved to the ACCOUNT
      // (see the CLANS section above). Gold cost is enforced client-side
      // only (same trust model as everything else online).
      case "clanCreate": {
        if (!clanAccountReady(me)) break;
        if (clanOf(me)) { send(ws, { type: "clanError", reason: "You're already in a clan" }); break; }
        const name = String(msg.name || "").replace(/[\r\n\t]+/g, " ").slice(0, 20).trim();
        if (!name) break;
        const clan = { id: crypto.randomBytes(6).toString("hex"), name, leaderUid: me.uid, members: [{ uid: me.uid, name: me.name }] };
        clans.set(clan.id, clan);
        clanOfUid.set(me.uid, clan.id);
        me.clanId = clan.id;
        clanDb(async () => {
          await sbRest("POST", "clans", { id: clan.id, name: clan.name, leader_uid: clan.leaderUid });
          await sbRest("POST", "clan_members", { uid: me.uid, clan_id: clan.id, name: me.name });
        });
        send(ws, clanRosterPayload(clan));
        break;
      }

      // ADD CLAN on a nearby player (see playerTouchClanBtn in online.js) —
      // only works if I actually have a clan; relay the invite to that
      // player, same targeted-send pattern as "partyInvite" above.
      case "clanInvite": {
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;
        const myClan = clanOf(me);
        if (!myClan) { send(ws, { type: "clanError", reason: "You don't have a clan yet" }); break; }
        if (!target.uid) { send(ws, { type: "clanError", reason: (target.name || "That player") + " can't join clans right now" }); break; }
        if (clanOf(target)) { send(ws, { type: "clanError", reason: (target.name || "That player") + " is already in a clan" }); break; }
        send(target.ws, { type: "clanInvite", from: me.id, fromName: me.name, clanId: myClan.id, clanName: myClan.name });
        break;
      }

      // ACCEPT CLAN / REJECT reply to a clan invite. Looked up by clanId
      // (not the inviter's player id) so it still resolves even if the
      // inviter has since walked to a different map.
      case "clanResponse": {
        if (!msg.accept) break;   // silent reject — no need to notify the inviter
        if (!clanAccountReady(me)) break;
        if (clanOf(me)) { send(ws, { type: "clanError", reason: "You're already in a clan" }); break; }
        const clan = clans.get(String(msg.clanId));
        if (!clan) { send(ws, { type: "clanError", reason: "That clan no longer exists" }); break; }
        if (clan.members.length >= CLAN_MAX_SIZE) { send(ws, { type: "clanError", reason: "That clan is full" }); break; }
        clan.members.push({ uid: me.uid, name: me.name });
        clanOfUid.set(me.uid, clan.id);
        me.clanId = clan.id;
        clanDb(() => sbRest("POST", "clan_members", { uid: me.uid, clan_id: clan.id, name: me.name }));
        broadcastClanUpdate(clan);
        break;
      }

      // Leaving my own clan (a member's LEAVE CLAN).
      case "clanLeave":
        if (!clanOf(me)) { send(ws, { type: "clanUpdate", clanId: null, members: [] }); break; }
        removeFromClan(me);
        break;

      // DISBAND — leader only; removes the clan and all its members.
      case "clanDisband": {
        const c = clanOf(me);
        if (!c) { send(ws, { type: "clanUpdate", clanId: null, members: [] }); break; }
        if (c.leaderUid !== me.uid) { send(ws, { type: "clanError", reason: "Only the leader can disband" }); break; }
        disbandClan(me);
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
    removeFromParty(me);
    // Closing the app does NOT leave the clan (it's saved to the account) —
    // just go offline and let the clan see it.
    if (me.uid && onlineByUid.get(me.uid) === me) {
      onlineByUid.delete(me.uid);
      const myClan = clanOf(me);
      if (myClan) broadcastClanUpdate(myClan);
    }
    players.delete(me.id);
    me.room.delete(me.id);
    broadcast(me.room, { type: "playerRemove", id: me.id });
    reassignHost(me.room, me.id);   // hand off enemy-hosting if I was hosting
    clearDropsIfEmpty(me.room);
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
