// =============================================================================
// skill_server.js  —  ONLINE MODE copy of skill.js
// =============================================================================
// This is the WHOLE online version of skill.js: in online mode the game runs
// THIS file (its numbers AND its functions/formulas), not skill.js. Edit
// anything in here to change how the game behaves in ONLINE mode.
// skill.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, so players cannot open or edit it. server.js sends it to each
// player when they join an online match; the game swaps it in for as long as
// the player is online, then puts the offline version back (see online.js).
//
// KEEP IT IN STEP WITH skill.js: when skill.js gets a new function or a fix,
// copy that change in here too, or online mode keeps running the old version.
// =============================================================================

// skill.js
//
// Defines character skills — special attacks separate from a character's
// equipped weapon (weapon.js). A character references a skill by name
// (character.js: skill: "barrage"), and game.js looks up that name here
// to know how to run it (damage, projectile burst, cooldown, unlock
// level, etc.).
//
// Unlike a weapon, a skill isn't fired on demand shot-by-shot — it's
// triggered once and then plays out its own burst of `projectileCount`
// bullets, `bulletInterval` seconds apart, before going on `cooldown`.
// SKILL LOCK — mirrors skill.js's SKILL_LOCK_MS exactly (see the comment
// there). Kept in sync by hand like everything else in this file; game.js
// itself isn't swapped per-mode so it always reads skill.js's copy of this
// constant, but this copy documents the online number and is here if the
// lock ever needs to be swapped in per-mode later.
const SKILL_LOCK_MS = 700;

const SKILLS = {

  barrage: {
    skill: "barrage",

    // CATEGORY — marks this as a skill-type item for the Inventory
    // screen's SKILL loadout (the catalog/equip slots there only accept
    // category:"skill" — see index.html's Inventory screen script).
    category: "skill",

    // ACTIVATION TYPE — "ground": tapping this skill's button arms it
    // (button glows red, same as before), then TAPPING THE GROUND
    // anywhere on screen fires it at that world point (see game.js's
    // handleTouchStart() ground-release branch). This travels with the
    // skill itself, not with whichever button slot (1-4) it's dragged
    // into — see onSkillSlotTouch() in game.js.
    activationType: "ground",

    // ATTACK TYPE — "beam": a straight-line vacuum path fired from the
    // player toward the tapped ground point (direction only — see
    // `range` below, it always travels the full distance regardless of
    // how close/far the tap was), instead of the old bullet-burst mortar.
    // Routes to runBeamSkillEffect() in game.js's runSkillActivation()
    // dispatcher. Any other "ground" skill that doesn't set attackType
    // still falls back to the old bullet-burst behavior
    // (runAimedSkillBurst()), so this is barrage-specific.
    attackType: "beam",

    // ICON — shown in the Inventory screen's skill catalog/equip slots,
    // and on the matching SKILL button in gameplay (game.js's
    // updateSkillButtonUI()) once this skill is attached.
    icon: "image/iconbarrage.png",

    // DESCRIPTION — shown under the stats in the Inventory screen's item
    // stats popup when this skill's icon is tapped.
    description: "Sucks in and damages every enemy caught in a straight vacuum path ahead of the player.",

    physicalDamage: 200,

    // RANGE — how far forward the vacuum path travels from the player,
    // in the direction of the ground tap, before it disappears (see
    // runBeamSkillEffect() in game.js). Also used as the aim-UI's
    // maxRange ring.
    range: 300,

    // WIDTH — how wide the vacuum path is (perpendicular to its travel
    // direction). Any bot inside this range x width rectangle gets hit.
    width: 80,

    // TRAVEL SPEED — world pixels/second the vacuum's leading edge
    // visibly travels outward from the player toward `range` (see
    // runBeamSkillEffect()'s sizeOverride.travelSpeed in game.js). Pure
    // visual — damage is still resolved instantly across the whole
    // range the moment the skill fires, this only controls how fast the
    // animation appears to reach the target. Kept comfortably inside
    // the "vacuum" effect's own ~520ms animation length (effect.js:
    // frames x speed) so the beam finishes traveling before its
    // animation ends, instead of visibly cutting off mid-flight.
    travelSpeed: 600,

    // Cooldown (ms) before the skill can be used again.
    cooldown: 5000,

    // Hit effect + sound played along the vacuum path (effect.js) —
    // stretched to exactly range x width, see runBeamSkillEffect().
    hitEffect: "vacuum",

    // SKILL SOUND — played once when the skill is used (ground-tap
    // release, see fireSkill() in game.js). Same music/ folder
    // convention as weapon.js's fireSound.
    skillSound: "music/skill2.mp3",

    // AIM UI — same generic maxRange/radius ring art weapon.js uses
    // (see game.js draw()'s aim UI). No dedicated skill art yet.
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    // Player must be at least this character level (character.js's
    // level/exp system) before the skill can be activated/used.
    requiredLevel: 1
  },

  cannonblast: {
    skill: "cannonblast",

    // CATEGORY — marks this as a skill-type item for the Inventory
    // screen's SKILL loadout (see barrage's `category` above).
    category: "skill",

    // ACTIVATION TYPE — same as barrage: tapping this skill's button arms
    // it, then tapping the ground fires it toward that point (see
    // handleTouchStart()'s ground-release branch in game.js).
    activationType: "ground",

    // ATTACK TYPE — "blast": like barrage's "beam", the ground tap only
    // picks a DIRECTION and the hit rectangle always reaches the skill's
    // full `range` that way. The difference from "beam" is purely visual:
    // a beam's hit effect visibly travels forward from the player toward
    // the tapped point (skill.js's travelSpeed / effect.js's growing
    // width); a blast's hit effect just appears fixed in front of the
    // character, filling the whole range x width rectangle immediately,
    // no travel animation. Routes to runBlastSkillEffect() in game.js's
    // runSkillActivation() dispatcher.
    attackType: "blast",

    // ICON — shown in the Inventory screen's skill catalog/equip slots,
    // and on the matching SKILL button in gameplay once this skill is
    // attached.
    icon: "image/iconblast.png",

    // DESCRIPTION — shown under the stats in the Inventory screen's item
    // stats popup when this skill's icon is tapped.
    description: "Fires a cannon blast in front of the player, damaging every enemy caught in its range.",

    physicalDamage: 100,
    magicalAttack: 100,

    // RANGE — how far forward the blast rectangle extends from the
    // player, in the direction of the ground tap (see
    // runBlastSkillEffect() in game.js).
    range: 100,

    // WIDTH — how wide the blast rectangle is (perpendicular to its
    // facing direction). Any bot inside this range x width rectangle
    // gets hit.
    width: 80,

    // Cooldown (ms) before the skill can be used again. Matches barrage's
    // default — adjust if cannonblast should be faster/slower.
    cooldown: 5000,

    // SKILL SOUND — played once when the skill is used (ground-tap
    // release, see fireSkill() in game.js).
    skillSound: "music/cannonblast.mp3",

    // Hit effect played across the blast rectangle (effect.js) — stretched
    // to exactly range x width, see runBlastSkillEffect().
    hitEffect: "cannonblast",

    // AIM UI — same generic maxRange/radius ring art weapon.js/barrage use
    // (see game.js draw()'s aim UI).
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    // Player must be at least this character level (character.js's
    // level/exp system) before the skill can be activated/used.
    requiredLevel: 1
  },

  // DEADLYSTRIKE — a "blast"-type ground skill that fires `shotTimes`
  // separate blasts, `shotInterval` seconds apart, instead of one.
  // shotTimes/shotInterval work on ANY skill (blast, beam, melee) — see
  // game.js's runSkillActivation()/activeSkillShots tick. Each shot
  // re-checks the hit rectangle, re-rolls crit/armor and replays the hit
  // effect; the skill sound only plays once, on the first shot.
  deadlystrike: {
    skill: "deadlystrike",

    // CATEGORY — marks this as a skill-type item for the Inventory
    // screen's SKILL loadout (see barrage's `category` above).
    category: "skill",

    // ACTIVATION TYPE — "ground": tap the skill button to arm it, then
    // tap the ground to fire toward that point.
    activationType: "ground",

    // ATTACK TYPE — "blast": fixed rectangle in front of the player.
    attackType: "blast",

    // ICON
    icon: "image/icondeadlystrike.png",

    // DESCRIPTION
    description: "Sucks in and damages every enemy caught in a straight vacuum path ahead of the player.",

    physicalDamage: 200,

    // RANGE
    range: 300,

    // WIDTH
    width: 80,

    // Cooldown (ms) before the skill can be used again.
    cooldown: 5000,

    // NUMBER OF SHOTS — how many times the blast fires per activation.
    shotTimes: 5,

    // TIME BETWEEN EACH SHOT (seconds)
    shotInterval: 0.2,

    // Hit effect + sound played along the path on every shot (effect.js).
    // NOTE: needs a "deadlystrike" entry in effect.js's HIT_EFFECTS —
    // until it exists the damage still lands, just with no visual.
    hitEffect: "deadlystrike",

    // SKILL SOUND — played once when the skill is used (placeholder,
    // swap for a dedicated sound whenever you have one).
    skillSound: "music/cannonblast.mp3",

    // AIM UI — same generic maxRange/radius ring art the other skills use.
    imagerange: "image/maxrange.png",
    imageradius: "image/radius.png",

    // Player must be at least this character level
    requiredLevel: 1
  },

  // HEAL — this is character.js's `skill2` slot (game.js's second skill
  // button, skillBtn2). Unlike barrage above, it's not aimed/armed with
  // the right analog: tapping skillBtn2 fires it instantly (see
  // fireSkill2() in game.js), healing the player and, in online mode,
  // any nearby teammate inside `radius`.
  heal1: {
    skill: "heal1",

    // CATEGORY — marks this as a skill-type item for the Inventory
    // screen's SKILL loadout (see barrage's `category` above).
    category: "skill",

    // ACTIVATION TYPE — "instant": tapping this skill's button fires it
    // immediately, no arm/aim step (see game.js's runInstantSkillEffect()).
    // Travels with the skill itself, same as barrage's activationType
    // above — dragging heal1 into any of the 4 slots always fires it
    // this way.
    activationType: "instant",

    // ICON — shown in the Inventory screen's skill catalog/equip slots,
    // and on the matching SKILL button in gameplay once attached.
    icon: "image/iconheal.png",

    // DESCRIPTION — shown under the stats in the Inventory screen's item
    // stats popup when this skill's icon is tapped.
    description: "Instantly heals the player and nearby teammates, plus a brief speed boost.",

    // Amount restored to the player and to each nearby teammate.
    healAmount: 50,

    // TEAMMATE HEAL RADIUS — teammates within this distance of the
    // player also get healed when the skill is used (self is always
    // healed regardless of distance). Mostly matters online, where
    // otherPlayers (game.js) are real teammates instead of empty in
    // offline solo play.
    radius: 100,

    // Cooldown (ms) before the skill can be used again.
    cooldown: 5000,

    // SKILL SOUND — played once when the skill activates. Same
    // music/ folder convention as barrage's skillSound above.
    skillSound: "music/heal1.mp3",

    // HIT EFFECT — played attached to (following) the player instead of
    // at a fixed impact point, since this skill has no aimed target.
    // See effect.js's "heal1" entry and fireSkill2()'s
    // createHitEffect(..., playerPos) call in game.js.
    hitEffect: "heal1",

    // Player must be at least this character level before the skill
    // can be activated/used.
    requiredLevel: 5,

    // SPEED BOOST — temporary movement-speed bump applied on activation
    // (added on top of the player's current movementSpeed), reverted
    // after speedBoostTime (ms) has elapsed. See the speed-boost tick in
    // game.js's update().
    speedBoost: 30,
    speedBoostTime: 2000
  },

  // SLASH1 — melee AoE skill: no aim step, hits every bot within
  // `radius` of the player, `hitNum` separate times, `hitInterval`
  // seconds apart, instead of one lump hit. NOTE: this needs its own
  // activationType handling in game.js (something like "melee") —
  // "instant" (heal1's type) doesn't currently support hitNum/hitInterval
  // multi-hit ticks or a critical roll, so runSkillActivation() will need
  // a new branch before this skill actually deals damage in-game.
  slash1: {
    skill: "slash1",

    // CATEGORY — marks this as a skill-type item for the Inventory
    // screen's SKILL loadout (see barrage's `category` above).
    category: "skill",

    // ACTIVATION TYPE — melee: fires centered on the player the moment
    // the button is tapped, no arm/aim step. Distinct from "instant"
    // (heal1) since it needs multi-hit/crit handling instant doesn't do.
    activationType: "melee",

    // ICON — shown in the Inventory screen's skill catalog/equip slots,
    // and on the matching SKILL button in gameplay once attached.
    icon: "image/slash.png",

    // DESCRIPTION — shown under the stats in the Inventory screen's item
    // stats popup when this skill's icon is tapped.
    description: "A close-range slash that hits twice in quick succession, striking every enemy nearby.",

   
    magicalAttack: 100,
    physicalDamage: 100,
    // AoE radius around the player — every bot inside this range gets
    // hit (same idea as barrage's `radius`, just centered on the player
    // instead of an aimed impact point).
    radius: 100,

    // Cooldown (ms) before the skill can be used again.
    cooldown: 5000,

    // HIT COUNT / INTERVAL — this skill lands hitNum separate hits
    // against everything still in `radius`, hitInterval seconds apart
    // (0.4s), instead of a single hit. Mirrors barrage's
    // projectileCount/bulletInterval burst timing, but re-checks range
    // each tick instead of firing traveling bullets.
    hitNum: 2,
    hitInterval: 0.4,

    // CRITICAL HIT — each of the hitNum hits independently rolls
    // criticalChance (50%) to crit; a crit adds criticalDamage (50% of
    // the character's currently equipped weapon damage, weapon.js) on
    // top of this skill's own `physicalDamage` for that hit.
    criticalChance: 0.0,
    criticalDamage: 0.0,

    // Hit effect + sound played on each hit (effect.js) — "slash1" added
    // there separately.
    hitEffect: "slash1",

    // Player must be at least this character level (character.js's
    // level/exp system) before the skill can be activated/used.
    requiredLevel: 1
  }

};



// ---------------------------------------------------------------------------
// SKILL STAT SCALING — lets a skill's own stat fields combine with the
// PLAYER'S own current total of that same stat (character.js's
// pow/vit/dex/int/health/mana/physicalDefense/physicalDamage/hpRegen/
// manaRegen/magicalAttack/magicalDefense/criticalChance/criticalDamage —
// the same fully-derived numbers already sitting on the live `player`
// object in game.js, gear and levels included), instead of a skill only
// ever dealing its own flat number.
//
// EXAMPLE: player.physicalDamage (current combined total) is 100,
// skill.physicalDamage is 100 -> getSkillEffectiveStats(skill, player)
// returns physicalDamage: 200 for that skill's activation — PLUS the
// physicalDamage of the weapon the player has equipped (see below).
//
// Only fields the skill itself actually sets get combined — a skill with
// no physicalDamage field simply has no physicalDamage (0), it does NOT
// fall back to the player's full physicalDamage on its own. This mirrors
// character.js's EQUIPMENT_STAT_MAP/combineEquipmentStats() pattern
// (equipment stats folding onto a character), just read fresh at
// activation time instead of being baked permanently onto the player.
// ---------------------------------------------------------------------------
const SKILL_SCALABLE_STATS = [
  "pow", "vit", "dex", "int",
  "health", "mana",
  "physicalDefense", "physicalDamage",
  "hpRegen", "manaRegen",
  "magicalAttack", "magicalDefense",
  "criticalChance", "criticalDamage"
];

function getSkillEffectiveStats(skill, player) {
  const effective = {};
  if (!skill) return effective;

  for (const statName of SKILL_SCALABLE_STATS) {
    if (typeof skill[statName] === "number") {
      const playerValue = (player && typeof player[statName] === "number") ? player[statName] : 0;
      effective[statName] = skill[statName] + playerValue;
    }
  }

  // WEAPON DAMAGE — the equipped weapon's physicalDamage is NOT stored on the
  // player (it is only added at attack-time, see getAttackDamage() in
  // character.js), so it has to be added here too or skills would ignore the
  // weapon. Total skill physical damage = skill + player + equipped weapon.
  // EXAMPLE: skill 100 + player 11 + shotgun 600 = 711.
  if (typeof effective.physicalDamage === "number" && player && player.weapon &&
      typeof player.weapon.physicalDamage === "number") {
    effective.physicalDamage += player.weapon.physicalDamage;
  }

  return effective;
}

// ---------------------------------------------------------------------------
// SKILL DAMAGE — builds one rolled damage result from a skill + player,
// combining physicalDamage/magicalAttack via getSkillEffectiveStats()
// above, then rolling ONE crit against the combined criticalChance/
// criticalDamage (also skill + player). Mirrors character.js's
// getAttackDamage()/rollCharacterCritical() — physicalDamage and
// magicalAttack are rolled independently and returned as two separate
// numbers, never summed (see getAttackDamage()'s own comment in
// character.js for why). Call this once per activation for a
// single-roll skill (e.g. barrage's whole burst shares one crit, same as
// a shotgun's whole pellet spread does); call it once PER HIT for a
// multi-hit skill (e.g. slash1) so each hit rolls independently, same as
// character.js's own multi-hit callers do.
//
// Falls back to a local crit roll if rollCharacterCritical isn't loaded
// yet — character.js (where it's defined) loads AFTER skill.js, see
// index.html's script order — so this only matters if this function is
// ever called before the rest of the game has finished loading, which
// shouldn't happen in normal play.
// ---------------------------------------------------------------------------
function getSkillDamageResult(skill, player) {
  const stats = getSkillEffectiveStats(skill, player);

  const physicalTotal = stats.physicalDamage || 0;
  const magicalTotal = stats.magicalAttack || 0;
  const criticalChance = stats.criticalChance || 0;
  const criticalDamage = stats.criticalDamage || 0;

  const critRoller = (typeof rollCharacterCritical === "function")
    ? rollCharacterCritical
    : function (critContext, baseDamage) {
        const isCritical = Math.random() < (critContext.criticalChance || 0);
        const damage = isCritical ? baseDamage * (1 + (critContext.criticalDamage || 0)) : baseDamage;
        return { damage, isCritical };
      };

  const critContext = { criticalChance, criticalDamage };
  const physicalResult = critRoller(critContext, physicalTotal);
  const magicalResult = critRoller(critContext, magicalTotal);

  return {
    damage: physicalResult.damage,
    physicalDamage: physicalResult.damage,
    magicalDamage: magicalResult.damage,
    isCritical: physicalResult.isCritical || magicalResult.isCritical
  };
}



function getSkill(name) {

  return SKILLS[name] || null;

}



function getAllSkills() {

  return Object.values(SKILLS);

}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    SKILLS,
    SKILL_LOCK_MS,
    getSkill,
    getAllSkills,
    SKILL_SCALABLE_STATS,
    getSkillEffectiveStats,
    getSkillDamageResult
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { SKILLS, SKILL_LOCK_MS, SKILL_SCALABLE_STATS };
