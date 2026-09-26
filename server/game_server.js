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
const { SKILL_LOCK_MS } = require("./skill_server.js");

function isPlayerSkillLocked(playerState, now) {
  return now < (playerState.skillGlobalLockedUntil || 0);
}

function lockPlayerSkillUse(playerState, now) {
  playerState.skillGlobalLockedUntil = now + SKILL_LOCK_MS;
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



// ---- export for server.js (Node) ----
if (typeof module !== "undefined") {
  module.exports = {
    MAX_ROOM_DROPS,
    PARTY_LOOT_RULES,
    partyLootRuleForCategory,
    prunePartyMembers,
    BOT_SKILL_MAX_DAMAGE_PER_HIT,
    clampBotSkillDamage,
    isPlayerSkillLocked,
    lockPlayerSkillUse,
    getPortalArrivalSpawn
  };
}
