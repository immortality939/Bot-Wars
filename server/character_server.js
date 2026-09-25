// =============================================================================
// character_server.js  —  ONLINE MODE copy of character.js
// =============================================================================
// This is the WHOLE online version of character.js: in online mode the game runs
// THIS file (its numbers AND its functions/formulas), not character.js. Edit
// anything in here to change how the game behaves in ONLINE mode.
// character.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, so players cannot open or edit it. server.js sends it to each
// player when they join an online match; the game swaps it in for as long as
// the player is online, then puts the offline version back (see online.js).
//
// KEEP IT IN STEP WITH character.js: when character.js gets a new function or a fix,
// copy that change in here too, or online mode keeps running the old version.
// =============================================================================

// character.js
//
// CHARACTERS[...].armor is an armor.js type name (e.g. "armor1"), not a
// flat number — getCharacter() below resolves it into its full armor.js
// definition and combines EVERY stat that definition carries onto the
// character (see combineEquipmentStats()/EQUIPMENT_STAT_MAP below), not
// just a single flat value. Load order:
// weapon.js -> armor.js -> character.js -> ...

// ---------------------------------------------------------------------------
// ATTRIBUTE_RATES — what ONE point of each attribute is worth. Every place
// that turns vit/dex/int/pow into stats (applyAttributeBonus(), the
// getBase...() helpers below, game.js's match start/respawn and index.html's
// character popup) reads these through attrRate(), so the numbers live here
// and nowhere else.
//   vit — +5 health, +0.25 physicalDefense per point
//   dex — +0.5 physicalDefense, +0.35 criticalDamage per point
//   int — +2 mana, +1 magicalAttack, +0.5 magicalDefense per point
//   pow — +1 physicalDamage per point
// These are the OFFLINE numbers. In ONLINE mode the server sends its own
// ATTRIBUTE_RATES (server/game_server.js) and online.js swaps them in for
// as long as the player is online, then puts these back.
// ---------------------------------------------------------------------------
const ATTRIBUTE_RATES = {
  vit: { health: 5, physicalDefense: 0.25 },
  dex: { physicalDefense: 0.5, criticalDamage: 0.02 },
  int: { mana: 2, magicalAttack: 1, magicalDefense: 0.5 },
  pow: { physicalDamage: 1 }
};

// Reads the CURRENT table (offline or server) so a swap takes effect at once.
function attrRate(attr, stat) {
  const t = ATTRIBUTE_RATES[attr];
  return (t && typeof t[stat] === "number") ? t[stat] : 0;
}

// ---------------------------------------------------------------------------
// GAME_RULES — the leveling numbers. Everything below (and game.js/index.html/
// online.js) reads them through gameRule(), never as loose constants:
//   EXP_BASE / EXP_GROWTH_RATE — exp to reach the next level: starts at
//                                EXP_BASE and multiplies by EXP_GROWTH_RATE
//                                for every level after that (see getExpForLevel)
//   MAX_LEVEL                  — level cap
//   STAT_POINTS_PER_LEVEL      — spendable points granted per level gained
//   AUTO_STAT_GROWTH_PER_LEVEL — free +N to ALL FOUR of vit/dex/int/pow per level
//   HEALTH_GROWTH_RATE         — health multiplier per level (1.1 = +10%, compounding)
//   PARTY_MAX_SIZE              — most players one party can ever hold (see
//                                 online.js's party system)
//   PARTY_EXP_SHARE_RANGE       — world units a party member must be within
//                                 a kill to get a share of its exp (see
//                                 computePartyExpShare() below)
// These are the OFFLINE numbers. In ONLINE mode the server sends its own
// GAME_RULES (server/game_server.js) and online.js swaps them in for as long
// as the player is online, then puts these back.
// ---------------------------------------------------------------------------
const GAME_RULES = {
  EXP_BASE: 300,
  EXP_GROWTH_RATE: 1.5,
  MAX_LEVEL: 40,
  STAT_POINTS_PER_LEVEL: 5,
  AUTO_STAT_GROWTH_PER_LEVEL: 3,
  HEALTH_GROWTH_RATE: 1.1,
  PARTY_MAX_SIZE: 6,
  PARTY_EXP_SHARE_RANGE: 300
};
// Untouched copy: only used if a table from the server ever lacks a rule,
// so a missing number can't turn into NaN / level cap 0.
const GAME_RULE_DEFAULTS = Object.assign({}, GAME_RULES);

function gameRule(name) {
  const v = GAME_RULES[name];
  return (typeof v === "number" && isFinite(v)) ? v : GAME_RULE_DEFAULTS[name];
}

const CHARACTERS = {


  // FAST CHARACTER
  police: {
    name: "police",
    health: 8000,
    armor: "armor1",
    movementSpeed: 115,
    weaponName: "uzi",
    currentHealth: 80,
    image: "image/police.png",
    radius: 13,
    cameraZoom: 1.2,
    unitExplode: "unitexplode",
    level: 1,
    exp: 0,

    // ---- COMBAT STATS — see canCharacterAttack()/getAttackDamage()/
    // tickCharacterRegen() below for how these actually get used. ----

    // ATTACK SPEED (seconds) — minimum time between attacks. 1 = can
    // only attack once every 1 second. Replaces the old per-weapon
    // `cooldown` (weapon.js) — firing rate is now a character stat
    // instead of a weapon one, so it stays consistent no matter what
    // weapon is equipped.
    attackSpeed: 1,

    // BASE DAMAGE — this character's own inherent physicalDamage (a "melee"
    // attack, see `attack` below). Always combines with whatever
    // weapon damage is dealt (getAttackDamage() adds the two together)
    // instead of being replaced by it once a weapon is equipped.
    physicalDamage: 11,
    attack: "melee",

    // CRITICAL HIT — criticalChance is the odds (0.08 = 8%) that an
    // attack crits; criticalDamage is the bonus applied on a crit
    // (0.05 = +5% added on top of the combined weapon+base damage).
    criticalChance: 0.08,
    criticalDamage: 0.05,

    // MANA — max mana pool. Not spent by anything yet (skills don't
    // cost mana currently) — just tracked/regenerated for now so the
    // system is in place before skills start drawing from it.
    mana: 100,

    // REGEN — percentage of max restored per second (0.01 = 1%, so
    // 1% of 100 mana = 1 point/sec). See tickCharacterRegen() below:
    // regen always ticks up by whole points (1, 2, 3...) rather than
    // jumping straight to the full per-second amount, so a higher
    // percentage is felt as faster ticking rather than a bigger jump.
    hpRegen: 0.01,
    manaRegen: 0.01,

    // ATTRIBUTES — raw stat points, converted into real combat stats by
    // getCharacter() below (see the ATTRIBUTES comment block there):
    //   vit — health + physicalDefense
    //   dex — physicalDefense + criticalDamage
    //   int — mana + magicalAttack + magicalDefense
    //   pow — physicalDamage
    vit: 5,
    dex: 5,
    int: 5,
    pow: 5,

    // MAGIC ATTACK — this character's own innate magic damage, separate
    // from physicalDamage (see getAttackDamage() below: the two are
    // rolled and returned independently, never summed).
    magicalAttack: 5,

    // Only one skill — SKILL1 gets heal1, SKILL2 stays empty (dimmed
    // placeholder in gameplay). ensureDefaultSkillsLoaded() in
    // index.html only fills as many equip slots as playerSkill lists,
    // so a single name here is enough; no trailing comma needed.
    playerSkill: "heal1,slash1,barrage,cannonblast,deadlystrike",

    description: "Fast and rapid fire but low health and armor."
  },


  // NORMAL SOLDIER
  soldier: {
    name: "soldier",
    health: 120,
    armor: "armor2",
    movementSpeed: 100,
    weaponName: "ak47",
    currentHealth: 120,
    image: "image/soldier.png",
    radius: 13,
    cameraZoom: 1.4,
    unitExplode: "unitexplode",
    level: 1,
    exp: 0,
    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,
    vit: 5,
    dex: 5,
    int: 5,
    pow: 5,
    magicalAttack: 5,
    playerSkill: "barrage,heal1,slash1",
    description: "Balanced all-rounder with steady health, armor, and speed."
  },


  // HEAVY TANK CHARACTER
  swat: {
    name: "swat",
    health: 250,
    armor: "armor3",
    movementSpeed: 85,
    weaponName: "shotgun",
    currentHealth: 250,
    image: "image/swat.png",
    radius: 15,
    cameraZoom: 1.6,
    unitExplode: "unitexplode",
    level: 1,
    exp: 0,
    attackSpeed: 1,
    physicalDamage: 11,
    attack: "melee",
    criticalChance: 0.08,
    criticalDamage: 0.05,
    mana: 100,
    hpRegen: 0.01,
    manaRegen: 0.01,
    vit: 5,
    dex: 5,
    int: 5,
    pow: 5,
    magicalAttack: 5,
    playerSkill: "barrage,heal1,slash1",
    description: "Heavy tank with high health and armor, but slow movement."
  }

};



// ---------------------------------------------------------------------------
// LEVELING — exp needed to reach the NEXT level starts at 300 (level 1)
// and multiplies by 1.5 for every level after that:
//   level 1 -> 300, level 2 -> 450, level 3 -> 675, level 4 -> 1013, ...
// getCharacter() below stamps every character with level/exp/maxExp;
// addCharacterExp() is how game.js actually grants exp (called with the
// killed bot's own expGet — see bot.js) and cascades through as many
// level-ups as the amount covers in one call. MAX_LEVEL caps how far
// that can go — see addCharacterExp() and getCharacter() below.
//
// STAT POINTS — every level gained also grants STAT_POINTS_PER_LEVEL (5)
// unspent points onto character.statPoints, tallied by addCharacterExp()
// below. These are spent through the game's POINTS panel (see
// index.html's gameInvPointsPanel / applyAttributeBonus() below) to raise
// vit/dex/int/pow — they don't do anything on their own until spent.
//
// AUTO STAT GROWTH — separately, every level gained also auto-applies a
// flat AUTO_STAT_GROWTH_PER_LEVEL (3) to ALL FOUR of vit/dex/int/pow at
// once, converted into health/physicalDefense/mana/etc via
// applyAttributeBonus() exactly like a manually-spent point is. This
// happens automatically, is not optional, and is on top of (not instead
// of) the 5 spendable points above. It's tracked in the very same
// character.spentVit/spentDex/spentInt/spentPow accumulators a manually-
// spent point uses (see addCharacterExp() below and index.html's
// spendGameInvStatPoint()), since both are just "bonus points beyond the
// character's own innate attribute" and need to survive a match restart
// the same way — see getCharacterProgress()/persistCharacterProgress()
// in index.html.
// ---------------------------------------------------------------------------
// (EXP_BASE, EXP_GROWTH_RATE, MAX_LEVEL, STAT_POINTS_PER_LEVEL and
// AUTO_STAT_GROWTH_PER_LEVEL are in GAME_RULES at the top of this file —
// read them with gameRule("NAME").)

function getExpForLevel(level) {
  return Math.round(gameRule("EXP_BASE") * Math.pow(gameRule("EXP_GROWTH_RATE"), (level || 1) - 1));
}

// ---------------------------------------------------------------------------
// HEALTH SCALING — a character's health grows 10% per level, compounding:
//   level 1 -> 100%, level 2 -> 110%, level 3 -> 121%, level 4 -> 133.1%, ...
// baseHealth is always the character's un-leveled, un-armored health (the
// plain `health` value on its CHARACTERS entry in character.js, or a bot's
// `health` on its BOT_TYPES entry in bot.js) — getCharacter() below and
// createBot() (bot.js) both call this the same way, so a character/bot
// that's still level 1 keeps its exact original number and anything past
// that scales up from there. Armor's health bonus is layered on TOP of
// this, separately, wherever it's already applied. Levels past MAX_LEVEL
// never reach this function — getCharacter() below clamps char.level to
// MAX_LEVEL first, so health always tops out at the level-40 number too.
// ---------------------------------------------------------------------------
function getHealthForLevel(baseHealth, level) {
  return Math.round((baseHealth || 0) * Math.pow(gameRule("HEALTH_GROWTH_RATE"), (level || 1) - 1));
}

// ---------------------------------------------------------------------------
// NO-ARMOR MAX HEALTH — same level-scaled health getCharacter() produces,
// PLUS the character's vit bonus (+5 health per vit point, same as
// getCharacter()'s ATTRIBUTES block below), but WITHOUT any equipped
// armor's health bonus baked in. Several call sites (game.js's
// applyLevelHealthGrowth()/startOfflineGame()/startOnlineGame(), index.html's
// save-load restore) need exactly this: a baseline that already reflects
// vit, with armor's health bonus added back separately by whatever's currently
// equipped. Read straight from the CHARACTERS entry (charName) rather than
// a live character object, so it works even before getCharacter() has run.
// ---------------------------------------------------------------------------
function getBaseMaxHealthForLevel(charName, level) {
  const def = (typeof CHARACTERS !== "undefined") ? CHARACTERS[charName] : null;
  const baseHealth = def ? def.health : 0;
  const vit = (def && typeof def.vit === "number") ? def.vit : 0;
  return getHealthForLevel(baseHealth, level) + (vit * attrRate("vit", "health"));
}

// ---------------------------------------------------------------------------
// NO-ARMOR PHYSICAL DEFENSE — same idea as getBaseMaxHealthForLevel() above,
// for physicalDefense instead of health: this character's own base
// physicalDefense (0 if unset) PLUS the vit/dex attribute bonus (+0.25
// physicalDefense per vit, +0.5 per dex, same as getCharacter()'s
// ATTRIBUTES block below), but WITHOUT any equipped armor's physicalDefense
// baked in. game.js's startOfflineGame()/startOnlineGame() need this
// specifically — they get armor's physicalDefense separately from the
// Armor slot (player.armor, see applyEquippedArmorToPlayer() in
// index.html), so baking the character's OWN starting-armor bonus in here
// too (the way getCharacter() below does) would double-count it. Doesn't
// scale by level — physicalDefense isn't a leveled stat, unlike health.
// ---------------------------------------------------------------------------
function getBasePhysicalDefense(charName) {
  const def = (typeof CHARACTERS !== "undefined") ? CHARACTERS[charName] : null;
  const basePhysicalDefense = (def && typeof def.physicalDefense === "number") ? def.physicalDefense : 0;
  const vit = (def && typeof def.vit === "number") ? def.vit : 0;
  const dex = (def && typeof def.dex === "number") ? def.dex : 0;
  return basePhysicalDefense + (vit * attrRate("vit", "physicalDefense")) + (dex * attrRate("dex", "physicalDefense"));
}

// ---------------------------------------------------------------------------
// NO-ARMOR PHYSICAL DAMAGE — same idea as getBasePhysicalDefense() above,
// for physicalDamage instead: this character's own base physicalDamage
// (0 if unset) PLUS the pow attribute bonus (+1 physicalDamage per pow,
// same as getCharacter()'s ATTRIBUTES block below), but WITHOUT any
// equipped armor's physicalDamage baked in. game.js's
// startOfflineGame()/startOnlineGame() need this specifically — they get
// armor's physicalDamage separately from the Armor slot (via
// applyEquippedArmorToPlayer() in index.html, which adds an armor's
// physicalDamage field the same way it adds physicalDefense/health/etc),
// so baking the character's OWN starting-armor bonus in here too (the
// way getCharacter() below does, and the way game.js used to read
// offlineChar.physicalDamage/onlineChar.physicalDamage directly) double-
// counted it: once permanently here, and again every time the Armor slot
// is (re)applied — and since this baked copy was never tracked by any
// delta, unequipping armor mid-match could never fully remove it either.
// ---------------------------------------------------------------------------
function getBasePhysicalDamage(charName) {
  const def = (typeof CHARACTERS !== "undefined") ? CHARACTERS[charName] : null;
  const basePhysicalDamage = (def && typeof def.physicalDamage === "number") ? def.physicalDamage : 0;
  const pow = (def && typeof def.pow === "number") ? def.pow : 0;
  return basePhysicalDamage + (pow * attrRate("pow", "physicalDamage"));
}

function addCharacterExp(character, amount) {
  if (!character || typeof amount !== "number" || amount <= 0) {
    return { leveledUp: false, levelsGained: 0 };
  }

  if (typeof character.level !== "number") character.level = 1;
  if (typeof character.exp !== "number") character.exp = 0;
  if (typeof character.maxExp !== "number") character.maxExp = getExpForLevel(character.level);
  if (typeof character.statPoints !== "number") character.statPoints = 0;

  const maxLevel = gameRule("MAX_LEVEL");

  // MAX LEVEL — a character already at MAX_LEVEL (40) has nowhere
  // further to go, so kills stop granting it exp entirely instead of
  // piling up exp it can never spend.
  if (character.level >= maxLevel) {
    character.level = maxLevel;
    character.exp = 0;
    character.maxExp = getExpForLevel(maxLevel);
    return { leveledUp: false, levelsGained: 0 };
  }

  character.exp += amount;

  let levelsGained = 0;
  while (character.level < maxLevel && character.exp >= character.maxExp) {
    character.exp -= character.maxExp;
    character.level += 1;
    character.maxExp = getExpForLevel(character.level);
    levelsGained++;
  }

  // A single big enough kill could cascade past MAX_LEVEL in the loop
  // above — clamp back down and drop whatever exp was left over, same
  // as the already-capped case above.
  if (character.level >= maxLevel) {
    character.level = maxLevel;
    character.exp = 0;
    character.maxExp = getExpForLevel(maxLevel);
  }

  // STAT POINTS — 5 per level gained (see STAT_POINTS_PER_LEVEL above),
  // regardless of how many levels a single big kill cascaded through.
  //
  // AUTO STAT GROWTH — +3 to vit/dex/int/pow per level gained (see
  // AUTO_STAT_GROWTH_PER_LEVEL above), folded into the same
  // spentVit/spentDex/spentInt/spentPow accumulators a manually-spent
  // point uses, so both persist and restore the same way (see
  // getCharacterProgress()/persistCharacterProgress() in index.html).
  // Run through applyAttributeBonus() — same conversion a spent point or
  // a piece of gear's own vit/dex/int/pow goes through — so this
  // directly raises health/physicalDefense/mana/magicalAttack/
  // magicalDefense/criticalDamage/physicalDamage too, not just the raw
  // vit/dex/int/pow numbers. currentHealth/currentMana are topped up by
  // the same amount just added to the max (mirroring
  // applyLevelHealthGrowth()'s top-up-by-delta convention in game.js),
  // and baseMaxHealth (the no-armor max health baseline game.js/
  // index.html's applyEquippedArmorToPlayer() recomputes off of) is kept
  // in sync too, so a later armor swap or level-based health recompute
  // can't silently erase this growth.
  if (levelsGained > 0) {
    character.statPoints = (character.statPoints || 0) + (levelsGained * gameRule("STAT_POINTS_PER_LEVEL"));

    const autoPoints = levelsGained * gameRule("AUTO_STAT_GROWTH_PER_LEVEL");
    character.spentVit = (character.spentVit || 0) + autoPoints;
    character.spentDex = (character.spentDex || 0) + autoPoints;
    character.spentInt = (character.spentInt || 0) + autoPoints;
    character.spentPow = (character.spentPow || 0) + autoPoints;

    const beforeHealth = character.health || 0;
    const beforeMana = character.mana || 0;
    applyAttributeBonus(character, autoPoints, autoPoints, autoPoints, autoPoints);
    const healthDelta = (character.health || 0) - beforeHealth;
    const manaDelta = (character.mana || 0) - beforeMana;

    if (typeof character.baseMaxHealth === "number") character.baseMaxHealth += healthDelta;
    if (typeof character.currentHealth === "number") character.currentHealth += healthDelta;
    if (typeof character.currentMana === "number") character.currentMana += manaDelta;
  }

  return { leveledUp: levelsGained > 0, levelsGained };
}

// ---------------------------------------------------------------------------
// PARTY EXP SHARING — online mode only (see online.js's party system: up to
// PARTY_MAX_SIZE (6) players, formed via the INVITE PARTY button). When a
// party member kills an enemy, the kill's expGet is split evenly between
// every party member within PARTY_EXP_SHARE_RANGE (300) world units of the
// kill, INCLUDING the killer — a member further away than that gets nothing
// from that particular kill. Both numbers are read through gameRule(), so a
// server config change doesn't need a code change.
//
// This function is pure math only — no character objects, no network calls.
// online.js is what actually calls it (once per online kill, from inside an
// addCharacterExp() override — see "damageBot"'s override in online.js for
// the same pattern), applies the killer's own share locally, and sends each
// other member's share to them over the network ("partyExpAward" — see
// server.js) to apply on their own end.
//
//   killerId        — id of whoever landed the kill.
//   killerX/killerY  — where the kill happened (the killer's own position).
//   amount           — the bot's total expGet for this kill.
//   partyPositions   — every party member online.js can currently place on
//                       the map, as [{ id, x, y }, ...]. MUST include the
//                       killer's own entry (their distance to themselves is
//                       always 0, so they're always in range). A member
//                       online.js can't currently place (on a different map,
//                       or hasn't sent a "state" yet) should simply be left
//                       out of this array — leaving them out has the exact
//                       same effect as them being out of range: no share.
//   range            — optional override; defaults to
//                       gameRule("PARTY_EXP_SHARE_RANGE").
//
// Returns an array of { id, share } — ONLY for members within range (a
// member left out of the return got 0, not a 0-share entry). Shares are
// floor()'d to whole numbers so exp is never fractional; whatever remainder
// that floor() leaves over (amount doesn't always divide evenly by the
// in-range headcount) is folded into the KILLER's own share, so the party's
// shares always add up to exactly `amount` — never more, never less.
// ---------------------------------------------------------------------------
function computePartyExpShare(killerId, killerX, killerY, amount, partyPositions, range) {
  if (typeof amount !== "number" || amount <= 0 || !Array.isArray(partyPositions)) return [];
  const shareRange = (typeof range === "number" && range >= 0) ? range : gameRule("PARTY_EXP_SHARE_RANGE");

  const inRangeIds = [];
  for (const m of partyPositions) {
    if (!m || typeof m.x !== "number" || typeof m.y !== "number") continue;
    const dist = Math.hypot(m.x - killerX, m.y - killerY);
    if (dist <= shareRange) inRangeIds.push(m.id);
  }
  if (!inRangeIds.length) return [];

  const base = Math.floor(amount / inRangeIds.length);
  const remainder = amount - (base * inRangeIds.length);

  return inRangeIds.map((id) => ({ id, share: base + (id === killerId ? remainder : 0) }));
}



// ---------------------------------------------------------------------------
// PARTY FRIENDLY FIRE — online mode only, same party system as
// computePartyExpShare() above (up to PARTY_MAX_SIZE members, formed via the
// INVITE PARTY button, membership tracked as server.js's authoritative
// `partyId` on each player). Two players count as teammates here ONLY when
// both have a non-null partyId AND it's the same one — a player with no
// party (partyId null/undefined) can still be hit by anyone, same as today.
//
// Pure check only — no network calls, no character mutation. The actual
// hit path (online.js's netHitPlayers() for players, server.js's "hit"
// relay) is what should call this BEFORE rolling/sending any damage, so a
// blocked hit never becomes a bullet-lands / dmgNum / knockback event either.
// ---------------------------------------------------------------------------
function isPartyFriendlyFire(attackerPartyId, targetPartyId) {
  return attackerPartyId != null && targetPartyId != null && attackerPartyId === targetPartyId;
}

// ---------------------------------------------------------------------------
// CLAN FRIENDLY FIRE — same idea as PARTY FRIENDLY FIRE above, but for
// clanmates (server.js's authoritative `clanId` on each player, set on
// clanCreate/clanResponse/removeFromClan — see the CLANS section of
// server.js). Two players count as clanmates here ONLY when both have a
// non-null clanId AND it's the same one — a player with no clan
// (clanId null/undefined) can still be hit by anyone, same as today.
// ---------------------------------------------------------------------------
function isClanFriendlyFire(attackerClanId, targetClanId) {
  return attackerClanId != null && targetClanId != null && attackerClanId === targetClanId;
}

// Convenience wrapper for callers that already have both player-ish objects
// in hand (anything carrying a `.partyId`/`.clanId`, e.g. online.js's local
// player mirror or server.js's connection records) instead of the ids alone.
function canCharacterDamageTarget(attacker, target) {
  if (!attacker || !target || attacker === target) return false;
  if (isPartyFriendlyFire(attacker.partyId, target.partyId)) return false;
  return !isClanFriendlyFire(attacker.clanId, target.clanId);
}



// ---------------------------------------------------------------------------
// PARTY LOOT TURN — alternates WHO a party's shared ground loot goes to
// instead of it always being whoever clicks/walks over it first. Turn order
// follows `party.members` (same array server.js's party object already
// keeps — see "parties" Map in server.js), and the current turn is stored
// right on that party object as `party.lootTurnIndex` so it persists for as
// long as the party exists, no extra state to wire up elsewhere.
//
//   isPartyLootTurn(party, playerId) — true if it's currently playerId's
//     turn to loot (or if `party` is null/has no members, since a solo
//     player or a broken party record should never be blocked from
//     looting). Call this before honoring a party member's "dropTake".
//
//   advancePartyLootTurn(party) — moves the turn to the next member, wrapping
//     back to the start after the last one. Call this once, right after a
//     party member's loot claim is accepted, so the NEXT drop goes to
//     whoever's next in line rather than the same person again.
//
// Both are pure/cheap — safe to call every time a drop is claimed.
// ---------------------------------------------------------------------------
function isPartyLootTurn(party, playerId) {
  if (!party || !Array.isArray(party.members) || !party.members.length) return true;
  const idx = (typeof party.lootTurnIndex === "number" ? party.lootTurnIndex : 0) % party.members.length;
  return party.members[idx] === playerId;
}

function advancePartyLootTurn(party) {
  if (!party || !Array.isArray(party.members) || !party.members.length) return;
  const idx = (typeof party.lootTurnIndex === "number" ? party.lootTurnIndex : 0) % party.members.length;
  party.lootTurnIndex = (idx + 1) % party.members.length;
}

// Read-only peek at whose turn it currently is, without advancing anything —
// for telling every member's client who's up next (server.js includes this
// in its "partyUpdate" roster broadcast; online.js mirrors it as
// netParty.lootTurnId). Returns null for no/solo party, same as
// isPartyLootTurn() treating that case as unrestricted.
function getPartyLootTurnId(party) {
  if (!party || !Array.isArray(party.members) || party.members.length < 2) return null;
  const idx = (typeof party.lootTurnIndex === "number" ? party.lootTurnIndex : 0) % party.members.length;
  return party.members[idx];
}



// ---------------------------------------------------------------------------
// EQUIPMENT STAT COMBINING — merges every stat an equipped item (armor,
// weapon, or any other equippable def with matching field names) carries
// onto a character/bot, instead of only pulling one or two fields out of
// it by hand. Safe to call once per equipped slot (armor, weapon,
// accessories, ...) since it only ADDS onto whatever's already there —
// call unequip logic separately if a slot needs to be removed/swapped.
//
// STAT MAP — equipment field name -> character field it adds onto. Only
// fields the equipment def actually defines (and that appear in this
// map) get combined; anything else on the def (name, image, category,
// spawnChance, description, block, ...) is left alone since those
// aren't character combat stats. Any of these fields can be put on
// EITHER a weapon.js entry or an armor.js entry — same simple addition
// either way, e.g. a weapon with hpRegen: 0.3 combines onto the
// character's hpRegen exactly like an armor piece would.
//
// hpRegen/manaRegen here ARE the character's own percent-of-max regen
// stat (character.hpRegen/manaRegen, see tickCharacterRegen() below) —
// a plain flat add, same as every other stat in this map (armor with
// hpRegen: 1 on a character already at hpRegen: 0.01 makes it 1.01).
//
// health is the same plain flat add onto character.health (max health) —
// there is no separate "addHealth" field anymore; an armor.js or
// weapon.js entry just sets health: 30 the same way it'd set hpRegen: 1,
// and the currentHealth top-up/clamp on gaining or losing it is handled
// generically wherever combineEquipmentStats() is called (see
// attachWeaponToCharacter() below and applyEquippedArmorToPlayer() in
// index.html), not by any special-cased field.
//
// vit/dex/int/pow are handled separately, just below — they don't do a
// flat add onto character.vit/etc, they run through the same
// point-conversion formulas as a character's own base attributes (see
// applyAttributeBonus() below) so gear-granted attribute points behave
// identically to the character's own.
// ---------------------------------------------------------------------------
const EQUIPMENT_STAT_MAP = {
  physicalDefense: "physicalDefense",
  magicalDefense: "magicalDefense",
  health: "health",
  physicalDamage: "physicalDamage",
  magicalAttack: "magicalAttack",
  criticalChance: "criticalChance",
  criticalDamage: "criticalDamage",
  mana: "mana",
  movementSpeed: "movementSpeed",
  hpRegen: "hpRegen",
  manaRegen: "manaRegen"
};

// ---------------------------------------------------------------------------
// ATTRIBUTE POINTS -> DERIVED STATS — shared by a character's own base
// vit/dex/int/pow (see the ATTRIBUTES block in getCharacter() below) and
// any equipped weapon/armor that also carries vit/dex/int/pow (see
// combineEquipmentStats() below). Keeping this in one place means a
// point of vit from gear does exactly what a point of vit on the
// character itself does, regardless of where it came from:
// The per-point numbers are in ATTRIBUTE_RATES (top of this file):
//   vit — +5 health, +0.25 physicalDefense per point
//   dex — +0.5 physicalDefense, +0.35 criticalDamage per point
//   int — +2 mana, +1 magicalAttack, +0.5 magicalDefense per point
//   pow — +1 physicalDamage per point
// ---------------------------------------------------------------------------
function applyAttributeBonus(character, vit, dex, int, pow) {
  if (!character) return character;
  vit = vit || 0; dex = dex || 0; int = int || 0; pow = pow || 0;

  character.vit = (character.vit || 0) + vit;
  character.dex = (character.dex || 0) + dex;
  character.int = (character.int || 0) + int;
  character.pow = (character.pow || 0) + pow;

  character.health = (character.health || 0) + (vit * attrRate("vit", "health"));
  character.physicalDefense = (character.physicalDefense || 0) + (vit * attrRate("vit", "physicalDefense")) + (dex * attrRate("dex", "physicalDefense"));
  character.criticalDamage = (character.criticalDamage || 0) + (dex * attrRate("dex", "criticalDamage"));
  character.mana = (character.mana || 0) + (int * attrRate("int", "mana"));
  character.magicalAttack = (character.magicalAttack || 0) + (int * attrRate("int", "magicalAttack"));
  character.magicalDefense = (character.magicalDefense || 0) + (int * attrRate("int", "magicalDefense"));
  character.physicalDamage = (character.physicalDamage || 0) + (pow * attrRate("pow", "physicalDamage"));

  return character;
}

// excludeFields — optional array of equipment field names to skip. Used
// by attachWeaponToCharacter() below to skip physicalDamage, since a
// weapon's physicalDamage already combines with the character's own at
// attack-time (see getAttackDamage() below) instead of being baked into
// a permanent stat — combining it here too would double it.
function combineEquipmentStats(character, equipmentDef, excludeFields) {
  if (!character || !equipmentDef) return character;
  const skip = excludeFields || [];

  for (const equipField in EQUIPMENT_STAT_MAP) {
    if (skip.indexOf(equipField) !== -1) continue;
    if (typeof equipmentDef[equipField] === "number") {
      const charField = EQUIPMENT_STAT_MAP[equipField];
      character[charField] = (character[charField] || 0) + equipmentDef[equipField];
    }
  }

  if (skip.indexOf("vit") === -1 && skip.indexOf("dex") === -1 &&
      skip.indexOf("int") === -1 && skip.indexOf("pow") === -1 &&
      (typeof equipmentDef.vit === "number" || typeof equipmentDef.dex === "number" ||
       typeof equipmentDef.int === "number" || typeof equipmentDef.pow === "number")) {
    applyAttributeBonus(character, equipmentDef.vit, equipmentDef.dex, equipmentDef.int, equipmentDef.pow);
  }

  return character;
}



function getCharacter(name) {

  const base = CHARACTERS[name];


  if (!base) {

    throw new Error(
      "Character not found: " + name
    );

  }


  const char = JSON.parse(
    JSON.stringify(base)
  );


  // LEVELING — see getExpForLevel()/addCharacterExp() above. Backfills
  // defaults if a character (or old save data) is missing them, and
  // always recomputes maxExp from the current level so it can't drift
  // out of sync with the 1.5x-per-level formula. Resolved BEFORE health
  // below, since health scaling needs to know the level already.
  // Clamped to MAX_LEVEL here too — so even if a CHARACTERS entry (or
  // stale save data) has level set higher than 40, it comes back as
  // level 40 with level-40 health, same as if it had actually been
  // earned through play.
  char.level = typeof char.level === "number" ? char.level : 1;
  if (char.level > gameRule("MAX_LEVEL")) char.level = gameRule("MAX_LEVEL");
  char.exp = typeof char.exp === "number" ? char.exp : 0;
  char.maxExp = getExpForLevel(char.level);

  // HEALTH SCALING — char.health on the CHARACTERS entry is this
  // character's level-1 baseline; baseHealth keeps that original number
  // around, and health becomes it scaled for char.level (see
  // getHealthForLevel() above) — e.g. 100 base at level 2 becomes 110.
  char.baseHealth = char.health;
  char.health = getHealthForLevel(char.baseHealth, char.level);

  char.radius = char.radius || 12;

  // COMBAT STATS — backfill defaults for any character missing these
  // (old save data, etc.), same pattern as char.radius above. Resolved
  // BEFORE the ARMOR/ATTRIBUTES blocks below, so both add cleanly on
  // top of real base numbers instead of racing ahead of these defaults.
  char.attackSpeed = typeof char.attackSpeed === "number" ? char.attackSpeed : 1;
  char.physicalDamage = typeof char.physicalDamage === "number" ? char.physicalDamage : 0;
  char.physicalDefense = typeof char.physicalDefense === "number" ? char.physicalDefense : 0;
  char.attack = char.attack || "melee";
  char.criticalChance = typeof char.criticalChance === "number" ? char.criticalChance : 0;
  char.criticalDamage = typeof char.criticalDamage === "number" ? char.criticalDamage : 0;
  char.hpRegen = typeof char.hpRegen === "number" ? char.hpRegen : 0;
  char.manaRegen = typeof char.manaRegen === "number" ? char.manaRegen : 0;
  char.mana = typeof char.mana === "number" ? char.mana : 0;

  // MAGIC STATS — magicalAttack is the magic-damage counterpart to
  // physicalDamage, but they are NOT combined into one number — see
  // getAttackDamage() below, which now returns physicalDamage and
  // magicalDamage as two separate amounts. magicalDefense is the
  // counterpart to physicalDefense, for whatever applies incoming
  // damage mitigation (item.js/bot.js) against each type independently
  // — a target with no magicalDefense still takes magicalDamage as pure
  // damage even if it has physicalDefense, and vice versa. Both default
  // to 0 for a character with no innate magic stats.
  char.magicalAttack = typeof char.magicalAttack === "number" ? char.magicalAttack : 0;
  char.magicalDefense = typeof char.magicalDefense === "number" ? char.magicalDefense : 0;

  // ATTRIBUTES (capture) — grab the CHARACTER'S OWN raw vit/dex/int/pow
  // points now, before the ARMOR block below runs, and zero them out on
  // char itself. This has to happen BEFORE combineEquipmentStats(armorDef)
  // for the fix below to work: combineEquipmentStats() converts an
  // armor's own vit/dex/int/pow into health/physicalDefense/etc via
  // applyAttributeBonus(), starting from whatever's currently sitting in
  // char.vit/dex/int/pow — starting it from 0 here means the armor's
  // points get converted exactly once. (Previously this capture happened
  // AFTER the armor block and read char.vit itself, which by then already
  // included the armor's points — so the final applyAttributeBonus() call
  // below converted the armor's contribution a SECOND time, silently
  // doubling the health/physicalDefense an armor's vit/dex granted.)
  const baseVit = typeof char.vit === "number" ? char.vit : 0;
  const baseDex = typeof char.dex === "number" ? char.dex : 0;
  const baseInt = typeof char.int === "number" ? char.int : 0;
  const basePow = typeof char.pow === "number" ? char.pow : 0;
  char.vit = 0; char.dex = 0; char.int = 0; char.pow = 0;

  // ARMOR — char.armor is an armor.js type name (e.g. "armor1"), the
  // equipment reference itself; NOT the same thing as char.physicalDefense
  // above, which is the character's own resolved defense number. Resolved
  // here into its full armor.js definition, then EVERY stat that
  // definition carries (physicalDefense, health, hpRegen, manaRegen,
  // etc. — see EQUIPMENT_STAT_MAP / combineEquipmentStats() above) gets
  // combined onto the character, not just a couple of cherry-picked
  // fields. Still falls back cleanly to treating a plain number as a
  // flat physicalDefense bonus (old style, no other armor.js stats) and
  // to no bonus at all if armor.js isn't loaded or char.armor is unset.
  const armorDef = (typeof char.armor === "number")
    ? null
    : (typeof getArmor === "function" ? getArmor(char.armor) : null);

  if (armorDef) {
    combineEquipmentStats(char, armorDef);
  } else if (typeof char.armor === "number") {
    char.physicalDefense += char.armor;
  }

  char.equippedArmor = armorDef || null;   // used by tickArmorRegeneration()/rollArmorBlock() in armor.js

  // ---------------------------------------------------------------------
  // ATTRIBUTES (apply) — now add the character's OWN vit/dex/int/pow
  // (captured above, before armor ran) on top of whatever the armor
  // block just contributed. char.vit/dex/int/pow already holds the
  // armor's points at this point (0 + armor's points, from the
  // combineEquipmentStats() call above — or still 0 if there's no armor,
  // or the armor has no attribute points on it). This call adds the
  // character's own points to that, and converts ONLY this call's
  // vit/dex/int/pow into health/physicalDefense/etc — so every point,
  // whether it's the character's own or the armor's, gets converted
  // exactly once:
  //   vit — +5 health, +0.25 physicalDefense per point
  //   dex — +0.5 physicalDefense, +0.35 criticalDamage per point
  //   int — +2 mana, +1 magicalAttack, +0.5 magicalDefense per point
  //   pow — +1 physicalDamage (physical attack power) per point
  // ---------------------------------------------------------------------
  applyAttributeBonus(char, baseVit, baseDex, baseInt, basePow);

  // Health/mana totals are only final once the ARMOR/ATTRIBUTES blocks
  // above have both applied, so currentHealth/currentMana are stamped
  // here, at the very end, instead of partway through.
  char.currentHealth = char.health;
  char.currentMana = char.mana;

  // ATTACK TIMING / REGEN ACCUMULATORS — see canCharacterAttack() and
  // tickCharacterRegen() below.
  char.lastAttackTime = 0;
  char._hpRegenAcc = 0;
  char._manaRegenAcc = 0;

  return char;

}





function attachWeaponToCharacter(character) {


  if (typeof getWeapon === "undefined") {

    throw new Error(
      "weapon.js not loaded or getWeapon() missing"
    );

  }


  const weapon = getWeapon(
    character.weaponName
  );


  if (!weapon) {

    throw new Error(
      "Weapon not found: " +
      character.weaponName
    );

  }


  // IMPORTANT: getWeapon() returns the SAME object stored in WEAPONS
  // (weapon.js) — it's a shared template, not a per-character copy.
  // Give the character its own deep clone (same approach bot.js already
  // uses in createBot()), so upgrading/buffing this character's weapon
  // mutates only their copy instead of permanently changing the shared
  // template that every other player/bot using that weapon reads from.
  character.weapon = JSON.parse(JSON.stringify(weapon));

  // Undo whatever the PREVIOUSLY attached weapon added below, before
  // combining this one. combineEquipmentStats()/applyAttributeBonus()
  // are purely additive, and this function gets called every time the
  // weapon changes (swapping in the Weapon slot) as well as a few times
  // per match for the SAME weapon (e.g. clearing a temporary buff) — so
  // without undoing the previous contribution first, a weapon's vit/dex/
  // int/pow/hpRegen/etc would stack higher every time it's re-attached.
  // Same fix already applied to armor's live equip path in index.html.
  const prevDelta = character._weaponGearDelta;
  if (prevDelta) {
    for (const field in prevDelta) {
      character[field] = (character[field] || 0) - prevDelta[field];
    }
  }
  character._weaponGearDelta = null;

  // Combine every OTHER stat the weapon def carries (criticalChance,
  // hpRegen, vit, magicalAttack, ...) onto the character, same as armor
  // does in getCharacter() above — see EQUIPMENT_STAT_MAP. physicalDamage
  // is excluded here on purpose: it already combines with the character's
  // own physicalDamage at attack-time (see getAttackDamage() below), so
  // adding it again here would double it.
  const trackedFields = ["physicalDefense", "health", "magicalDefense",
    "magicalAttack", "criticalChance", "criticalDamage", "mana",
    "movementSpeed", "hpRegen", "manaRegen", "vit", "dex", "int", "pow",
    "physicalDamage"];
  const before = {};
  trackedFields.forEach(f => { before[f] = character[f] || 0; });

  combineEquipmentStats(character, character.weapon, ["physicalDamage"]);

  const delta = {};
  trackedFields.forEach(f => {
    const d = (character[f] || 0) - before[f];
    if (d) delta[f] = d;
  });
  character._weaponGearDelta = delta;

  // baseMaxHealth is the "no-armor" health baseline that
  // applyEquippedArmorToPlayer() (index.html) recomputes player.health
  // FROM every time armor is equipped/swapped/removed. Every OTHER
  // source of health (level growth, spent/auto vit points, ...) already
  // keeps baseMaxHealth in sync when it changes health -- this one
  // didn't, so a weapon's health/vit bonus was silently erased the next
  // time armor got (re-)applied, including on respawn.
  if (delta.health && typeof character.baseMaxHealth === "number") {
    character.baseMaxHealth += delta.health;
  }

  // Same currentHealth clamp applyEquippedArmorToPlayer() (index.html)
  // uses for its own health delta -- keeps currentHealth from sitting
  // above the new max, and tops it up (capped at the new max) if a
  // weapon's health/vit just got freshly gained.
  if (delta.health && typeof character.currentHealth === "number") {
    character.currentHealth = delta.health > 0
      ? Math.min(character.health, character.currentHealth + delta.health)
      : Math.min(character.currentHealth, character.health);
  }

  // Same idea for mana -- a weapon's mana/int bonus otherwise raises/
  // lowers character.mana (the max) without ever touching
  // character.currentMana, which is exactly the bug reported for
  // armor's mana (see the manaBefore clamp in applyEquippedArmorToPlayer(),
  // index.html): the max moves but current doesn't follow, so it can
  // end up showing more "current" than the new max allows.
  if (delta.mana && typeof character.currentMana === "number") {
    character.currentMana = delta.mana > 0
      ? Math.min(character.mana, character.currentMana + delta.mana)
      : Math.min(character.currentMana, character.mana);
  }

  return character;

}





// ---------------------------------------------------------------------------
// SKILL ATTACH — mirrors attachWeaponToCharacter() above. character.skill is
// just a name (skill.js: "barrage"); this resolves it into a real stats
// object at character.skillData, deep-cloned so per-character cooldown/use
// tracking never mutates the shared SKILLS template. Characters with no
// skill (character.skill unset) just get skillData: null — game.js checks
// for that before showing the skill button at all.
// ---------------------------------------------------------------------------
function attachSkillToCharacter(character) {

  if (!character.skill) {
    character.skillData = null;
  } else {

    if (typeof getSkill === "undefined") {
      throw new Error(
        "skill.js not loaded or getSkill() missing"
      );
    }

    const skill = getSkill(character.skill);

    if (!skill) {
      throw new Error(
        "Skill not found: " + character.skill
      );
    }

    character.skillData = JSON.parse(JSON.stringify(skill));

    // Cooldown tracking — 0 means "never used yet", so the skill is
    // available immediately once the required level is reached.
    character.skillLastUsedTime = 0;

  }

  // SKILL 2 — second, independent skill slot (character.skill2, e.g.
  // "heal"). Same resolve/clone/cooldown-tracking pattern as `skill`
  // above, just attached to skillData2/skill2LastUsedTime instead, so
  // game.js's second skill button (skillBtn2) can track it separately
  // from the first. Characters with no skill2 just get skillData2: null
  // — game.js checks for that before showing that button at all.
  if (!character.skill2) {
    character.skillData2 = null;
  } else {

    if (typeof getSkill === "undefined") {
      throw new Error(
        "skill.js not loaded or getSkill() missing"
      );
    }

    const skill2 = getSkill(character.skill2);

    if (!skill2) {
      throw new Error(
        "Skill not found: " + character.skill2
      );
    }

    character.skillData2 = JSON.parse(JSON.stringify(skill2));
    character.skill2LastUsedTime = 0;

  }

  return character;

}




// GET ALL CHARACTERS
function getAllCharacters(){

  return Object.keys(CHARACTERS);

}




// ---------------------------------------------------------------------------
// UNIT EXPLODE — plays a character's death animation (character.unitExplode,
// see effect.js) once, at the given x/y. Mirrors damageBot()'s death
// handling in bot.js. character.js has no health/death tracking of its own
// (that's done in game.js), so this needs to be called from wherever a
// player's death is actually detected — e.g. game.js's "playerDied"
// handling and its offline-mode equivalent.
// ---------------------------------------------------------------------------
function playCharacterExplode(character, x, y) {

  if (!character) return;

  if (character.unitExplode && typeof createHitEffect === "function") {
    createHitEffect(x, y, character.unitExplode);
  }

}




// ---------------------------------------------------------------------------
// ATTACK SPEED — replaces the old per-weapon `cooldown` (weapon.js) now
// that firing rate is a character stat instead of a per-weapon one.
// character.attackSpeed is in seconds; character.lastAttackTime is a
// performance.now() timestamp set by the caller (game.js's fireBullet()
// for the player, bot.js's tryBotShoot() for bots) the moment an attack
// actually fires. Works on both a player character (character.js) and a
// bot (bot.js) — both get attackSpeed/lastAttackTime the same way.
// ---------------------------------------------------------------------------
function canCharacterAttack(character, nowMs) {
  if (!character) return false;
  const interval = (character.attackSpeed || 0) * 1000;
  return (nowMs - (character.lastAttackTime || 0)) >= interval;
}



// ---------------------------------------------------------------------------
// CRITICAL HIT — rolls character.criticalChance and, on a hit, boosts
// baseDamage by criticalDamage (e.g. 0.05 = +5%). Returns both the final
// damage and whether it crit, in case a caller wants to show a crit
// indicator later.
// ---------------------------------------------------------------------------
function rollCharacterCritical(character, baseDamage) {
  const chance = (character && character.criticalChance) || 0;
  const bonus = (character && character.criticalDamage) || 0;
  const isCritical = Math.random() < chance;
  const damage = isCritical ? baseDamage * (1 + bonus) : baseDamage;
  return { damage, isCritical };
}



// ---------------------------------------------------------------------------
// ATTACK DAMAGE — physical and magical damage are rolled and returned as
// TWO SEPARATE amounts, never summed into one total. They're different
// damage types that get checked against different defenses downstream
// (physicalDamage vs a target's physicalDefense, magicalDamage vs a
// target's magicalDefense) — a target with only physicalDefense still
// takes its magicalDamage as pure, unmitigated damage, and vice versa.
// That mitigation step itself happens wherever damage is actually applied
// (e.g. damageBot() in bot.js, applyDamageToPlayer() in item.js), not
// here — this just produces the two raw numbers to feed into it.
//
// `damage` is kept on the result (mirrored from physicalDamage) so
// existing callers that only read a single `.damage` number — like
// tryBotShoot()/tryBotMeleeAttack() (bot.js) — keep working unchanged
// until they're updated to also apply magicalDamage separately.
// ---------------------------------------------------------------------------
function getAttackDamage(character, weaponDamage) {
  const physicalTotal = (weaponDamage || 0) + ((character && character.physicalDamage) || 0);
  const magicalTotal = (character && character.magicalAttack) || 0;

  const physicalResult = rollCharacterCritical(character, physicalTotal);
  const magicalResult = rollCharacterCritical(character, magicalTotal);

  return {
    damage: physicalResult.damage,
    physicalDamage: physicalResult.damage,
    magicalDamage: magicalResult.damage,
    isCritical: physicalResult.isCritical || magicalResult.isCritical
  };
}



// ---------------------------------------------------------------------------
// DAMAGE MITIGATION — applies a defender's physicalDefense/magicalDefense
// against an attacker's raw physicalDamage/magicalDamage (see
// getAttackDamage() above: the two are separate damage types, never
// summed before this point). Each type is reduced ONLY by its own
// matching defense stat — a defender with physicalDefense but no
// magicalDefense still takes magicalDamage as pure, unmitigated damage,
// and vice versa (physicalDefense/magicalDefense both default to 0, so
// "no defense of that type" naturally falls through to full damage, no
// special-casing needed). Returns both reduced amounts plus their sum
// (totalDamage, floored at 1 so a hit can never deal 0) for callers that
// just want a single number to subtract from health.
// ---------------------------------------------------------------------------
function getMitigatedDamage(attackResult, defender) {
  const rawPhysical = (attackResult && attackResult.physicalDamage) || 0;
  const rawMagical = (attackResult && attackResult.magicalDamage) || 0;
  const physicalDefense = (defender && defender.physicalDefense) || 0;
  const magicalDefense = (defender && defender.magicalDefense) || 0;

  const physicalDamage = Math.max(0, Math.round(rawPhysical - physicalDefense));
  const magicalDamage = Math.max(0, Math.round(rawMagical - magicalDefense));

  return {
    physicalDamage,
    magicalDamage,
    totalDamage: Math.max(1, physicalDamage + magicalDamage),
    isCritical: !!(attackResult && attackResult.isCritical)
  };
}



// ---------------------------------------------------------------------------
// PERCENT REGEN TICK — shared by hp and mana regen below. Restores
// points at a rate of (max * regenFraction) per second, but never in one
// lump jump: it accumulates dt and adds exactly 1 point every time enough
// time has passed for one point at that rate, so a higher percentage
// shows up as faster ticking (1, 2, 3, 4, 5 in the same second) rather
// than a bigger jump.
// ---------------------------------------------------------------------------
function tickPercentRegen(current, max, regenFraction, accumulatorMs, dtMs) {
  if (typeof current !== "number" || typeof max !== "number" || max <= 0) {
    return { value: current, accumulator: 0 };
  }
  if (current >= max || !regenFraction || regenFraction <= 0) {
    return { value: current, accumulator: 0 };
  }

  const pointsPerSecond = max * regenFraction;
  if (pointsPerSecond <= 0) return { value: current, accumulator: 0 };

  const tickIntervalMs = 1000 / pointsPerSecond;

  let acc = (accumulatorMs || 0) + dtMs;
  let value = current;

  while (acc >= tickIntervalMs && value < max) {
    acc -= tickIntervalMs;
    value = Math.min(max, value + 1);
  }

  return { value, accumulator: acc };
}

// CHARACTER REGEN — call every frame with elapsed dt (in milliseconds)
// for a player (character.js: currentHealth/health, currentMana/mana) or
// a bot (bot.js: health/maxHealth, mana/maxMana) to tick their own
// hpRegen/manaRegen percentage stats. Any equipped weapon/armor with its
// own hpRegen/manaRegen field is already folded straight into these
// percentages by combineEquipmentStats() above, so this one tick covers
// both the character's own regen and gear's regen bonus together.
function tickCharacterRegen(character, dtMs) {
  if (!character) return;

  // HP
  if (typeof character.currentHealth === "number" && typeof character.health === "number") {
    const hp = tickPercentRegen(character.currentHealth, character.health, character.hpRegen, character._hpRegenAcc, dtMs);
    character.currentHealth = hp.value;
    character._hpRegenAcc = hp.accumulator;
  } else if (typeof character.health === "number" && typeof character.maxHealth === "number") {
    const hp = tickPercentRegen(character.health, character.maxHealth, character.hpRegen, character._hpRegenAcc, dtMs);
    character.health = hp.value;
    character._hpRegenAcc = hp.accumulator;
  }

  // MANA
  if (typeof character.currentMana === "number" && typeof character.mana === "number") {
    const mp = tickPercentRegen(character.currentMana, character.mana, character.manaRegen, character._manaRegenAcc, dtMs);
    character.currentMana = mp.value;
    character._manaRegenAcc = mp.accumulator;
  } else if (typeof character.mana === "number" && typeof character.maxMana === "number") {
    const mp = tickPercentRegen(character.mana, character.maxMana, character.manaRegen, character._manaRegenAcc, dtMs);
    character.mana = mp.value;
    character._manaRegenAcc = mp.accumulator;
  }
}





if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    CHARACTERS,
    getCharacter,
    attachWeaponToCharacter,
    attachSkillToCharacter,
    getAllCharacters,
    getExpForLevel,
    addCharacterExp,
    computePartyExpShare,
    isPartyFriendlyFire,
    isClanFriendlyFire,
    canCharacterDamageTarget,
    isPartyLootTurn,
    advancePartyLootTurn,
    getPartyLootTurnId,
    getHealthForLevel,
    getBaseMaxHealthForLevel,
    getBasePhysicalDefense,
    getBasePhysicalDamage,
    playCharacterExplode,
    canCharacterAttack,
    rollCharacterCritical,
    getAttackDamage,
    getMitigatedDamage,
    tickCharacterRegen,
    combineEquipmentStats,
    applyAttributeBonus,
    EQUIPMENT_STAT_MAP,
    ATTRIBUTE_RATES,
    attrRate,
    GAME_RULES,
    gameRule
  };

}

