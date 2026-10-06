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
// PORTAL ARRIVAL SPAWN — server-authoritative too (see game_server.js's
// getPortalArrivalSpawn() comment): the "map" case below decides where a
// player lands, the client just gets told.
const { isPlayerSkillLocked, lockPlayerSkillUse, getPortalArrivalSpawn, syncReportedMana, tryPaySkillUse, hasPaidSkillUse, consumeSkillHit, findSkillDef } = require("./server/game_server.js");

// ONLINE RULES — respawn / spawn-protect / update rates / trade limits live in
// server/online_server.js (not in the public online.js); enforced below.
const { ONLINE_RULES } = require("./server/online_server.js");

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
  require("./server/game_server.js"),
  require("./server/online_server.js")
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
// The boss arena file (boss1_server.js) loads BEFORE worldmap_server.js (alphabetical), so move its
// map to the END of the list: otherwise it would become the "first map" = everyone's start map.
if (MAPS.BOSSEVENT) { const bossMap = MAPS.BOSSEVENT; delete MAPS.BOSSEVENT; MAPS.BOSSEVENT = bossMap; }
const START_MAP = MAPS.worldmap ? "worldmap" : (MAPS.LEVEL1 ? "LEVEL1" : Object.keys(MAPS).find((k) => k !== "BOSSEVENT"));   // where everyone spawns (never the boss arena)
// ---- BOSS EVENT MAP (hard-coded) -------------------------------------------
// A private arena map that is only reachable through the WAR ZONE > BOSS EVENT
// button (never through a portal). Its map data is in server/boss1_server.js;
// edit BOSS_EVENT below to change the rules.
// Schedule is in PHILIPPINE TIME (UTC+8): Monday, Wednesday, Friday, 8 PM - 10 PM.
const BOSS_EVENT = {
  KEY: "BOSSEVENT",
  MIN_LEVEL: 20,
  DAYS: [1, 3, 5],        // 0=Sunday ... 1=Monday, 3=Wednesday, 5=Friday
  START_HOUR: 20,         // 8 PM
  END_HOUR: 22,           // 10 PM (everyone is sent back to their last map)
  TZ_OFFSET_HOURS: 8      // Philippines
};
// The arena map itself lives in server/boss1_server.js (key "BOSSEVENT", loaded with the other map files).
if (!MAPS[BOSS_EVENT.KEY]) console.warn("[boss event] server/boss1_server.js not found — BOSS EVENT is disabled until it is uploaded.");
GAME_DATA.WORLD_MAPS = MAPS;
GAME_DATA.START_MAP = START_MAP;

// SAVE GUARD — checks every account save before it reaches the database and keeps
// the server's own record of gold/items it saw a player pick up or trade (see
// save_guard.js). The whole GAME_DATA is passed so it knows the real item names,
// shop prices, characters and level cap.
const { createSaveGuard } = require("./save_guard.js");
const saveGuard = createSaveGuard(GAME_DATA);

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
// Server count / player cap / channels / party size now live in server/online_server.js.
const SERVER_COUNT = ONLINE_RULES.SERVER_COUNT;
const SERVER_MAX_PLAYERS = ONLINE_RULES.SERVER_MAX_PLAYERS;
const CHANNEL_PVP = ONLINE_RULES.CHANNELS.find((c) => c.pvp).id;     // players can damage each other
const CHANNEL_SAFE = ONLINE_RULES.CHANNELS.find((c) => !c.pvp).id;   // no player-vs-player damage

// No per-hit damage cap and no hits-per-second limit (both removed on purpose).

// Plain HTTP: /servers gives the lobby its "0/500" counts; anything else is a
// health check so hosts (Render etc.) know the service is alive.
// The ONLINE-MODE CLIENT CODE (client/online_client.js). It is not in the public game
// files any more: the public data/online.js downloads it from here when the player taps
// "Online". Read on every request so a redeploy / file edit is picked up immediately.
const ONLINE_CLIENT_FILE = path_join(__dirname, "client", "online_client.js");
function path_join(...a) { return require("path").join(...a); }

const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  // Browser pre-flight for the account API below (it sends an Authorization header).
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600"
    });
    res.end();
    return;
  }
  // Shop owner page / approvals / PayMongo webhook — see "REAL-MONEY SHOP" further down.
  if (path === "/admin/shop" || path.startsWith("/api/admin/") || path === "/api/paymongo/webhook") {
    handleShopOwner(req, res, path).catch((e) => {
      console.error("[shop] " + path + " failed:", e && e.message || e);
      if (!res.headersSent) apiReply(res, 500, { error: "SERVER_ERROR" });
    });
    return;
  }
  // Account saves / session claims — see "ACCOUNT SAVES" further down.
  if (path.startsWith("/api/") && req.method === "POST") {
    handleApi(req, res, path).catch((e) => {
      console.error("[api] " + path + " failed:", e && e.message || e);
      if (!res.headersSent) apiReply(res, 502, { error: "SERVER_ERROR" });
    });
    return;
  }
  if (path === "/online.js") {
    let code;
    try { code = fs.readFileSync(ONLINE_CLIENT_FILE, "utf8"); }
    catch (e) { res.writeHead(500, { "Access-Control-Allow-Origin": "*" }); res.end("online client code missing"); return; }
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(code);
    return;
  }
  if (path === "/servers") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(serverList()));
    return;
  }
  // Character pictures for the online picker (comes from character_server.js)
  if (path === "/characters") {
    const out = {};
    const chars = GAME_DATA.CHARACTERS || {};
    for (const n in chars) if (chars[n] && chars[n].image) out[n] = chars[n].image;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(out));
    return;
  }
  // Real ONLINE stats of every character (from character_server.js) for the
  // stats popup on the online character picker — that popup opens BEFORE the
  // server has sent its game data, so without this it shows the offline
  // character.js numbers.
  if (path === "/characterstats") {
    const out = {};
    const chars = GAME_DATA.CHARACTERS || {};
    // getCharacter() looks armor up through a browser-style global; expose it
    // only for this synchronous block, then put everything back.
    const need = ["getArmor", "getWeapon"];
    const saved = {};
    for (const n of need) {
      saved[n] = global[n];
      if (typeof GAME_DATA[n] === "function") global[n] = GAME_DATA[n];
    }
    try {
      for (const n in chars) {
        try {
          const c = GAME_DATA.getCharacter(n);
          out[n] = {
            health: c.health, physicalDefense: c.physicalDefense,
            magicalDefense: c.magicalDefense, magicalAttack: c.magicalAttack,
            physicalDamage: c.physicalDamage,
            criticalChance: c.criticalChance, criticalDamage: c.criticalDamage,
            mana: c.mana, movementSpeed: chars[n].movementSpeed,
            weaponName: chars[n].weaponName, description: chars[n].description || "",
            vit: chars[n].vit || 0, dex: chars[n].dex || 0,
            int: chars[n].int || 0, pow: chars[n].pow || 0
          };
        } catch (e) { /* skip a character that fails to resolve */ }
      }
    } finally {
      for (const n of need) {
        if (saved[n] === undefined) delete global[n]; else global[n] = saved[n];
      }
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(out));
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
const PARTY_MAX_SIZE = ONLINE_RULES.PARTY_MAX_SIZE;   // see server/online_server.js

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

async function sbRest(method, pathQuery, body, prefer) {
  const headers = { apikey: SB_SERVICE_KEY, "Content-Type": "application/json" };
  // New-style "sb_secret_..." keys go in apikey only; old JWT service keys also go in Authorization.
  if (!SB_SERVICE_KEY.startsWith("sb_")) headers.Authorization = "Bearer " + SB_SERVICE_KEY;
  if (method !== "GET") headers.Prefer = prefer || "return=minimal";
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
      const cs = await sbRest("GET", "clans?select=id,name,leader_uid,message");
      const ms = await sbRest("GET", "clan_members?select=uid,clan_id,name&order=joined_at.asc");
      clans.clear(); clanOfUid.clear();
      for (const c of cs) clans.set(c.id, { id: c.id, name: c.name, leaderUid: c.leader_uid, message: c.message || "", members: [] });
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

// Proves which account a token belongs to. Returns { id, email } (the Supabase
// user), or null if the token is missing/invalid/expired. Answers are cached for
// 30 seconds so a save every few seconds doesn't hit Supabase Auth every time.
const tokenCache = new Map();   // token -> { user, exp }
async function verifyAccountUser(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4000 || typeof fetch !== "function") return null;
  const now = Date.now();
  const hit = tokenCache.get(token);
  if (hit && hit.exp > now) return hit.user;
  try {
    const r = await fetch(SB_URL + "/auth/v1/user", {
      headers: { apikey: SB_ANON_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) { tokenCache.delete(token); return null; }
    const u = await r.json();
    if (!u || typeof u.id !== "string") return null;
    const user = { id: u.id, email: typeof u.email === "string" ? u.email : "" };
    if (tokenCache.size > 2000) { for (const [k, v] of tokenCache) if (v.exp <= now) tokenCache.delete(k); if (tokenCache.size > 2000) tokenCache.clear(); }
    tokenCache.set(token, { user, exp: now + 30000 });
    return user;
  } catch { return null; }
}
async function verifyAccountToken(token) {
  const u = await verifyAccountUser(token);
  return u ? u.id : null;
}

// ---------------------------------------------------------------------------
// ACCOUNT SAVES — the ONLY code that writes the player_data table.
// ---------------------------------------------------------------------------
// The game used to write player_data straight from the player's phone, so a
// modified client could store any gold / items / level. Now:
//   * supabase_lockdown.sql removes every client write permission on the table
//     (players can still READ their own row);
//   * the client sends its save here (POST /api/save) with its login token;
//   * save_guard.js reviews it, then THIS server writes it with the service key;
//   * the single-device "active_session" claim/release also goes through here.
// Needs SUPABASE_SERVICE_KEY (same one the clans use). Without it saving is
// refused (503) rather than silently skipped.
// ---------------------------------------------------------------------------
let PD_HAS_USERNAME = true;   // flips off by itself if the table has no "username" column

function apiReply(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// One database operation per account at a time (read-check-write must not interleave).
const uidLocks = new Map();
function withUidLock(uid, fn) {
  const prev = uidLocks.get(uid) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  uidLocks.set(uid, next);
  next.then(() => {}, () => {}).then(() => { if (uidLocks.get(uid) === next) uidLocks.delete(uid); });
  return next;
}

async function writePlayerRow(user, gameData) {
  const row = { id: user.id, game_data: gameData };
  if (PD_HAS_USERNAME && user.email) row.username = user.email;
  const prefer = "resolution=merge-duplicates,return=minimal";   // upsert: only the columns we send change (active_session is left alone)
  try {
    await sbRest("POST", "player_data?on_conflict=id", row, prefer);
  } catch (e) {
    if (PD_HAS_USERNAME && /username/i.test(String(e && e.message))) {
      PD_HAS_USERNAME = false;
      delete row.username;
      await sbRest("POST", "player_data?on_conflict=id", row, prefer);
    } else throw e;
  }
}

async function apiSave(user, body) {
  if (!saveGuard.allowSaveRate(user.id)) return [429, { error: "RATE_LIMITED" }];
  return withUidLock(user.id, async () => {
    const rows = await sbRest("GET", "player_data?select=game_data,active_session&id=eq." + q(user.id));
    const row = (Array.isArray(rows) && rows[0]) || null;
    const session = typeof body.session === "string" ? body.session.toLowerCase() : null;
    // Only the device that owns the account right now may save.
    if (row && row.active_session && row.active_session !== session) return [409, { error: "SESSION_TAKEN" }];
    const stored = row && row.game_data && typeof row.game_data === "object" ? row.game_data : null;
    const incoming = body.game_data;
    // Older than (or same as) what is stored: nothing to write, just report what the database holds.
    if (stored && incoming && Number(incoming.savedAt) <= Number(stored.savedAt || 0)) return [200, { ok: true, cloud: stored }];
    const rev = saveGuard.review(user.id, stored, incoming);
    if (!rev.ok) return [400, { error: rev.error }];
    await writePlayerRow(user, rev.gameData);
    rev.commit();
    if (rev.notes.length) console.log("[save] " + user.id.slice(0, 8) + " corrected: " + rev.notes.slice(0, 6).join("; "));
    return [200, { ok: true, cloud: rev.gameData, goldFixed: rev.goldFixed }];
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function apiSession(user, body) {
  const sid = typeof body.session === "string" && UUID_RE.test(body.session) ? body.session.toLowerCase() : null;
  if (!sid) return [400, { error: "BAD_SESSION" }];
  return withUidLock(user.id, async () => {
    if (body.action === "claim") {
      await sbRest("POST", "player_data?on_conflict=id", { id: user.id, active_session: sid }, "resolution=merge-duplicates,return=minimal");
      return [200, { ok: true }];
    }
    if (body.action === "release") {
      // only clears the claim if it is still OURS
      await sbRest("PATCH", "player_data?id=eq." + q(user.id) + "&active_session=eq." + q(sid), { active_session: null });
      return [200, { ok: true }];
    }
    return [400, { error: "BAD_ACTION" }];
  });
}

async function handleApi(req, res, urlPath) {
  if (!CLAN_DB_ON) { apiReply(res, 503, { error: "SAVES_DISABLED" }); return; }   // no SUPABASE_SERVICE_KEY on this server
  const auth = String(req.headers.authorization || "");
  const user = await verifyAccountUser(auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (!user) { apiReply(res, 401, { error: "UNAUTHORIZED" }); return; }
  let body;
  try { body = await readJsonBody(req, 256 * 1024); } catch (e) { apiReply(res, 400, { error: "BAD_REQUEST" }); return; }
  if (!body || typeof body !== "object") { apiReply(res, 400, { error: "BAD_REQUEST" }); return; }
  let out;
  if (urlPath === "/api/save") out = await apiSave(user, body);
  else if (urlPath === "/api/session") out = await apiSession(user, body);
  else if (urlPath.startsWith("/api/shop/")) out = await apiShop(user, urlPath, body);
  else out = [404, { error: "NOT_FOUND" }];
  apiReply(res, out[0], out[1]);
}

// ---------------------------------------------------------------------------
// REAL-MONEY SHOP — items sold for pesos (see server/shop_server.js REAL_SHOP)
// ---------------------------------------------------------------------------
// Two ways to pay:
//   AUTOMATIC  PayMongo hosted checkout (GCash, Maya, GrabPay, cards). Set the
//              environment variable PAYMONGO_SECRET_KEY (sk_live_... / sk_test_...).
//              An order is only marked paid after THIS server asks PayMongo for
//              the checkout session and sees a paid payment — the player's phone
//              (or a forged webhook) can never mark an order paid by itself.
//              Optional: PAYMONGO_METHODS="gcash,paymaya,grab_pay,card" to change
//              which methods are offered.
//   MANUAL     the player sends money to the GCash/bank in PAYMENT_INFO and
//              submits the reference number; the OWNER approves it at
//              /admin/shop (environment variable SHOP_ADMIN_KEY = your password).
//
// DELIVERY: a paid order is handed to the player's game client (POST /api/shop/claim)
// which puts the item in the inventory and saves; the client then confirms
// (/api/shop/ack). The save guard is told to expect the extra item first, so the
// normal anti-cheat check does not strip it.
//
// ORDERS are kept in memory and in the Supabase table "shop_orders" so they survive
// restarts (create it once with the SQL in the setup notes):
//   create table if not exists shop_orders (
//     id text primary key, uid text not null, data jsonb not null,
//     updated_at timestamptz not null default now());
//   alter table shop_orders enable row level security;   -- no policies: only the server key can use it
// ---------------------------------------------------------------------------
const PAYMONGO_KEY = process.env.PAYMONGO_SECRET_KEY || "";
const PAYMONGO_METHODS = (process.env.PAYMONGO_METHODS || "gcash,paymaya,grab_pay,card").split(",").map((s) => s.trim()).filter(Boolean);
const SHOP_ADMIN_KEY = process.env.SHOP_ADMIN_KEY || "";
const REAL_SHOP = GAME_DATA.REAL_SHOP || {};
const SHOP_TYPES = ["weapon", "armor", "stone", "accessory"];
const shopOrders = new Map();   // order id -> order
const CLAIM_RETRY_MS = 2 * 60 * 1000;     // a claimed-but-never-confirmed order is offered again after this
const ORDER_OPEN_LIMIT = 10;               // most unfinished orders one account may have at once

let shopDbQueue = Promise.resolve();
function shopSave(o) {
  if (!CLAN_DB_ON) return;
  const row = { id: o.id, uid: o.uid, data: o, updated_at: new Date().toISOString() };
  shopDbQueue = shopDbQueue
    .then(() => sbRest("POST", "shop_orders?on_conflict=id", row, "resolution=merge-duplicates,return=minimal"))
    .catch((e) => console.error("[shop] could not save order " + o.id + ": " + (e && e.message || e)));
}

async function loadShopOrders() {
  if (!CLAN_DB_ON) { console.log("[shop] SUPABASE_SERVICE_KEY not set — shop orders are memory-only."); return; }
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const rows = await sbRest("GET", "shop_orders?select=id,uid,data&order=updated_at.desc&limit=5000");
      for (const r of rows) if (r && r.data && r.data.id && !shopOrders.has(r.data.id)) shopOrders.set(r.data.id, r.data);
      console.log("[shop] loaded " + shopOrders.size + " order(s).");
      return;
    } catch (e) {
      console.error("[shop] load failed (attempt " + attempt + "): " + (e && e.message || e) + (attempt === 1 ? "  — did you create the shop_orders table?" : ""));
      await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }
  console.error("[shop] giving up loading orders; new orders are kept in memory and saved when the table works.");
}
loadShopOrders();

function shopFind(type, name) {
  if (SHOP_TYPES.indexOf(type) < 0) return null;
  const list = REAL_SHOP[type];
  if (!Array.isArray(list)) return null;
  const e = list.find((x) => x && x.name === name && Number(x.price) > 0);
  return e ? { type, name: e.name, price: Math.round(Number(e.price) * 100) / 100 } : null;
}

function shopOpenCount(uid) {
  let n = 0;
  for (const o of shopOrders.values()) if (o.uid === uid && (o.status === "awaiting_payment" || o.status === "review")) n++;
  return n;
}

function shopNewOrder(user, item, method, extra) {
  const o = Object.assign({
    id: crypto.randomUUID(), uid: user.id, email: user.email || "",
    type: item.type, name: item.name, price: item.price,
    method, status: "pending", createdAt: Date.now()
  }, extra || {});
  shopOrders.set(o.id, o);
  shopSave(o);
  return o;
}

function shopMarkPaid(o) {
  if (o.status === "paid" || o.status === "claimed" || o.status === "delivered") return;
  o.status = "paid";
  o.paidAt = Date.now();
  shopSave(o);
  console.log("[shop] PAID " + o.id.slice(0, 8) + " " + o.name + " P" + o.price + " (" + o.method + ")");
  const p = onlineByUid.get(o.uid);
  if (p && p.ws) send(p.ws, { type: "shopPaid" });   // wakes the game so it claims right away
}

function paymongoHeaders() {
  return { Authorization: "Basic " + Buffer.from(PAYMONGO_KEY + ":").toString("base64"), "Content-Type": "application/json" };
}

// Asks PayMongo whether this order's checkout session was really paid.
async function shopVerifyPaymongo(o) {
  if (!PAYMONGO_KEY || o.method !== "paymongo" || o.status !== "awaiting_payment" || !o.checkoutId) return;
  try {
    const r = await fetch("https://api.paymongo.com/v1/checkout_sessions/" + encodeURIComponent(o.checkoutId), {
      headers: paymongoHeaders(), signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return;
    const d = await r.json();
    const a = d && d.data && d.data.attributes;
    if (!a) return;
    if (a.reference_number && a.reference_number !== o.id) return;   // not this order's session
    const need = Math.round(o.price * 100);
    const pays = Array.isArray(a.payments) ? a.payments.filter((p) => p && p.attributes && p.attributes.status === "paid") : [];
    const paidAmount = pays.reduce((sum, p) => sum + (Number(p.attributes.amount) || 0), 0);
    const intentOk = !!(a.payment_intent && a.payment_intent.attributes && a.payment_intent.attributes.status === "succeeded");
    if ((pays.length && paidAmount >= need) || (!pays.length && (intentOk || a.status === "paid"))) shopMarkPaid(o);
  } catch (e) { /* PayMongo unreachable right now — checked again on the next poll */ }
}

async function shopStartPaymongo(user, body) {
  if (!PAYMONGO_KEY) return [503, { error: "AUTO_PAYMENT_OFF" }];
  const item = shopFind(String(body.type || ""), String(body.name || ""));
  if (!item) return [400, { error: "BAD_ITEM" }];
  if (shopOpenCount(user.id) >= ORDER_OPEN_LIMIT) return [429, { error: "TOO_MANY_OPEN_ORDERS" }];
  let ret = String(body.returnUrl || "");
  if (!/^https?:\/\/[^\s]{3,500}$/i.test(ret)) ret = "";
  const order = shopNewOrder(user, item, "paymongo");
  const attrs = {
    line_items: [{ currency: "PHP", amount: Math.round(item.price * 100), name: "Metal War - " + item.name, quantity: 1 }],
    payment_method_types: PAYMONGO_METHODS,
    description: "Metal War item: " + item.name,
    reference_number: order.id,
    metadata: { order_id: order.id },
    success_url: ret || undefined,
    cancel_url: ret || undefined,
    send_email_receipt: false,
    show_description: true,
    show_line_items: true
  };
  if (user.email) attrs.billing = { email: user.email };
  try {
    const r = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST", headers: paymongoHeaders(),
      body: JSON.stringify({ data: { attributes: attrs } }),
      signal: AbortSignal.timeout(15000)
    });
    const txt = await r.text();
    let d = null; try { d = JSON.parse(txt); } catch (e) {}
    const url = d && d.data && d.data.attributes && d.data.attributes.checkout_url;
    if (!r.ok || !url) {
      order.status = "failed"; order.note = "provider " + r.status; shopSave(order);
      console.error("[shop] PayMongo refused checkout: " + r.status + " " + txt.slice(0, 300));
      return [502, { error: "PAYMENT_PROVIDER_ERROR" }];
    }
    order.checkoutId = d.data.id;
    order.status = "awaiting_payment";
    shopSave(order);
    return [200, { ok: true, orderId: order.id, checkoutUrl: url }];
  } catch (e) {
    order.status = "failed"; order.note = "network"; shopSave(order);
    return [502, { error: "PAYMENT_PROVIDER_ERROR" }];
  }
}

function shopSubmitManual(user, body) {
  const item = shopFind(String(body.type || ""), String(body.name || ""));
  if (!item) return [400, { error: "BAD_ITEM" }];
  const channel = body.channel === "bank" ? "bank" : "gcash";
  const ref = String(body.ref || "").replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,24}$/.test(ref)) return [400, { error: "BAD_REFERENCE" }];
  const sender = String(body.sender || "").replace(/[^\w .+@-]/g, "").trim().slice(0, 40);
  if (sender.length < 3) return [400, { error: "BAD_SENDER" }];
  for (const o of shopOrders.values()) if (o.method === "manual" && o.ref === ref) return [409, { error: "REFERENCE_USED" }];
  if (shopOpenCount(user.id) >= ORDER_OPEN_LIMIT) return [429, { error: "TOO_MANY_OPEN_ORDERS" }];
  const order = shopNewOrder(user, item, "manual", { channel, ref, sender });
  order.status = "review";
  shopSave(order);
  console.log("[shop] REVIEW " + order.id.slice(0, 8) + " " + item.name + " P" + item.price + " via " + channel + " ref " + ref);
  return [200, { ok: true, orderId: order.id }];
}

function shopPublicOrder(o) {
  return { id: o.id, type: o.type, name: o.name, price: o.price, method: o.method, status: o.status, createdAt: o.createdAt };
}

async function shopListOrders(user) {
  const mine = [...shopOrders.values()].filter((o) => o.uid === user.id && Date.now() - o.createdAt < 30 * 86400000);
  await Promise.all(mine.filter((o) => o.status === "awaiting_payment").slice(0, 5).map(shopVerifyPaymongo));
  mine.sort((a, b) => b.createdAt - a.createdAt);
  return [200, { ok: true, orders: mine.slice(0, 30).map(shopPublicOrder) }];
}

// The game asks for items it has not received yet. They stay "claimed" until the
// game confirms (ack) after saving; an unconfirmed one is offered again later.
function shopClaim(user) {
  const now = Date.now();
  const items = [];
  for (const o of shopOrders.values()) {
    if (o.uid !== user.id) continue;
    if (o.status === "paid" || (o.status === "claimed" && now - (o.claimedAt || 0) > CLAIM_RETRY_MS)) {
      o.status = "claimed"; o.claimedAt = now; shopSave(o);
      items.push({ orderId: o.id, type: o.type, name: o.name });
      if (items.length >= 10) break;
    }
  }
  if (items.length) saveGuard.creditItems(user.id, items.length);
  return [200, { ok: true, items }];
}

function shopAck(user, body) {
  const ids = Array.isArray(body.orderIds) ? body.orderIds.slice(0, 20) : [];
  for (const id of ids) {
    const o = shopOrders.get(String(id));
    if (o && o.uid === user.id && o.status === "claimed") { o.status = "delivered"; o.deliveredAt = Date.now(); shopSave(o); }
  }
  return [200, { ok: true }];
}

async function apiShop(user, urlPath, body) {
  const act = urlPath.slice("/api/shop/".length);
  if (act === "paymongo") return shopStartPaymongo(user, body);
  if (act === "manual") return shopSubmitManual(user, body);
  if (act === "orders") return shopListOrders(user);
  if (act === "claim") return shopClaim(user);
  if (act === "ack") return shopAck(user, body);
  return [404, { error: "NOT_FOUND" }];
}

// When a player connects: check their unfinished card payments and tell the game
// to claim anything that is paid.
async function shopOnJoin(p) {
  if (!p.uid) return;
  const mine = [...shopOrders.values()].filter((o) => o.uid === p.uid);
  await Promise.all(mine.filter((o) => o.status === "awaiting_payment" && Date.now() - o.createdAt < 3 * 86400000).slice(0, 5).map(shopVerifyPaymongo));
  const now = Date.now();
  if (mine.some((o) => o.status === "paid" || (o.status === "claimed" && now - (o.claimedAt || 0) > CLAIM_RETRY_MS))) send(p.ws, { type: "shopPaid" });
}

// ---- OWNER SIDE: /admin/shop page, order list, approve/reject, PayMongo webhook ----
const adminFails = new Map();   // ip -> { n, t }
function adminAllowed(req) {
  if (SHOP_ADMIN_KEY.length < 12) return 503;   // not configured (or too short to be safe)
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const f = adminFails.get(ip);
  if (f && Date.now() - f.t < 600000 && f.n >= 10) return 429;
  const given = crypto.createHash("sha256").update(String(req.headers["x-admin-key"] || "")).digest();
  const real = crypto.createHash("sha256").update(SHOP_ADMIN_KEY).digest();
  if (crypto.timingSafeEqual(given, real)) { adminFails.delete(ip); return 200; }
  adminFails.set(ip, { n: (f && Date.now() - f.t < 600000 ? f.n : 0) + 1, t: Date.now() });
  return 401;
}

const ADMIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metal War - Shop orders</title>
<style>body{font:14px system-ui,sans-serif;background:#0b1218;color:#dff;margin:0;padding:12px}h1{font-size:18px}
.o{border:1px solid #2a4a5a;border-radius:8px;padding:10px;margin:8px 0;background:#101c26}.o b{color:#8fe}
button{padding:8px 14px;border-radius:6px;border:0;margin:6px 6px 0 0;font-weight:700}.ok{background:#3c6}.no{background:#d55;color:#fff}
.s{color:#9bd;font-size:12px}</style></head><body><h1>Shop orders</h1>
<div class="s">Open your GCash / bank app, find the reference number below, then Approve. Approve only money you actually received.</div>
<div id="l">Loading...</div>
<script>
let key=sessionStorage.getItem("k")||prompt("Admin key")||"";sessionStorage.setItem("k",key);
async function api(p,b){const r=await fetch(p,{method:"POST",headers:{"x-admin-key":key,"Content-Type":"application/json"},body:JSON.stringify(b||{})});
if(r.status==401){sessionStorage.removeItem("k");document.getElementById("l").textContent="Wrong key. Reload.";throw 0}
if(!r.ok){document.getElementById("l").textContent="Error "+r.status;throw 0}return r.json()}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
async function load(){const d=await api("/api/admin/orders");const l=document.getElementById("l");
l.innerHTML=d.orders.map(o=>'<div class="o"><b>'+esc(o.name)+'</b> ('+esc(o.type)+') &mdash; <b>P'+o.price+'</b><br>'+
'<span class="s">status: '+esc(o.status)+' | '+esc(o.method)+(o.channel?'/'+esc(o.channel):'')+' | '+new Date(o.createdAt).toLocaleString()+'<br>account: '+esc(o.email)+
(o.ref?'<br>reference: <b>'+esc(o.ref)+'</b> | sender: '+esc(o.sender):'')+'</span>'+
(o.status=="review"?'<br><button class="ok" onclick="dec(\\''+o.id+'\\',true)">Approve</button><button class="no" onclick="dec(\\''+o.id+'\\',false)">Reject</button>':'')+'</div>').join("")||"No orders yet."}
async function dec(id,a){if(!confirm(a?"Money received? Approve and deliver the item?":"Reject this order?"))return;await api("/api/admin/decide",{id:id,approve:a});load()}
load();
</script></body></html>`;

async function handleShopOwner(req, res, urlPath) {
  const plain = (code, text) => { res.writeHead(code, { "Content-Type": "text/plain" }); res.end(text); };
  if (urlPath === "/admin/shop" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
    res.end(ADMIN_PAGE);
    return;
  }
  if (urlPath === "/api/paymongo/webhook" && req.method === "POST") {
    // Answer at once. The body is NOT trusted: it only tells us which order to
    // re-check, and the check asks PayMongo directly (shopVerifyPaymongo).
    let ev = null;
    try { ev = await readJsonBody(req, 128 * 1024); } catch (e) {}
    res.writeHead(200); res.end("ok");
    try {
      const inner = (ev && ev.data && ev.data.attributes && ev.data.attributes.data) || (ev && ev.data) || {};
      const at = inner.attributes || {};
      const id = String(at.reference_number || (at.metadata && at.metadata.order_id) || "");
      let o = shopOrders.get(id);
      if (!o && typeof inner.id === "string") for (const x of shopOrders.values()) if (x.checkoutId === inner.id) { o = x; break; }
      if (o) await shopVerifyPaymongo(o);
    } catch (e) {}
    return;
  }
  if (req.method !== "POST") { plain(405, "method not allowed"); return; }
  const gate = adminAllowed(req);
  if (gate !== 200) { apiReply(res, gate, { error: gate === 503 ? "ADMIN_OFF" : "DENIED" }); return; }
  let body = {};
  try { body = await readJsonBody(req, 16 * 1024); } catch (e) { apiReply(res, 400, { error: "BAD_REQUEST" }); return; }
  if (urlPath === "/api/admin/orders") {
    const list = [...shopOrders.values()].sort((a, b) => (a.status === "review" ? 0 : 1) - (b.status === "review" ? 0 : 1) || b.createdAt - a.createdAt).slice(0, 100);
    apiReply(res, 200, { ok: true, orders: list.map((o) => Object.assign(shopPublicOrder(o), { email: o.email, channel: o.channel, ref: o.ref, sender: o.sender })) });
    return;
  }
  if (urlPath === "/api/admin/decide") {
    const o = shopOrders.get(String(body.id || ""));
    if (!o || o.method !== "manual" || o.status !== "review") { apiReply(res, 409, { error: "NOT_PENDING" }); return; }
    if (body.approve === true) shopMarkPaid(o);
    else { o.status = "rejected"; shopSave(o); }
    apiReply(res, 200, { ok: true });
    return;
  }
  apiReply(res, 404, { error: "NOT_FOUND" });
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
  shopOnJoin(p).catch(() => {});   // deliver anything the player already paid for
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

// CHAT: finds any connected player by name (case-insensitive), for the
// PRIVATE tab's "@PlayerName message" whispers — see the "chatMessage"
// case below. Global, not room-scoped: a whisper works regardless of
// which map/channel either side is on.
function findOnlinePlayerByName(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower) return null;
  for (const p of players.values()) if (p.name && p.name.toLowerCase() === lower) return p;
  return null;
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
    message: clan.message || "",
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

// LAST POSITION — a player who logs in again starts on the map and at the exact
// spot where they left (the client saves it with the account and sends it in
// "join" as lastPos). The server never just trusts it: the map must exist, the
// point must be inside it and not inside an obstacle, and a spot on top of a
// portal is moved just past it (same offset getPortalArrivalSpawn() uses) so
// logging in can't instantly warp you to another map. Returns {map,x,y} or null.
function validateSavedSpot(lp) {
  if (!lp || typeof lp !== "object") return null;
  const key = String(lp.map || "");
  const map = MAPS[key];
  if (!map || typeof lp.x !== "number" || typeof lp.y !== "number" || !isFinite(lp.x) || !isFinite(lp.y)) return null;
  const pad = 20;
  let x = Math.max(pad, Math.min(map.worldWidth - pad, lp.x));
  let y = Math.max(pad, Math.min(map.worldHeight - pad, lp.y));
  for (const p of (map.portals || [])) {
    if (x >= p.x - 30 && x <= p.x + p.width + 30 && y >= p.y - 30 && y <= p.y + p.height + 30) {
      const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
      const dx = map.worldWidth / 2 - cx, dy = map.worldHeight / 2 - cy;
      const d = Math.hypot(dx, dy) || 1;
      x = cx + (dx / d) * 45; y = cy + (dy / d) * 45;
      break;
    }
  }
  // Only a spot really INSIDE an obstacle needs moving (a player can legitimately stand right
  // beside one). It is pushed just outside the nearest edge instead of being thrown away,
  // which used to send the player to a random start on the first map.
  const edge = 14;
  for (const o of (map.obstacles || [])) {
    if (x > o.x && x < o.x + o.width && y > o.y && y < o.y + o.height) {
      const dl = x - o.x, dr = o.x + o.width - x, dt = y - o.y, db = o.y + o.height - y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) x = o.x - edge; else if (m === dr) x = o.x + o.width + edge;
      else if (m === dt) y = o.y - edge; else y = o.y + o.height + edge;
      x = Math.max(pad, Math.min(map.worldWidth - pad, x));
      y = Math.max(pad, Math.min(map.worldHeight - pad, y));
    }
  }
  return { map: key, x, y };
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

// TRADE — player-to-player item/gold exchange, started via the TRADE button
// on the touch menu (see playerTouchTradeBtn in online.js). Same trust model
// as everything else online: the server never sees either player's real
// inventory, it just relays "here's what I've put up" between the two of
// them (like "hit"/"partyExpAward" above) and — once BOTH have pressed
// ACCEPT — tells both clients to apply the swap. A modified client could
// therefore claim to offer something it doesn't have, exactly like a
// modified client could already fake damage numbers; this is a
// play-with-friends feature, not a cheat-proof marketplace.
//
// p.tradePartnerId / p.tradeConfirmed live on the player object (set in the
// "join" handler below, next to partyId/clanId). Only one trade at a time.
function cancelActiveTrade(p, notifyReason) {
  if (!p || p.tradePartnerId == null) return;
  const partner = players.get(p.tradePartnerId);
  p.tradePartnerId = null;
  p.tradeConfirmed = false;
  p.tradeGold = 0; p.tradeItemCount = 0;
  if (partner && partner.tradePartnerId === p.id) {
    partner.tradePartnerId = null;
    partner.tradeConfirmed = false;
    partner.tradeGold = 0; partner.tradeItemCount = 0;
    send(partner.ws, { type: "tradeCancelled", from: p.id, fromName: p.name, reason: notifyReason || "" });
  }
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
  if (!r) { r = new Map(); r.hostId = null; r.lastBots = null; r.lastBotsAt = 0; r.mapKey = mapKey; r.simBots = null; r.simLast = 0; r.drops = new Map(); r.nextDropId = 1; rooms.set(k, r); }
  return r;
}
// Picks anyone else left in the room to take over as bot host.
function pickNewHost(room, excludeId) {
  for (const p of room.values()) if (p.id !== excludeId) return p;
  return null;
}
// ENEMY MEMORY — how long (ms) a room remembers its enemies (health, position,
// dead/alive + respawn countdown) after the host left / the room emptied.
// Whoever hosts or walks into that map inside this window gets the enemies
// back exactly as they were left (online.js's netRestoreHostedBots()); past
// it the map starts fresh. Ground loot is remembered separately (drops).
const ROOM_BOTS_KEEP_MS = 5 * 60 * 1000;   // 5 minutes

// The room's remembered enemy snapshot, ready to hand to a host / joiner.
// A dead enemy's `rm` (ms left until it respawns) is reduced by the time that
// passed since the snapshot was taken, so it respawns on schedule instead of
// getting a full new wait. [] when nothing is remembered (or it expired).
function currentBots(room) {
  if (!room.lastBots) return [];
  const age = Date.now() - (room.lastBotsAt || 0);
  if (!room.simBots && age > ROOM_BOTS_KEEP_MS) { room.lastBots = null; return []; }   // a room the server is simulating never expires
  return room.lastBots.map((b) => (b && b.a === false)
    ? Object.assign({}, b, { rm: Math.max(0, (Number(b.rm) || 0) - age) })
    : b);
}
// Hands bot-hosting duty to `next` (or clears it if the room is now empty)
// and tells everyone so nobody is left looking at enemies that are no longer
// being simulated by anyone. The last snapshot is deliberately KEPT (see
// ENEMY MEMORY above): the new host — or the next player to walk into the
// emptied room — restores the enemies from it instead of spawning new ones.
function reassignHost(room, leavingId) {
  if (room.hostId !== leavingId) return;
  const next = pickNewHost(room, leavingId);
  room.hostId = next ? next.id : null;
  if (next) send(next.ws, { type: "botHost", host: true, bots: currentBots(room) });
  else startOfflineSim(room);   // nobody left: the server keeps the enemies moving (see below)
  broadcast(room, { type: "botsReset" }, next ? next.id : -1);
}

// ---------------------------------------------------------------------------
// OFFLINE ENEMY SIMULATION — while a room is EMPTY the server itself keeps its
// enemies alive, the way bot.js would: they patrol (walk to a random point
// near where they stand, stop and look around, repeat), wounded ones regenerate,
// and dead ones respawn at their spawn point when their timer runs out. The
// next player to walk in gets the enemies exactly where they wandered to (via
// currentBots() -> netRestoreHostedBots() in online.js) and becomes the host.
// It only runs for rooms that already had enemies (a host streamed a snapshot),
// and only while the room is empty. Lives in server memory like drops do, so a
// server restart / Render sleep starts the map fresh.
// ---------------------------------------------------------------------------
const BOT_TYPES = GAME_DATA.BOT_TYPES || {};
const OBSTACLE_TYPES = (() => { try { return require("./server/obstacles_server.js").OBSTACLE_TYPES || {}; } catch (e) { return {}; } })();

function startOfflineSim(room) {
  if (!Array.isArray(room.lastBots) || !room.lastBots.length || !MAPS[room.mapKey]) { room.simBots = null; return; }
  const now = Date.now();
  const age = now - (room.lastBotsAt || now);
  room.simLast = now;
  room.simBots = room.lastBots.filter((b) => b && typeof b.i === "number").map((b) => ({
    i: b.i, t: b.t, x: b.x, y: b.y, h: b.h, mh: b.mh, a: !!b.a,
    fa: b.fa || 0, mv: false,
    sx: typeof b.sx === "number" ? b.sx : b.x,
    sy: typeof b.sy === "number" ? b.sy : b.y,
    st: "look", stT: 0, tx: b.x, ty: b.y,
    respawnAt: now + Math.max(0, (Number(b.rm) || 0) - age)   // only used while dead
  }));
  room.lastBotsAt = now;
}
function stopOfflineSim(room) {
  if (!room.simBots) return;
  simTickRoom(room, Date.now());   // catch up to this very moment before handing over
  room.simBots = null;
}

function simSolveObstacles(b, radius, obstacles) {
  for (const obs of obstacles) {
    const type = OBSTACLE_TYPES[obs.name];
    let cx, cy;
    if (type && type.collision === "circle") {
      const ox = obs.x + obs.width / 2, oy = obs.y + obs.height / 2;
      const r = Math.min(obs.width, obs.height) / 2;
      const d = Math.hypot(b.x - ox, b.y - oy) || 1;
      cx = ox + ((b.x - ox) / d) * r; cy = oy + ((b.y - oy) / d) * r;
    } else {
      cx = Math.max(obs.x, Math.min(b.x, obs.x + obs.width));
      cy = Math.max(obs.y, Math.min(b.y, obs.y + obs.height));
    }
    const dx = b.x - cx, dy = b.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < radius) {
      const push = radius - dist;
      if (dist > 0) { b.x += (dx / dist) * push; b.y += (dy / dist) * push; }
      else { b.x += push; }
    }
  }
}

function simTickRoom(room, now) {
  const map = MAPS[room.mapKey];
  if (!map || !room.simBots) { room.simBots = null; return; }
  const dt = Math.min(0.5, Math.max(0, (now - room.simLast) / 1000));
  room.simLast = now;
  const W = map.worldWidth, H = map.worldHeight, obstacles = map.obstacles || [];
  for (const b of room.simBots) {
    const def = BOT_TYPES[b.t];
    if (!def) continue;
    const radius = def.radius || 12;
    if (!b.a) {
      if (now >= b.respawnAt) {
        b.a = true; b.h = b.mh; b.x = b.sx; b.y = b.sy;
        b.st = "patrol"; b.stT = 0; b.tx = b.sx; b.ty = b.sy; b.mv = false;
        b.fa = Math.random() * Math.PI * 2;
      }
      continue;
    }
    // HP regen: same rate as character.js's tickPercentRegen (max * fraction per second)
    if (b.h < b.mh && def.hpRegen > 0) b.h = Math.min(b.mh, b.h + b.mh * def.hpRegen * dt);

    b.stT += dt * 1000;
    if (b.st === "patrol") {
      const dx = b.tx - b.x, dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 5 || b.stT >= (def.patrolInterval || 3000)) {
        b.st = "look"; b.stT = 0; b.mv = false;
      } else {
        b.fa = Math.atan2(dy, dx);
        const step = Math.min((def.movementSpeed || 80) * dt, dist);
        b.x += (dx / dist) * step;
        b.y += (dy / dist) * step;
        b.mv = true;
      }
    } else {   // "look": stand still and scan, then pick a new patrol point
      b.mv = false;
      b.fa += Math.sin(b.stT / 400) * dt * 2;
      if (b.stT >= (def.lookDuration || 1500)) {
        const pr = def.patrolRadius || 60;
        b.tx = Math.max(radius, Math.min(W - radius, b.x + (Math.random() * 2 - 1) * pr));
        b.ty = Math.max(radius, Math.min(H - radius, b.y + (Math.random() * 2 - 1) * pr));
        b.st = "patrol"; b.stT = 0;
      }
    }
    b.x = Math.max(radius, Math.min(W - radius, b.x));
    b.y = Math.max(radius, Math.min(H - radius, b.y));
    simSolveObstacles(b, radius, obstacles);
  }
  // Keep the remembered snapshot current so whoever walks in next gets it.
  room.lastBots = room.simBots.map((b) => ({
    i: b.i, t: b.t,
    x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
    h: Math.max(0, Math.round(b.h)), mh: b.mh, a: b.a,
    fa: Math.round(b.fa * 100) / 100, mv: b.mv, sx: b.sx, sy: b.sy,
    rm: b.a ? 0 : Math.max(0, Math.round(b.respawnAt - now))
  }));
  room.lastBotsAt = now;
}
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.simBots && room.size === 0) simTickRoom(room, now);
  }
}, 250);
// Loot lying on the ground in a room (dropped by enemies). The server keeps it
// so people who join / come back later still see it — but only until it
// actually despawns. NOTE: it lives in the server's memory, so it is lost
// whenever the server restarts / goes to sleep (Render free plan).
// MAX_ROOM_DROPS now lives in server/game_server.js (see that file).
const { MAX_ROOM_DROPS, ITEM_DESPAWN_TIME } = GAME_DATA;
// DESPAWN — a drop must disappear for EVERYONE, permanently, ITEM_DESPAWN_TIME
// (the same 30-sec window item_server.js/item.js use client-side) after it was
// created — not just while someone happens to be watching it. Before this fix
// the server kept every drop for up to 72h "so a returning player still finds
// it", which is exactly why: (1) an item a player watched despawn locally
// would come BACK after they logged out and back in (rejoining just re-sent
// the still-there server copy), and (2) a player who joined a minute later
// would see items that had already visually despawned for everyone else (the
// client reset each drop's spawn timer to "now" on arrival, instead of using
// its real age). See sweepExpiredDrops() below and netApplyDrops()/`at` on
// the wire (online.js) for the other half of the fix.
const DROP_MAX_AGE_MS = ITEM_DESPAWN_TIME || 30000;
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
  if (a && (a.category === "armor" || a.category === "ring" || a.category === "accessory")) return a.category;
  if (GAME_DATA.STONE_TYPES && GAME_DATA.STONE_TYPES[t]) return "stone";
  if (GAME_DATA.ORB_TYPES && GAME_DATA.ORB_TYPES[t]) return "orb";
  const itemDef = GAME_DATA.ITEM_TYPES && GAME_DATA.ITEM_TYPES[t];
  if (itemDef) return itemDef.category || "item";
  return "item";
}

// Removes every drop in `room` that has passed its despawn window and
// returns the ids that were removed (empty array if none). Pure bookkeeping —
// callers decide whether/how to tell anyone (see dropList(), which just needs
// the list clean, vs sweepExpiredDrops() below, which also broadcasts).
function pruneDrops(room) {
  const cutoff = Date.now() - DROP_MAX_AGE_MS;
  const removed = [];
  for (const [id, d] of room.drops) {
    if (d.at < cutoff) { room.drops.delete(id); removed.push(id); }
  }
  return removed;
}
function dropList(room) {
  pruneDrops(room);
  return [...room.drops.values()].map((d) => d.k === "inv"
    ? { id: d.id, k: "inv", invType: d.invType, name: d.name, data: d.data, qty: d.qty, x: d.x, y: d.y, at: d.at }
    : { id: d.id, t: d.t, x: d.x, y: d.y, at: d.at, stats: d.stats });
}
function clearDropsIfEmpty() { /* intentionally keeps loot in empty rooms */ }

// ---------------------------------------------------------------------------
// BOSS EVENT — schedule check, enter, and the 10 PM teleport-out
// ---------------------------------------------------------------------------
function bossManilaNow() { return new Date(Date.now() + BOSS_EVENT.TZ_OFFSET_HOURS * 3600 * 1000); }
function bossWindowOpen() {
  const d = bossManilaNow();
  return BOSS_EVENT.DAYS.includes(d.getUTCDay()) && d.getUTCHours() >= BOSS_EVENT.START_HOUR && d.getUTCHours() < BOSS_EVENT.END_HOUR;
}
// Moves one player into/out of the boss arena (server-initiated, so no "map" message needed).
function bossMovePlayer(p, key, spawn, ended) {
  const oldRoom = p.room;
  oldRoom.delete(p.id);
  broadcast(oldRoom, { type: "playerRemove", id: p.id });
  reassignHost(oldRoom, p.id);
  p.map = key;
  p.room = getRoom(p.server, p.channel, key);
  const first = p.room.size === 0;
  p.room.set(p.id, p);
  if (first) { p.room.hostId = p.id; stopOfflineSim(p.room); }
  p.x = spawn.x; p.y = spawn.y;
  p.lastMapChange = Date.now();
  p.protectUntil = Date.now() + ONLINE_RULES.SPAWN_PROTECT_MS;
  send(p.ws, {
    type: "bossMove", map: key, ended: !!ended,
    spawnX: p.x, spawnY: p.y,
    players: [...p.room.values()].filter((o) => o.id !== p.id).map(publicInfo),
    botHost: p.room.hostId === p.id,
    bots: currentBots(p.room),
    drops: dropList(p.room)
  });
  broadcast(p.room, { type: "playerAdd", player: publicInfo(p) }, p.id);
}
// Where a player goes when the event ends: the exact spot they entered from.
function bossReturnSpot(p) {
  const r = validateSavedSpot(p.bossReturn);
  if (r && r.map !== BOSS_EVENT.KEY) return r;
  const m = MAPS[START_MAP];
  return { map: START_MAP, x: m.worldWidth / 2, y: m.worldHeight / 2 };
}
// Every second: once it is 10 PM, send everyone still inside back to their last position.
setInterval(() => {
  if (bossWindowOpen()) return;
  for (const room of rooms.values()) {
    if (room.mapKey !== BOSS_EVENT.KEY || room.size === 0) continue;
    for (const p of [...room.values()]) {
      const r = bossReturnSpot(p);
      p.bossReturn = null;
      bossMovePlayer(p, r.map, { x: r.x, y: r.y }, true);
    }
  }
}, 1000);

// Runs on a timer (see setInterval below) so a drop disappears for players
// who are ALREADY in the room the moment it expires, not just for the next
// person to join/rejoin (dropList() above already keeps those clean). Reuses
// the same "dropGone" message a pickup sends, so no client changes are needed
// to receive it — online.js's netRemoveDrop() already handles it.
function sweepExpiredDrops() {
  for (const room of rooms.values()) {
    if (!room.drops.size) continue;
    const removed = pruneDrops(room);
    for (const id of removed) broadcast(room, { type: "dropGone", id }, -1);
  }
}
setInterval(sweepExpiredDrops, 5000);
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
  // serverCount + channels: the lobby builds its rows from these (they are no longer hardcoded in online.js)
  return { max: SERVER_MAX_PLAYERS, serverCount: SERVER_COUNT, channels: ONLINE_RULES.CHANNELS, servers: list };
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
    mana: p.mana, maxMana: p.maxMana, exp: p.exp, maxExp: p.maxExp,
    alive: p.alive, level: p.level,
    // Equipped gear names only (see the "state" case below) — lets a
    // newly-joined client's VIEW popup (online.js) show what everyone
    // already on the map has on before their next "state" tick arrives.
    weapon: p.weapon, armor: p.armor, accessory: p.accessory
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

      let savedSpot = validateSavedSpot(msg.lastPos);   // null -> normal start
      if (savedSpot && savedSpot.map === BOSS_EVENT.KEY && !bossWindowOpen()) savedSpot = null;   // event is over: normal start
      const startMap = savedSpot ? savedSpot.map : START_MAP;
      const room = getRoom(serverId, channel, startMap);
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
        server: serverId, channel, map: startMap, room, lastMapChange: 0,
        name: wantedName || ("Player " + id),
        character: (typeof GAME_DATA.resolveCharacterName === "function") ? GAME_DATA.resolveCharacterName(wanted) : (chars[wanted] ? wanted : (Object.keys(chars)[0] || "soldier")),
        x: savedSpot ? savedSpot.x : 0, y: savedSpot ? savedSpot.y : 0,
        health: 100, maxHealth: 100,
        mana: 0, maxMana: 0, exp: 0, maxExp: 0,
        alive: true,
        level: 1,
        weapon: null, armor: null, accessory: null,
        hitWindowStart: 0, hitCount: 0,
        protectUntil: Date.now() + ONLINE_RULES.SPAWN_PROTECT_MS,   // spawn protection (see online_server.js)
        lastStateAt: 0,   // for the STATE_INTERVAL_MS rate limit
        botHitWindowStart: 0, botHitCount: 0,
        skillGlobalLockedUntil: 0, // see game_server.js's isPlayerSkillLocked()
        partyId: null,
        clanId: null,
        tradePartnerId: null, tradeConfirmed: false,   // see the TRADE section below
        uid: null, uidChecked: false   // Supabase account id, filled in by attachAccount()
      };
      const isFirstInRoom = room.size === 0;
      players.set(id, me);
      room.set(id, me);
      if (isFirstInRoom) { room.hostId = id; stopOfflineSim(room); }   // keep room.lastBots: enemies come back as they wandered to
      send(ws, {
        type: "init",
        id,
        name: me.name,
        server: serverId,
        channel,
        pvp: channel === CHANNEL_PVP,
        // set only when restoring the spot where this player last logged out
        map: savedSpot ? startMap : undefined,
        spawnX: savedSpot ? savedSpot.x : undefined,
        spawnY: savedSpot ? savedSpot.y : undefined,
        players: [...room.values()].filter((p) => p.id !== id).map(publicInfo),
        data: GAME_DATA,   // the online numbers + the world map
        // PvE: am I responsible for simulating this room's enemies, and (if
        // not) here's the most recent snapshot so I'm not staring at an
        // empty map until the host's next tick — see "bots" below.
        botHost: room.hostId === id,
        bots: currentBots(room),
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
      case "state": {
        // Rate limit: faster than half the allowed interval is dropped (half = jitter tolerance).
        const stateNow = Date.now();
        if (stateNow - me.lastStateAt < ONLINE_RULES.STATE_INTERVAL_MS * 0.5) break;
        me.lastStateAt = stateNow;
        // Coming back alive after being dead = a respawn -> spawn protection.
        if (!me.alive && msg.alive) me.protectUntil = stateNow + ONLINE_RULES.SPAWN_PROTECT_MS;
        me.x = num(msg.x, me.x);
        me.y = num(msg.y, me.y);
        me.health = num(msg.health, me.health);
        me.maxHealth = num(msg.maxHealth, me.maxHealth);
        // MANA — the server keeps its own count (see game_server.js's
        // syncReportedMana()): the client's number can go down, but can't
        // jump up faster than real regen.
        syncReportedMana(me, Number(msg.mana), Number(msg.maxMana), !!msg.alive, Date.now());
        me.exp = num(msg.exp, me.exp);
        me.maxExp = num(msg.maxExp, me.maxExp);
        me.level = num(msg.level, me.level);
        me.alive = !!msg.alive;
        // Equipped gear names, just for the VIEW popup (online.js) on
        // other clients — same 24-char/string-only sanitizing as
        // "character" above, nothing that looks up game data server-side.
        const equipName = (v) => (typeof v === "string" && v) ? v.slice(0, 24) : null;
        me.weapon = equipName(msg.weapon);
        me.armor = equipName(msg.armor);
        me.accessory = equipName(msg.accessory);
        broadcast(me.room, {
          type: "state", id: me.id,
          x: me.x, y: me.y, health: me.health, maxHealth: me.maxHealth,
          mana: me.mana, maxMana: me.maxMana, exp: me.exp, maxExp: me.maxExp,
          level: me.level, alive: me.alive,
          weapon: me.weapon, armor: me.armor, accessory: me.accessory
        }, me.id);
        break;
      }

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
          amount: Math.max(0, Math.round(num(msg.amount))),
          isCritical: !!msg.isCritical
        }, me.id);
        break;

      // PvE: the room's enemy host streams its enemies' position/health/
      // alive state here (~10x/sec) — cache it (so late joiners see the
      // current fight instantly) and relay it to everyone else in the room.
      case "bots":
        if (me.room.hostId !== me.id || !Array.isArray(msg.list)) break;
        me.room.lastBots = msg.list;
        me.room.lastBotsAt = Date.now();
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

        // SKILL LOCK — same enforcement as the "hit" case above, for a
        // player-vs-bot skill hit (online.js's damageBot() override).
        if (msg.isSkillHit) {
          if (!consumeSkillHit(me, now)) break;   // not paid on the server / locked / over this cast's hit budget
        }

        send(host.ws, {
          type: "botHit",
          idx: Math.trunc(num(msg.idx, -1)),
          amount: Math.max(0, num(msg.amount)),
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
        if (Date.now() < target.protectUntil) break;   // spawn protection

        const now = Date.now();

        send(target.ws, {
          type: "botHitPlayer",
          physicalDamage: Math.max(0, num(msg.physicalDamage)),
          magicalDamage: Math.max(0, num(msg.magicalDamage)),
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
        // A hacked host must not be able to flood the room with drops (each one can carry gold).
        const dropNow = Date.now();
        if (dropNow - (me.room.dropWinAt || 0) > 1000) { me.room.dropWinAt = dropNow; me.room.dropWinN = 0; }
        for (const d of msg.drops.slice(0, 20)) {
          if (++me.room.dropWinN > 60) break;
          if (!d || typeof d.t !== "string" || d.t.length > 40) continue;
          const drop = { id: me.room.nextDropId++, t: d.t, x: num(d.x), y: num(d.y), at: Date.now() };
          // Gold orbs carry their own amount (varies per bot type — see
          // spawnGoldOrbChance/goldOrbAmount on BOT_TYPES), instead of a
          // single shared amount looked up from ITEM_TYPES. Clamped to a
          // sane range so a hacked host can't mint arbitrary gold.
          if (d.t === "goldOrb") drop.amt = saveGuard.clampOrbAmount(num(d.amt));   // never above the biggest real orb (save_guard.js)
          // GEAR STATS — weapons / armor / rings / accessories are plain in the
          // *_server.js tables; the stats are rolled HERE, on the server, from the
          // level of the enemy TYPE that dropped it (looked up in bot_server.js,
          // never a level the client claims), using rollItemStats() in
          // server/item_server.js. The host only says which item dropped.
          const gearCat = categoryForDrop(drop);
          if (gearCat === "weapon" || gearCat === "armor" || gearCat === "ring" || gearCat === "accessory") {
            const srcBot = BOT_TYPES[String(d.bt || "")];
            const enemyLevel = (srcBot && typeof srcBot.level === "number") ? srcBot.level : 1;
            const spawnBonus = (srcBot && typeof srcBot.increaseSpawnGet === "number") ? srcBot.increaseSpawnGet : 0;
            // requiredType of the dropped item (weapon_server.js / armor_server.js) decides which
            // attack stat it rolls: magemaster -> magicalAttack, others -> physicalDamage.
            const dropDef = (GAME_DATA.WEAPONS && GAME_DATA.WEAPONS[d.t]) || (GAME_DATA.ARMOR_TYPES && GAME_DATA.ARMOR_TYPES[d.t]) || null;
            drop.stats = GAME_DATA.rollItemStats(gearCat, enemyLevel, spawnBonus, dropDef && dropDef.requiredType);
            // REQUIRED STAT ("pow=40" etc., armor_server.js): the item's own requiredStat if it has
            // one, otherwise enemy level x 4 on the stat its requiredType uses. Rolled here so the
            // number comes from the server's enemy level, never from the host's client.
            if (dropDef && drop.stats && typeof GAME_DATA.rollRequiredStat === "function") {
              const reqStat = GAME_DATA.rollRequiredStat(dropDef.requiredType, enemyLevel, dropDef.requiredStat);
              if (reqStat) drop.stats.requiredStat = reqStat;
            }
          }
          me.room.drops.set(drop.id, drop);
          added.push(drop);
        }
        while (me.room.drops.size > MAX_ROOM_DROPS) me.room.drops.delete(me.room.drops.keys().next().value);
        if (added.length) broadcast(me.room, { type: "dropAdd", drops: added.map(({ id, t, x, y, amt, at, stats }) => ({ id, t, x, y, amt, at, stats })) }, -1);
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
          drop: { id: drop.id, k: "inv", invType: drop.invType, name: drop.name, data: drop.data, qty: drop.qty, x: drop.x, y: drop.y, at: drop.at }
        }, -1);
        break;
      }

      // SKILL USE — the client says it is firing a skill. The server takes that
      // skill's manaCost (from skill_server.js) off ITS OWN mana count; only a
      // paid use lets the skill's "hit"/"botHit"/"skillBuff" messages through
      // (see game_server.js's tryPaySkillUse()/hasPaidSkillUse()).
      case "skillUse": {
        const skillName = String(msg.skill || "").slice(0, 32);
        const paid = tryPaySkillUse(me, skillName, Date.now());
        send(me.ws, { type: "manaSync", skill: skillName, ok: paid, mana: me.mana });
        break;
      }

      // POWERBOOST / DEFENSEBOOST (skill_server.js) — the caster tells the server they used
      // a party-buff skill. The skill's numbers come from the SERVER's own
      // skill_server.js (never from the client): every party member on the
      // same map within `range` of the caster gets a "skillBuff" and starts
      // the buff on their own client (online.js).
      case "skillBuff": {
        const def = findSkillDef(String(msg.skill || ""));
        if (!def || !(def.attackIncrease || def.defenseIncrease)) break;
        if (!hasPaidSkillUse(me, Date.now(), def.skill)) break;   // mana not paid on the server
        const party = getParty(me);
        if (!party) break;
        const range = num(def.range, 0);
        for (const id of party.members) {
          if (id === me.id) continue;
          const m = players.get(id);
          if (!m || m.room !== me.room || m.alive === false) continue;
          if (Math.hypot(m.x - me.x, m.y - me.y) > range) continue;
          send(m.ws, { type: "skillBuff", skill: def.skill, fromId: me.id });
        }
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

        // What the SERVER saw this player pick up: save_guard.js uses it to tell a real
        // gold/item gain from a made-up one when the player's save arrives. Only counts if
        // the picker is actually close to the drop (no vacuuming the map from far away).
        const pickupNear = Math.hypot(me.x - num(drop.x), me.y - num(drop.y)) <= 450;
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
            : { category, itemType: drop.t, stats: drop.stats };

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
              if (pickupNear) saveGuard.creditGold(m.uid, amount);
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
            if (pickupNear) saveGuard.creditItems(recipient.uid, drop.k === "inv" ? drop.qty : 1);
            // itemPayload spread FIRST, { type, mode } applied LAST — so the
            // "partyLootAward" discriminator always wins even if itemPayload
            // ever grows a field that happens to be named "type" or "mode"
            // again. This is the actual fix for the field-collision bug
            // above; the itemType rename alone already fixes today's case,
            // this just stops the same class of bug from coming back.
            send(recipient.ws, Object.assign({}, itemPayload, { type: "partyLootAward", mode: "item" }));
            advancePartyLootTurn(party);
          }
        } else if (pickupNear) {
          // Not in a party: the picker's own client applies the award, the server just records it.
          if (drop.t === "goldOrb") saveGuard.creditGold(me.uid, drop.amt || 0);
          else saveGuard.creditItems(me.uid, drop.k === "inv" ? drop.qty : 1);
        }
        break;
      }

      // Walked through a portal: move to that map's room (same server + channel).
      case "map": {
        const key = String(msg.map || "");
        const now = Date.now();
        if (!MAPS[key] || key === me.map || now - me.lastMapChange < 300) break;
        if (key === BOSS_EVENT.KEY || me.map === BOSS_EVENT.KEY) break;   // the arena is only entered via "bossEnter"
        me.lastMapChange = now;
        me.protectUntil = now + ONLINE_RULES.SPAWN_PROTECT_MS;
        const fromMapKey = me.map;   // captured BEFORE me.map is overwritten below
        const oldRoom = me.room;
        oldRoom.delete(me.id);
        broadcast(oldRoom, { type: "playerRemove", id: me.id });
        reassignHost(oldRoom, me.id);   // hand off enemy-hosting if I was hosting that map
        clearDropsIfEmpty(oldRoom);

        me.map = key;
        me.room = getRoom(me.server, me.channel, key);
        const isFirstInNewRoom = me.room.size === 0;
        me.room.set(me.id, me);
        if (isFirstInNewRoom) { me.room.hostId = me.id; stopOfflineSim(me.room); }   // keep me.room.lastBots: enemies come back as they wandered to

        // Server decides where I land — not the client. Finds the portal
        // back to the map I just came from and puts me next to it.
        const spawn = getPortalArrivalSpawn(MAPS[key], fromMapKey, MAPS);
        me.x = spawn.x;
        me.y = spawn.y;

        send(ws, {
          type: "mapChanged", map: key,
          spawnX: me.x, spawnY: me.y,
          players: [...me.room.values()].filter((p) => p.id !== me.id).map(publicInfo),
          botHost: me.room.hostId === me.id,
          bots: currentBots(me.room),
          drops: dropList(me.room)
        });
        broadcast(me.room, { type: "playerAdd", player: publicInfo(me) }, me.id);
        break;
      }

      // WAR ZONE > BOSS EVENT > ENTER MAP. The server re-checks everything.
      case "bossEnter": {
        const deny = (reason) => send(ws, { type: "bossDenied", reason });
        if (me.map === BOSS_EVENT.KEY) break;
        if (!MAPS[BOSS_EVENT.KEY]) { deny("BOSS EVENT is not available yet."); break; }
        if (!bossWindowOpen()) { deny("BOSS EVENT is only available on Monday, Wednesday and Friday, at 8PM only."); break; }
        if (num(me.level, 1) < BOSS_EVENT.MIN_LEVEL) { deny("You cannot enter the map. Required level " + BOSS_EVENT.MIN_LEVEL + " and above."); break; }
        if (!me.alive) { deny("You cannot enter while you are dead."); break; }
        if (Date.now() - me.lastMapChange < 300) break;
        me.bossReturn = { map: me.map, x: me.x, y: me.y };   // brought back here at 10 PM
        const m = MAPS[BOSS_EVENT.KEY];
        bossMovePlayer(me, BOSS_EVENT.KEY, { x: m.worldWidth / 2 + (Math.random() * 300 - 150), y: m.worldHeight - 250 }, false);
        break;
      }

      // Attacker says "I hit targetId" -> only that player is told.
      case "hit": {
        // CHANNEL 1 is a no-damage channel: drop every player-vs-player hit.
        if (me.channel !== CHANNEL_PVP) break;
        const target = me.room.get(num(msg.targetId, -1));   // same server + channel only
        if (!target || target.id === me.id) break;
        if (Date.now() < target.protectUntil) break;   // spawn protection

        // Party members never damage each other, even on a PvP channel.
        if (isPartyFriendlyFire(me.partyId, target.partyId)) break;

        // Clanmates never damage each other, either.
        if (isClanFriendlyFire(me.clanId, target.clanId)) break;

        const now = Date.now();

        // SKILL LOCK — server-authoritative version of game.js's
        // player.skillGlobalLockedUntil (see game_server.js). Only
        // hits the client tagged isSkillHit go through this; drop it
        // if this player's own skill lock (tracked here, not on the
        // client) hasn't expired yet, no matter what that client claims.
        if (msg.isSkillHit) {
          if (!consumeSkillHit(me, now)) break;   // not paid on the server / locked / over this cast's hit budget
        }

        send(target.ws, {
          type: "hit",
          from: me.id,
          physicalDamage: Math.max(0, num(msg.physicalDamage)),
          magicalDamage: Math.max(0, num(msg.magicalDamage)),
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
      // CHAT BOX (online gameplay) — index.html's CHATBOX window sends
      // { type: "chatMessage", scope: "world"|"private", text }.
      // WORLD: broadcast to everyone on my exact server+channel (not
      // room/map — chat spans every map inside that server/channel).
      // PRIVATE: text must be "@PlayerName message" (index.html's PRIVATE
      // tab pre-fills the "@" for the player); relayed to that player AND
      // echoed back to me, so my own outgoing whisper shows up in my own
      // PRIVATE tab too — see window.applyChatMessage in index.html.
      case "chatMessage": {
        if (!me.name) break;
        const scope = msg.scope === "private" ? "private" : "world";
        const raw = String(msg.text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
        if (!raw) break;

        if (scope === "private") {
          if (raw[0] !== "@") { send(ws, { type: "chatError", reason: "Type @PlayerName then your message" }); break; }
          const rest = raw.slice(1);
          // Player names can contain spaces (e.g. "john bert"), so a fixed
          // "first word = name" split breaks for them. Instead, check every
          // currently online name as a possible prefix of what was typed,
          // and keep the LONGEST one that matches — so if both "john" and
          // "john bert" are online, "@john bert hi" goes to "john bert",
          // not "john" with the message "bert hi".
          const lowerRest = rest.toLowerCase();
          let target = null, matchedLen = 0;
          for (const p of players.values()) {
            if (!p.name || p.name.length <= matchedLen) continue;
            const lname = p.name.toLowerCase();
            if (lowerRest === lname || lowerRest.startsWith(lname + " ")) {
              target = p; matchedLen = p.name.length;
            }
          }
          if (!target) { send(ws, { type: "chatError", reason: "Type @PlayerName then your message" }); break; }
          const body = rest.slice(matchedLen).trim();
          if (!body) { send(ws, { type: "chatError", reason: "Type @PlayerName then your message" }); break; }
          if (target.id === me.id) { send(ws, { type: "chatError", reason: "You can't whisper yourself" }); break; }
          const payload = { type: "chatMessage", scope: "private", fromName: me.name, toName: target.name, text: body };
          send(target.ws, payload);
          send(ws, payload);
        } else {
          const payload = { type: "chatMessage", scope: "world", fromName: me.name, text: raw };
          for (const p of players.values()) {
            if (p.server === me.server && p.channel === me.channel) send(p.ws, payload);
          }
        }
        break;
      }

      case "clanCreate": {
        if (!clanAccountReady(me)) break;
        if (clanOf(me)) { send(ws, { type: "clanError", reason: "You're already in a clan" }); break; }
        const name = String(msg.name || "").replace(/[\r\n\t]+/g, " ").slice(0, 20).trim();
        if (!name) break;
        const clan = { id: crypto.randomBytes(6).toString("hex"), name, leaderUid: me.uid, message: "", members: [{ uid: me.uid, name: me.name }] };
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

      // MESSAGE: button (clan leader) -> index.html's "clanMsgSubmitBtn"
      // sends { type: "clanMessage", text }. Leader-only, saved on the clan
      // and re-broadcast so it shows up beside MESSAGE: for every member,
      // including whoever just set it (index.html reads it off clanUpdate).
      case "clanMessage": {
        const clan = clanOf(me);
        if (!clan) { send(ws, { type: "clanError", reason: "You don't have a clan yet" }); break; }
        if (clan.leaderUid !== me.uid) { send(ws, { type: "clanError", reason: "Only the leader can set the clan message" }); break; }
        clan.message = String(msg.text || "").replace(/[\r\n\t]+/g, " ").slice(0, 100).trim();
        clanDb(() => sbRest("PATCH", "clans?id=eq." + q(clan.id), { message: clan.message }));
        broadcastClanUpdate(clan);
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

      // ---- TRADE --------------------------------------------------------
      // Sent when the TRADE button is tapped on a nearby player (see
      // playerTouchTradeBtn in online.js) — same targeted-send pattern as
      // "partyInvite"/"clanInvite" above (proximity already enforced
      // client-side by NET_TOUCH_RANGE).
      case "tradeRequest": {
        const target = me.room.get(num(msg.targetId, -1));
        if (!target || target.id === me.id) break;
        if (me.tradePartnerId != null) { send(ws, { type: "tradeError", reason: "You're already trading" }); break; }
        if (target.tradePartnerId != null) { send(ws, { type: "tradeError", reason: (target.name || "That player") + " is already trading" }); break; }
        send(target.ws, { type: "tradeRequest", from: me.id, fromName: me.name });
        break;
      }

      // ACCEPT / DECLINE reply to a trade request. Looked up server-wide
      // (like "partyResponse") in case the inviter walked to a different
      // map while the request popup was up.
      case "tradeResponse": {
        const inviter = players.get(num(msg.targetId, -1));
        if (!inviter || inviter.id === me.id) break;
        if (!msg.accept) {
          send(inviter.ws, { type: "tradeResponse", from: me.id, fromName: me.name, accept: false });
          break;
        }
        if (me.tradePartnerId != null || inviter.tradePartnerId != null) {
          send(ws, { type: "tradeError", reason: "That trade is no longer available" });
          break;
        }
        me.tradePartnerId = inviter.id; me.tradeConfirmed = false; me.tradeGold = 0; me.tradeItemCount = 0;
        inviter.tradePartnerId = me.id; inviter.tradeConfirmed = false; inviter.tradeGold = 0; inviter.tradeItemCount = 0;
        send(inviter.ws, { type: "tradeStart", from: me.id, fromName: me.name });
        send(ws, { type: "tradeStart", from: inviter.id, fromName: inviter.name });
        break;
      }

      // My offer box (items + gold orb amount) changed — relay it to my
      // trade partner so their screen mirrors what I've put up. Changing
      // an offer un-confirms BOTH sides (same as most trade UIs — you
      // don't want an ACCEPT to lock in something the other player then
      // quietly edits).
      case "tradeOffer": {
        if (me.tradePartnerId == null || num(msg.targetId, -1) !== me.tradePartnerId) break;
        const partner = players.get(me.tradePartnerId);
        if (!partner || partner.tradePartnerId !== me.id) break;
        const items = Array.isArray(msg.items) ? msg.items.slice(0, ONLINE_RULES.TRADE_OFFER_SIZE) : [];
        const gold = Math.max(0, Math.min(ONLINE_RULES.TRADE_MAX_GOLD, Math.trunc(num(msg.gold, 0))));
        me.tradeConfirmed = false;
        partner.tradeConfirmed = false;
        // remembered so a completed trade can be credited to the receiver (save_guard.js)
        me.tradeGold = gold;
        me.tradeItemCount = items.reduce((n, it) => n + (it && typeof it === "object" ? Math.max(1, Math.min(999, Math.trunc(num(it.qty, 1)))) : 0), 0);
        send(partner.ws, { type: "tradeOffer", from: me.id, items, gold });
        break;
      }

      // ACCEPT on the trade screen itself (final confirm, not the initial
      // request). Once BOTH sides have confirmed, tell both to apply the
      // swap — each client already knows both offers from "tradeOffer"
      // above, so no payload is needed here.
      case "tradeConfirm": {
        if (me.tradePartnerId == null || num(msg.targetId, -1) !== me.tradePartnerId) break;
        const partner = players.get(me.tradePartnerId);
        if (!partner || partner.tradePartnerId !== me.id) break;
        me.tradeConfirmed = true;
        send(partner.ws, { type: "tradeConfirm", from: me.id });
        if (partner.tradeConfirmed) {
          saveGuard.creditGold(partner.uid, me.tradeGold || 0);
          saveGuard.creditGold(me.uid, partner.tradeGold || 0);
          saveGuard.creditItems(partner.uid, me.tradeItemCount || 0);
          saveGuard.creditItems(me.uid, partner.tradeItemCount || 0);
          me.tradeGold = 0; me.tradeItemCount = 0; partner.tradeGold = 0; partner.tradeItemCount = 0;
          send(ws, { type: "tradeComplete" });
          send(partner.ws, { type: "tradeComplete" });
          me.tradePartnerId = null; me.tradeConfirmed = false;
          partner.tradePartnerId = null; partner.tradeConfirmed = false;
        }
        break;
      }

      // DECLINE / CANCEL, at any point (request popup, or the trade screen
      // itself). Silent on the sender's side — the partner gets notified
      // via cancelActiveTrade()'s "tradeCancelled".
      case "tradeCancel":
        cancelActiveTrade(me, "cancelled");
        break;

      // SELL — the player sold an item from the inventory popup. The server works
      // out the price itself from ITS OWN numbers (armor_server.js / upgrade_server.js),
      // never from a price sent by the client, and credits that gold so save_guard.js
      // accepts the gold increase on the next save. Not cheat-proof (the server does not
      // hold the inventory), but it is rate-limited and capped by the price formula.
      case "sell": {
        const sellNow = Date.now();
        if (sellNow - (me.lastSellAt || 0) < 200) break;
        me.lastSellAt = sellNow;
        const it = msg.item;
        if (!it || typeof it !== "object") break;
        const sType = String(it.type || ""), sName = String(it.name || "");
        const sData = (it.data && typeof it.data === "object") ? it.data : {};
        let sellPrice = 0;
        if (sType === "weapon" && GAME_DATA.WEAPONS && GAME_DATA.WEAPONS[sName]) {
          sellPrice = GAME_DATA.calcGearSellPrice(sData, sType);
        } else if ((sType === "armor" || sType === "ring" || sType === "accessory") && GAME_DATA.ARMOR_TYPES && GAME_DATA.ARMOR_TYPES[sName]) {
          sellPrice = GAME_DATA.calcGearSellPrice(sData, sType);
        } else if ((sType === "stone" && GAME_DATA.STONE_TYPES && GAME_DATA.STONE_TYPES[sName]) ||
                   (sType === "orb" && GAME_DATA.ORB_TYPES && GAME_DATA.ORB_TYPES[sName])) {
          sellPrice = GAME_DATA.getUpgradeItemSellPrice(sName);
        }
        if (sellPrice > 0) saveGuard.creditGold(me.uid, sellPrice);
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
    cancelActiveTrade(me, "left");
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

// SAFETY NET: one unexpected error inside a timer, a database call or a message
// handler must not take the whole game server (and every connected player) down.
process.on("uncaughtException", (e) => { console.error("[uncaughtException]", e && e.stack || e); });
process.on("unhandledRejection", (e) => { console.error("[unhandledRejection]", e && e.stack || e); });

server.listen(PORT, () => console.log("Bot Wars server listening on port " + PORT));
