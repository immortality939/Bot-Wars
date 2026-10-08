// =============================================================================
// game_server.js  —  ROOM / PARTY / LOOT TUNING (ONLINE MODE)
// =============================================================================
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, same as every other *_server.js file — so none of these numbers
// or rules can be read or edited by a player. It's the home for small
// hardcoded values that control server behavior but don't obviously belong
// inside one specific *_server.js file (weapon/armor/character/item/etc).
//
// Start moving other hardcoded server.js numbers in here over time — this
// file is meant to grow, not stay this short.
// =============================================================================



// ---------------------------------------------------------------------------
// ROOM DROPS — a room (one map instance, one channel) never holds more than
// this many ground items at once; the oldest is deleted to make space for a
// new one. Keeps a long-running room from accumulating forever if nobody
// loots. Used by server.js's "dropAdd" / "invDropAdd" handlers.
// ---------------------------------------------------------------------------
const MAX_ROOM_DROPS = 400;

// ---------------------------------------------------------------------------
// ROOM ENEMY MEMORY (ms) — how long a map's enemies (their health / position /
// dead-or-alive) are remembered after the LAST player left it (or after the
// enemy host left and nobody streamed a newer state). Whoever walks back in
// inside this window finds the enemies exactly as they were left (the ones
// you nearly killed are still nearly dead). Past it the map starts fresh.
// Used by server.js's currentBots().
// ---------------------------------------------------------------------------
const EMPTY_ROOM_BOTS_KEEP_TIME = 5 * 60 * 1000;   // 5 minutes



// ---------------------------------------------------------------------------
// PARTY LOOT — how a party (2+ members) splits a ground item that a solo
// player would otherwise just keep outright. Every ground-item category
// (see item_server.js's createItemDrop()/createInventoryItemDrop() —
// "weapon", "armor", "invItem", "stone", "orb", "gold", or the default
// "item") funnels into exactly ONE of these three rules. server.js's
// "dropTake" handler looks the claimed drop's category up in here and
// applies the matching rule instead of always awarding the picker.
//
//   ALTERNATE — gear/materials (weapons, armor, dropped inventory items,
//     upgrade stones/orbs): goes to ONE party member at a time. Turn order
//     follows the party's member list and rotates every time ANY member
//     claims a drop in this rule (see getPartyLootTurnId()/
//     advancePartyLootTurn() in character_server.js), so loot spreads out
//     evenly instead of always going to whoever is fastest/nearest.
//
//   SPLIT — gold orbs: the orb's gold amount is divided evenly across
//     every party member, with any remainder (from an amount that doesn't
//     divide evenly) given out one-each starting from the front of the
//     turn order, so no gold is lost to rounding.
//
//   SHARED — consumable buffs/heals (health, shield, speedup, powerup):
//     every party member gets the FULL effect applied to their OWN
//     character, not just whoever walked over the drop. A speedup picked
//     up by one member speeds up the whole party.
//
// A category that isn't listed here falls back to SHARED — the safest
// default, since worst case everyone gets an effect meant for one person,
// rather than loot silently disappearing.
// ---------------------------------------------------------------------------
const PARTY_LOOT_RULES = {
  weapon: "ALTERNATE",
  armor: "ALTERNATE",
  ring: "ALTERNATE",
  accessory: "ALTERNATE",
  invItem: "ALTERNATE",
  stone: "ALTERNATE",
  orb: "ALTERNATE",
  gold: "SPLIT",
  item: "SHARED"
};

function partyLootRuleForCategory(category) {
  return PARTY_LOOT_RULES[category] || "SHARED";
}



// ---------------------------------------------------------------------------
// PARTY MEMBER HYGIENE — fixes the "loot goes to me twice before it ever
// reaches player 2" bug. party.members is only ever supposed to hold ids of
// people currently in the party, but a connection that disappears WITHOUT a
// clean websocket "close" firing (a dropped Render connection, a refresh
// the server didn't get the close event for in time, etc.) can leave a
// stale/dead id sitting in that array forever — removeFromParty() only ever
// runs from the "close" handler, so if close never fires, nothing prunes it.
//
// That stale id still occupies a slot in the ALTERNATE turn order
// (getPartyLootTurnId()/advancePartyLootTurn() in character_server.js just
// walk party.members by index — they have no way to know an entry is dead).
// server.js's old fallback of "if the current turn holder isn't a live
// player, just give it to whoever's picking it up" means every turn that
// lands on that dead slot silently gets handed to the PICKER instead — which
// looks exactly like "it keeps going to me" for however many dead slots are
// in the array, before the turn order finally reaches the real other member.
// The same stale id also eats a SPLIT gold share that never reaches anyone
// (server.js's `if (!m) continue;` just drops it).
//
// Call this at the top of "dropTake", right after getParty(me), before
// looking at party.members.length or computing any rule. It rewrites
// party.members down to only ids currently in the live `players` Map, and
// clamps lootTurnIndex into the new (possibly shorter) range so the turn
// order keeps making sense instead of pointing past the end. Safe to call
// on every claim — it's a no-op whenever nothing is actually stale.
// ---------------------------------------------------------------------------
function prunePartyMembers(party, players) {
  if (!party || !Array.isArray(party.members)) return false;
  const live = party.members.filter((id) => players.has(id));
  if (live.length === party.members.length) return false;
  party.members = live;
  if (typeof party.lootTurnIndex === "number" && live.length) {
    party.lootTurnIndex = party.lootTurnIndex % live.length;
  }
  return true; // membership changed — caller should re-broadcast the roster
}



// ---------------------------------------------------------------------------
// BOT SKILL DAMAGE CAP — a bot with a botSkill list (bot_server.js's
// BOT_TYPES[...].botSkill, e.g. guard's "slash1,barrage,cannonblast,
// deadlystrike") can hit much harder per swing than a plain melee/ranged
// bot attack — see skill_server.js's SKILLS for each skill's own
// physicalDamage/magicalAttack. server.js's "botHitPlayer" relay already
// clamps EVERY bot hit (skill or not) to its own generic MAX_DAMAGE_PER_HIT,
// which is sized for a normal weapon swing, not a skill burst — so a
// compromised room host could otherwise report a skill-tier "botHitPlayer"
// hit that gets silently truncated down to normal-attack size, or (if that
// generic cap is ever loosened) inflate a normal attack up to skill size.
//
// This is the skill-specific ceiling for that same relay: bigger than a
// normal bot swing (so a legitimate skill hit isn't clipped), but still
// capped well under what a fully-stacked player build could theoretically
// roll through getSkillDamageResult() (skill_server.js), so a hostile host
// can't mint unlimited damage by claiming every hit came from a skill.
// Not yet wired into server.js's "botHitPlayer" case — that handler still
// applies the generic MAX_DAMAGE_PER_HIT to every bot hit today. Swap in
// clampBotSkillDamage() there (using msg.isSkillHit or similar) if/when
// skill-sourced bot hits need this tighter, dedicated cap instead.
// ---------------------------------------------------------------------------
const BOT_SKILL_MAX_DAMAGE_PER_HIT = 400;

function clampBotSkillDamage(amount) {
  return Math.min(BOT_SKILL_MAX_DAMAGE_PER_HIT, Math.max(0, Number(amount) || 0));
}



// ---------------------------------------------------------------------------
// SHARED SKILL LOCK — SERVER-AUTHORITATIVE version of game.js's
// player.skillGlobalLockedUntil / bot.js's bot.skillGlobalLockedUntil. The
// client-side lock (game.js) stops a normal client from firing a different
// skill within skill_server.js's SKILL_LOCK_MS of its last one, but that
// check runs in the player's own browser, so a modified client could just
// skip it and send "hit"/"botHit" messages (see online.js's netSendHit()/
// damageBot()) for skills back-to-back anyway.
//
// This is the check that actually can't be bypassed: server.js calls
// isPlayerSkillLocked(me, now) for any inbound "hit"/"botHit" message
// tagged isSkillHit (see online.js), where `me` is THIS PLAYER'S OWN
// per-connection object that only server.js ever writes to — a client
// can send messages, but it can never directly set its own me.
// skillGlobalLockedUntil, so it cannot lie its way past this. If the
// check fails, server.js drops the hit (same "just `break`" pattern it
// already uses for its rate-limit/damage-clamp checks); if it passes,
// call lockPlayerSkillUse(me, now) so the NEXT skill hit from this same
// player has to wait out the same window for real, no matter what that
// player's client-side UI shows.
// ---------------------------------------------------------------------------
const { SKILL_LOCK_MS, SKILLS } = require("./skill_server.js");

function isPlayerSkillLocked(playerState, now) {
  return now < (playerState.skillGlobalLockedUntil || 0);
}

function lockPlayerSkillUse(playerState, now) {
  playerState.skillGlobalLockedUntil = now + SKILL_LOCK_MS;
}



// ---------------------------------------------------------------------------
// SERVER-AUTHORITATIVE MANA — same idea as isPlayerSkillLocked()/
// lockPlayerSkillUse() above: game.js's own hasEnoughSkillMana()/
// spendSkillMana() (skill.js) already stop a normal client from firing a
// skill it can't afford, but that check runs in the player's own browser,
// so a modified client could just skip it and send a "hit" message (see
// online.js's netSendHit()) claiming the skill fired anyway.
//
// NOT WIRED IN YET. Using these for real needs two more pieces this file
// alone can't provide:
//   1. playerState.mana/maxMana on the server's own per-connection object
//      (server.js's `me`, initialized alongside health/maxHealth) — there
//      is currently no server-side mana value to check or spend at all.
//   2. the skill's name on the "hit" message itself (online.js's
//      netSendHit() only sends isSkillHit: true/false today, never WHICH
//      skill) — without it, server.js has no way to look up that skill's
//      manaCost in SKILLS below.
// Once both exist, call hasEnoughPlayerMana(me, skillName) next to
// isPlayerSkillLocked(me, now) in server.js's "hit" case, and
// spendPlayerMana(me, skillName) next to lockPlayerSkillUse(me, now).
// ---------------------------------------------------------------------------
// SKILL NAME LOOKUP — the client reports a skill by its `skill:` NAME (e.g.
// "Fire Explosion"), but SKILLS is keyed by the table KEY (e.g.
// "fireexplosion"). For many skills those two are NOT the same text, so a
// plain SKILLS[skillName] lookup found nothing: the server never "paid" the
// cast and then dropped every hit of it (other players / bots took no
// damage from a second player's skills). This finds the skill by key first,
// then by its `skill` name (case-insensitive).
function findSkillDef(skillName) {
  if (typeof skillName !== "string" || !skillName) return null;
  if (SKILLS[skillName]) return SKILLS[skillName];
  const lower = skillName.toLowerCase();
  for (const k of Object.keys(SKILLS)) {
    const d = SKILLS[k];
    if (k.toLowerCase() === lower || (d && typeof d.skill === "string" && d.skill.toLowerCase() === lower)) return d;
  }
  return null;
}

function hasEnoughPlayerMana(playerState, skillName) {
  const skill = findSkillDef(skillName);
  const cost = (skill && typeof skill.manaCost === "number") ? skill.manaCost : 0;
  const currentMana = (playerState && typeof playerState.mana === "number") ? playerState.mana : 0;
  return currentMana >= cost;
}

function spendPlayerMana(playerState, skillName) {
  if (!playerState || typeof playerState.mana !== "number") return;
  const skill = findSkillDef(skillName);
  const cost = (skill && typeof skill.manaCost === "number") ? skill.manaCost : 0;
  playerState.mana = Math.max(0, playerState.mana - cost);
}

// ---------------------------------------------------------------------------
// WIRED IN (server.js): the server now keeps its OWN mana count for every
// player (playerState.mana / maxMana) and a skill only counts if the server
// charged for it:
//   * the client sends {type:"skillUse", skill} whenever it fires a skill
//     (online.js wraps runSkillActivation) -> tryPaySkillUse() looks the
//     skill's manaCost up in skill_server.js (never trusts the client's
//     number) and takes it from the server's count. No mana = not paid.
//   * server.js drops every skill "hit"/"botHit" and "skillBuff" unless a
//     paid skill use is still open (hasPaidSkillUse()), so a modified client
//     that skips the local mana check just hits for 0.
//   * the client still reports its mana in "state" messages (it knows its
//     gear/stat bonuses), but syncReportedMana() never lets that number jump
//     up faster than MANA_REGEN_CAP_PER_SEC, so you can't report yourself
//     back to full mana.
// Numbers you may want to tune are the three constants right below.
// ---------------------------------------------------------------------------
const MAX_PLAYER_MANA = 3000;            // the highest max mana a client may claim
const MANA_REGEN_CAP_PER_SEC = 0.05;     // most mana (fraction of max) the server accepts regaining per second (normal regen is ~0.01)
const SKILL_PAID_HIT_WINDOW_MS = 3000;   // how long after paying, that skill's hits/buffs are still accepted (+ its multi-shot time)

// Called from server.js's "state" case with what the client REPORTED.
function syncReportedMana(playerState, reportedMana, reportedMaxMana, nowAlive, now) {
  const max = Math.min(MAX_PLAYER_MANA, Math.max(0,
    Number.isFinite(reportedMaxMana) ? reportedMaxMana : (playerState.maxMana || 0)));
  const rep = Math.max(0, Math.min(max,
    Number.isFinite(reportedMana) ? reportedMana : (playerState.mana || 0)));
  const last = playerState.manaSyncAt || 0;
  const dt = last ? Math.min(5, Math.max(0, (now - last) / 1000)) : 0;
  if (!playerState.manaSynced || (nowAlive && playerState.alive === false)) {
    // first report after joining, or just respawned: mana is refilled
    playerState.mana = rep;
    playerState.manaSynced = true;
  } else {
    // can go DOWN freely; can only go UP by what real regen could give
    playerState.mana = Math.min(rep, max, (playerState.mana || 0) + max * MANA_REGEN_CAP_PER_SEC * dt);
  }
  playerState.maxMana = max;
  playerState.manaSyncAt = now;
}

// Charges a skill use. Returns true (paid, mana taken, hits now accepted) or false.
function tryPaySkillUse(playerState, skillName, now) {
  const skill = findSkillDef(skillName);
  if (!skill) return false;
  if (!hasEnoughPlayerMana(playerState, skillName)) return false;
  spendPlayerMana(playerState, skillName);
  const shots = Math.max(1, Math.trunc(skill.shotTimes) || 1);
  const gapMs = Math.max(0, Number(skill.shotInterval) || 0) * 1000;
  playerState.skillPaidUntil = now + SKILL_PAID_HIT_WINDOW_MS + (shots - 1) * gapMs;
  playerState.skillPaidName = (typeof skill.skill === "string" && skill.skill) ? skill.skill : skillName;
  // One paid cast = one "cast id" and a limited hit budget (see consumeSkillHit()).
  playerState.skillCastId = (playerState.skillCastId || 0) + 1;
  playerState.skillHitsLeft = 0;
  playerState.skillHitBudget = Math.min(SKILL_MAX_HITS_PER_CAST, shots * SKILL_HITS_PER_SHOT);
  return true;
}

const SKILL_HITS_PER_SHOT = 8;      // most hits (targets) one shot of a paid cast may land
const SKILL_MAX_HITS_PER_CAST = 60; // hard cap for one paid cast, however many shots

// SKILL HIT GATE — server.js calls this for every "hit"/"botHit" tagged
// isSkillHit. The cast must be paid (mana taken on the server) and the global
// skill lock (SKILL_LOCK_MS between two DIFFERENT casts) is checked on the
// FIRST hit of each paid cast. Before this, the lock was re-checked on every
// hit, so a skill that hits 2+ targets or fires several shots only ever got
// its first hit through. Now one paid cast may land up to its own hit budget
// (shots x targets), but a second cast still has to be paid for and wait out
// the lock, so a modified client cannot spam hits for free.
function consumeSkillHit(playerState, now) {
  if (!hasPaidSkillUse(playerState, now)) return false;
  if (playerState.skillLockedCast !== playerState.skillCastId) {
    if (isPlayerSkillLocked(playerState, now)) return false;
    lockPlayerSkillUse(playerState, now);
    playerState.skillLockedCast = playerState.skillCastId;
    playerState.skillHitsLeft = Math.max(0, (playerState.skillHitBudget || SKILL_HITS_PER_SHOT) - 1);
    return true;
  }
  if (playerState.skillHitsLeft > 0) { playerState.skillHitsLeft--; return true; }
  return false;
}

// True while a paid skill use is still open (optionally for one named skill).
function hasPaidSkillUse(playerState, now, skillName) {
  if (now >= (playerState.skillPaidUntil || 0)) return false;
  return !skillName || playerState.skillPaidName === skillName;
}



// ---------------------------------------------------------------------------
// PORTAL ARRIVAL SPAWN — SERVER-AUTHORITATIVE. Where a player lands after
// walking through a portal into another map.
//
// game.js/online.js used to pick this on the CLIENT (switchToLevel() in
// game.js worked out a "return portal" and spawned the player next to it
// locally, then just told the server which map it ended up on). A modified
// client could lie about that and report any x/y it wanted for the "state"
// messages that follow. This is the server-side version of that same idea,
// run here instead so the player has no say in it: server.js's "map" case
// calls getPortalArrivalSpawn() itself, right after validating the map
// switch, and sets me.x/me.y (and sends them back in "mapChanged") BEFORE
// the client ever gets a chance to send its own guess.
//
// Logic: on the map the player is ARRIVING at, look for the portal whose
// `entrance` leads back to the map they just came FROM, and land them just
// off that portal — walk back onto it and you're straight back where you
// started, like stepping back through the same door. `entrance` values are
// map keys/names (see worldmap_server.js, e.g. entrance: "LEVEL2"), matched
// case-insensitively against both the source map's own key in `maps` and
// its `name` field, so this doesn't depend on the two happening to be
// spelled the same. No matching portal (a dead end, or arriving fresh from
// the lobby) just falls back to the middle of the map.
// ---------------------------------------------------------------------------
function findReturnPortal(mapDef, fromMapKey, maps) {
  if (!mapDef || !Array.isArray(mapDef.portals) || !fromMapKey) return null;
  const fromMap = maps && maps[fromMapKey];
  const fromName = fromMap && typeof fromMap.name === "string" ? fromMap.name.trim().toLowerCase() : "";
  const fromKeyLower = String(fromMapKey).trim().toLowerCase();
  for (const p of mapDef.portals) {
    const entrance = String((p && p.entrance) || "").trim().toLowerCase();
    if (!entrance) continue;
    if (entrance === fromKeyLower || (fromName && entrance === fromName)) return p;
  }
  return null;
}

function spawnPointNearPortal(portal, mapDef) {
  const cx = portal.x + portal.width / 2;
  const cy = portal.y + portal.height / 2;
  const worldCx = mapDef.worldWidth / 2;
  const worldCy = mapDef.worldHeight / 2;
  const dx = worldCx - cx, dy = worldCy - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const margin = 45;   // just past the portal, still close enough to walk straight back onto it
  return { x: cx + (dx / dist) * margin, y: cy + (dy / dist) * margin };
}

function getPortalArrivalSpawn(mapDef, fromMapKey, maps) {
  const returnPortal = findReturnPortal(mapDef, fromMapKey, maps);
  if (returnPortal) return spawnPointNearPortal(returnPortal, mapDef);
  return { x: mapDef.worldWidth / 2, y: mapDef.worldHeight / 2 };
}



// ---------------------------------------------------------------------------
// MAP BACKGROUND MUSIC (ONLINE) — which track plays on which online map.
// Keys are the map keys from worldmap_server.js (LEVEL1 ... LEVEL50); values
// are files in the game's music/ folder (MUSIC1.mp3 ... MUSIC6.mp3, repeating
// 1-6 over the 20 maps). server.js sends this to the client inside the game
// data, online.js puts it on each map, and game.js plays it when the player
// is on that map (stops it when the player walks through a portal to another
// map, then plays the new map's track). Change a line to swap a map's track.
// ---------------------------------------------------------------------------
const MAP_MUSIC = {
  LEVEL1: "music/MUSIC1.mp3",
  LEVEL2: "music/MUSIC2.mp3",
  LEVEL3: "music/MUSIC3.mp3",
  LEVEL4: "music/MUSIC4.mp3",
  LEVEL5: "music/MUSIC5.mp3",
  LEVEL6: "music/MUSIC6.mp3",
  LEVEL7: "music/MUSIC1.mp3",
  LEVEL8: "music/MUSIC2.mp3",
  LEVEL9: "music/MUSIC3.mp3",
  LEVEL10: "music/MUSIC4.mp3",
  LEVEL11: "music/MUSIC5.mp3",
  LEVEL12: "music/MUSIC6.mp3",
  LEVEL13: "music/MUSIC1.mp3",
  LEVEL14: "music/MUSIC2.mp3",
  LEVEL15: "music/MUSIC3.mp3",
  LEVEL16: "music/MUSIC4.mp3",
  LEVEL17: "music/MUSIC5.mp3",
  LEVEL18: "music/MUSIC6.mp3",
  LEVEL19: "music/MUSIC1.mp3",
  LEVEL20: "music/MUSIC2.mp3",
  LEVEL21: "music/MUSIC3.mp3",
  LEVEL22: "music/MUSIC4.mp3",
  LEVEL23: "music/MUSIC5.mp3",
  LEVEL24: "music/MUSIC6.mp3",
  LEVEL25: "music/MUSIC1.mp3",
  LEVEL26: "music/MUSIC2.mp3",
  LEVEL27: "music/MUSIC3.mp3",
  LEVEL28: "music/MUSIC4.mp3",
  LEVEL29: "music/MUSIC5.mp3",
  LEVEL30: "music/MUSIC6.mp3",
  LEVEL31: "music/MUSIC1.mp3",
  LEVEL32: "music/MUSIC2.mp3",
  LEVEL33: "music/MUSIC3.mp3",
  LEVEL34: "music/MUSIC4.mp3",
  LEVEL35: "music/MUSIC5.mp3",
  LEVEL36: "music/MUSIC6.mp3",
  LEVEL37: "music/MUSIC1.mp3",
  LEVEL38: "music/MUSIC2.mp3",
  LEVEL39: "music/MUSIC3.mp3",
  LEVEL40: "music/MUSIC4.mp3",
  LEVEL41: "music/MUSIC5.mp3",
  LEVEL42: "music/MUSIC6.mp3",
  LEVEL43: "music/MUSIC1.mp3",
  LEVEL44: "music/MUSIC2.mp3",
  LEVEL45: "music/MUSIC3.mp3",
  LEVEL46: "music/MUSIC4.mp3",
  LEVEL47: "music/MUSIC5.mp3",
  LEVEL48: "music/MUSIC6.mp3",
  LEVEL49: "music/MUSIC1.mp3",
  LEVEL50: "music/MUSIC2.mp3"
};



// ---- export for server.js (Node) ----
if (typeof module !== "undefined") {
  module.exports = {
    MAX_ROOM_DROPS,
    EMPTY_ROOM_BOTS_KEEP_TIME,
    MAP_MUSIC,
    PARTY_LOOT_RULES,
    partyLootRuleForCategory,
    prunePartyMembers,
    BOT_SKILL_MAX_DAMAGE_PER_HIT,
    clampBotSkillDamage,
    isPlayerSkillLocked,
    lockPlayerSkillUse,
    hasEnoughPlayerMana,
    spendPlayerMana,
    syncReportedMana,
    tryPaySkillUse,
    hasPaidSkillUse,
    consumeSkillHit,
    findSkillDef,
    getPortalArrivalSpawn
  };
}
