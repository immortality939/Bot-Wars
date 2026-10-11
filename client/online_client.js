// =============================================================================
// online_client.js — ONLINE MODE (client side): a shared PvP arena.
// -----------------------------------------------------------------------------
// This file lives on the SERVER (GitHub / Render), NOT in the public game files.
// The public data/online.js is only a small loader: when the player taps
// "Online" it downloads this file from the server (GET /online.js) and runs it.
// -----------------------------------------------------------------------------
// =============================================================================
// Tapping "Online" on the start menu picks a character, connects to the
// server (server/server.js) and drops the player into a shared arena with
// everyone else who is connected. Offline mode is completely separate and
// never touches any of this (game.js only calls into here when
// gameMode === "online").
//
// HOW DAMAGE WORKS (simple, friend-friendly trust model):
//   * The ATTACKER works out who their attack hit (netHitPlayers(),
//     netMeleeStrike(), netMortarLanded()) and sends a "hit" for each victim.
//   * The VICTIM applies it to themselves (netApplyHit()) using their own
//     armor / defense / block chance, and handles their own death + respawn.
//   * Everyone else just sees positions, health bars, bullets, effects and
//     sounds relayed by the server.
// Loaded after game.js (downloaded when Online is tapped), so it can use game.js's globals (player, playerPos,
// bullets, isDead, respawnPlayerOffline() ...).
// =============================================================================

// (server address: lives in the public data/online.js loader — getOnlineServerUrl())

// The arena map comes from the server (server/worldmap_server.js) when you
// join; this is the level number it gets registered under (see netRegisterWorldMaps).
let netOnlineLevel = 1;
// Server count, player cap and channels are NOT stored here: the server's /servers
// answer lists them (server/online_server.js -> ONLINE_RULES).
// These online rules are NOT stored here: the server sends them when you join
// (server/online_server.js -> ONLINE_RULES, see netApplyServerData) and enforces them.
let NET_STATE_INTERVAL = 0;
let NET_RESPAWN_SECONDS = 0;
let NET_SPAWN_PROTECT_MS = 0;
let NET_BOTS_INTERVAL = 0;

let netSocket = null;
let netServerId = 0;                 // server / channel I am currently in
let netChannel = -1;
let netChannelPvp = false;           // does my channel allow player-vs-player damage? (the server tells us on join)
const otherPlayers = new Map();      // id -> remote player (see netAddRemote)
let netStateTimer = 0;
let netSpawnProtectUntil = 0;
let netRespawnInterval = null;
let netDeathPos = null;   // where I died: I respawn right there (see netRespawn)
const netCharCache = {};             // character name -> { image, radius }

// ---------------------------------------------------------------------------
// PARTY (online only) — formed via the INVITE PARTY button (see
// playerTouchInviteBtn below), up to PARTY_MAX_SIZE members, sharing kill exp
// with anyone in range (see the addCharacterExp() override further down and
// computePartyExpShare() in character.js). Server-authoritative: server.js
// tracks real membership and is the source of truth for "partyUpdate";
// netParty here is just this client's local mirror of that, kept for
// rendering the PARTY panel and for picking who to send exp shares to.
// In-memory only, like the friend list above — resets on reload/reconnect.
// ---------------------------------------------------------------------------
let PARTY_MAX_SIZE = 0;              // set from the server's ONLINE_RULES when you join
let netParty = null;                 // { id, members: [{id, name}] } or null when not in a party

// ---------------------------------------------------------------------------
// ENEMIES (PvE) — shared in real time across everyone in the room.
// ---------------------------------------------------------------------------
// Only ONE player per room ("the bot host") actually simulates the enemies
// (the normal bots.js AI, unchanged) — everyone else just renders whatever
// the host reports. This is set from the server's "init"/"mapChanged"/
// "botHost" messages (see netSetBotHost() below); it can change mid-match
// if the current host disconnects.
let netIsBotHost = false;
let netBotsTimer = 0;

// game.js/bot.js load before this file, so these grab the real, offline
// versions before we replace the global names — offline mode (and the bot
// host in online mode) always goes straight through to these, unchanged.
const _localUpdateBots = updateBots;
const _localDamageBot = damageBot;
const NET_PRED_DEATH_HOLD_MS = 3000;   // how long a guest's predicted kill is kept while waiting for the host to confirm it

// SKILL MANA (online) — game.js's fireSkill() family ends in
// runSkillActivation(). Online, tell the server the moment a skill fires so
// it can charge the mana cost on ITS OWN mana count (game_server.js's
// tryPaySkillUse()); the server drops the skill's hits/buffs if it wasn't paid.
const _localRunSkillActivation = runSkillActivation;
runSkillActivation = function (s, target) {
  if (netIsOnline() && s && s.skill) netSend({ type: "skillUse", skill: s.skill });
  return _localRunSkillActivation.apply(this, arguments);
};

// PERCENT HEAL (online) — skill_server.js's heal1 has healAmount: 0.3, meaning "heal
// 30% of MAX health" (a value above 1 is still the old flat amount, which game.js
// handles by itself). game.js's runInstantSkillEffect() adds healAmount as a flat
// number, so online it is wrapped here: the normal effect/sound/speed boost still
// run (with a 0 heal), then the percent heal is applied to me, and the server is
// asked to heal the party members inside the skill's `range` (server.js "skillBuff").
function netIsPercentHeal(s) {
  return !!s && typeof s.healAmount === "number" && s.healAmount > 0 && s.healAmount <= 1 &&
    !s.attackIncrease && !s.defenseIncrease;
}
function netApplyPercentHeal(s) {
  const maxHealth = player.health || player.baseMaxHealth || 100;
  const gain = Math.round(maxHealth * s.healAmount);
  player.currentHealth = Math.min(maxHealth, (player.currentHealth || 0) + gain);
  if (typeof healthDisplay !== "undefined" && healthDisplay) {
    healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  }
}
const _localRunInstantSkillEffect = runInstantSkillEffect;
runInstantSkillEffect = function (s) {
  if (netIsPercentHeal(s)) {
    const result = _localRunInstantSkillEffect.call(this, Object.assign({}, s, { healAmount: 0 }));
    netApplyPercentHeal(s);
    if (netIsOnline()) netSend({ type: "skillBuff", skill: s.skill });
    return result;
  }
  return _localRunInstantSkillEffect.apply(this, arguments);
};

// Only the bot host actually steps the enemy AI/physics forward each frame
// (movement, aggro, shooting, status effects, respawn timers...). Everyone
// else's `bots` array is just a set of puppets kept in sync by whatever the
// host reports (see netApplyBotsSnapshot) — if they also ran this, their
// enemies would wander off and shoot on their own, independent of the host.
updateBots = function (botsArr, dt, ctx) {
  if (netIsOnline() && !netIsBotHost) return;
  const result = _localUpdateBots(botsArr, dt, ctx);
  // updateBots() only makes enemies solid against the HOST's own player.
  // Other players in the room were walk-through: push enemies out of them too.
  if (netIsOnline() && otherPlayers.size) {
    for (const b of botsArr) {
      if (!b.alive) continue;
      for (const p of otherPlayers.values()) {
        if (p.alive === false) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        const dist = Math.hypot(dx, dy);
        const minDist = b.radius + (p.radius || 14);
        if (dist > 0 && dist < minDist) {
          const push = minDist - dist;
          b.x += (dx / dist) * push;
          b.y += (dy / dist) * push;
        }
      }
    }
  }
  return result;
};

// Every place game.js deals damage to a bot (bullets, melee, skills, mortar
// splash...) calls this one function, so overriding it here is the one
// choke point needed to make hitting an enemy work the same in online mode
// as offline, no matter which attack landed it.
damageBot = function (bot, amount, isCritical, showDamageNumber, isSkillHit) {
  // Offline, or I'm the host: I run the real fight — unchanged.
  if (!netIsOnline() || netIsBotHost) {
    return _localDamageBot(bot, amount, isCritical, showDamageNumber, isSkillHit);
  }
  // Guest: the host's simulation is the source of truth for this enemy, so
  // tell it what I hit instead of resolving the kill myself. Predict the
  // result locally (health tick, damage number, death animation) so the hit
  // still feels instant — the host's next snapshot (~10x/sec) confirms or
  // corrects it, e.g. if two players land the kill blow at the same time.
  if (!bot || !bot.alive) return;
  const idx = bots.indexOf(bot);
  if (idx === -1) return _localDamageBot(bot, amount, isCritical, showDamageNumber, isSkillHit);

  netSend({
    type: "botHit", idx,
    amount: Math.max(0, Math.round(amount)), isCritical: !!isCritical,
    srcX: playerPos.x, srcY: playerPos.y,
    // SKILL LOCK — tells server.js this hit came from a skill (see
    // game.js's 3 damageBot() calls that pass isSkillHit: true) so it can
    // enforce skill.js's SKILL_LOCK_MS server-side (game_server.js's
    // isPlayerSkillLocked()/lockPlayerSkillUse()), instead of only trusting
    // this client's own local cooldown/lock.
    isSkillHit: !!isSkillHit
  });

  if (showDamageNumber !== false && amount >= 1 && typeof createDamageNumber === "function") {
    createDamageNumber(bot.x, bot.y - bot.radius, amount, { isCritical: !!isCritical });
  }
  bot.health = Math.max(0, bot.health - amount);
  if (bot.health <= 0) {
    bot.alive = false;
    bot.deathTime = performance.now();
    // DOUBLE EXP FIX — remember this death is only a PREDICTION until the host
    // confirms it (see netApplyBotsSnapshot()). A snapshot sent before the host
    // applied my hit still says "alive"; without this it revived the bot here and
    // my next shot "killed" it a second time for a second exp payout.
    bot._netPredDeadUntil = performance.now() + NET_PRED_DEATH_HOLD_MS;
    if (bot.unitExplode && typeof createHitEffect === "function") {
      createHitEffect(bot.x, bot.y, bot.unitExplode);
    }
  }
};

// ---------------------------------------------------------------------------
// PARTY EXP SHARING — every place game.js grants a kill's exp calls
// addCharacterExp(player, bot.expGet) (see character.js) exactly like
// offline mode; overriding the global name here is the same one-choke-point
// trick damageBot()/spawnItemsOnBotDeath() use above. Solo (no party, or
// alone in one), this just passes straight through unchanged. In a party, it
// splits the amount with whichever members computePartyExpShare() (see
// character.js) finds within PARTY_EXP_SHARE_RANGE of MY current position
// (I'm always the killer here — game.js only ever calls this for `player`,
// its own local character), keeps my own share, and sends everyone else's
// share to them over the network ("partyExpAward") to apply on their end.
// ---------------------------------------------------------------------------
const _localAddCharacterExp = addCharacterExp;

// Every party member I can currently place on the map, myself included —
// see computePartyExpShare()'s partyPositions param in character.js for why
// a member I can't place (different map, no "state" from them yet) is just
// left out rather than given a fake position.
function netPartyPositionsForSplit() {
  const list = [{ id: myId, x: playerPos.x, y: playerPos.y }];
  if (!netParty) return list;
  for (const m of netParty.members) {
    if (m.id === myId) continue;
    const p = otherPlayers.get(m.id);
    if (p && p.alive !== false) list.push({ id: m.id, x: p.x, y: p.y });
  }
  return list;
}

addCharacterExp = function (character, amount) {
  if (!netIsOnline() || character !== player || !netParty || netParty.members.length < 2 ||
      typeof amount !== "number" || amount <= 0 || typeof computePartyExpShare !== "function") {
    return _localAddCharacterExp(character, amount);
  }

  const shares = computePartyExpShare(myId, playerPos.x, playerPos.y, amount, netPartyPositionsForSplit());
  let myResult = { leveledUp: false, levelsGained: 0 };
  for (const s of shares) {
    if (s.id === myId) {
      if (s.share > 0) myResult = _localAddCharacterExp(character, s.share);
    } else if (s.share > 0) {
      netSend({ type: "partyExpAward", targetId: s.id, amount: s.share });
    }
  }
  return myResult;
};

// Applies a share of a kill a party member sent ME (see "partyExpAward"
// above). Mirrors the small level-up/persist/toast handling game.js's own
// exp-award blocks do, since this bypasses game.js entirely.
function netApplyPartyExpAward(amount) {
  amount = Math.max(0, Math.round(Number(amount) || 0));
  if (amount <= 0) return;
  const expResult = _localAddCharacterExp(player, amount);
  if (expResult.leveledUp && typeof applyLevelHealthGrowth === "function") {
    applyLevelHealthGrowth(expResult.levelsGained);
  }
  if (typeof persistCharacterProgress === "function") {
    persistCharacterProgress(
      player.name, player.level, player.exp, player.statPoints,
      player.spentVit || 0, player.spentDex || 0, player.spentInt || 0, player.spentPow || 0
    );
  }
  if (expResult.leveledUp && typeof showHubToast === "function") {
    showHubToast("Level Up! Now level " + player.level);
  }
}

// ---------------------------------------------------------------------------
// ITEM DROPS (shared) — loot from enemies is decided ONCE, by the bot host,
// and the server remembers it for the room. Before this, every player rolled
// their own drops locally, so anyone who joined / came back to a map later
// found the ground empty even though other players still saw the items.
//   * host: rolls the drops (same function offline uses), sends "dropAdd"
//   * server: stores them per room, gives each an id, tells EVERYONE
//   * anyone picking one up sends "dropTake" -> server removes it for all
//   * anyone joining / entering the map gets the remaining drops in
//     "init" / "mapChanged" (netApplyDrops below)
// ---------------------------------------------------------------------------
const _localSpawnItemsOnBotDeath = spawnItemsOnBotDeath;
const _localCheckItemPickup = checkItemPickup;

spawnItemsOnBotDeath = function (spawnItemList, x, y, bot) {
  if (!netIsOnline()) return _localSpawnItemsOnBotDeath(spawnItemList, x, y, bot);
  // Guests never roll loot. The host rolls it but doesn't keep it: the
  // server echoes it back (with an id) to everyone including the host.
  if (!netIsBotHost) return [];
  const rolled = _localSpawnItemsOnBotDeath(spawnItemList, x, y, bot);
  if (rolled.length) {
    // bt = the enemy TYPE that died. The server looks up that type's level
    // itself (bot_server.js) and rolls the item's stats from it — the stats
    // this client may have rolled locally are thrown away on purpose.
    const botType = bot && typeof bot.type === "string" ? bot.type : "";
    netSend({
      type: "dropAdd",
      drops: rolled.map((d) => ({ t: d.type, x: Math.round(d.x * 10) / 10, y: Math.round(d.y * 10) / 10, bt: botType }))
    });
  }
  return [];
};

// GOLD ORB DROPS (shared) — same "host rolls it, server is the source of
// truth" pattern as spawnItemsOnBotDeath() above. Kept as its own wrapper
// instead of folding into the one above because spawnGoldOrbOnBotDeath()
// is a separate call with its own chance/amount (bot.spawnGoldOrbChance /
// bot.goldOrbAmount — see bot.js), not a spawnItem-list entry, and its
// result needs its goldAmount carried over the wire so every client (host
// included) reconstructs the drop with the right amount — see
// netApplyDrops() below, which is what actually builds the local drop
// object for a "goldOrb" entry instead of createItemDrop().
const _localSpawnGoldOrbOnBotDeath = spawnGoldOrbOnBotDeath;
spawnGoldOrbOnBotDeath = function (chance, amount, x, y) {
  if (!netIsOnline()) return _localSpawnGoldOrbOnBotDeath(chance, amount, x, y);
  if (!netIsBotHost) return [];
  const rolled = _localSpawnGoldOrbOnBotDeath(chance, amount, x, y);
  if (rolled.length) {
    netSend({
      type: "dropAdd",
      drops: rolled.map((d) => ({
        t: d.type,
        x: Math.round(d.x * 10) / 10,
        y: Math.round(d.y * 10) / 10,
        amt: d.goldAmount
      }))
    });
  }
  return [];
};

// PARTY LOOT — solo (or no real party, netParty.members.length < 2) keeps
// the exact old behavior: touch it, it's mine, tell the server so it's gone
// for everyone else. In a real party, the SERVER decides who actually gets
// each drop (round-robin for gear, split for gold, everyone for buffs — see
// server.js's "dropTake" handler and server/game_server.js's
// PARTY_LOOT_RULES), so here we only detect the touch and report it — never
// apply the pickup to myself directly. The item still vanishes from MY
// screen the instant I walk over it (spliced out below); the server's
// "partyLootAward" reply (netApplyPartyLootAward) is what actually credits
// whoever it decided should get it, possibly someone else entirely.
checkItemPickup = function (dropsArr, pl, pos) {
  if (!netIsOnline()) return _localCheckItemPickup(dropsArr, pl, pos);

  if (!netParty || netParty.members.length < 2) {
    const shared = dropsArr.filter((d) => d.netId != null);
    _localCheckItemPickup(dropsArr, pl, pos);
    for (const d of shared) {
      if (!dropsArr.includes(d)) netSend({ type: "dropTake", id: d.netId });   // I picked it up
    }
    return;
  }

  for (let i = dropsArr.length - 1; i >= 0; i--) {
    const d = dropsArr[i];
    if (d.netId == null) continue;   // not a server-tracked drop — nothing to claim
    const dx = pos.x - d.x, dy = pos.y - d.y;
    if (Math.hypot(dx, dy) < pos.radius + d.radius) {
      netSend({ type: "dropTake", id: d.netId });
      dropsArr.splice(i, 1);
    }
  }
};

// Server's answer to a "dropTake" claim made while in a party — see the
// comment above checkItemPickup(). Every recipient's OWN client runs this
// on itself, using the exact same local pickup functions a solo pickup
// would have used, so gear/materials still land in the storage grid, gold
// still goes through addGold(), and buffs still go through
// applyItemEffect() (which also (re)starts that buff's timer on THIS
// client's own player, exactly like walking over it normally would).
// Temporary diagnostics in here (console.log + netToast on every branch,
// including the "function missing" cases) — safe to strip out once the
// weapon/armor share issue is confirmed fixed.
function netApplyPartyLootAward(msg) {
  if (!msg) return;
  console.log("[partyLootAward] received", msg);

  if (msg.mode === "gold") {
    if (typeof addGold === "function") addGold(msg.amount || 0);
    if (msg.amount) netToast("+" + msg.amount + " gold (party share)");
    return;
  }
  if (msg.mode === "effect") {
    if (typeof applyItemEffect === "function") {
      applyItemEffect(player, msg.itemType);
      netToast("Party buff: " + msg.itemType);
    } else {
      console.error("[partyLootAward] applyItemEffect is not a function");
      netToast("DEBUG: applyItemEffect missing");
    }
    return;
  }
  if (msg.mode === "item") {
    if (msg.category === "invItem") {
      if (typeof pickUpInventoryDrop === "function") {
        pickUpInventoryDrop({ invType: msg.invType, name: msg.name, data: msg.data, qty: msg.qty });
        netToast("Party loot: " + msg.name);
      } else {
        console.error("[partyLootAward] pickUpInventoryDrop is not a function");
        netToast("DEBUG: pickUpInventoryDrop missing");
      }
    } else if (msg.category === "weapon") {
      // msg.itemType, NOT msg.type — server.js sends the weapon's own type
      // name (e.g. "uzi") under "itemType" specifically so it can never
      // collide with and overwrite the outer "partyLootAward" message type
      // this whole switch dispatches on. See server.js's dropTake handler
      // for the full story; this is the other half of that fix.
      if (typeof pickUpWeaponDrop === "function") {
        pickUpWeaponDrop(msg.itemType, msg.stats);
        netToast("Party loot: " + msg.itemType);
      } else {
        console.error("[partyLootAward] pickUpWeaponDrop is not a function");
        netToast("DEBUG: pickUpWeaponDrop missing");
      }
    } else if (msg.category === "armor" || msg.category === "ring" || msg.category === "accessory") {
      if (typeof pickUpArmorDrop === "function") {
        pickUpArmorDrop(msg.itemType, msg.stats);
        netToast("Party loot: " + msg.itemType);
      } else {
        console.error("[partyLootAward] pickUpArmorDrop is not a function");
        netToast("DEBUG: pickUpArmorDrop missing");
      }
    } else if (msg.category === "stone" || msg.category === "orb") {
      if (typeof pickUpUpgradeDrop === "function") {
        pickUpUpgradeDrop(msg.itemType, msg.category);
        netToast("Party loot: " + msg.itemType);
      } else {
        console.error("[partyLootAward] pickUpUpgradeDrop is not a function");
        netToast("DEBUG: pickUpUpgradeDrop missing");
      }
    } else {
      console.error("[partyLootAward] unknown item category:", msg.category);
      netToast("DEBUG: unknown loot category " + msg.category);
    }
  }
}

// MANUAL DROPS — the player drags a weapon/armor/stone out of the
// Inventory/Equip popup and lets go on open ground (see index.html's
// dragend handler, which calls this and pushes whatever it returns into
// itemDrops). Same "server is the source of truth" pattern as the bot-loot
// drops above: ANY player may send this one (not just the bot host), so it
// isn't gated on netIsBotHost. Returning null here is safe — index.html
// removes the item from the inventory slot unconditionally, regardless of
// what this returns; the ground copy shows up for everyone (dropper
// included) once the server echoes it back with an id (netApplyDrops).
const _localCreateInventoryItemDrop = createInventoryItemDrop;
createInventoryItemDrop = function (entry, x, y) {
  if (!netIsOnline()) return _localCreateInventoryItemDrop(entry, x, y);
  if (!entry) return null;
  netSend({
    type: "invDropAdd",
    entry: {
      name: entry.name,
      invType: entry.type || entry.kind,
      data: entry.data,
      qty: entry.qty || 1
    },
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10
  });
  return null;
};

// Damage numbers for EVERYONE: whenever damage actually lands on MY health (a
// player's hit, an enemy bot's hit, a host-local enemy...), also tell the room
// so the attacker and any onlookers see the same floating number above me.
// Hits fully absorbed by the shield show nothing, same as locally.
const _localApplyDamageToPlayer = applyDamageToPlayer;
applyDamageToPlayer = function (pl, rawDamage) {
  const isMe = pl === player;
  const before = isMe ? pl.currentHealth : 0;
  const result = _localApplyDamageToPlayer.apply(this, arguments);
  if (isMe && netIsOnline()) {
    const dealt = Math.round(before - pl.currentHealth);
    if (dealt >= 1) {
      netSend({
        type: "dmgNum",
        x: Math.round(playerPos.x * 10) / 10,
        y: Math.round((playerPos.y - playerPos.radius) * 10) / 10,
        amount: dealt,
        isCritical: !!(rawDamage && typeof rawDamage === "object" && rawDamage.isCritical)
      });
    }
  }
  return result;
};

// Creates the ground items the server tells us about (skips ones already
// here). Handles both kinds the server can send: bot loot ({t,x,y}, looked
// up in ITEM_TYPES/WEAPONS via createItemDrop) and manual inventory drops
// ({k:"inv", invType, name, data, qty, x, y}, rebuilt via
// createInventoryItemDrop so they carry the exact stats they were dropped
// with).
function netApplyDrops(list) {
  if (!Array.isArray(list)) return;
  for (const s of list) {
    if (!s || itemDrops.some((d) => d.netId === s.id)) continue;
    try {
      const d = s.k === "inv"
        ? _localCreateInventoryItemDrop({ name: s.name, type: s.invType, data: s.data, qty: s.qty }, s.x, s.y)
        // Gold orbs aren't in ITEM_TYPES (see item.js) so createItemDrop()
        // can't build one — reconstruct it directly instead, same shape
        // spawnGoldOrbOnBotDeath() returns, using the amount the host sent
        // over the wire (s.amt) rather than a shared/looked-up amount.
        : s.t === "goldOrb"
          ? {
              id: nextItemDropId++,
              type: "goldOrb",
              category: "gold",
              goldAmount: s.amt || 0,
              x: s.x,
              y: s.y,
              radius: GOLD_ORB_RADIUS,
              image: getItemImage(GOLD_ORB_IMAGE),
              spawnTime: performance.now()
            }
          : createItemDrop(s.t, s.x, s.y, s.stats);   // s.stats = the stats the SERVER rolled for this drop
      if (!d) continue;
      d.netId = s.id;
      // BACK-DATE the local despawn clock to the drop's real age, using the
      // server's creation time (s.at, wall-clock ms — see server.js's "at" on
      // dropAdd/invDropAdd/dropList). Without this, createItemDrop() /
      // _localCreateInventoryItemDrop() stamp spawnTime as "right now", so
      // the 30-sec despawn timer (item.js's updateItemDrops) restarted for
      // every client the moment IT happened to receive the item — meaning a
      // player who joined/rejoined a minute later saw a fresh 30 seconds on
      // an item everyone else had already watched vanish. This makes every
      // client agree on when the item actually despawns.
      // Prefer the server-measured age (immune to a wrong phone clock); fall back to "at".
      if (typeof s.age === "number") {
        d.spawnTime = performance.now() - Math.max(0, s.age);
      } else if (typeof s.at === "number") {
        d.spawnTime = performance.now() - Math.max(0, Date.now() - s.at);
      }
      // Already expired by the time it arrived (e.g. a slow join) — skip it
      // outright instead of letting it flash on screen for one frame before
      // item.js's own despawn check catches up to it.
      if (d.timeLife && (performance.now() - d.spawnTime >= d.timeLife)) continue;
      itemDrops.push(d);
    } catch (e) { /* unknown item type on this client — skip it */ }
  }
}

function netRemoveDrop(id) {
  for (let i = itemDrops.length - 1; i >= 0; i--) {
    if (itemDrops[i].netId === id) itemDrops.splice(i, 1);
  }
}

// Becomes host (spawns this map's enemies fresh and starts broadcasting
// them) or becomes a guest (clears any locally-spawned enemies and waits
// for the host's snapshot instead) — called on join, on switching maps, and
// whenever the server hands hosting duty to/away from this client.
function netSetBotHost(isHost, restoreList) {
  netIsBotHost = isHost;
  if (!isHost) {
    bots.length = 0;   // don't show my own stale/locally-spawned enemies
    return;
  }
  try {
    const levelData = getLevel(netOnlineLevel);
    bots.length = 0;
    for (const b of spawnBotsForLevel(levelData, { x: playerPos.x, y: playerPos.y }, obstacles)) bots.push(b);
    // The room's enemies already exist (the server kept them patrolling while
    // the room was empty, or the previous host handed them over): put each one
    // back where it is / with its damage / dead + respawn timer, instead of
    // starting the map over with fresh enemies.
    if (Array.isArray(restoreList) && restoreList.length) netRestoreHostedBots(restoreList);
  } catch (e) {
    console.error("Online: failed to host enemies:", e);
  }
  netBotsTimer = 0;
  netSendBotsSnapshot();   // don't leave the room staring at nothing until the next tick
}

// HOST side: apply a saved snapshot (same shape the host streams, plus `rm` =
// ms until respawn for dead enemies) onto the freshly spawned local enemies.
// Enemies are matched by array index + type (spawn order is fixed per map).
function netRestoreHostedBots(list) {
  for (const s of list) {
    const b = bots[s.i];
    if (!b || b.type !== s.t) continue;
    if (typeof s.sx === "number" && typeof s.sy === "number") { b.spawnX = s.sx; b.spawnY = s.sy; }
    b.x = s.x; b.y = s.y;
    b.facingAngle = s.fa || 0;
    b.maxHealth = s.mh || b.maxHealth;
    if (s.a) {
      b.health = Math.max(1, Math.min(b.maxHealth, s.h));
      b.alive = true;
      b.patrolTarget = { x: b.x, y: b.y };
    } else {
      b.health = 0;
      b.alive = false;
      b.dropsSpawned = true;   // its loot was already dropped when it died
      b.expAwarded = true;
      b.deathTime = performance.now() - Math.max(0, b.respawnTime - (s.rm || 0));
    }
  }
}

// Compact per-enemy snapshot the host streams out ~10x/sec. Bots never get
// inserted/removed mid-level (see bot.js) — only spawned in bulk at level
// start/switch — so their array index is a stable id for their whole life.
function netSendBotsSnapshot() {
  if (!netIsOnline() || !netIsBotHost) return;
  netSend({
    type: "bots",
    list: bots.map((b, i) => ({
      i, t: b.type,
      x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
      h: Math.max(0, Math.round(b.health)), mh: Math.round(b.maxHealth),
      a: !!b.alive,
      fa: Math.round((b.facingAngle || 0) * 100) / 100,
      mv: !!b.isMoving,
      sx: Math.round((b.spawnX !== undefined ? b.spawnX : b.x) * 10) / 10,
      sy: Math.round((b.spawnY !== undefined ? b.spawnY : b.y) * 10) / 10,
      // ms until a DEAD enemy respawns — the server remembers it with the rest
      // of the snapshot (ENEMY MEMORY) and netRestoreHostedBots() uses it.
      rm: b.alive ? 0 : Math.max(0, Math.round((b.respawnTime || 0) - (performance.now() - (b.deathTime || 0))))
    }))
  });
}

// Guest side: build/update local puppet bots from the host's snapshot.
// createBot() gives each puppet the right sprite/stats for its type (bot
// type data is a public table every client already has — see bot.js) —
// only position/health/alive/facing actually come over the network.
function netApplyBotsSnapshot(list) {
  if (!Array.isArray(list)) return;
  const nowMs = performance.now();
  for (const s of list) {
    let b = bots[s.i];
    if (!b || b.type !== s.t) {
      try { b = createBot(s.t, s.x, s.y); } catch (e) { continue; }
      if (!s.a) { b.alive = false; b.health = 0; b.dropsSpawned = true; b.expAwarded = true; }
      b._netHostAlive = !!s.a;
      bots[s.i] = b;
    }
    // What the HOST last said about this enemy (not my local prediction) —
    // a real respawn is "host said dead, now says alive".
    const hostWasAlive = (b._netHostAlive === undefined) ? b.alive : b._netHostAlive;
    b._netHostAlive = !!s.a;
    b._netTX = s.x; b._netTY = s.y;

    if (!hostWasAlive && s.a) {
      // Just respawned on the host's side: snap instead of gliding in from
      // the old death spot, and let this new life drop loot/exp again.
      b.x = s.x; b.y = s.y;
      b.dropsSpawned = false;
      b.expAwarded = false;
      b._netPredDeadUntil = 0;
    }

    // DOUBLE EXP FIX — I predicted this enemy's death (my hit went to the host
    // but the host hasn't applied it yet). A snapshot that still says "alive"
    // is just stale: keep it dead here so my next shots can't kill it again
    // and pay exp twice. Once the host says dead the hold ends; if it never
    // confirms within the hold time, the kill didn't count — put it back.
    if (b._netPredDeadUntil) {
      if (!s.a) {
        b._netPredDeadUntil = 0;
      } else if (nowMs < b._netPredDeadUntil) {
        b.health = 0;
        b.alive = false;
        b.facingAngle = s.fa;
        b.isMoving = s.mv;
        b.maxHealth = s.mh;
        continue;
      } else {
        // The host never confirmed my kill (its copy survived with a sliver of
        // health). Bring the enemy back, but KEEP expAwarded: I was already paid
        // for this life, so killing it again must not pay a second time. A real
        // host respawn (above) is the only thing that resets it.
        b._netPredDeadUntil = 0;
      }
    }

    b.health = s.h;
    b.maxHealth = s.mh;
    b.alive = s.a;
    b.facingAngle = s.fa;
    b.isMoving = s.mv;
  }
  bots.length = list.length;
}

// ONLINE + bot host only: everyone else in the room, in the shape bot.js's
// updateSingleBot() wants for target selection (see game.js's updateBots()
// call). Empty when offline, or when I'm not hosting this room's enemies —
// that path just runs the offline AI unchanged, targeting only playerPos.
function netGetOtherPlayersForBots() {
  if (!netIsOnline() || !netIsBotHost) return [];
  const list = [];
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    list.push({ id: p.id, x: p.x, y: p.y, radius: p.radius, level: p.level });
  }
  return list;
}

// A bot I'm hosting just melee'd a REMOTE player (bot.js's
// tryBotMeleeAttack, via ctx.onBotMeleeHit) — bot.js has no way to touch
// another player's health directly (it isn't even loaded on their
// machine), so tell the server to apply it. Same idea as netMortarLanded()
// but this is PvE damage: it must land regardless of the room's PvP
// channel, so it's handled by netApplyBotHit() (below), not netApplyHit().
function netBotMeleeHit(targetId, attackResult, x, y) {
  if (!netIsOnline() || !netIsBotHost) return;
  netSend({
    type: "botHitPlayer", targetId,
    physicalDamage: Math.max(0, Math.round(attackResult.physicalDamage || 0)),
    magicalDamage: Math.max(0, Math.round(attackResult.magicalDamage || 0)),
    isCritical: !!attackResult.isCritical,
    srcX: x, srcY: y, knockback: 0
  });
}

// A bot bullet I'm hosting landed and was aimed at a remote player
// (b.targetPlayerId, set in bot.js's tryBotShoot) — this bullet only ever
// existed on my own screen, so tell the server to actually damage them.
function netBotMortarLanded(b) {
  const p = otherPlayers.get(b.targetPlayerId);
  if (!p || !p.alive) return;
  const dist = Math.hypot(p.x - b.x, p.y - b.y);
  if (dist > b.explosionRadius + p.radius) return;
  const falloff = getAoeFalloff(Math.min(dist, b.explosionRadius), b.explosionRadius);
  netSend({
    type: "botHitPlayer", targetId: p.id,
    physicalDamage: Math.max(1, Math.round((b.damage || 0) * falloff)),
    magicalDamage: Math.round((b.magicalDamage || 0) * falloff),
    isCritical: false,
    srcX: b.x, srcY: b.y,
    knockback: (b.knockback || 0) * falloff
  });
}

// Taking damage FROM AN ENEMY BOT (not another player) — same rules as
// netApplyHit() below except this always applies no matter the room's PvP
// channel: CHANNEL_SAFE only turns off player-vs-player damage, enemies
// still fight normally there. Death has no player killer (killerId null).
function netApplyBotHit(msg) {
  if (isDead || performance.now() < netSpawnProtectUntil) return;

  const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);
  if (!blocked) {
    applyDamageToPlayer(player, {
      physicalDamage: msg.physicalDamage || 0,
      magicalDamage: msg.magicalDamage || 0,
      isCritical: !!msg.isCritical
    });

    if (msg.knockback > 0 && player.currentHealth > 0) {
      const dx = playerPos.x - msg.srcX;
      const dy = playerPos.y - msg.srcY;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) {
        playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x + (dx / d) * msg.knockback));
        playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y + (dy / d) * msg.knockback));
      }
    }
  }

  healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  if (player.currentHealth <= 0) netOnDeath(null);
}

// ---------------------------------------------------------------------------
// ONLINE GAME DATA (comes from the server, not from the public files)
// ---------------------------------------------------------------------------
// The numbers used in online mode live in the *_server.js files on the
// server. When you join, the server sends them and we swap them into the
// game's tables (WEAPONS, ARMOR_TYPES, CHARACTERS ...). When you leave, the
// original offline tables are put back, so offline mode is never affected.
function netTableRefs() {
  const refs = {};
  const add = (name, getter) => {
    try { const v = getter(); if (v && typeof v === "object") refs[name] = v; } catch (e) { /* table not present */ }
  };
  add("WEAPONS", () => WEAPONS);
  add("ARMOR_TYPES", () => ARMOR_TYPES);
  add("ATTACK_MODES", () => ATTACK_MODES);
  add("CHARACTERS", () => CHARACTERS);
  add("EQUIPMENT_STAT_MAP", () => EQUIPMENT_STAT_MAP);
  add("SKILLS", () => SKILLS);
  add("SKILL_SCALABLE_STATS", () => SKILL_SCALABLE_STATS);
  add("STONE_TYPES", () => STONE_TYPES);
  add("ORB_TYPES", () => ORB_TYPES);
  add("SHOP_WEAPONS", () => SHOP_WEAPONS);
  add("SHOP_ARMORS", () => SHOP_ARMORS);
  add("SHOP_STONES", () => SHOP_STONES);
  add("SHOP_ACCESSORIES", () => SHOP_ACCESSORIES);
  add("ITEM_TYPES", () => ITEM_TYPES);
  add("LEVELS", () => LEVELS);
  add("OBSTACLE_TYPES", () => OBSTACLE_TYPES);
  add("BOT_TYPES", () => BOT_TYPES);
  return refs;
}

function netReplaceContents(target, source) {
  if (Array.isArray(target)) {
    target.length = 0;
    for (const v of source) target.push(v);
  } else {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, source);
  }
}

// Copy of the offline tables, taken once when this file loads (before any
// online match can touch them).
const netOfflineSnapshot = (function () {
  const snap = {};
  const refs = netTableRefs();
  for (const name in refs) snap[name] = structuredClone(refs[name]);
  return snap;
})();
let netUsingServerData = false;

function netApplyServerData(data) {
  if (!data || typeof data !== "object") throw new Error("Server sent no game data");
  // Online rules (respawn time, update rates ...) come from the server, never from this file.
  const rules = data.ONLINE_RULES;
  if (!rules || typeof rules !== "object") throw new Error("Server sent no online rules");
  NET_STATE_INTERVAL = Number(rules.STATE_INTERVAL_MS);
  NET_RESPAWN_SECONDS = Number(rules.RESPAWN_SECONDS);
  NET_SPAWN_PROTECT_MS = Number(rules.SPAWN_PROTECT_MS);
  NET_BOTS_INTERVAL = Number(rules.BOTS_INTERVAL_MS);
  NET_TOUCH_RANGE = Number(rules.TOUCH_RANGE);
  PARTY_MAX_SIZE = Number(rules.PARTY_MAX_SIZE);
  const refs = netTableRefs();
  let applied = 0;
  for (const name in refs) {
    if (data[name] == null || typeof data[name] !== typeof refs[name]) continue;
    netReplaceContents(refs[name], structuredClone(data[name]));
    applied++;
  }
  if (!applied) throw new Error("Server game data was empty");
  netUsingServerData = true;
  // Real-money shop prices + payment details (shop_server.js) — only used by the SHOP button.
  olShopData = (data.REAL_SHOP && typeof data.REAL_SHOP === "object")
    ? { REAL_SHOP: data.REAL_SHOP, PAYMENT_INFO: data.PAYMENT_INFO || {}, POINTS_SHOP: (data.POINTS_SHOP && typeof data.POINTS_SHOP === "object") ? data.POINTS_SHOP : {} } : null;
  netInstallServerCode(data.CODE);   // the server files' FUNCTIONS too (numbers + formulas)
  netRefreshRemoteCharacters();      // players already in the room were built from the OFFLINE tables — redo them
}

// Remote players that were already in the room when I joined are created
// (netAddRemote, in netConnect) BEFORE the server's tables are swapped in, so
// they got the OFFLINE character picture/size cached forever (old soldier /
// swat / police pictures instead of the server's characters). Throw the cache
// away and refresh every remote player from the tables that are live now.
function netRefreshRemoteCharacters() {
  for (const k of Object.keys(netCharCache)) delete netCharCache[k];
  try {
    for (const p of otherPlayers.values()) {
      p.radius = netCharInfo(p.character).radius;
    }
  } catch (e) { /* otherPlayers not ready yet */ }
}

// ---- SERVER CODE SWAP -------------------------------------------------------
// The server also sends the source of its *_server.js files (data.CODE). Here
// their top-level FUNCTIONS replace the game's own (character.js's
// applyAttributeBonus/addCharacterExp/..., item.js, skill.js, ...) for as long
// as the player is online, so every number and formula in a *_server.js file is
// the real online rule. netRestoreServerCode() puts the offline ones back.
//  * The server file's own copy of a data table (const CHARACTERS = {...}) is
//    replaced by the game's live table, so both always see the same data.
//  * Anything that goes wrong just leaves the game's own function in place.
let netServerCodeOriginals = null;   // function name -> the game's own function

// Functions THIS file (online.js) already wraps with multiplayer-specific
// behavior (see "checkItemPickup = function (...)" / "spawnItemsOnBotDeath
// = function (...)" above — PARTY LOOT / "only the bot host rolls loot").
// The *_server.js files are near-verbatim OFFLINE copies of these same
// functions (item_server.js's own checkItemPickup/pickUpWeaponDrop/etc. know
// nothing about parties, netSend, or netIsBotHost) — so the blanket swap
// below must never be allowed to install them over these names, or online
// mode silently reverts to solo/offline pickup behavior the instant you
// connect: every touched drop goes straight into YOUR inventory instead of
// alternating through the party, exactly like it was never wrapped at all.
//
// This list needs EVERY name online.js overrides with "= function", not
// just the two originally caught — missing one is exactly what broke gold
// orb sharing again after checkItemPickup/spawnItemsOnBotDeath were added
// here but spawnGoldOrbOnBotDeath (the host-only gold-orb roll, right above
// spawnItemsOnBotDeath) was not, so once the server started sending
// data.CODE it got silently replaced by item_server.js's plain version —
// every player rolling/spawning their own gold orbs instead of only the
// host, same class of bug as the original one:
//   updateBots, damageBot            — currently harmless (bot_server.js
//                                       doesn't declare these), kept here
//                                       so adding them there later can't
//                                       reintroduce this bug silently.
//   addCharacterExp                  — party exp splitting (character_server.js)
//   spawnItemsOnBotDeath             — host-only item-loot roll (item_server.js)
//   spawnGoldOrbOnBotDeath           — host-only gold-orb roll (item_server.js)
//   checkItemPickup                  — party-loot touch/claim reporting (item_server.js)
//   createInventoryItemDrop          — manual-drop networking (item_server.js)
//   applyDamageToPlayer              — PvP damage relay (item_server.js)
// If you add another "NAME = function (...) { ... }" override anywhere in
// this file for a name that ALSO exists in a *_server.js file, add it here
// too — otherwise it will silently work fine until the day it doesn't.
const NET_PROTECTED_FUNCTIONS = new Set([
  "updateBots", "damageBot", "addCharacterExp",
  "spawnItemsOnBotDeath", "spawnGoldOrbOnBotDeath",
  "checkItemPickup", "createInventoryItemDrop", "applyDamageToPlayer"
]);

// Functions that exist ONLY in a *_server.js file (the public offline file has no
// copy), so the swap below would normally skip them. They are installed on
// window while online and deleted again by netRestoreServerCode():
//   getUpgradeGoldCost, applyUpgradeLevelToData — upgrade_server.js (gold orb cost
//   per upgrade, and the "+5% of every base stat per success" stat math).
const NET_SERVER_ONLY_FUNCTIONS = new Set([
  "getUpgradeGoldCost", "applyUpgradeLevelToData"
]);

function netInstallServerCode(code) {
  if (!code || typeof code !== "object") return;
  const tables = netTableRefs();
  if (!netServerCodeOriginals) netServerCodeOriginals = {};
  let swapped = 0;
  for (const file of Object.keys(code)) {
    try {
      const src = String(code[file]);
      const names = [];
      src.replace(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm, (m, n) => { names.push(n); return m; });
      const body = src.replace(/^const ([A-Za-z_$][\w$]*) = ([\[{])/gm, (m, name, open) =>
        tables[name] ? "const " + name + " = __tables." + name + "; const __server_" + name + " = " + open : m);
      const fns = new Function("__tables", "module", "exports", body + "\nreturn { " + names.join(", ") + " };")(tables, {}, {});
      for (const n of names) {
        if (NET_PROTECTED_FUNCTIONS.has(n)) continue;
        if (typeof fns[n] !== "function") continue;
        if (typeof window[n] !== "function" && !NET_SERVER_ONLY_FUNCTIONS.has(n)) continue;
        if (!(n in netServerCodeOriginals)) netServerCodeOriginals[n] = window[n];
        window[n] = fns[n];
        swapped++;
      }
    } catch (e) {
      console.error("Online mode: could not load server code for " + file + " (using the game's own):", e);
    }
  }
  console.log("Online mode: running " + swapped + " functions from the server files.");
}

function netRestoreServerCode() {
  if (!netServerCodeOriginals) return;
  for (const n in netServerCodeOriginals) {
    if (netServerCodeOriginals[n] === undefined) { try { delete window[n]; } catch (e) { window[n] = undefined; } }   // server-only function: remove it again
    else window[n] = netServerCodeOriginals[n];
  }
  netServerCodeOriginals = null;
}
// ---- END SERVER CODE SWAP ---------------------------------------------------

function netRestoreOfflineData() {
  netRestoreServerCode();
  for (const k of Object.keys(netCharCache)) delete netCharCache[k];   // pictures follow the tables back to offline
  if (!netUsingServerData) return;
  const refs = netTableRefs();
  for (const name in refs) {
    if (netOfflineSnapshot[name]) netReplaceContents(refs[name], structuredClone(netOfflineSnapshot[name]));
  }
  netUsingServerData = false;
}

// Weapons/armor the player owns are stored as COPIES of their stats (made
// when the character was picked or the item was looted/saved), so swapping
// the tables alone doesn't change them. This rebuilds every weapon/armor item
// (equipped slots + storage grid) from whatever the tables hold right now,
// then re-applies the item's upgrade levels on top, the same way the
// upgrade system did. Called after the server data is applied AND after the
// offline tables are put back, so each mode sees its own numbers.
function netRefreshGearFromTables() {
  let slots = null, grid = null;
  try { slots = invSlotData; } catch (e) {}
  try { grid = invGridData; } catch (e) {}

  // ONLINE: upgrade_server.js's applyUpgradeLevelToData() (+5% of every base stat
  // per upgrade level) is installed only while online. OFFLINE: the public
  // upgrade.js tier functions are still used, exactly as before.
  const onlineUpgrade = typeof applyUpgradeLevelToData === "function";
  const canUpgrade =
    typeof getUpgradeDamagePercent === "function" &&
    typeof getUpgradeArmorBonus === "function" &&
    typeof getUpgradeArmorHealthBonus === "function";

  let rebuilt = 0;
  const rebuild = (entry) => {
    if (!entry || !entry.data) return;
    if (entry.data.cdmCustom) return;   // made/edited in CDM: keep ITS numbers, don't reset them to the table's
    const kind = entry.kind || entry.type;
    let def = null;
    if (kind === "weapon" && typeof getWeapon === "function") def = getWeapon(entry.name);
    else if ((kind === "armor" || kind === "ring" || kind === "accessory") && typeof getArmor === "function") def = getArmor(entry.name);
    if (!def) return;

    const lvl = entry.data.upgradeLevel || 0;
    if (lvl > 0 && !canUpgrade && !onlineUpgrade) return;          // can't redo upgrades -> leave item alone

    // table numbers win; item-only fields (upgradeLevel, attachedOrb, image) are kept
    const data = Object.assign({}, entry.data, def);
    if (entry.data.image) data.image = entry.data.image;
    delete data.upgradeBase;     // the +0 numbers come from the table again

    if (kind === "armor") {
      data.defense = def.physicalDefense || 0;
      data.health = def.health || 0;
    }

    if (onlineUpgrade) {
      // data now holds the +0 numbers: put the upgrade levels back on top.
      entry.data = (lvl > 0 && (kind === "weapon" || kind === "armor"))
        ? applyUpgradeLevelToData(data, lvl)
        : data;
      rebuilt++;
      return;
    }

    for (let l = 1; l <= lvl; l++) {
      if (kind === "weapon" && typeof data.physicalDamage === "number") {
        data.physicalDamage = Math.round(data.physicalDamage * (1 + getUpgradeDamagePercent(l)) * 100) / 100;
      } else if (kind === "armor") {
        data.defense += getUpgradeArmorBonus(l);
        data.health += getUpgradeArmorHealthBonus(l);
      }
    }
    if (lvl > 0) data.upgradeLevel = lvl;
    entry.data = data;
    rebuilt++;
  };

  if (slots) for (const k in slots) rebuild(slots[k]);
  if (Array.isArray(grid)) grid.forEach(rebuild);
  console.log("Online: refreshed " + rebuilt + " weapon/armor item(s) from the current data tables.");
}

// Player-vs-player damage only exists in CHANNEL 0 (the server also drops
// hits in channel 1, this just stops them being sent / applied at all).
function netPvpOn() {
  return netChannelPvp || (typeof netMapByLevel !== "undefined" && netMapByLevel[netOnlineLevel] === "CWmap");   // the clan war map is PvP on every channel
}

// NAME COLOR — is this other player someone I could damage? Not when the
// channel has no player damage (channel 1), and not when they're in my party
// or my clan (the server drops those hits too — see isPartyFriendlyFire /
// isClanFriendlyFire in server.js). Party members come from netParty; clan
// members from my clan roster (its member ids are the live player ids).
function netIsFriendlyPlayer(p) {
  if (!p) return false;
  if (netParty && Array.isArray(netParty.members) && netParty.members.some((m) => m.id === p.id)) return true;
  try {
    const clan = (typeof getPlayerClan === "function") ? getPlayerClan() : null;
    if (clan && Array.isArray(clan.members) && clan.members.some((m) => m.id === p.id)) return true;
  } catch (e) { /* clan data not ready — treat as not clanmates */ }
  return false;
}

// Red = attackable, white = safe.
function netPlayerNameColor(p) {
  return (netPvpOn() && !netIsFriendlyPlayer(p)) ? "#ff3b3b" : "#ffffff";
}

// ---------------------------------------------------------------------------
// THE ONLINE MAP (worldmap_server.js, sent by the server)
// ---------------------------------------------------------------------------
// Safe places to spawn: open spots away from obstacles, spread out over the
// whole map (farthest-point picking), so a crowd doesn't spawn in one pile.
function netBuildSpawnPoints(level, want) {
  want = want || 24;
  const w = level.worldWidth, h = level.worldHeight, pad = 30, step = 25;
  const obs = level.obstacles || [];
  const free = [];
  for (let y = pad; y <= h - pad; y += step) {
    for (let x = pad; x <= w - pad; x += step) {
      const blocked = obs.some((o) =>
        x > o.x - pad && x < o.x + o.width + pad && y > o.y - pad && y < o.y + o.height + pad);
      if (!blocked) free.push({ x, y });
    }
  }
  if (!free.length) return [{ x: w / 2, y: h / 2 }];

  const picked = [free[Math.floor(free.length / 2)]];
  const minD = free.map((p) => (p.x - picked[0].x) ** 2 + (p.y - picked[0].y) ** 2);
  while (picked.length < want && picked.length < free.length) {
    let best = 0;
    for (let i = 1; i < free.length; i++) if (minD[i] > minD[best]) best = i;
    const p = free[best];
    picked.push(p);
    for (let i = 0; i < free.length; i++) {
      const d = (free[i].x - p.x) ** 2 + (free[i].y - p.y) ** 2;
      if (d < minD[i]) minD[i] = d;
    }
  }
  return picked;
}

// The server sends every map it has (all the *_server.js map files). Each
// one becomes a normal level (using custommaps.js). Portals (entrance: "name")
// can only lead to another map on this list. The offline level list is put
// back on exit.
let netLevelByMap = {};   // map key -> level number
let netMapByLevel = {};   // level number -> map key

function netRegisterWorldMaps(maps, startKey, mapMusic) {
  if (!maps || typeof maps !== "object" || !Object.keys(maps).length) throw new Error("The server sent no map. The server on Render is an old version - redeploy the latest server files (server.js + the server folder with worldmap_server.js).");
  if (typeof registerCustomMap !== "function") throw new Error("custommaps.js is not loaded");
  netLevelByMap = {};
  netMapByLevel = {};
  // Online uses ONLY the server's maps. Throw away every level the game had loaded for OFFLINE
  // (level.js + offline_worldmap.js also have maps named LEVEL1, LEVEL2 ... and the portals would
  // find those first). netRestoreOfflineData() puts the offline list back on exit.
  for (const k of Object.keys(LEVELS)) delete LEVELS[k];
  for (const key of Object.keys(maps)) {
    const before = Object.keys(LEVELS).length;
    registerCustomMap(maps[key]);
    if (Object.keys(LEVELS).length === before) { console.warn("Online: skipped invalid map " + key); continue; }
    const num = Math.max(...Object.keys(LEVELS).map(Number).filter((n) => isFinite(n)));
    LEVELS[num].onlineSpawnPoints = netBuildSpawnPoints(LEVELS[num]);
    // background music of this map — the list lives on the server (game_server.js, MAP_MUSIC)
    if (mapMusic && typeof mapMusic[key] === "string") LEVELS[num].music = mapMusic[key];
    netLevelByMap[key] = num;
    netMapByLevel[num] = key;
  }
  const start = netLevelByMap[startKey] != null ? netLevelByMap[startKey] : Object.values(netLevelByMap)[0];
  if (start == null) throw new Error("The server's map is not valid");
  return start;
}

// Portals: may this level be entered online? (only maps the server has)
function netCanEnterLevel(levelNumber) {
  return netMapByLevel[levelNumber] !== undefined;
}

// I just walked through a portal to another map: tell the server so I leave
// this map's players behind and meet the ones on the new map.
function netAfterLevelSwitch(levelNumber) {
  const key = netMapByLevel[levelNumber];
  if (key === undefined) return;
  netToast("Entered " + key);   // tell the player which map they just walked into
  netOnlineLevel = levelNumber;   // so netSetBotHost() spawns the right map's enemies if I end up hosting
  // switchToLevel() (game.js) already spawned this client's own local
  // enemies for the new map, same as offline — wipe them until the
  // server's "mapChanged" tells us whether we're hosting this room's
  // enemies or should wait for the host's snapshot instead.
  bots.length = 0;
  otherPlayers.clear();
  netSend({ type: "map", map: key });
  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
  netStateTimer = 0;
  netSendState();
}

// ---------------------------------------------------------------------------
// Low-level send
// ---------------------------------------------------------------------------
function netIsOnline() {
  return gameMode === "online" && netSocket && netSocket.readyState === WebSocket.OPEN;
}

function netSend(obj) {
  if (netSocket && netSocket.readyState === WebSocket.OPEN) {
    netSocket.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------------------
// HIDDEN CDM BUTTON (online) — the offline hub's CDM item spawner
// (#cdmScreen in index.html), reachable in an online match from the OPTIONS
// popup, but only after a secret code is typed into WORLD chat:
//     @#$_&cmd <secret>   (or @#$_&cdm <secret>) -> shows a CDM button inside the OPTIONS popup
//     @#$_&      -> hides it again
// The codes are hard-coded right here (change them below). They are handled
// entirely on this device and are NOT sent to the server / other players.
// The button is created from this file, so index.html has nothing to show
// offline. NOTE: this is only a client-side gate (anyone who reads this file
// can see the codes), and the server's save_guard.js still limits how many
// items an account may gain.
// ---------------------------------------------------------------------------
// SECURITY: the real secret is NOT in this file. The admin types   @#$_&cmd <secret>   in
// WORLD chat (the secret = the server's CMD_GIVE_CODE env var). It is kept only in memory
// (olCmdSecret), sent with CDM requests, and the server also requires the account name to
// be listed in CMD_GIVE_ADMINS. A wrong secret / non-admin account just gets "Not allowed".
const OL_CMD_SHOW_PREFIX = "@#$_&cmd ";
const OL_CMD_SHOW_PREFIX_ALT = "@#$_&cdm ";   // same thing, for when the button's name (CDM) gets typed
const OL_CMD_HIDE_CODE = "@#$_&";
let olCmdSecret = "";
// MAP CREATOR button (CREATE MAP in the online HUD) works the same way: hidden
// when the match starts; typed into WORLD chat:
//     @#$_&-mapcreator  -> shows it      @#$_&-  -> hides it again
const OL_MAPCREATOR_SHOW_CODE = "@#$_&-mapcreator";
const OL_MAPCREATOR_HIDE_CODE = "@#$_&-";
window.__olMapCreatorUnlocked = false;
function olMapCreatorRefreshButton() {
  const btn = document.getElementById("createMapBtn");
  if (btn) btn.style.display = (window.__olMapCreatorUnlocked && netIsOnline()) ? "block" : "none";
}
let olCmdUnlocked = false;      // stays on until the hide code, leaving the match, or a reload
let olCmdOpenInGame = false;    // true while #cdmScreen was opened from OPTIONS (not from the offline hub)

function olCmdGetButton() {
  let btn = document.getElementById("gameOptionsCdmBtn");
  if (btn) return btn;
  const body = document.querySelector("#gameOptionsPopup .gameOptionsBody");
  if (!body) return null;
  btn = document.createElement("button");
  btn.id = "gameOptionsCdmBtn";
  btn.className = "gameOptionsBtn";
  btn.textContent = "CDM";
  btn.style.display = "none";
  // Sits just above LOG OUT, which stays the last button.
  body.insertBefore(btn, document.getElementById("gameOptionsLogoutBtn") || null);
  btn.addEventListener("click", olCmdOpen);
  return btn;
}

function olCmdRefreshButton() {
  const btn = olCmdGetButton();
  if (btn) btn.style.display = olCmdUnlocked ? "" : "none";
}

function olCmdOpen() {
  if (!olCmdUnlocked) return;
  const screen = document.getElementById("cdmScreen");
  if (!screen) return;
  if (typeof closeGameOptionsPopup === "function") closeGameOptionsPopup();
  olCmdOpenInGame = true;
  if (!olCmdCatalog) olCmdRequestCatalog();   // boxes refresh again when it arrives
  olCmdRefreshBoxes();
  olCmdShowSendButton(true);
  screen.style.display = "flex";
  // Same HUD hiding every in-game popup does, so the skill buttons don't sit on top of it.
  document.body.classList.add("gameInvPopupOpen");
  if (typeof setGameInvHudButtonsHidden === "function") setGameInvHudButtonsHidden(true);
}

function olCmdClose() {
  olCmdOpenInGame = false;
  olCmdShowSendButton(false);
  olCmdCloseSendPopup();
  const screen = document.getElementById("cdmScreen");
  if (screen) screen.style.display = "none";
  if (typeof closeCdmItemPopup === "function") closeCdmItemPopup();
  document.body.classList.remove("gameInvPopupOpen");
  if (typeof setGameInvHudButtonsHidden === "function") setGameInvHudButtonsHidden(false);
}

// ---- CDM shows EVERY stat from weapon_server.js / armor_server.js -----------
// Offline, the CDM item popup only lists a fixed set of stat names (index.html's
// collectCdmEditableFields). While the CDM screen is opened from OPTIONS it lists
// every numeric field the item has in the CURRENT tables (= the server's
// weapon_server.js / armor_server.js online), so a stat you add there just shows up
// as an editable row, no client change needed. Fields that are not stats are hidden
// here — add a name to this list if some other number shows up that you don't want.
const OL_CMD_HIDDEN_FIELDS = new Set([
  "width", "height", "timeLife", "spawnChance", "radius", "imagerange", "pellets", "spread",
  "maxEnemyLevel", "perEnemyLevel", "armorValue", "def", "upgradeLevel", "qty", "price"
]);

function olCmdPrettyLabel(field) {
  const spaced = String(field).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function olCmdCollectAllFields(type, data) {
  const labels = {
    physicalDefense: "Physical Defense", defense: "Physical Defense", health: "Health", block: "Block Chance"
  };
  if (typeof CONNECTED_STAT_ROWS !== "undefined") CONNECTED_STAT_ROWS.forEach(([f, l]) => { labels[f] = l; });
  const armorish = type === "armor" || type === "ring" || type === "accessory";
  const fields = [];
  if (type !== "weapon" && !armorish) return fields;
  // Every number on the item, in the order it is written in cmd_server.js. (Armor's
  // "defense" is the same number as physicalDefense — index.html copies it across — so
  // it is only listed when physicalDefense is missing.)
  for (const f of Object.keys(data)) {
    if (OL_CMD_HIDDEN_FIELDS.has(f)) continue;
    if (typeof data[f] !== "number" || !isFinite(data[f])) continue;
    if (f === "defense" && typeof data.physicalDefense === "number") continue;
    fields.push([f, labels[f] || olCmdPrettyLabel(f)]);
  }
  return fields;
}

// ---- CDM item list = server/cmd_server.js (NOT weapon_server / armor_server / upgrade_server) ----
// The server sends it when the CDM code is typed ("cmdCatalog"). While the CDM screen is open
// from OPTIONS, searching, the boxes and the stat rows all use it. Each item is stored in the
// inventory under its KEY (armor1, sword3 ...); its NAME (Frostplate Vanguard ...) is only shown.
let olCmdCatalog = null;   // { weapon:{key:def}, armor:{key:def}, upgrade:{key:def} } | null

function olCmdRequestCatalog() {
  if (!olCmdUnlocked || !netIsOnline()) return;
  netSend({ type: "cmdCatalog", code: olCmdSecret });
}

function olCmdOnCatalog(msg) {
  if (!msg || !msg.ok || !msg.catalog) {
    // Server refused (wrong secret or not an admin account): switch the tool off again.
    olCmdCatalog = null;
    if (olCmdUnlocked) { olCmdUnlocked = false; olCmdSecret = ""; olCmdRefreshButton(); netToast("Not allowed"); }
    return;
  }
  const cat = msg.catalog;
  for (const group of ["weapon", "armor", "upgrade"]) {
    const tbl = cat[group] || (cat[group] = {});
    for (const key of Object.keys(tbl)) {
      // remember the key on the def without it being copied into the item's data
      Object.defineProperty(tbl[key], "cmdKey", { value: key, enumerable: false });
    }
  }
  olCmdCatalog = cat;
  if (olCmdOpenInGame) olCmdRefreshBoxes();
}

function olCmdCatalogDef(type, key) {
  if (!olCmdCatalog) return null;
  const tbl = type === "weapon" ? olCmdCatalog.weapon
    : (type === "armor" || type === "ring" || type === "accessory") ? olCmdCatalog.armor
    : olCmdCatalog.upgrade;
  return (tbl && Object.prototype.hasOwnProperty.call(tbl, key)) ? tbl[key] : null;
}

// Type word the inventory uses for a catalog def.
function olCmdCatalogType(group, def) {
  if (group === "weapon") return "weapon";
  if (group === "armor") return def.category || "armor";
  return def.category;
}

// Type the KEY (armor1) or the NAME (Frostplate Vanguard), or part of either.
function olCmdFindInCatalog(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !olCmdCatalog) return null;
  const groups = ["weapon", "armor", "upgrade"];
  const test = [
    (key, def) => key.toLowerCase() === q,
    (key, def) => String(def.name || "").toLowerCase() === q,
    (key, def) => key.toLowerCase().includes(q) || String(def.name || "").toLowerCase().includes(q)
  ];
  for (const t of test) {
    for (const g of groups) {
      const tbl = olCmdCatalog[g] || {};
      for (const key of Object.keys(tbl)) {
        if (t(key, tbl[key])) return { type: olCmdCatalogType(g, tbl[key]), def: tbl[key] };
      }
    }
  }
  return null;
}

// Rebuild every CDM box from the tables as they are RIGHT NOW. The two starter
// boxes (uzi / armor1) and anything added before joining were built from the
// offline files, so they stayed plain online; this swaps in the server's version
// when the CDM screen opens in a match, and the offline version again when leaving.
function olCmdRefreshBoxes() {
  if (typeof cdmSlots === "undefined" || typeof buildCdmEntryFromDef !== "function") return;
  for (let i = 0; i < cdmSlots.length; i++) {
    const e = cdmSlots[i];
    if (!e || !e.name) continue;
    let def = olCmdCatalogDef(e.type, e.name);   // cmd_server.js version first (while the CDM screen is open in a match)
    if (def) {
      cdmSlots[i] = buildCdmEntryFromDef(e.type, def);
      if (typeof paintCdmSlot === "function") paintCdmSlot(i);
      continue;
    }
    if (e.type === "weapon" && typeof getWeapon === "function") def = getWeapon(e.name);
    else if ((e.type === "armor" || e.type === "ring" || e.type === "accessory") && typeof getArmor === "function") def = getArmor(e.name);
    else if (typeof getUpgradeItem === "function") def = getUpgradeItem(e.name);
    if (!def) continue;
    cdmSlots[i] = buildCdmEntryFromDef(e.type, def);
    if (typeof paintCdmSlot === "function") paintCdmSlot(i);
  }
}

// ---- Inventory item popup: also list stats it has no row for -----------------
// index.html's openItemStatsPopup() only has rows for a fixed list of stat names, so a
// stat added in weapon_server.js / armor_server.js (or typed into CDM) was in the item
// but invisible. Online, this adds a row for every other number on a weapon / armor /
// ring / accessory (same hidden-field list as CDM above).
const OL_STATS_ALREADY_SHOWN = new Set(["physicalDamage", "physicalDefense", "defense", "health", "block", "upgradeLevel"]);

function olAddExtraItemStatRows(entry) {
  try {
    if (!entry || !entry.data || typeof itemStatsRows === "undefined" || !itemStatsRows) return;
    const type = entry.type || entry.kind;
    if (type !== "weapon" && type !== "armor" && type !== "ring" && type !== "accessory") return;
    const known = new Set(OL_STATS_ALREADY_SHOWN);
    if (typeof CONNECTED_STAT_ROWS !== "undefined") CONNECTED_STAT_ROWS.forEach((r) => known.add(r[0]));
    for (const f of Object.keys(entry.data)) {
      const v = entry.data[f];
      if (known.has(f) || OL_CMD_HIDDEN_FIELDS.has(f) || typeof v !== "number" || !isFinite(v) || v === 0) continue;
      const row = document.createElement("div");
      row.className = "charStatsRow";
      row.innerHTML = '<span class="charStatsLabel">' + olCmdPrettyLabel(f) + '</span><span class="charStatsValue">+' + v + '</span>';
      itemStatsRows.appendChild(row);
    }
  } catch (e) { /* the popup itself already rendered; extra rows are a bonus */ }
}

// ---- CDM SEND: give the selected CDM item to another online player ---------
// The item popup (#cdmItemPopup) gets a SEND button next to Cancel / Get Item
// (only while the CDM screen was opened from OPTIONS). SEND opens a small
// window with a name box + CANCEL / SEND; sending asks the server ("cmdGive",
// see server.js) to put the item in that player's inventory. The server
// answers with "cmdGiveResult" once the other player's game has accepted it.
let olCmdPendingSend = null;   // { type, name, data, qty, slotIndex } while waiting for the item popup's SEND

function olCmdNotify(text) {
  // CDM's own toast sits above the CDM screen; the normal one is hidden behind it.
  if (olCmdOpenInGame && typeof showCdmToast === "function") showCdmToast(text);
  else netToast(text);
}

function olCmdShowSendButton(show) {
  const btn = document.getElementById("cdmItemSendBtn");
  if (btn) btn.style.display = show ? "" : "none";
}

// Same reading of the edited stat boxes that the offline "Get Item" button does.
function olCmdCollectItem() {
  if (typeof cdmSelectedEntry === "undefined" || !cdmSelectedEntry) return null;
  const data = Object.assign({}, cdmSelectedEntry.data);
  let qty = 1;
  document.querySelectorAll("#cdmItemRows .cdmStatInput").forEach((input) => {
    const field = input.dataset.field;
    const n = parseFloat(input.value);
    if (field === "qty") qty = (Number.isFinite(n) && n > 0) ? Math.floor(n) : 1;
    else if (Number.isFinite(n)) data[field] = n;
  });
  data.cdmCustom = true;   // see netRefreshGearFromTables(): CDM numbers are kept as typed
  if (cdmSelectedEntry.type === "armor" && typeof data.physicalDefense === "number") data.defense = data.physicalDefense;
  return {
    type: cdmSelectedEntry.type, name: cdmSelectedEntry.name, data, qty,
    slotIndex: (typeof cdmSelectedIndex === "undefined") ? null : cdmSelectedIndex
  };
}

function olCmdBuildSendPopup() {
  let el = document.getElementById("olCmdSendPopup");
  if (el) return el;
  el = document.createElement("div");
  el.id = "olCmdSendPopup";
  el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.65);display:none;align-items:center;" +
    "justify-content:center;z-index:10700;font-family:'Courier New',Courier,monospace;";
  el.innerHTML =
    '<div class="charStatsCard">' +
      '<div class="charStatsName">SEND TO PLAYER</div>' +
      '<input id="olCmdSendName" class="authInput" type="text" placeholder="Player name" maxlength="30" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" ' +
        'style="width:100%;box-sizing:border-box;margin-top:12px;" />' +
      '<div class="charButtonsRow">' +
        '<button id="olCmdSendCancelBtn" class="charBtn cancelBtn" type="button">CANCEL</button>' +
        '<button id="olCmdSendOkBtn" class="charBtn startBtn" type="button">SEND</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById("olCmdSendCancelBtn").addEventListener("click", olCmdCloseSendPopup);
  document.getElementById("olCmdSendOkBtn").addEventListener("click", olCmdConfirmSend);
  document.getElementById("olCmdSendName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); olCmdConfirmSend(); }
  });
  el.addEventListener("click", (e) => { if (e.target === el) olCmdCloseSendPopup(); });
  return el;
}

function olCmdOpenSendPopup() {
  if (!olCmdUnlocked || !olCmdOpenInGame) return;
  const item = olCmdCollectItem();
  if (!item) return;
  olCmdPendingSend = item;
  const el = olCmdBuildSendPopup();
  document.getElementById("olCmdSendName").value = "";
  el.style.display = "flex";
  document.getElementById("olCmdSendName").focus();
}

function olCmdCloseSendPopup() {
  const el = document.getElementById("olCmdSendPopup");
  if (el) el.style.display = "none";
}

function olCmdConfirmSend() {
  const input = document.getElementById("olCmdSendName");
  const name = input ? input.value.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (!name) { olCmdNotify("Type a player name"); return; }
  const item = olCmdPendingSend;
  if (!item) { olCmdCloseSendPopup(); return; }
  if (!netIsOnline()) { olCmdNotify("Not connected"); return; }
  if (window.netMyName && name.toLowerCase() === String(window.netMyName).toLowerCase()) {
    olCmdNotify("That's you - use Get Item");
    return;
  }
  netSend({
    type: "cmdGive", code: olCmdSecret, targetName: name,
    item: { type: item.type, name: item.name, data: item.data, qty: item.qty }
  });
  olCmdCloseSendPopup();
  if (typeof closeCdmItemPopup === "function") closeCdmItemPopup();   // also clears cdmSelectedEntry/Index
  olCmdSentSlot = item.slotIndex;
  olCmdNotify("Sending " + item.name + " to " + name + "...");
}

let olCmdSentSlot = null;   // CDM box the item in flight came from (cleared once it arrives)

// Server -> the RECEIVER: someone used CDM SEND on me.
function olCmdReceive(msg) {
  const it = msg && msg.item;
  if (!it || typeof it !== "object" || !it.type || !it.name) return;
  const ok = (typeof addItemToInventory === "function")
    ? !!addItemToInventory(it.type, it.name, it.data || null, it.qty || 1)
    : false;
  netSend({ type: "cmdGiveAck", toId: msg.fromId, ok });
  netToast(ok
    ? ("Received " + it.name + (it.qty > 1 ? " x" + it.qty : "") + " from " + (msg.fromName || "a player"))
    : ("Inventory full - could not receive " + it.name));
}

// Server -> the SENDER: the item arrived (ok) or was refused (reason).
function olCmdOnResult(msg) {
  if (!msg) return;
  if (msg.ok) {
    // One-shot "give", like Get Item: the CDM box the item came from is emptied.
    if (olCmdSentSlot !== null && typeof cdmSlots !== "undefined" && cdmSlots[olCmdSentSlot]) {
      cdmSlots[olCmdSentSlot] = null;
      if (typeof paintCdmSlot === "function") paintCdmSlot(olCmdSentSlot);
    }
    olCmdSentSlot = null;
    olCmdNotify("Sent " + (msg.itemName || "item") + " to " + (msg.toName || "player"));
  } else {
    olCmdSentSlot = null;
    olCmdNotify(msg.reason || "Could not send");
  }
}

// Called when leaving the online match (exitOnlineGame): hide it again and
// close the CDM screen if it was open.
function olCmdReset() {
  olCmdUnlocked = false;
  olCmdSecret = "";
  olCmdCatalog = null;
  olCmdPendingSend = null;
  olCmdSentSlot = null;
  if (olCmdOpenInGame) olCmdClose();
  olCmdRefreshButton();
  window.__olMapCreatorUnlocked = false;
  olMapCreatorRefreshButton();
}

// Returns true if what's typed in the chat box was one of the two codes
// (and was consumed, so it is NOT sent as a chat message).
function olCmdHandleChatCode() {
  const input = document.getElementById("chatInput");
  if (!input) return false;
  const raw = input.value.replace(/[\r\n\t]+/g, " ").trim();
  // Map Creator codes first ("@#$_&-mapcreator" / "@#$_&-").
  if (raw === OL_MAPCREATOR_SHOW_CODE || raw === OL_MAPCREATOR_HIDE_CODE) {
    if (typeof chatActiveTab === "string" && chatActiveTab !== "world") return false;
    window.__olMapCreatorUnlocked = (raw === OL_MAPCREATOR_SHOW_CODE);
    input.value = "";
    olMapCreatorRefreshButton();
    netToast(window.__olMapCreatorUnlocked ? "Map Creator on" : "Map Creator off");
    return true;
  }
  const showPrefix = raw.startsWith(OL_CMD_SHOW_PREFIX) ? OL_CMD_SHOW_PREFIX : (raw.startsWith(OL_CMD_SHOW_PREFIX_ALT) ? OL_CMD_SHOW_PREFIX_ALT : "");
  const isShow = !!showPrefix && raw.length > showPrefix.length;
  if (!isShow && raw !== OL_CMD_HIDE_CODE) return false;
  // WORLD tab only (the PRIVATE tab treats "@..." as a whisper).
  if (typeof chatActiveTab === "string" && chatActiveTab !== "world") return false;
  olCmdUnlocked = isShow;
  olCmdSecret = isShow ? raw.slice(showPrefix.length).trim() : "";
  if (isShow) olCmdRequestCatalog(); else olCmdCatalog = null;
  input.value = "";
  olCmdRefreshButton();
  netToast(olCmdUnlocked ? "CDM on (Options)" : "CDM off");
  return true;
}

(function olCmdInstall() {
  if (window.__olCmdInstalled) return;
  window.__olCmdInstalled = true;

  // Capture-phase listeners on the chat window run BEFORE the SEND button's /
  // input's own handlers (index.html's chatSubmit), and stopPropagation keeps
  // those from ever seeing the code.
  const chatWin = document.getElementById("chatWindow");
  if (chatWin) {
    chatWin.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("#chatSendBtn") && olCmdHandleChatCode()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    chatWin.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target && e.target.id === "chatInput" && olCmdHandleChatCode()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  // The CDM screen's Back button normally returns to the offline hub; when it
  // was opened from OPTIONS, just close it and go back to the game.
  const cdmScreenEl = document.getElementById("cdmScreen");
  if (cdmScreenEl) {
    cdmScreenEl.addEventListener("click", (e) => {
      if (olCmdOpenInGame && e.target && e.target.closest && e.target.closest("#cdmBackBtn")) {
        e.stopPropagation();
        e.preventDefault();
        olCmdClose();
      }
    }, true);
  }

  olCmdGetButton();   // create it now (hidden) so it is ready inside the OPTIONS popup

  // CDM items are marked so the login-time "rebuild gear from the tables" leaves them alone.
  const cdmItemPopupEl = document.getElementById("cdmItemPopup");
  if (cdmItemPopupEl) {
    cdmItemPopupEl.addEventListener("click", (e) => {
      if (olCmdOpenInGame && e.target && e.target.closest && e.target.closest("#cdmItemGetBtn") &&
          typeof cdmSelectedEntry !== "undefined" && cdmSelectedEntry && cdmSelectedEntry.data) {
        cdmSelectedEntry.data.cdmCustom = true;   // runs before the Get Item handler copies the data
        // armor shows "defense" but equips physicalDefense: keep them the same number
        const pdInput = document.querySelector('#cdmItemRows .cdmStatInput[data-field="physicalDefense"]');
        const pdVal = pdInput ? parseFloat(pdInput.value) : NaN;
        if (cdmSelectedEntry.type === "armor" && Number.isFinite(pdVal)) cdmSelectedEntry.data.defense = pdVal;
      }
    }, true);
  }

  // Inventory item popup: extra rows for stats it has no built-in row for (online only).
  if (typeof openItemStatsPopup === "function" && !window.__olStatsHooked) {
    window.__olStatsHooked = true;
    const origOpenItemStats = openItemStatsPopup;
    openItemStatsPopup = function (slotEl, entry) {
      const result = origOpenItemStats.apply(this, arguments);
      if (netIsOnline()) olAddExtraItemStatRows(entry);
      return result;
    };
  }

  // Search + box building read cmd_server.js while the CDM screen is open from OPTIONS.
  if (typeof findCdmCatalogEntry === "function" && !window.__olCmdFindHooked) {
    window.__olCmdFindHooked = true;
    const offlineFind = findCdmCatalogEntry;
    findCdmCatalogEntry = function (query) {
      if (!olCmdOpenInGame) return offlineFind(query);
      if (!olCmdCatalog) { olCmdRequestCatalog(); return null; }   // still downloading
      return olCmdFindInCatalog(query);
    };
  }
  if (typeof buildCdmEntryFromDef === "function" && !window.__olCmdBuildHooked) {
    window.__olCmdBuildHooked = true;
    const offlineBuild = buildCdmEntryFromDef;
    buildCdmEntryFromDef = function (type, def) {
      if (!def || !def.cmdKey) return offlineBuild(type, def);
      // stored under the KEY (so getArmor/getWeapon/images work); the NAME is just data.name
      const data = Object.assign({}, def, { image: def.image || ("image/" + def.cmdKey + ".png") });
      if (type === "armor") data.defense = (typeof data.physicalDefense === "number") ? data.physicalDefense : 0;
      return { type, name: def.cmdKey, data };
    };
  }

  // Item popup stat rows: every stat while in a match, the original short list otherwise.
  if (typeof collectCdmEditableFields === "function" && !window.__olCmdFieldsHooked) {
    window.__olCmdFieldsHooked = true;
    const offlineCollect = collectCdmEditableFields;
    collectCdmEditableFields = function (type, data) {
      if (!olCmdOpenInGame || !data) return offlineCollect(type, data);
      return olCmdCollectAllFields(type, data);
    };
  }

  // SEND button on the CDM item popup, next to Cancel / Get Item (hidden unless
  // the CDM screen was opened from OPTIONS — offline has nobody to send to).
  const itemBtnRow = document.querySelector("#cdmItemPopup .charButtonsRow");
  if (itemBtnRow && !document.getElementById("cdmItemSendBtn")) {
    const sendBtn = document.createElement("button");
    sendBtn.id = "cdmItemSendBtn";
    sendBtn.className = "charBtn startBtn";
    sendBtn.type = "button";
    sendBtn.textContent = "Send";
    sendBtn.style.display = "none";
    itemBtnRow.appendChild(sendBtn);
    sendBtn.addEventListener("click", olCmdOpenSendPopup);
  }
})();

// ---------------------------------------------------------------------------
// Small on-screen status / kill-feed text
// ---------------------------------------------------------------------------
function netStatus(text) {
  let el = document.getElementById("netStatus");
  if (!text) {
    if (el) el.remove();
    return;
  }
  let textEl;
  if (!el) {
    // Styling (background image, bar frame/fill) lives in style.css under
    // "#netStatus" — this just builds the three-piece markup once. The
    // background image is opaque and covers the full screen, so nothing
    // from the previous screen (SAVE/PAUSE/EXIT, health bars, bots...) can
    // show through underneath it as a faint "ghost" while this is up.
    el = document.createElement("div");
    el.id = "netStatus";
    el.innerHTML =
      '<div class="netStatusBar">' +
        '<div class="netStatusBarFill"></div>' +
        '<div class="netStatusBarBorder"></div>' +
        '<span class="netStatusText"></span>' +
      '</div>';
    document.body.appendChild(el);
  }
  textEl = el.querySelector(".netStatusText");
  if (textEl) textEl.textContent = text;
}

function netToast(text) {
  let feed = document.getElementById("netFeed");
  if (!feed) {
    feed = document.createElement("div");
    feed.id = "netFeed";
    feed.style.cssText =
      "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9000;" +
      "display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;";
    document.body.appendChild(feed);
  }
  const line = document.createElement("div");
  line.textContent = text;
  line.style.cssText =
    "background:rgba(0,0,0,0.6);color:#fff;font:12px 'Courier New',monospace;" +
    "padding:4px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);";
  feed.appendChild(line);
  setTimeout(() => line.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Remote players
// ---------------------------------------------------------------------------
function netCharInfo(name) {
  if (!netCharCache[name]) {
    let c = null;
    try { c = getCharacter(name); } catch (e) { /* unknown character */ }
    const info = { image: null, radius: (c && c.radius) || 12 };
    if (c && c.image) {
      const img = new Image();
      img.src = c.image;
      info.image = img;
    }
    netCharCache[name] = info;
  }
  return netCharCache[name];
}

function netAddRemote(p) {
  const info = netCharInfo(p.character);
  otherPlayers.set(p.id, {
    id: p.id,
    name: p.name || ("Player " + p.id),
    character: p.character,
    x: p.x || 0, y: p.y || 0,
    tx: p.x || 0, ty: p.y || 0,
    health: p.health != null ? p.health : 100,
    maxHealth: p.maxHealth || 100,
    mana: p.mana != null ? p.mana : 0,
    maxMana: p.maxMana || 0,
    exp: p.exp || 0,
    maxExp: p.maxExp || 0,
    level: p.level || 1,
    alive: p.alive !== false,
    radius: info.radius,
    // Equipped gear names — the VIEW touch-menu popup (see
    // netShowPlayerViewPopup() below) reads these to show what this
    // player currently has on. Filled in for real by the "state"
    // messages that follow this initial snapshot.
    weapon: p.weapon || null,
    armor: p.armor || null,
    accessory: p.accessory || null
  });
}

// ---------------------------------------------------------------------------
// WORLD CHAT BUBBLES — a floating speech bubble over a character's head
// showing their last WORLD chat line, so players nearby can read it without
// opening the CHATBOX. Keyed by remote player id; the local player's own
// bubble (netMyChatBubble) is tracked separately since it isn't in
// otherPlayers, and is drawn using game.js's own playerPos/player globals.
// ---------------------------------------------------------------------------
const CHAT_BUBBLE_MS = 5000;        // how long a bubble stays up
const CHAT_BUBBLE_MAX_CHARS = 40;   // wrap width before starting a new line
const netChatBubbles = new Map();   // remote player id -> { text, until }
let netMyChatBubble = null;         // { text, until } for the local player

// Same two-layer art approach as the CHATBOX window itself (see style.css:
// border art on top, fill art behind it, both stretched to the box size).
const netChatBorderImage = new Image();
netChatBorderImage.src = "image/minichatborder.png";
const netChatHudImage = new Image();
netChatHudImage.src = "image/minichathud.png";

function netShowWorldChatBubble(fromName, text) {
  const until = Date.now() + CHAT_BUBBLE_MS;
  if (typeof window.netMyName === "string" && fromName === window.netMyName) {
    netMyChatBubble = { text, until };
    return;
  }
  for (const p of otherPlayers.values()) {
    if (p.name === fromName) { netChatBubbles.set(p.id, { text, until }); return; }
  }
}

// Draws a rounded speech bubble whose bottom tip points at (sx, tipY).
function drawChatBubbleAt(ctx, sx, tipY, text) {
  ctx.save();
  ctx.font = "10px 'Courier New', Courier, monospace";
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (next.length > CHAT_BUBBLE_MAX_CHARS && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);

  const lineH = 12, padX = 10, padY = 8;
  let boxW = 0;
  for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width);
  boxW += padX * 2;
  const boxH = lines.length * lineH + padY * 2;
  const x0 = sx - boxW / 2, y0 = tipY - boxH - 4;

  const haveArt = netChatHudImage.complete && netChatHudImage.naturalWidth
    && netChatBorderImage.complete && netChatBorderImage.naturalWidth;
  if (haveArt) {
    ctx.drawImage(netChatHudImage, x0, y0, boxW, boxH);      // fill, behind
    ctx.drawImage(netChatBorderImage, x0, y0, boxW, boxH);   // border, on top
  } else {
    // Art not loaded yet (or missing) — plain rounded box so a bubble
    // still shows up instead of nothing.
    ctx.fillStyle = "rgba(15,15,20,0.85)";
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
    ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r);
    ctx.arcTo(x0, y0 + boxH, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + boxW, y0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], sx, y0 + padY + i * lineH);
  ctx.restore();
}

function drawRemotePlayers(ctx, offX, offY) {
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const info = netCharInfo(p.character);
    const size = p.radius * 2;
    const sx = offX + p.x;
    const sy = offY + p.y;

    if (info.image && info.image.complete && info.image.naturalWidth) {
      ctx.drawImage(info.image, sx - size / 2, sy - size / 2, size, size);
    } else {
      ctx.fillStyle = "#f55";
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name + level tag (stacked, same treatment as the local player's — see
    // game.js), health bar (same art as the local player's). Bottom to top:
    // health bar, name, level.
    ctx.save();
    ctx.font = "9px 'Courier New', Courier, monospace";
    ctx.textAlign = "center";
    // PERF: was shadowColor/shadowBlur (slow on phones, once per other player
    // per frame). A thin dark outline gives the same readable look for free.
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeText(p.name, sx, sy - p.radius - 13);
    ctx.fillStyle = netPlayerNameColor(p);   // red = can be damaged, white = can't (channel 1 / party / clan)
    ctx.fillText(p.name, sx, sy - p.radius - 13);
    ctx.strokeText("Lv " + p.level, sx, sy - p.radius - 22);
    ctx.fillStyle = "#ff8080";
    ctx.fillText("Lv " + p.level, sx, sy - p.radius - 22);
    ctx.restore();

    const pct = Math.max(0, Math.min(1, p.health / (p.maxHealth || 100)));
    if (typeof drawImageHealthBar === "function") {
      drawImageHealthBar(ctx, sx - 20, sy - p.radius - 10, 40, 5, pct,
        healthBorderImage, healthHudImage, healthEmptyImage);
    }

    const bubble = netChatBubbles.get(p.id);
    if (bubble) {
      if (Date.now() < bubble.until) drawChatBubbleAt(ctx, sx, sy - p.radius - 26, bubble.text);
      else netChatBubbles.delete(p.id);
    }
  }

  // My own WORLD chat bubble, over my own character (playerPos/player come
  // from game.js — see the note at the top of this file).
  if (netMyChatBubble) {
    if (Date.now() < netMyChatBubble.until) {
      const sx = offX + playerPos.x, sy = offY + playerPos.y;
      drawChatBubbleAt(ctx, sx, sy - (playerPos.radius || 12) - 26, netMyChatBubble.text);
    } else {
      netMyChatBubble = null;
    }
  }
}

// ---------------------------------------------------------------------------
// TOUCHING ANOTHER PLAYER (online only)
// ---------------------------------------------------------------------------
// Tapping a nearby player (within NET_TOUCH_RANGE world units of me) pops up
// a small ADD FRIEND / TRADE / ADD CLAN / INVITE menu — see
// handleTouchStart() in game.js, which calls netFindPlayerAtClientPoint()
// the same way it already calls findBotAtClientPoint() for enemies, and only
// on a hit opens the menu via netShowPlayerTouchPopup().
//
// ADD FRIEND sends a "friendRequest" to that player; the server relays it
// (same targeted-send pattern as "hit") and the other player sees an
// ACCEPT / DECLINE popup (netShowFriendRequestPopup). Accepting adds each
// player to the OTHER's friend list (window.friendsList — see the FRIEND
// button/window wiring in index.html) and tells the requester so their own
// list picks it up too. window.friendsList itself is still just an in-memory
// array during play, but it now rides along with the rest of the account's
// saved progress (see olCloudProfile()/olEnterOnlineProfile() below), so it
// survives logout/reconnect instead of resetting.
// TRADE / ADD CLAN / INVITE aren't wired up to anything yet — they just
// close the menu with a "coming soon" toast for now.
// ---------------------------------------------------------------------------
let NET_TOUCH_RANGE = 0;   // set from the server's ONLINE_RULES when you join

const playerTouchOverlay = document.getElementById("playerTouchOverlay");
const playerTouchViewBtn = document.getElementById("playerTouchViewBtn");
const playerTouchAddFriendBtn = document.getElementById("playerTouchAddFriendBtn");
const playerTouchTradeBtn = document.getElementById("playerTouchTradeBtn");
const playerTouchClanBtn = document.getElementById("playerTouchClanBtn");
const playerTouchInviteBtn = document.getElementById("playerTouchInviteBtn");
let netTouchTargetId = null;

// ---- TRADE state — see the big "TRADE" section below (after the clan
// invite popup) for the request popup, the Trade screen itself, and the
// netHandle() cases ("tradeRequest"/"tradeStart"/"tradeOffer"/...) that
// drive all of this. Declared up here so the touch-menu button below (and
// anything else early in the file) can already see it. ----------------------
const TRADE_OFFER_SIZE = 8;   // 4x2 — MY OFFER / THEIR OFFER capacity (My Inventory stays 4x4)

let netTradePartnerId = null;       // other player's id, once a trade is active
let netTradePartnerName = "";
let netTradeMyOffer = new Array(TRADE_OFFER_SIZE).fill(null);        // {type,name,data,qty} | null, mirrors invGridData entries I've offered
let netTradeTheirOffer = new Array(TRADE_OFFER_SIZE).fill(null);      // read-only mirror of their offer
let netTradeMyOfferSource = new Array(TRADE_OFFER_SIZE).fill(null);   // invGridData index each MY OFFER slot came from (parallel to netTradeMyOffer)
let netTradeMyGold = 0;
let netTradeTheirGold = 0;
let netTradeMyConfirmed = false;
let netTradeTheirConfirmed = false;
let netTradeStoragePage = 0;        // Trade screen's own page cursor into invGridData

// Same hit-test math as findBotAtClientPoint() in game.js, but against
// otherPlayers, and only considers players actually within touch range —
// a player rendered on screen while zoomed/far away can't be tapped.
function netFindPlayerAtClientPoint(clientX, clientY) {
  if (!otherPlayers.size) return null;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const cam = getCameraPos();

  let closest = null;
  let closestDist = Infinity;

  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;

    const worldDist = Math.hypot(p.x - playerPos.x, p.y - playerPos.y);
    if (worldDist > NET_TOUCH_RANGE) continue;

    const screenX = centerX + (p.x - cam.x) * cameraZoom;
    const screenY = centerY + (p.y - cam.y) * cameraZoom;
    const clientPX = rect.left + screenX / scaleX;
    const clientPY = rect.top + screenY / scaleY;

    const dist = Math.hypot(clientX - clientPX, clientY - clientPY);
    const tapRadius = Math.max(28, (p.radius * cameraZoom) / scaleX + 14);

    if (dist <= tapRadius && dist < closestDist) {
      closest = p;
      closestDist = dist;
    }
  }

  return closest;
}

function netShowPlayerTouchPopup(remotePlayer) {
  if (!playerTouchOverlay || !remotePlayer) return;
  netTouchTargetId = remotePlayer.id;
  playerTouchOverlay.style.display = "flex";
}

function netCloseTouchPopup() {
  if (playerTouchOverlay) playerTouchOverlay.style.display = "none";
  netTouchTargetId = null;
}

if (playerTouchOverlay) {
  playerTouchOverlay.addEventListener("click", (e) => {
    if (e.target === playerTouchOverlay) netCloseTouchPopup();
  });
  playerTouchOverlay.addEventListener("touchstart", (e) => {
    if (e.target === playerTouchOverlay) {
      e.preventDefault();
      netCloseTouchPopup();
    }
  }, { passive: false });
}

if (playerTouchViewBtn) {
  playerTouchViewBtn.addEventListener("click", () => {
    const targetId = netTouchTargetId;
    const p = targetId != null ? otherPlayers.get(targetId) : null;
    netCloseTouchPopup();
    if (!p) return;
    netShowPlayerViewPopup(p);
  });
}
if (playerTouchAddFriendBtn) {
  playerTouchAddFriendBtn.addEventListener("click", () => {
    const targetId = netTouchTargetId;
    const p = targetId != null ? otherPlayers.get(targetId) : null;
    netCloseTouchPopup();
    if (!p) return;
    netSend({ type: "friendRequest", targetId });
    netToast("Friend request sent to " + p.name);
  });
}
if (playerTouchTradeBtn) {
  playerTouchTradeBtn.addEventListener("click", () => {
    const targetId = netTouchTargetId;
    const p = targetId != null ? otherPlayers.get(targetId) : null;
    netCloseTouchPopup();
    if (!p) return;
    if (netTradePartnerId != null) { netToast("You're already trading"); return; }
    netSend({ type: "tradeRequest", targetId });
    netToast("Trade request sent to " + p.name);
  });
}
if (playerTouchClanBtn) {
  playerTouchClanBtn.addEventListener("click", () => {
    const targetId = netTouchTargetId;
    const p = targetId != null ? otherPlayers.get(targetId) : null;
    netCloseTouchPopup();
    if (!p) return;
    // getPlayerClan() is defined in index.html's own <script> (CLAN section)
    // — by the time this click can happen the whole page has loaded, so
    // it's always available here despite this file loading first.
    const myClan = (typeof getPlayerClan === "function") ? getPlayerClan() : null;
    if (!myClan || myClan.id == null) {
      netToast("Create a clan first (OPTIONS > CREATE CLAN)");
      return;
    }
    netSend({ type: "clanInvite", targetId });
    netToast("Clan invite sent to " + p.name);
  });
}
if (playerTouchInviteBtn) {
  playerTouchInviteBtn.addEventListener("click", () => {
    const targetId = netTouchTargetId;
    const p = targetId != null ? otherPlayers.get(targetId) : null;
    netCloseTouchPopup();
    if (!p) return;
    if (netParty && netParty.members.length >= PARTY_MAX_SIZE) {
      netToast("Your party is full (max " + PARTY_MAX_SIZE + ")");
      return;
    }
    netSend({ type: "partyInvite", targetId });
    netToast("Party invite sent to " + p.name);
  });
}

// ---- VIEW popup (shown to whoever tapped VIEW on the touch menu) ---------
// A read-only mirror of the local "Equip" popup's portrait+ring
// (gameInventoryOverlay in index.html): the touched player's character
// image, level, HEALTH/MANA/EXP, and the same 6-circle ring (Weapon/
// Armor/Accessory equipped items, Helmet/Ring/Boots still "Soon" —
// nothing to drag, this is view-only. Item images are looked up locally
// from the equipped item NAME the "state"/playerAdd messages carry (see
// netAddRemote()/netHandle()'s "state" case above), the same
// getWeapon()/getArmor() convention the local Equip ring already uses.
const playerViewOverlay = document.getElementById("playerViewOverlay");
const playerViewCloseBtn = document.getElementById("playerViewCloseBtn");

function netCloseViewPopup() {
  if (playerViewOverlay) playerViewOverlay.style.display = "none";
}

function netFillViewRingSlot(slotEl, itemName, lookupFn, itemType) {
  if (!slotEl) return;
  const img = slotEl.querySelector(".invSlotImg");
  const label = slotEl.querySelector(".invSlotLabel");
  const def = (itemName && typeof lookupFn === "function") ? lookupFn(itemName) : null;
  // buildCdmEntryFromDef() (index.html) turns a raw weapon.js/armor.js
  // def into the same {type,name,data} shape openItemStatsPopup()
  // expects — including armor's physicalDefense -> defense remap — so
  // tapping this circle below shows the exact same stat rows the local
  // Equip screen would for the same item.
  const entry = (def && typeof buildCdmEntryFromDef === "function")
    ? buildCdmEntryFromDef(itemType, def)
    : (itemName ? { type: itemType, name: itemName, data: {} } : null);
  const imageSrc = itemName ? ((entry && entry.data && entry.data.image) || ("image/" + itemName + ".png")) : null;

  if (itemName && imageSrc) {
    if (img) { img.src = imageSrc; img.style.display = "block"; }
    if (label) label.style.display = "none";
    slotEl.classList.add("filled");
    slotEl._netViewEntry = entry;
  } else {
    if (img) img.style.display = "none";
    if (label) label.style.display = "block";
    slotEl.classList.remove("filled");
    slotEl._netViewEntry = null;
  }
}

// Tapping a filled Weapon/Armor/Accessory circle opens the same
// image+stats popup the local Inventory/Equip screens use (see
// window.openItemStatsPopup() in index.html) — passing a null slotEl
// so it opens in its read-only "ground item preview" mode (no
// Discard/Upgrade buttons, since this isn't the local player's item).
// Wired once here; netFillViewRingSlot() above keeps each slot's
// _netViewEntry current every time the popup is (re)shown.
["pViewWeaponSlot", "pViewArmorSlot", "pViewAccessorySlot"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", () => {
    if (el._netViewEntry && typeof window.openItemStatsPopup === "function") {
      window.openItemStatsPopup(null, el._netViewEntry);
    }
  });
});

function netShowPlayerViewPopup(remotePlayer) {
  if (!playerViewOverlay || !remotePlayer) return;
  const info = netCharInfo(remotePlayer.character);

  const titleEl = document.getElementById("playerViewTitle");
  if (titleEl) titleEl.textContent = remotePlayer.name || "Player";

  const charImg = document.getElementById("pViewCharImg");
  const charPlaceholder = document.getElementById("pViewCharPlaceholder");
  if (charImg && charPlaceholder) {
    if (info.image) {
      charImg.src = info.image.src;
      charImg.style.display = "block";
      charPlaceholder.style.display = "none";
    } else {
      charImg.style.display = "none";
      charPlaceholder.style.display = "block";
    }
  }

  const levelEl = document.getElementById("pViewLevelVal");
  if (levelEl) levelEl.textContent = remotePlayer.level || 1;

  netFillViewRingSlot(document.getElementById("pViewWeaponSlot"), remotePlayer.weapon,
    typeof getWeapon === "function" ? getWeapon : null, "weapon");
  netFillViewRingSlot(document.getElementById("pViewArmorSlot"), remotePlayer.armor,
    typeof getArmor === "function" ? getArmor : null, "armor");
  netFillViewRingSlot(document.getElementById("pViewAccessorySlot"), remotePlayer.accessory, null, "accessory");

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("pViewStatHealth", Math.max(0, Math.round(remotePlayer.health || 0)) + "/" + Math.round(remotePlayer.maxHealth || 0));
  setText("pViewStatMana", Math.max(0, Math.round(remotePlayer.mana || 0)) + "/" + Math.round(remotePlayer.maxMana || 0));
  setText("pViewStatExp", Math.round(remotePlayer.exp || 0) + "/" + Math.round(remotePlayer.maxExp || 0));

  playerViewOverlay.style.display = "flex";
}

if (playerViewCloseBtn) playerViewCloseBtn.addEventListener("click", netCloseViewPopup);
if (playerViewOverlay) {
  playerViewOverlay.addEventListener("click", (e) => {
    if (e.target === playerViewOverlay) netCloseViewPopup();
  });
  playerViewOverlay.addEventListener("touchstart", (e) => {
    if (e.target === playerViewOverlay) {
      e.preventDefault();
      netCloseViewPopup();
    }
  }, { passive: false });
}

// ---- Friend request popup (shown to the player who got touched) ----------
const friendRequestOverlay = document.getElementById("friendRequestOverlay");
const friendRequestText = document.getElementById("friendRequestText");
const friendRequestAcceptBtn = document.getElementById("friendRequestAcceptBtn");
const friendRequestDeclineBtn = document.getElementById("friendRequestDeclineBtn");
const netFriendRequestQueue = [];   // {from, fromName} — in case more than one arrives at once
let netFriendRequestCurrent = null;

function netShowNextFriendRequest() {
  if (!friendRequestOverlay || !friendRequestText) return;
  if (netFriendRequestCurrent || !netFriendRequestQueue.length) return;
  netFriendRequestCurrent = netFriendRequestQueue.shift();
  friendRequestText.textContent = netFriendRequestCurrent.fromName + " wants to be friends";
  friendRequestOverlay.style.display = "flex";
}

function netCloseFriendRequestPopup() {
  if (friendRequestOverlay) friendRequestOverlay.style.display = "none";
  netFriendRequestCurrent = null;
  netShowNextFriendRequest();   // show the next queued request, if any
}

function netOnFriendRequest(msg) {
  netFriendRequestQueue.push({ from: msg.from, fromName: msg.fromName || ("Player " + msg.from) });
  netShowNextFriendRequest();
}

// Adds someone to my friend list (both on accepting a request, and when the
// person I sent a request to accepts it) and refreshes the FRIEND window if
// it's currently open.
function netAddFriend(id, name) {
  if (typeof window.friendsList === "undefined" || !Array.isArray(window.friendsList)) {
    window.friendsList = [];
  }
  if (!window.friendsList.some((f) => f.id === id)) {
    window.friendsList.push({ id, name });
  }
  if (typeof renderFriendList === "function") renderFriendList();
}

if (friendRequestAcceptBtn) {
  friendRequestAcceptBtn.addEventListener("click", () => {
    const req = netFriendRequestCurrent;
    netCloseFriendRequestPopup();
    if (!req) return;
    netAddFriend(req.from, req.fromName);
    netSend({ type: "friendResponse", targetId: req.from, accept: true });
    netToast("You are now friends with " + req.fromName);
  });
}
if (friendRequestDeclineBtn) {
  friendRequestDeclineBtn.addEventListener("click", () => {
    const req = netFriendRequestCurrent;
    netCloseFriendRequestPopup();
    if (!req) return;
    netSend({ type: "friendResponse", targetId: req.from, accept: false });
  });
}

// ---- Party invite popup (shown to the player who got invited) ------------
// Same queue/overlay pattern as the friend request popup just above.
const partyInviteOverlay = document.getElementById("partyInviteOverlay");
const partyInviteText = document.getElementById("partyInviteText");
const partyInviteAcceptBtn = document.getElementById("partyInviteAcceptBtn");
const partyInviteDeclineBtn = document.getElementById("partyInviteDeclineBtn");
const netPartyInviteQueue = [];   // {from, fromName} — in case more than one arrives at once
let netPartyInviteCurrent = null;

function netShowNextPartyInvite() {
  if (!partyInviteOverlay || !partyInviteText) return;
  if (netPartyInviteCurrent || !netPartyInviteQueue.length) return;
  netPartyInviteCurrent = netPartyInviteQueue.shift();
  partyInviteText.textContent = netPartyInviteCurrent.fromName + " invited you to a party";
  partyInviteOverlay.style.display = "flex";
}

function netCloseInvitePartyPopup() {
  if (partyInviteOverlay) partyInviteOverlay.style.display = "none";
  netPartyInviteCurrent = null;
  netShowNextPartyInvite();   // show the next queued invite, if any
}

function netOnPartyInvite(msg) {
  netPartyInviteQueue.push({ from: msg.from, fromName: msg.fromName || ("Player " + msg.from) });
  netShowNextPartyInvite();
}

if (partyInviteAcceptBtn) {
  partyInviteAcceptBtn.addEventListener("click", () => {
    const req = netPartyInviteCurrent;
    netCloseInvitePartyPopup();
    if (!req) return;
    if (netParty) { netToast("You're already in a party"); return; }
    netSend({ type: "partyResponse", targetId: req.from, accept: true });
    // netParty itself is set once the server's "partyUpdate" roster arrives
    // (see netHandleMessage below) — it's the source of truth for who's in.
  });
}
if (partyInviteDeclineBtn) {
  partyInviteDeclineBtn.addEventListener("click", () => {
    const req = netPartyInviteCurrent;
    netCloseInvitePartyPopup();
    if (!req) return;
    netSend({ type: "partyResponse", targetId: req.from, accept: false });
  });
}

// ---- Clan invite popup (shown to the player who got touched) -------------
// Same queue/overlay pattern as the friend/party invite popups above.
// ACCEPT CLAN sends "clanResponse"; my own clan roster (name/leader/member
// list) then arrives separately as a "clanUpdate" message, which
// index.html's applyClanUpdate() turns into the CREATE CLAN -> CLAN button
// swap and fills in the CLAN window's member list.
const clanInviteOverlay = document.getElementById("clanInviteOverlay");
const clanInviteText = document.getElementById("clanInviteText");
const clanInviteAcceptBtn = document.getElementById("clanInviteAcceptBtn");
const clanInviteRejectBtn = document.getElementById("clanInviteRejectBtn");
const netClanInviteQueue = [];   // {from, fromName, clanId, clanName} — in case more than one arrives at once
let netClanInviteCurrent = null;

function netShowNextClanInvite() {
  if (!clanInviteOverlay || !clanInviteText) return;
  if (netClanInviteCurrent || !netClanInviteQueue.length) return;
  netClanInviteCurrent = netClanInviteQueue.shift();
  clanInviteText.textContent = netClanInviteCurrent.fromName + " invites you to join the clan";
  clanInviteOverlay.style.display = "flex";
}

function netCloseClanInvitePopup() {
  if (clanInviteOverlay) clanInviteOverlay.style.display = "none";
  netClanInviteCurrent = null;
  netShowNextClanInvite();   // show the next queued invite, if any
}

function netOnClanInvite(msg) {
  netClanInviteQueue.push({
    from: msg.from,
    fromName: msg.fromName || ("Player " + msg.from),
    clanId: msg.clanId,
    clanName: msg.clanName || "the clan"
  });
  netShowNextClanInvite();
}

if (clanInviteAcceptBtn) {
  clanInviteAcceptBtn.addEventListener("click", () => {
    const req = netClanInviteCurrent;
    netCloseClanInvitePopup();
    if (!req) return;
    netSend({ type: "clanResponse", targetId: req.from, clanId: req.clanId, accept: true });
  });
}
if (clanInviteRejectBtn) {
  clanInviteRejectBtn.addEventListener("click", () => {
    const req = netClanInviteCurrent;
    netCloseClanInvitePopup();
    if (!req) return;
    netSend({ type: "clanResponse", targetId: req.from, clanId: req.clanId, accept: false });
  });
}

// ---------------------------------------------------------------------------
// TRADE — request popup, then the full Trade screen (see tradeScreen /
// tradeRequestOverlay / tradeGoldInputOverlay in index.html).
//
// Flow: TRADE button (above) -> "tradeRequest" -> the touched player sees
// the ACCEPT/CANCEL popup below -> "tradeResponse" -> the server replies
// "tradeStart" to BOTH players, who each open their own Trade screen. From
// there each side privately picks items out of their OWN storage grid
// (netTradeMyOffer) and taps the gold orb to add gold; every change is sent
// as "tradeOffer" and mirrored on the other player's screen as THEIR OFFER
// (read-only). ACCEPT sends "tradeConfirm"; once both sides have confirmed,
// the server sends "tradeComplete" and each client applies the swap to its
// own inventory (netTradeApplyComplete()) — same client-trust model as
// everything else online (see server.js's TRADE section).
// ---------------------------------------------------------------------------

// ---- Trade request popup (shown to the player who got touched) -----------
const tradeRequestOverlay = document.getElementById("tradeRequestOverlay");
const tradeRequestText = document.getElementById("tradeRequestText");
const tradeRequestAcceptBtn = document.getElementById("tradeRequestAcceptBtn");
const tradeRequestCancelBtn = document.getElementById("tradeRequestCancelBtn");
const netTradeRequestQueue = [];   // {from, fromName} — in case more than one arrives at once
let netTradeRequestCurrent = null;

function netShowNextTradeRequest() {
  if (!tradeRequestOverlay || !tradeRequestText) return;
  if (netTradeRequestCurrent || !netTradeRequestQueue.length) return;
  netTradeRequestCurrent = netTradeRequestQueue.shift();
  tradeRequestText.textContent = netTradeRequestCurrent.fromName + " wants to trade";
  tradeRequestOverlay.style.display = "flex";
}

function netCloseTradeRequestPopup() {
  if (tradeRequestOverlay) tradeRequestOverlay.style.display = "none";
  netTradeRequestCurrent = null;
  netShowNextTradeRequest();   // show the next queued request, if any
}

function netOnTradeRequest(msg) {
  if (netTradePartnerId != null) return;   // already trading — mirrors the server's own guard
  netTradeRequestQueue.push({ from: msg.from, fromName: msg.fromName || ("Player " + msg.from) });
  netShowNextTradeRequest();
}

if (tradeRequestAcceptBtn) {
  tradeRequestAcceptBtn.addEventListener("click", () => {
    const req = netTradeRequestCurrent;
    netCloseTradeRequestPopup();
    if (!req) return;
    if (netTradePartnerId != null) { netToast("You're already trading"); return; }
    netSend({ type: "tradeResponse", targetId: req.from, accept: true });
    // The Trade screen itself only opens once the server's own "tradeStart"
    // arrives (see netHandle) — same "server is the source of truth"
    // pattern as partyResponse/partyUpdate.
  });
}
if (tradeRequestCancelBtn) {
  tradeRequestCancelBtn.addEventListener("click", () => {
    const req = netTradeRequestCurrent;
    netCloseTradeRequestPopup();
    if (!req) return;
    netSend({ type: "tradeResponse", targetId: req.from, accept: false });
  });
}

// ---- Trade screen ----------------------------------------------------------
const tradeScreen = document.getElementById("tradeScreen");
const tradeTitleEl = document.getElementById("tradeTitle");
const tradeStatusTextEl = document.getElementById("tradeStatusText");
const tradeTheirLabelEl = document.getElementById("tradeTheirLabel");

const tradeStorageInner = document.getElementById("tradeStorageInner");
const tradeStoragePrevBtn = document.getElementById("tradeStoragePrevBtn");
const tradeStorageNextBtn = document.getElementById("tradeStorageNextBtn");
const tradeStoragePageLabel = document.getElementById("tradeStoragePageLabel");

const tradeMyOfferInner = document.getElementById("tradeMyOfferInner");
const tradeTheirOfferInner = document.getElementById("tradeTheirOfferInner");

const tradeMyGoldRow = document.getElementById("tradeMyGoldRow");
const tradeMyGoldAmountEl = document.getElementById("tradeMyGoldAmount");
const tradeTheirGoldAmountEl = document.getElementById("tradeTheirGoldAmount");

const tradeAcceptBtn = document.getElementById("tradeAcceptBtn");
const tradeDeclineBtn = document.getElementById("tradeDeclineBtn");

const TRADE_PAGE_SIZE = 16;   // same 4x4 as the Inventory screen's own storage grid

// Build the 16 storage-picker slots (4x4) + 8 my-offer slots (4x2) + 8
// their-offer slots (4x2) once, the same "reusable DOM element, repainted
// per state" approach as the Inventory screen's own invGridSlots (see
// index.html) — just with Trade's own small data arrays instead of
// invGridData/invSlotData.
const tradeStorageSlots = [];
const tradeMyOfferSlots = [];
const tradeTheirOfferSlots = [];

function tradeBuildSlotEl() {
  const slot = document.createElement("div");
  slot.className = "invGridSlot";
  slot.setAttribute("draggable", "false");
  slot.innerHTML =
    '<img class="invGridSlotImg" style="display:none;" />' +
    '<span class="invGridSlotQty" style="display:none;"></span>';
  return slot;
}

// group: "storage" (My Inventory, 4x4/16, paged) | "myOffer" (4x2/8) |
// "theirOffer" (4x2/8, read-only mirror). Tagged once here so the
// drag-and-drop handlers below can tell which array a slot belongs to
// without re-deriving it every drag.
function tradeFillGrid(container, slotArray, group) {
  if (!container) return;
  const count = group === "storage" ? TRADE_PAGE_SIZE : TRADE_OFFER_SIZE;
  for (let i = 0; i < count; i++) {
    const slot = tradeBuildSlotEl();
    slot.dataset.tradeGroup = group;
    if (group !== "storage") slot.dataset.offerIndex = String(i);
    container.appendChild(slot);
    slotArray.push(slot);
  }
}
tradeFillGrid(tradeStorageInner, tradeStorageSlots, "storage");
tradeFillGrid(tradeMyOfferInner, tradeMyOfferSlots, "myOffer");
tradeFillGrid(tradeTheirOfferInner, tradeTheirOfferSlots, "theirOffer");

// Paints one of the small reused elements from a plain {type,name,data,qty}
// entry (or null) — same visual shape as index.html's paintGridSlotEl, just
// operating on Trade's own slot arrays instead of invGridData.
function tradePaintSlotEl(slotEl, entry, allowDrag) {
  const img = slotEl.querySelector(".invGridSlotImg");
  const qty = slotEl.querySelector(".invGridSlotQty");
  if (entry) {
    img.src = (entry.data && entry.data.image) || ("image/" + entry.name + ".png");
    img.style.display = "block";
    slotEl.classList.add("filled");
    slotEl.dataset.type = entry.type;
    slotEl.title = entry.name;
    slotEl.setAttribute("draggable", allowDrag ? "true" : "false");
    if (entry.qty && entry.qty > 1) { qty.textContent = entry.qty; qty.style.display = "block"; }
    else qty.style.display = "none";
  } else {
    img.style.display = "none";
    qty.style.display = "none";
    slotEl.classList.remove("filled");
    slotEl.removeAttribute("data-type");
    slotEl.title = "";
    slotEl.setAttribute("draggable", "false");
  }
}

// invGridData indices currently sitting in MY offer, so the storage picker
// below doesn't also show them as available — they're "in the deal" until
// I tap them back out.
function netTradeReservedIndices() {
  const set = new Set();
  for (const idx of netTradeMyOfferSource) if (idx != null) set.add(idx);
  return set;
}

function tradeRenderStoragePage() {
  const reserved = netTradeReservedIndices();
  const start = netTradeStoragePage * TRADE_PAGE_SIZE;
  const grid = (typeof invGridData !== "undefined") ? invGridData : [];
  for (let i = 0; i < TRADE_PAGE_SIZE; i++) {
    const gridIndex = start + i;
    const raw = grid[gridIndex];
    const entry = (raw && !reserved.has(gridIndex)) ? raw : null;
    tradePaintSlotEl(tradeStorageSlots[i], entry, true);
    tradeStorageSlots[i].dataset.gridIndex = String(gridIndex);
  }
  const pageCount = (typeof INVENTORY_PAGE_COUNT === "number") ? INVENTORY_PAGE_COUNT : 4;
  if (tradeStoragePageLabel) tradeStoragePageLabel.textContent = (netTradeStoragePage + 1) + "/" + pageCount;
  if (tradeStoragePrevBtn) tradeStoragePrevBtn.disabled = netTradeStoragePage <= 0;
  if (tradeStorageNextBtn) tradeStorageNextBtn.disabled = netTradeStoragePage >= pageCount - 1;
}

function tradeRenderMyOffer() {
  for (let i = 0; i < TRADE_OFFER_SIZE; i++) tradePaintSlotEl(tradeMyOfferSlots[i], netTradeMyOffer[i], true);
  if (tradeMyGoldAmountEl) tradeMyGoldAmountEl.textContent = netTradeMyGold;
}

function tradeRenderTheirOffer() {
  for (let i = 0; i < TRADE_OFFER_SIZE; i++) tradePaintSlotEl(tradeTheirOfferSlots[i], netTradeTheirOffer[i], false);
  if (tradeTheirGoldAmountEl) tradeTheirGoldAmountEl.textContent = netTradeTheirGold;
}

function tradeRenderAll() {
  tradeRenderStoragePage();
  tradeRenderMyOffer();
  tradeRenderTheirOffer();
}

if (tradeStoragePrevBtn) {
  tradeStoragePrevBtn.addEventListener("click", () => {
    if (netTradeStoragePage > 0) { netTradeStoragePage--; tradeRenderStoragePage(); }
  });
}
if (tradeStorageNextBtn) {
  tradeStorageNextBtn.addEventListener("click", () => {
    const pageCount = (typeof INVENTORY_PAGE_COUNT === "number") ? INVENTORY_PAGE_COUNT : 4;
    if (netTradeStoragePage < pageCount - 1) { netTradeStoragePage++; tradeRenderStoragePage(); }
  });
}

// Sends my current offer (items + gold) to my trade partner, and un-confirms
// both sides locally — mirrors the server's own reset (see "tradeOffer" in
// server.js): changing your offer after hitting Accept should un-lock it.
function netTradeSendOffer() {
  if (netTradePartnerId == null) return;
  netTradeMyConfirmed = false;
  netTradeTheirConfirmed = false;
  tradeUpdateAcceptState();
  netSend({ type: "tradeOffer", targetId: netTradePartnerId, items: netTradeMyOffer, gold: netTradeMyGold });
}

// Drag a filled box in MY INVENTORY onto an empty box in MY OFFER to add
// it to the trade (dropped into the exact slot you release it on — your
// trade partner sees it land there too, since MY OFFER is sent to them and
// mirrored read-only as THEIR OFFER on their screen, see "tradeOffer"
// below). Drag a filled box in MY OFFER back onto MY INVENTORY to pull it
// back out. Drag one MY OFFER box onto another to swap their positions.
// Same dragstart/dragover/dragleave/drop/dragend pattern as the full
// Inventory screen's own drag/drop (see index.html's allInvSlotEls).
let tradeDragSourceEl = null;

function tradeHandleDrop(targetEl) {
  if (!tradeDragSourceEl || tradeDragSourceEl === targetEl) return;
  const sourceGroup = tradeDragSourceEl.dataset.tradeGroup;
  const targetGroup = targetEl.dataset.tradeGroup;

  if (sourceGroup === "storage" && targetGroup === "myOffer") {
    const gridIndex = Number(tradeDragSourceEl.dataset.gridIndex);
    const entry = invGridData[gridIndex];
    if (!entry) return;
    const targetIndex = Number(targetEl.dataset.offerIndex);
    if (netTradeMyOffer[targetIndex]) { netToast("That offer slot is full"); return; }
    netTradeMyOffer[targetIndex] = entry;
    netTradeMyOfferSource[targetIndex] = gridIndex;
    tradeRenderStoragePage();
    tradeRenderMyOffer();
    netTradeSendOffer();
  } else if (sourceGroup === "myOffer" && targetGroup === "storage") {
    const offerIndex = Number(tradeDragSourceEl.dataset.offerIndex);
    if (!netTradeMyOffer[offerIndex]) return;
    netTradeMyOffer[offerIndex] = null;
    netTradeMyOfferSource[offerIndex] = null;
    tradeRenderStoragePage();
    tradeRenderMyOffer();
    netTradeSendOffer();
  } else if (sourceGroup === "myOffer" && targetGroup === "myOffer") {
    const a = Number(tradeDragSourceEl.dataset.offerIndex);
    const b = Number(targetEl.dataset.offerIndex);
    const entryA = netTradeMyOffer[a], sourceA = netTradeMyOfferSource[a];
    netTradeMyOffer[a] = netTradeMyOffer[b];
    netTradeMyOfferSource[a] = netTradeMyOfferSource[b];
    netTradeMyOffer[b] = entryA;
    netTradeMyOfferSource[b] = sourceA;
    tradeRenderMyOffer();
    netTradeSendOffer();
  }
}

const tradeDraggableSlots = tradeStorageSlots.concat(tradeMyOfferSlots);
tradeDraggableSlots.forEach((slotEl) => {
  slotEl.addEventListener("dragstart", (e) => {
    if (!slotEl.classList.contains("filled")) { e.preventDefault(); return; }
    tradeDragSourceEl = slotEl;
    e.dataTransfer.effectAllowed = "move";
  });
  slotEl.addEventListener("dragover", (e) => {
    if (!tradeDragSourceEl) return;
    e.preventDefault();
    slotEl.classList.add("dragOver");
  });
  slotEl.addEventListener("dragleave", () => {
    slotEl.classList.remove("dragOver");
  });
  slotEl.addEventListener("drop", (e) => {
    e.preventDefault();
    slotEl.classList.remove("dragOver");
    tradeHandleDrop(slotEl);
    tradeDragSourceEl = null;
    tradeJustDragged = true;
    setTimeout(() => (tradeJustDragged = false), 50);
  });
  slotEl.addEventListener("dragend", () => {
    tradeDraggableSlots.forEach((s) => s.classList.remove("dragOver"));
    tradeDragSourceEl = null;
    tradeJustDragged = true;
    setTimeout(() => (tradeJustDragged = false), 50);
  });
});

// Reads whichever {type,name,data,qty} entry (or null) a trade slot is
// currently showing — same shape openItemStatsPopup() (index.html) already
// renders — regardless of which of the three groups it belongs to. Used by
// the tap-to-preview handler below.
function tradeGetSlotEntry(slotEl) {
  const group = slotEl.dataset.tradeGroup;
  if (group === "storage") {
    const grid = (typeof invGridData !== "undefined") ? invGridData : [];
    return grid[Number(slotEl.dataset.gridIndex)] || null;
  }
  const idx = Number(slotEl.dataset.offerIndex);
  if (group === "myOffer") return netTradeMyOffer[idx] || null;
  if (group === "theirOffer") return netTradeTheirOffer[idx] || null;
  return null;
}

// Tapping any filled box in the Trade screen — My Inventory, My Offer, or
// Their Offer — shows the same big image + stats popup as the Inventory
// screen, so both players can check exactly what's on the table before
// accepting. Read-only preview: passing slotEl as null tells
// openItemStatsPopup() to hide the Discard/Upgrade buttons (see there),
// since nothing here should be discarded/upgraded from inside a trade.
let tradeJustDragged = false;
const tradeAllSlots = tradeStorageSlots.concat(tradeMyOfferSlots, tradeTheirOfferSlots);
tradeAllSlots.forEach((slotEl) => {
  slotEl.addEventListener("click", () => {
    if (tradeJustDragged) return;
    const entry = tradeGetSlotEntry(slotEl);
    if (entry && typeof window.openItemStatsPopup === "function") {
      window.openItemStatsPopup(null, entry);
    }
  });
});

// Safety net, same as index.html's document-level guard: without this, a
// drop released outside every valid target falls back to the browser's
// native "navigate to the dragged image" behavior instead of just leaving
// the item where it was.
document.addEventListener("dragover", (e) => { if (tradeDragSourceEl) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (tradeDragSourceEl) e.preventDefault(); });

function tradeUpdateAcceptState() {
  if (tradeAcceptBtn) tradeAcceptBtn.classList.toggle("tradeReady", netTradeTheirConfirmed && !netTradeMyConfirmed);
  if (!tradeStatusTextEl) return;
  if (netTradeMyConfirmed && netTradeTheirConfirmed) tradeStatusTextEl.textContent = "Trading...";
  else if (netTradeMyConfirmed) tradeStatusTextEl.textContent = "Waiting for " + (netTradePartnerName || "the other player") + "...";
  else if (netTradeTheirConfirmed) tradeStatusTextEl.textContent = (netTradePartnerName || "The other player") + " is ready — Accept to complete the trade";
  else tradeStatusTextEl.textContent = "";
}

function netTradeReset() {
  netTradePartnerId = null;
  netTradePartnerName = "";
  netTradeMyOffer = new Array(TRADE_OFFER_SIZE).fill(null);
  netTradeTheirOffer = new Array(TRADE_OFFER_SIZE).fill(null);
  netTradeMyOfferSource = new Array(TRADE_OFFER_SIZE).fill(null);
  netTradeMyGold = 0;
  netTradeTheirGold = 0;
  netTradeMyConfirmed = false;
  netTradeTheirConfirmed = false;
  netTradeStoragePage = 0;
  if (tradeAcceptBtn) tradeAcceptBtn.classList.remove("tradeReady");
  if (tradeStatusTextEl) tradeStatusTextEl.textContent = "";
}

function netOpenTradeScreen(partnerId, partnerName) {
  netTradeReset();
  netTradePartnerId = partnerId;
  netTradePartnerName = partnerName || ("Player " + partnerId);
  if (tradeTitleEl) tradeTitleEl.textContent = "Trading with " + netTradePartnerName;
  if (tradeTheirLabelEl) tradeTheirLabelEl.textContent = netTradePartnerName + "'s Offer";
  tradeUpdateAcceptState();
  tradeRenderAll();
  if (tradeScreen) tradeScreen.style.display = "flex";
}

function netCloseTradeScreen() {
  if (tradeScreen) tradeScreen.style.display = "none";
}

// Actually applies a completed trade to MY inventory: removes whatever I
// offered from the exact storage slots it came from, adds whatever my
// partner offered into the first open storage slots, and moves gold both
// ways. Called once the server's "tradeComplete" arrives (both sides
// confirmed) — see server.js's "tradeConfirm" case.
function netTradeApplyComplete() {
  // Remove what I gave away.
  for (const gridIndex of netTradeMyOfferSource) {
    if (gridIndex != null) invGridData[gridIndex] = null;
  }
  // Spend my offered gold, then receive theirs.
  if (netTradeMyGold > 0 && typeof addGold === "function") addGold(-netTradeMyGold);
  // Receive what they gave — drop each into the first open storage box
  // (addItemToInventory also stacks it onto a matching box if one exists).
  for (const entry of netTradeTheirOffer) {
    if (!entry) continue;
    if (typeof addItemToInventory === "function") {
      addItemToInventory(entry.type, entry.name, entry.data, entry.qty || 1);
    } else {
      const openIndex = invGridData.findIndex((e) => e == null);
      if (openIndex !== -1) invGridData[openIndex] = entry;
    }
  }
  if (netTradeTheirGold > 0 && typeof addGold === "function") addGold(netTradeTheirGold);

  if (typeof refreshInventoryUI === "function") refreshInventoryUI();
  if (typeof olNotifyChange === "function") olNotifyChange();

  netToast("Trade complete with " + netTradePartnerName);
  netTradeReset();
  netCloseTradeScreen();
}

if (tradeMyGoldRow) tradeMyGoldRow.addEventListener("click", () => netOpenTradeGoldInput());
if (tradeAcceptBtn) {
  tradeAcceptBtn.addEventListener("click", () => {
    if (netTradePartnerId == null) return;
    netTradeMyConfirmed = true;
    tradeUpdateAcceptState();
    netSend({ type: "tradeConfirm", targetId: netTradePartnerId });
  });
}
if (tradeDeclineBtn) {
  tradeDeclineBtn.addEventListener("click", () => {
    if (netTradePartnerId != null) netSend({ type: "tradeCancel", targetId: netTradePartnerId });
    netTradeReset();
    netCloseTradeScreen();
  });
}

// ---- Gold amount popup (tap the gold orb under MY OFFER) ------------------
const tradeGoldInputOverlay = document.getElementById("tradeGoldInputOverlay");
const tradeGoldInputField = document.getElementById("tradeGoldInputField");
const tradeGoldInputOkBtn = document.getElementById("tradeGoldInputOkBtn");
const tradeGoldInputCancelBtn = document.getElementById("tradeGoldInputCancelBtn");

function netOpenTradeGoldInput() {
  if (!tradeGoldInputOverlay || !tradeGoldInputField) return;
  tradeGoldInputField.value = netTradeMyGold || "";
  tradeGoldInputOverlay.style.display = "flex";
  tradeGoldInputField.focus();
}
function netCloseTradeGoldInput() {
  if (tradeGoldInputOverlay) tradeGoldInputOverlay.style.display = "none";
  if (tradeGoldInputField) tradeGoldInputField.blur();
}
function netSubmitTradeGoldInput() {
  const myGold = (typeof playerGold === "number") ? playerGold : Infinity;
  let amount = Math.trunc(Number(tradeGoldInputField.value));
  if (!isFinite(amount) || amount < 0) amount = 0;
  if (amount > myGold) { netToast("You don't have that much gold"); amount = myGold; }
  netTradeMyGold = amount;
  netCloseTradeGoldInput();
  tradeRenderMyOffer();
  netTradeSendOffer();
}
if (tradeGoldInputOkBtn) tradeGoldInputOkBtn.addEventListener("click", netSubmitTradeGoldInput);
if (tradeGoldInputCancelBtn) tradeGoldInputCancelBtn.addEventListener("click", netCloseTradeGoldInput);
if (tradeGoldInputField) {
  tradeGoldInputField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") netSubmitTradeGoldInput();
  });
}

// ---------------------------------------------------------------------------
// PARTY panel — the small "PARTY" button fixed near the top of the screen
// (online only); tapping it drags a short roster panel down below it. Both
// elements live in index.html (partyPanelBtn / partyPanelDrop); built here
// since they only make sense while netParty has something to show.
// ---------------------------------------------------------------------------
const partyPanelBtn = document.getElementById("partyPanelBtn");
const partyPanelDrop = document.getElementById("partyPanelDrop");
const partyPanelList = document.getElementById("partyPanelList");
const partyPanelLeaveBtn = document.getElementById("partyPanelLeaveBtn");
let netPartyPanelOpen = false;

function netRenderPartyPanel() {
  if (!partyPanelList) return;
  partyPanelList.innerHTML = "";
  if (!netParty || !netParty.members.length) {
    const row = document.createElement("div");
    row.className = "partyPanelRow partyPanelEmpty";
    row.textContent = "No party — touch a nearby player and tap INVITE PARTY";
    partyPanelList.appendChild(row);
    if (partyPanelLeaveBtn) partyPanelLeaveBtn.style.display = "none";
    return;
  }
  for (const m of netParty.members) {
    const row = document.createElement("div");
    row.className = "partyPanelRow";
    row.textContent = m.name + (m.id === myId ? " (You)" : "");
    partyPanelList.appendChild(row);
  }
  if (partyPanelLeaveBtn) partyPanelLeaveBtn.style.display = "";
}

function netSetPartyPanelOpen(open) {
  netPartyPanelOpen = open;
  if (partyPanelDrop) partyPanelDrop.classList.toggle("partyPanelDropOpen", open);
}

// =============================================================================
// REAL-MONEY SHOP  —  the SHOP button (top-right, online mode only)
// =============================================================================
// Looks like the offline Shop (same classes / same 6x6 grid) but items cost real
// pesos. Prices + payment details come from the server (shop_server.js REAL_SHOP /
// PAYMENT_INFO). Paying is done on the server side (see server.js "REAL-MONEY SHOP"):
//   * AUTO   — PayMongo page (GCash / Maya / GrabPay / cards), item arrives by itself.
//   * MANUAL — send to the GCash number / bank shown here, type the reference number,
//              the owner approves it, item arrives.
// Items that were paid for are put in the inventory by olShopClaim() below.
// =============================================================================
let olShopData = null;            // { REAL_SHOP, PAYMENT_INFO } from the server's game data
let olShopCategory = "weapon";
let olShopPage = 0;
let olShopSelected = null;
let olShopWatching = false;       // true while we wait for a payment to land
let olShopClaimBusy = false;
let olShopClaimTries = 0;
let olShopPollTimer = null;
const OL_SHOP_PAGE_SIZE = 36;
const OL_SHOP_PAGE_COUNT = 4;
const OL_SHOP_PENDING_KEY = "olShopPending";   // remembers "I paid, waiting for delivery" across the PayMongo redirect

function olShopPeso(n) {
  const v = Number(n) || 0;
  return "\u20B1" + (v % 1 === 0 ? v.toLocaleString() : v.toFixed(2));
}

function olShopLookup(type, name) {
  try {
    if (type === "weapon" && typeof getWeapon === "function") return getWeapon(name);
    if (type === "armor" && typeof getArmor === "function") return getArmor(name);
    if (type === "stone" && typeof getStone === "function") return getStone(name);
    if (type === "accessory" && typeof getArmor === "function") return getArmor(name);
  } catch (e) {}
  return null;
}

// What inventory category an item lands in (rings/accessories keep their own, like the offline shop).
function olShopItemType(type, data) {
  return (data && (data.category === "ring" || data.category === "accessory")) ? data.category : type;
}

function olShopCatalog(cat) {
  const arr = new Array(OL_SHOP_PAGE_SIZE * OL_SHOP_PAGE_COUNT).fill(null);
  if (cat === "points") {
    // POINTS tab: weapons, then armor, then rings/accessories (shop_server.js POINTS_SHOP), priced in points
    const ps = (olShopData && olShopData.POINTS_SHOP) || {};
    let i = 0;
    for (const t of ["weapon", "armor", "accessory"]) {
      for (const e of (Array.isArray(ps[t]) ? ps[t] : [])) {
        if (i >= arr.length) break;
        const data = e && olShopLookup(t, e.name);
        if (!data) continue;
        arr[i++] = { type: olShopItemType(t, data), shopType: t, name: e.name, data, price: Number(e.price), isPoints: true };
      }
    }
    return arr;
  }
  const list = (olShopData && olShopData.REAL_SHOP && olShopData.REAL_SHOP[cat]) || [];
  list.forEach((e, i) => {
    if (i >= arr.length || !e) return;
    const data = olShopLookup(cat, e.name);
    if (!data) return;
    arr[i] = { type: olShopItemType(cat, data), shopType: cat, name: e.name, data, price: Number(e.price) };
  });
  return arr;
}

// POINTS (earned from ads, kept on the server): balance shown on the shop screen
let olShopPoints = null;
function olShopPts(n) { return (Number(n) || 0).toLocaleString() + " pts"; }
function olShopPriceText(entry) { return entry && entry.isPoints ? olShopPts(entry.price) : olShopPeso(entry.price); }
function olShopUpdateBar() {
  const el = document.getElementById("olShopBarText");
  if (!el) return;
  el.textContent = olShopCategory === "points"
    ? "POINTS: " + (olShopPoints === null ? "..." : olShopPoints.toLocaleString())
    : "REAL MONEY (\u20B1 PHP)";
}
async function olShopLoadPoints() {
  try {
    const r = await olApiPost("/api/shop/points", {});
    if (r.status === 200 && typeof r.json.points === "number") { olShopPoints = r.json.points; olShopUpdateBar(); }
  } catch (e) {}
}

function olShopLabel(entry) {
  const n = entry && entry.data && typeof entry.data.name === "string" ? entry.data.name.trim() : "";
  return n || (entry && entry.name) || "";
}

function olShopToast(text) {
  const el = document.getElementById("olShopToast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(olShopToast._t);
  olShopToast._t = setTimeout(() => el.classList.remove("visible"), 3200);
}

function olShopInstallUi() {
  if (document.getElementById("olShopScreen")) return;
  const st = document.createElement("style");
  st.textContent = `
    #olShopPopup { position:fixed; inset:0; background:rgba(0,0,0,0.65); display:none; align-items:center; justify-content:center;
      z-index:10650; font-family:'Courier New',Courier,monospace; }
    .olPayCard { width:min(90vw,340px); max-height:90vh; overflow:auto; box-sizing:border-box; padding:16px; text-align:center; color:#dff;
      border:2px solid rgba(255,210,110,0.55); border-radius:14px; background:linear-gradient(180deg, rgba(24,20,10,0.96), rgba(8,8,6,0.97));
      box-shadow:0 0 20px rgba(255,190,70,0.3); }
    .olPayTitle { font-size:15px; font-weight:900; letter-spacing:2px; text-transform:uppercase; color:#ffe08a; }
    .olPaySub { margin-top:6px; font-size:11px; letter-spacing:1px; color:#cbb77a; line-height:1.5; }
    .olPayBtn { display:block; width:100%; box-sizing:border-box; margin-top:9px; padding:11px 8px; border-radius:9px; cursor:pointer;
      font:900 12px 'Courier New',monospace; letter-spacing:1.5px; text-transform:uppercase; touch-action:manipulation;
      border:2px solid rgba(255,210,110,0.55); background:rgba(255,200,80,0.12); color:#ffe9a8; }
    .olPayBtn.green { border-color:rgba(100,255,150,0.55); background:rgba(80,255,140,0.12); color:#7f9; }
    .olPayBtn.gray { border-color:rgba(200,200,210,0.4); background:rgba(255,255,255,0.06); color:#ccd; }
    .olPayBtn[disabled] { opacity:0.5; }
    .olPayBox { margin-top:10px; padding:8px; border-radius:8px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,210,110,0.3);
      font-size:12px; line-height:1.6; color:#ffe9a8; word-break:break-all; }
    .olPayBox b { color:#fff; font-size:14px; letter-spacing:1px; }
    .olPayInput { display:block; width:100%; box-sizing:border-box; margin-top:8px; padding:10px 8px; text-align:center; font:700 14px 'Courier New',monospace;
      color:#fff; background:rgba(0,0,0,0.55); border:2px solid rgba(255,210,110,0.45); border-radius:8px; outline:none; }
    .olPayErr { min-height:14px; margin-top:6px; font-size:11px; color:#f77; }
  `;
  document.head.appendChild(st);

  const screen = document.createElement("div");
  screen.id = "olShopScreen";
  screen.style.cssText = "position:fixed;inset:0;background:url('image/playerprofile.png') center center / cover no-repeat rgba(0,0,0,0.55);display:none;flex-direction:column;z-index:9800;overflow:hidden;";
  screen.innerHTML =
    '<div class="invTitle">Shop</div>' +
    '<div class="invGoldBar"><span id="olShopBarText" class="invGoldAmountText" style="color:#ffe08a;">REAL MONEY (\u20B1 PHP)</span></div>' +
    '<div class="shopBody">' +
      '<div class="shopCatColumn">' +
        ["weapon", "armor", "stone", "accessory", "points"].map((c) =>
          '<button class="hubBtn shopCatBtn olShopCatBtn" data-shop-cat="' + c + '"><span class="hubBtnRing"><span class="hubBtnDot"></span></span>' +
          c.charAt(0).toUpperCase() + c.slice(1) + '</button>').join("") +
        '<button class="hubBtn" id="olShopEarnBtn" style="display:none;"><span class="hubBtnRing"><span class="hubBtnDot"></span></span>Earn Points</button>' +
        '<button class="hubBtn olShopOrdersBtn" id="olShopOrdersBtn"><span class="hubBtnRing"><span class="hubBtnDot"></span></span>Orders</button>' +
      '</div>' +
      '<div class="shopGridColumn">' +
        '<div id="olShopGridBox" class="shopGridBox"><div id="olShopGridInner" class="shopGridInner"></div></div>' +
        '<div class="invGridPager">' +
          '<button id="olShopPrev" class="invGridArrowBtn" title="Previous page">\u25C0</button>' +
          '<span id="olShopPageLabel" class="invGridPageLabel">1/4</span>' +
          '<button id="olShopNext" class="invGridArrowBtn" title="Next page">\u25B6</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="olShopToast" class="hubToast"></div>' +
    '<button id="olShopBack" class="menuBackBtn shopBackBtn">Back</button>';
  document.body.appendChild(screen);

  const popup = document.createElement("div");
  popup.id = "olShopPopup";
  document.body.appendChild(popup);

  const inner = screen.querySelector("#olShopGridInner");
  for (let i = 0; i < OL_SHOP_PAGE_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "shopGridSlot";
    slot.dataset.gridIndex = String(i);
    inner.appendChild(slot);
  }
  inner.addEventListener("click", (e) => {
    const slot = e.target.closest(".shopGridSlot");
    if (!slot || !slot.classList.contains("filled")) return;
    const entry = olShopCatalog(olShopCategory)[Number(slot.dataset.gridIndex)];
    if (entry) olShopOpenItem(entry);
  });
  screen.querySelectorAll(".olShopCatBtn").forEach((b) => b.addEventListener("click", () => olShopSelectCategory(b.dataset.shopCat)));
  screen.querySelector("#olShopPrev").addEventListener("click", () => olShopGoPage(-1));
  screen.querySelector("#olShopNext").addEventListener("click", () => olShopGoPage(1));
  screen.querySelector("#olShopBack").addEventListener("click", olShopClose);
  screen.querySelector("#olShopOrdersBtn").addEventListener("click", olShopShowOrders);
  screen.querySelector("#olShopEarnBtn").addEventListener("click", olShopEarnPoints);
}

// EARN POINTS (online): play a rewarded ad. The points are NOT given by this file - AdMob tells
// the SERVER the ad was finished (server-side verification, server.js /api/admob/ssv) and the
// server adds 5 points and sends "pointsUpdate", so nobody can fake it from the browser.
async function olShopEarnPoints() {
  if (typeof MWAds === "undefined") { olShopToast("Ads only work in the Metal War app."); return; }
  let uid = "";
  try {
    const s = await window.supabaseClient.auth.getSession();
    uid = (s && s.data && s.data.session && s.data.session.user && s.data.session.user.id) || "";
  } catch (e) {}
  if (!uid) { olShopToast("Please log in again."); return; }
  MWAds.show(uid, (status) => {
    if (status === "rewarded") {
      olShopToast("Ad finished! Adding 5 points...");
      // Test mode only: the server accepts this when AD_TEST_MODE=1 is set on Render; otherwise it
      // answers 403 and the points come from AdMob's signed message instead.
      olApiPost("/api/shop/adtest", {}).then((r) => {
        if (r && r.status === 200 && r.json && typeof r.json.points === "number") { olShopPoints = r.json.points; olShopUpdateBar(); }
      }).catch(() => {});
      // the server pushes the new balance by itself; ask again in case the push was missed
      setTimeout(olShopLoadPoints, 4000);
      setTimeout(olShopLoadPoints, 10000);
    } else olShopToast(MWAds.message(status));
  });
}

function olShopPaint() {
  const cat = olShopCatalog(olShopCategory);
  document.querySelectorAll("#olShopGridInner .shopGridSlot").forEach((slot, i) => {
    const entry = cat[olShopPage * OL_SHOP_PAGE_SIZE + i];
    slot.dataset.gridIndex = String(olShopPage * OL_SHOP_PAGE_SIZE + i);
    slot.innerHTML = "";
    if (entry) {
      const img = document.createElement("img");
      img.className = "shopGridSlotImg";
      img.src = entry.data.image || ("image/" + entry.name + ".png");
      slot.appendChild(img);
      const price = document.createElement("span");
      price.className = "shopSlotPrice";
      price.textContent = olShopPriceText(entry);
      slot.appendChild(price);
      slot.classList.add("filled");
      slot.dataset.type = entry.type;
      slot.title = olShopLabel(entry);
    } else {
      slot.classList.remove("filled");
      delete slot.dataset.type;
      slot.title = "";
    }
  });
  document.getElementById("olShopPageLabel").textContent = (olShopPage + 1) + "/" + OL_SHOP_PAGE_COUNT;
  document.getElementById("olShopPrev").disabled = olShopPage === 0;
  document.getElementById("olShopNext").disabled = olShopPage === OL_SHOP_PAGE_COUNT - 1;
}

function olShopGoPage(d) {
  const n = olShopPage + d;
  if (n < 0 || n >= OL_SHOP_PAGE_COUNT) return;
  olShopPage = n;
  olShopPaint();
}

function olShopSelectCategory(cat) {
  olShopCategory = cat;
  olShopPage = 0;
  document.querySelectorAll(".olShopCatBtn").forEach((b) => b.classList.toggle("active", b.dataset.shopCat === cat));
  olShopUpdateBar();
  if (cat === "points") olShopLoadPoints();
  const earn = document.getElementById("olShopEarnBtn");
  if (earn) earn.style.display = cat === "points" ? "" : "none";
  olShopPaint();
}

function olShopOpen() {
  olShopInstallUi();
  if (!olShopData) { netToast("Shop is not ready yet, try again in a moment"); return; }
  document.getElementById("olShopScreen").style.display = "flex";
  olShopSelectCategory(olShopCategory);
  olShopClaim();   // anything already paid for gets delivered when the shop opens
}

function olShopClose() {
  const s = document.getElementById("olShopScreen");
  if (s) s.style.display = "none";
  olShopClosePopup();
}

function olShopClosePopup() {
  const p = document.getElementById("olShopPopup");
  if (p) { p.style.display = "none"; p.innerHTML = ""; }
  olShopSelected = null;
}

function olShopShowPopup(html) {
  const p = document.getElementById("olShopPopup");
  p.innerHTML = '<div class="olPayCard">' + html + '</div>';
  p.style.display = "flex";
  return p;
}

function olShopEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---- stats list for the item card (same rows the inventory stats popup shows) ----
const OL_SHOP_EXTRA_STATS = [
  ["magicalAttack", "Magical Attack"],
  ["magicalDefense", "Magical Defense"],
  ["criticalChance", "Critical Chance", (v) => Math.round(v * 1000) / 10 + "%"],
  ["criticalDamage", "Critical Damage", (v) => Math.round(v * 1000) / 10 + "%"],
  ["mana", "Mana"],
  ["hpRegen", "HP Regen", (v) => Math.round(v * 1000) / 10 + "%"],
  ["manaRegen", "Mana Regen", (v) => Math.round(v * 1000) / 10 + "%"],
  ["movementSpeed", "Movement Speed"],
  ["vit", "VIT"],
  ["dex", "DEX"],
  ["int", "INT"],
  ["pow", "POW"]
];

function olShopStatRows(entry) {
  const d = (entry && entry.data) || {};
  const type = String((entry && entry.type) || d.category || "");
  const rows = [];
  const num = (v) => typeof v === "number" && isFinite(v);
  if (type) rows.push(["Type", type.charAt(0).toUpperCase() + type.slice(1)]);
  if (typeof d.requiredType === "string" && d.requiredType) {
    rows.push(["Required Type", d.requiredType.charAt(0).toUpperCase() + d.requiredType.slice(1)]);
  }
  if (d.requiredStat) {
    let st = "", amt = NaN;
    if (typeof d.requiredStat === "string") {
      const m = d.requiredStat.trim().match(/^([a-z]+)\s*=\s*(\d+(?:\.\d+)?)$/i);
      if (m) { st = m[1]; amt = Number(m[2]); }
    } else if (typeof d.requiredStat === "object") {
      const k = Object.keys(d.requiredStat)[0];
      if (k) { st = k; amt = Number(d.requiredStat[k]); }
    }
    if (st && amt > 0) rows.push(["Required Stat", st.toUpperCase() + " " + amt]);
  }
  if (type === "weapon") {
    rows.push(["Physical Damage", num(d.physicalDamage) ? d.physicalDamage : "\u2014"]);
    if (num(d.physicalDefense) && d.physicalDefense !== 0) rows.push(["Physical Defense", "+" + d.physicalDefense]);
    if (num(d.health)) rows.push(["Health", "+" + d.health]);
    OL_SHOP_EXTRA_STATS.forEach((r) => { if (num(d[r[0]]) && d[r[0]] !== 0) rows.push([r[1], "+" + (r[2] ? r[2](d[r[0]]) : d[r[0]])]); });
  } else if (type === "armor" || type === "ring" || type === "accessory") {
    let pd = d.physicalDefense;
    if (typeof pd === "string") { const ref = olShopLookup("armor", pd); pd = ref && ref.physicalDefense; }   // armor can point at another armor by name
    if (!num(pd)) pd = d.defense;
    if (num(pd)) rows.push(["Physical Defense", (type === "armor" ? "" : "+") + pd]);
    else if (type === "armor") rows.push(["Physical Defense", "\u2014"]);
    if (num(d.health)) rows.push(["Health", "+" + d.health]);
    if (num(d.block) && d.block > 0) rows.push(["Block Chance", d.block + "%"]);
    OL_SHOP_EXTRA_STATS.forEach((r) => { if (num(d[r[0]]) && d[r[0]] !== 0) rows.push([r[1], "+" + (r[2] ? r[2](d[r[0]]) : d[r[0]])]); });
  }
  return rows.map((r) =>
    '<div class="charStatsRow"><span class="charStatsLabel">' + olShopEsc(r[0]) + '</span><span class="charStatsValue">' + olShopEsc(r[1]) + '</span></div>').join("");
}

// ---- step 1: item card (same look as the offline Buy popup) ----
function olShopOpenItem(entry) {
  olShopSelected = entry;
  const p = olShopShowPopup(
    '<div class="charStatsName">' + olShopEsc(olShopLabel(entry)) + '</div>' +
    '<img class="shopItemImg" src="' + olShopEsc(entry.data.image || ("image/" + entry.name + ".png")) + '" />' +
    '<div class="olPaySub">Price: <b style="color:#fff;font-size:15px;">' + olShopPriceText(entry) + '</b></div>' +
    '<div style="margin-top:8px;">' + olShopStatRows(entry) + '</div>' +
    '<div class="olPaySub">' + olShopEsc((entry.data && entry.data.description) || "") + '</div>' +
    '<button class="olPayBtn green" id="olBuyBtn">Buy</button>' +
    '<button class="olPayBtn gray" id="olCancelBtn">Cancel</button>');
  p.querySelector("#olBuyBtn").addEventListener("click", () => (entry.isPoints ? olShopConfirmPoints(entry) : olShopChooseMethod(entry)));
  p.querySelector("#olCancelBtn").addEventListener("click", olShopClosePopup);
}

// ---- POINTS item: confirm, then the server takes the points and delivers the item ----
function olShopConfirmPoints(entry) {
  const have = olShopPoints === null ? "..." : olShopPts(olShopPoints);
  const p = olShopShowPopup(
    '<div class="olPayTitle">Buy with points</div>' +
    '<div class="olPaySub">' + olShopEsc(olShopLabel(entry)) + '</div>' +
    '<div class="olPayBox">Cost: <b>' + olShopPts(entry.price) + '</b><br>You have: <b>' + have + '</b></div>' +
    '<div class="olPayErr" id="olPayErr"></div>' +
    '<button class="olPayBtn green" id="olPtsYes">Confirm</button>' +
    '<button class="olPayBtn gray" id="olPtsBack">Back</button>');
  p.querySelector("#olPtsBack").addEventListener("click", () => olShopOpenItem(entry));
  p.querySelector("#olPtsYes").addEventListener("click", async () => {
    const btn = p.querySelector("#olPtsYes");
    const err = p.querySelector("#olPayErr");
    btn.disabled = true; err.textContent = "Buying...";
    try {
      const r = await olApiPost("/api/shop/buypoints", { type: entry.shopType, name: entry.name });
      if (r.status === 200 && r.json.ok) {
        olShopPoints = r.json.points; olShopUpdateBar();
        olShopClosePopup();
        olShopToast("Bought " + olShopLabel(entry) + " \u2014 it is being delivered.");
        olShopClaim();
        return;
      }
      if (r.json && typeof r.json.points === "number") { olShopPoints = r.json.points; olShopUpdateBar(); }
      err.textContent = olShopErrText(r);
      btn.disabled = false;
    } catch (e) { err.textContent = "No connection. Please try again."; btn.disabled = false; }
  });
}

// ---- step 2: how to pay ----
function olShopChooseMethod(entry) {
  const info = (olShopData && olShopData.PAYMENT_INFO) || {};
  const bank = info.bank || {};
  const hasBank = !!(bank.accountNumber && String(bank.accountNumber).trim());
  const p = olShopShowPopup(
    '<div class="olPayTitle">Pay ' + olShopPeso(entry.price) + '</div>' +
    '<div class="olPaySub">' + olShopEsc(olShopLabel(entry)) + '</div>' +
    '<button class="olPayBtn green" id="olPayAuto">GCash / Maya / GrabPay / Card<br><span style="font-weight:400;letter-spacing:0;font-size:10px;">automatic \u2014 item arrives by itself<br>works for international cards too</span></button>' +
    '<button class="olPayBtn" id="olPayGcash">Send via GCash (manual)</button>' +
    (hasBank ? '<button class="olPayBtn" id="olPayBank">Bank transfer (manual)</button>' : '') +
    '<div class="olPayErr" id="olPayErr"></div>' +
    '<button class="olPayBtn gray" id="olPayBack">Back</button>');
  p.querySelector("#olPayAuto").addEventListener("click", () => olShopPayAuto(entry));
  p.querySelector("#olPayGcash").addEventListener("click", () => olShopManualForm(entry, "gcash"));
  const bb = p.querySelector("#olPayBank");
  if (bb) bb.addEventListener("click", () => olShopManualForm(entry, "bank"));
  p.querySelector("#olPayBack").addEventListener("click", () => olShopOpenItem(entry));
}

const OL_SHOP_ERRORS = {
  NOT_ENOUGH_POINTS: "You do not have enough points. Watch ads to earn more.",
  AUTO_PAYMENT_OFF: "Automatic payment is not available yet. Please use the manual GCash option.",
  PAYMENT_PROVIDER_ERROR: "The payment service did not respond. Please try again.",
  TOO_MANY_OPEN_ORDERS: "You have too many unfinished orders. Finish or wait for them first.",
  BAD_REFERENCE: "Enter the reference number from your payment receipt (letters/numbers, at least 8).",
  BAD_SENDER: "Enter the name or number you paid from.",
  REFERENCE_USED: "That reference number was already submitted.",
  BAD_ITEM: "That item is not for sale.",
  UNAUTHORIZED: "Please log in again.",
  SAVES_DISABLED: "The server is not ready for payments yet."
};
function olShopErrText(r) {
  const code = r && r.json && r.json.error;
  return OL_SHOP_ERRORS[code] || ("Something went wrong (" + (code || (r && r.status) || "network") + "). Please try again.");
}

async function olShopPayAuto(entry) {
  const btn = document.getElementById("olPayAuto");
  const err = document.getElementById("olPayErr");
  if (btn) btn.disabled = true;
  if (err) err.textContent = "Opening payment page...";
  try {
    const r = await olApiPost("/api/shop/paymongo", {
      type: entry.shopType, name: entry.name,
      returnUrl: location.href.split("#")[0]
    });
    if (r.status !== 200 || !r.json.checkoutUrl) {
      if (err) err.textContent = olShopErrText(r);
      if (btn) btn.disabled = false;
      return;
    }
    try { localStorage.setItem(OL_SHOP_PENDING_KEY, String(Date.now())); } catch (e) {}
    try { if (typeof olSaveNowOnLeave === "function") olSaveNowOnLeave(); } catch (e) {}   // keep progress before leaving the page
    location.href = r.json.checkoutUrl;
  } catch (e) {
    if (err) err.textContent = "No connection. Please try again.";
    if (btn) btn.disabled = false;
  }
}

function olShopManualForm(entry, channel) {
  const info = (olShopData && olShopData.PAYMENT_INFO) || {};
  const dest = channel === "bank" ? (info.bank || {}) : (info.gcash || {});
  const lines = channel === "bank"
    ? 'Bank: <b>' + olShopEsc(dest.bankName || "") + '</b><br>Account name: <b>' + olShopEsc(dest.accountName || "") + '</b><br>Account no.: <b>' + olShopEsc(dest.accountNumber || "") + '</b>'
    : 'GCash number: <b>' + olShopEsc(dest.number || "") + '</b><br>Account name: <b>' + olShopEsc(dest.name || "") + '</b>';
  const p = olShopShowPopup(
    '<div class="olPayTitle">' + (channel === "bank" ? "Bank transfer" : "Send via GCash") + '</div>' +
    '<div class="olPayBox">Send exactly <b>' + olShopPeso(entry.price) + '</b><br>' + lines + '</div>' +
    '<div class="olPayBox" style="margin-top:8px;border-color:#f5c542;">' +
      '<b style="color:#f5c542;">IMPORTANT</b><br>' +
      'Message the admin on Facebook and send a <b>screenshot of your payment</b> (do it right after you pay) so your order can be approved faster.<br>' +
      '<a href="https://www.facebook.com/share/1DpM4dMPTK/" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;padding:6px 12px;border-radius:6px;background:#1877f2;color:#fff;font-weight:bold;text-decoration:none;">Message admin on Facebook</a>' +
    '</div>' +
    '<div class="olPaySub">After paying, type the reference number from your receipt. The owner checks it and your item is delivered after approval.</div>' +
    '<input class="olPayInput" id="olPayRef" maxlength="30" placeholder="Reference no." autocomplete="off" />' +
    '<input class="olPayInput" id="olPaySender" maxlength="40" placeholder="Your GCash number / name" autocomplete="off" />' +
    '<div class="olPayErr" id="olPayErr"></div>' +
    '<button class="olPayBtn green" id="olPaySubmit">I paid \u2014 submit</button>' +
    '<button class="olPayBtn gray" id="olPayBack">Back</button>');
  p.querySelector("#olPayBack").addEventListener("click", () => olShopChooseMethod(entry));
  p.querySelector("#olPaySubmit").addEventListener("click", async () => {
    const ref = p.querySelector("#olPayRef").value.trim();
    const sender = p.querySelector("#olPaySender").value.trim();
    const err = p.querySelector("#olPayErr");
    const btn = p.querySelector("#olPaySubmit");
    if (!ref || !sender) { err.textContent = "Fill in both boxes."; return; }
    btn.disabled = true; err.textContent = "Sending...";
    try {
      const r = await olApiPost("/api/shop/manual", { type: entry.shopType, name: entry.name, channel, ref, sender });
      if (r.status !== 200 || !r.json.ok) { err.textContent = olShopErrText(r); btn.disabled = false; return; }
      olShopClosePopup();
      olShopToast("Payment submitted. Your item arrives after the owner approves it.");
      olShopStartWatching();
    } catch (e) { err.textContent = "No connection. Please try again."; btn.disabled = false; }
  });
}

// ---- my orders list ----
async function olShopShowOrders() {
  const p = olShopShowPopup('<div class="olPayTitle">My orders</div><div class="olPaySub">Loading...</div><button class="olPayBtn gray" id="olOrdersClose">Close</button>');
  p.querySelector("#olOrdersClose").addEventListener("click", olShopClosePopup);
  try {
    const r = await olApiPost("/api/shop/orders", {});
    if (r.status !== 200) { p.querySelector(".olPaySub").textContent = olShopErrText(r); return; }
    const names = { awaiting_payment: "waiting for payment", review: "waiting for owner approval", paid: "paid \u2014 delivering", claimed: "paid \u2014 delivering", delivered: "delivered", rejected: "rejected", failed: "not completed", pending: "not completed" };
    const rows = (r.json.orders || []).map((o) =>
      '<div class="olPayBox" style="text-align:left;">' + olShopEsc(o.name) + ' \u2014 <b>' + (o.method === "points" ? olShopPts(o.price) : olShopPeso(o.price)) + '</b><br>' + olShopEsc(names[o.status] || o.status) + '</div>').join("");
    p.querySelector(".olPaySub").outerHTML = rows || '<div class="olPaySub">No orders yet.</div>';
    olShopClaim();
  } catch (e) { p.querySelector(".olPaySub").textContent = "No connection."; }
}

// ---- delivery: put paid items in the inventory, save, confirm ----
async function olShopClaim() {
  if (olShopClaimBusy) return;
  if (typeof addItemToInventory !== "function") return;
  // The inventory is only loaded once the online profile is running; wait for it.
  if (!onlineProfileActive || !netIsOnline()) {
    if (olShopClaimTries++ < 20) setTimeout(olShopClaim, 3000);
    return;
  }
  olShopClaimTries = 0;
  olShopClaimBusy = true;
  try {
    const r = await olApiPost("/api/shop/claim", {});
    if (r.status !== 200 || !Array.isArray(r.json.items) || !r.json.items.length) return;
    const done = [];
    let full = false;
    for (const it of r.json.items) {
      const data = olShopLookup(it.type, it.name);
      if (!data) continue;   // unknown item: leave it, the server offers it again later
      const itemType = olShopItemType(it.type, data);
      if (addItemToInventory(itemType, it.name, data, 1)) {
        done.push(it.orderId);
        olShopToast("Delivered: " + (data.name || it.name));
        try { netToast("Shop delivery: " + (data.name || it.name)); } catch (e) {}
      } else { full = true; }
    }
    if (full) olShopToast("Inventory full \u2014 free a slot, the rest of your items will arrive soon.");
    if (done.length) {
      try { await saveOnlinePlayerData(); } catch (e) {}
      await olApiPost("/api/shop/ack", { orderIds: done });
      try { localStorage.removeItem(OL_SHOP_PENDING_KEY); } catch (e) {}
    }
    if (full) setTimeout(olShopClaim, 130000);   // the server offers unconfirmed items again after 2 minutes
  } catch (e) {
    /* network hiccup: the next poll tries again */
  } finally {
    olShopClaimBusy = false;
  }
}

// While a payment is on its way: ask the server every 10 s (it checks PayMongo itself).
function olShopStartWatching() {
  olShopWatching = true;
  if (olShopPollTimer) return;
  let ticks = 0;
  olShopPollTimer = setInterval(async () => {
    if (!netIsOnline() || ++ticks > 90) {   // ~15 minutes, then stop (the server also tells us when something is paid)
      clearInterval(olShopPollTimer); olShopPollTimer = null; olShopWatching = false; return;
    }
    try { await olApiPost("/api/shop/orders", {}); } catch (e) {}
    olShopClaim();
  }, 10000);
}

// ---- the SHOP button itself ----
function olUpdateShopButton() {
  // The SHOP button now lives inside the OPTIONS popup (first button, above UPGRADE)
  // instead of the top-right HUD bar. Online mode only.
  const body = document.querySelector("#gameOptionsPopup .gameOptionsBody");
  if (!body) return;
  // remove the old top-right button if an earlier build left one behind
  const oldTop = document.querySelector("#hudTopRight #onlineShopBtn");
  if (oldTop) oldTop.remove();
  let btn = document.getElementById("onlineShopBtn");
  if (!btn) {
    olShopInstallUi();
    btn = document.createElement("button");
    btn.id = "onlineShopBtn";
    btn.className = "gameOptionsBtn";
    btn.title = "Shop";
    btn.textContent = "SHOP";
    btn.style.display = "none";
    btn.addEventListener("click", () => {
      // close the OPTIONS popup first (restores the HUD), then open the shop
      const closeBtn = document.getElementById("gameOptionsCloseBtn");
      if (closeBtn) closeBtn.click();
      olShopOpen();
    });
    body.insertBefore(btn, body.firstChild);
  }
  const on = netIsOnline();
  btn.style.display = on ? "" : "none";
  if (on) {
    // came back from the PayMongo page, or just connected: collect whatever is paid
    let pending = false;
    try { pending = !!localStorage.getItem(OL_SHOP_PENDING_KEY); } catch (e) {}
    if (pending) olShopStartWatching();
    olShopClaim();
  } else {
    olShopClose();
  }
}

// Shows/hides the whole PARTY button — only meaningful in online mode.
function netUpdatePartyButtonVisibility() {
  if (partyPanelBtn) partyPanelBtn.style.display = netIsOnline() ? "" : "none";
  if (!netIsOnline()) netSetPartyPanelOpen(false);
  olUpdateShopButton();   // SHOP button (top-right) follows online/offline too
  olWarZoneUpdateVisibility();   // WAR ZONE button follows online/offline too
}

if (partyPanelBtn) {
  partyPanelBtn.addEventListener("click", () => netSetPartyPanelOpen(!netPartyPanelOpen));
}
if (partyPanelLeaveBtn) {
  partyPanelLeaveBtn.addEventListener("click", () => {
    netSend({ type: "partyLeave" });
    netSetPartyPanelOpen(false);
  });
}

// =============================================================================
// TOP HUD (online): PARTY under OPTIONS  +  WAR ZONE button  +  BOSS EVENT
// =============================================================================
// * PARTY button now sits right BELOW the OPTIONS button (top-right).
// * WAR ZONE button sits at the top middle (where PARTY used to be). Tapping it
//   slides a window down with CLAN WAR and BOSS EVENT.
// * BOSS EVENT: level 20+ only, Monday / Wednesday / Friday, 8 PM - 10 PM
//   (Philippine time). The server enforces it too (server.js, BOSS_EVENT).
//   At 10 PM the server sends everyone back to their last position
//   ("bossMove" with ended:true). Dying inside respawns after the normal
//   10 seconds on the same spot (netOnDeath / netRespawn above).
// Hard-coded here (keep in sync with BOSS_EVENT in server.js):
const OL_BOSS = {
  KEY: "BOSSEVENT",
  MIN_LEVEL: 1,
  DAYS: [1, 3, 5],       // Monday, Wednesday, Friday
  START_HOUR: 20,        // 8 PM
  END_HOUR: 22,          // 10 PM
  TZ_OFFSET_HOURS: 8,    // Philippine time
  CLOSED_TEXT: "BOSS EVENT is only available on Monday, Wednesday and Friday, at 8PM only."
};

(function olInstallTopHudStyle() {
  if (document.getElementById("olTopHudStyle")) return;
  const st = document.createElement("style");
  st.id = "olTopHudStyle";
  st.textContent = `
    #partyPanelBtn { left:auto !important; right:10px; transform:none !important; top:52px; }
    #partyPanelBtn:active { transform:scale(0.95) !important; }
    #partyPanelDrop { left:auto !important; right:10px; transform:none !important; top:76px; }
    #warZoneBtn { position:fixed; top:calc(6px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:895;
      font-family:'Courier New',Courier,monospace; font-weight:900; letter-spacing:2px; font-size:10px; padding:5px 14px; cursor:pointer;
      touch-action:manipulation; background:linear-gradient(160deg, rgba(60,18,18,0.94), rgba(30,6,6,0.97)); border:1px solid rgba(255,110,90,0.6);
      border-radius:5px; color:#ffe9e4; text-shadow:0 0 6px rgba(255,110,90,0.7); display:none; }
    #warZoneBtn:active { transform:translateX(-50%) scale(0.95); }
    #warZoneDrop { position:fixed; top:calc(30px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:894;
      width:min(60vw,190px); max-height:0; overflow:hidden; opacity:0; box-sizing:border-box; pointer-events:none;
      background:linear-gradient(160deg, rgba(60,18,18,0.94), rgba(30,6,6,0.97)); border:1px solid rgba(255,110,90,0.4); border-top:none;
      border-radius:0 0 8px 8px; transition:max-height 0.22s ease, opacity 0.18s ease; }
    #warZoneDrop.open { max-height:200px; opacity:1; pointer-events:auto; }
    #warZoneDrop .wzInner { display:flex; flex-direction:column; gap:6px; padding:10px; }
    .wzBtn { font-family:'Courier New',Courier,monospace; font-weight:900; letter-spacing:2px; font-size:11px; padding:8px 6px; cursor:pointer;
      touch-action:manipulation; background:rgba(255,255,255,0.06); border:1px solid rgba(255,110,90,0.55); border-radius:5px; color:#ffe9e4; }
    .wzBtn:active { transform:scale(0.96); }
    #olBossOverlay { position:fixed; inset:0; z-index:2600; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); }
    #olBossOverlay.open { display:flex; }
    #olBossBox { width:min(86vw,340px); box-sizing:border-box; padding:16px 16px 14px; text-align:center; border-radius:8px;
      font-family:'Courier New',Courier,monospace; color:#ffe9e4; border:1px solid rgba(255,110,90,0.6);
      background:linear-gradient(160deg, rgba(60,18,18,0.97), rgba(24,4,4,0.98)); }
    #olBossTitle { font-weight:900; letter-spacing:3px; font-size:14px; margin-bottom:10px; text-shadow:0 0 6px rgba(255,110,90,0.7); }
    #olBossText { white-space:pre-line; font-size:12px; line-height:1.5; margin-bottom:14px; }
    #olBossBtns { display:flex; gap:8px; justify-content:center; }
    #olBossBtns .wzBtn { flex:1; }
    #olBossTimer { position:fixed; top:calc(34px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:893; display:none;
      font-family:'Courier New',Courier,monospace; font-weight:900; font-size:11px; letter-spacing:1px; color:#ffd9d2; padding:3px 10px; border-radius:4px;
      background:rgba(40,8,8,0.8); border:1px solid rgba(255,110,90,0.5); pointer-events:none; }
  `;
  document.head.appendChild(st);
})();

// ---- WAR ZONE button + sliding window ----
const warZoneBtn = document.createElement("button");
warZoneBtn.id = "warZoneBtn";
warZoneBtn.textContent = "WAR ZONE";
document.body.appendChild(warZoneBtn);

const warZoneDrop = document.createElement("div");
warZoneDrop.id = "warZoneDrop";
warZoneDrop.innerHTML = '<div class="wzInner"><button class="wzBtn" id="wzClanWarBtn">CLAN WAR</button><button class="wzBtn" id="wzBossBtn">BOSS EVENT</button><button class="wzBtn" id="wzWorldBtn">WORLD MAP</button></div>';
document.body.appendChild(warZoneDrop);

let olWarZoneOpen = false;
// The menu never offers the map you are standing in: World Map -> CLAN WAR + BOSS EVENT,
// Clan War map -> BOSS EVENT + WORLD MAP, Boss Event map -> CLAN WAR + WORLD MAP.
function olWzRefreshButtons() {
  const cur = (typeof netIsOnline === "function" && netIsOnline()) ? netMapByLevel[netOnlineLevel] : "";
  const inCw = cur === OL_CW.KEY, inBoss = cur === OL_BOSS.KEY;
  document.getElementById("wzClanWarBtn").style.display = inCw ? "none" : "";
  document.getElementById("wzBossBtn").style.display = inBoss ? "none" : "";
  document.getElementById("wzWorldBtn").style.display = (inCw || inBoss) ? "" : "none";
}
setInterval(olWzRefreshButtons, 300);
function olSetWarZoneOpen(open) {
  if (open) olWzRefreshButtons();
  olWarZoneOpen = open;
  warZoneDrop.classList.toggle("open", open);
}
function olWarZoneUpdateVisibility() {
  const on = netIsOnline();
  warZoneBtn.style.display = on ? "block" : "none";
  if (!on) olSetWarZoneOpen(false);
}
warZoneBtn.addEventListener("click", () => olSetWarZoneOpen(!olWarZoneOpen));
document.getElementById("wzClanWarBtn").addEventListener("click", () => {
  olSetWarZoneOpen(false);
  olCwClick();
});
document.getElementById("wzWorldBtn").addEventListener("click", () => {
  olSetWarZoneOpen(false);
  if (netIsOnline()) netSend({ type: "worldEnter" });   // the server returns me to my last World Map spot
});
document.getElementById("wzBossBtn").addEventListener("click", () => {
  olSetWarZoneOpen(false);
  olBossClick();
});

// ---- PARTY button follows the OPTIONS button (below it, same right edge) ----
function olPlaceTopHud() {
  const ob = document.getElementById("optionsGameBtn");
  if (!ob || !partyPanelBtn || ob.offsetParent === null) return;
  const r = ob.getBoundingClientRect();
  const top = Math.round(r.bottom + 6);
  const right = Math.max(4, Math.round(window.innerWidth - r.right));
  partyPanelBtn.style.top = top + "px";
  partyPanelBtn.style.right = right + "px";
  if (partyPanelDrop) {
    partyPanelDrop.style.top = (top + (partyPanelBtn.offsetHeight || 24)) + "px";
    partyPanelDrop.style.right = right + "px";
  }
}
window.addEventListener("resize", olPlaceTopHud);
setInterval(olPlaceTopHud, 700);

// ---- BOSS EVENT: schedule + messages ----
function olBossManilaNow() { return new Date(Date.now() + OL_BOSS.TZ_OFFSET_HOURS * 3600 * 1000); }
function olBossWindowOpen() {
  const d = olBossManilaNow();
  return OL_BOSS.DAYS.includes(d.getUTCDay()) && d.getUTCHours() >= OL_BOSS.START_HOUR && d.getUTCHours() < OL_BOSS.END_HOUR;
}
function olBossMsLeft() {
  const d = olBossManilaNow();
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), OL_BOSS.END_HOUR, 0, 0);
  return end - d.getTime();
}

let olBossOverlay = null;
function olBossEnsureOverlay() {
  if (olBossOverlay) return olBossOverlay;
  olBossOverlay = document.createElement("div");
  olBossOverlay.id = "olBossOverlay";
  olBossOverlay.innerHTML = '<div id="olBossBox"><div id="olBossTitle"></div><div id="olBossText"></div><div id="olBossBtns"></div></div>';
  document.body.appendChild(olBossOverlay);
  return olBossOverlay;
}
// buttons: [{label, onClick}] — defaults to a single OK
function olBossShowMessage(text, title, buttons) {
  const ov = olBossEnsureOverlay();
  document.getElementById("olBossTitle").textContent = title || "BOSS EVENT";
  document.getElementById("olBossText").textContent = text;
  const row = document.getElementById("olBossBtns");
  row.innerHTML = "";
  for (const b of (buttons || [{ label: "OK" }])) {
    const btn = document.createElement("button");
    btn.className = "wzBtn";
    btn.textContent = b.label;
    btn.addEventListener("click", () => {
      ov.classList.remove("open");
      if (b.onClick) b.onClick();
    });
    row.appendChild(btn);
  }
  ov.classList.add("open");
}

function olBossClick() {
  if (!netIsOnline()) return;
  if (netMapByLevel[netOnlineLevel] === OL_BOSS.KEY) { olBossShowMessage("You are already inside the Boss Event map."); return; }
  if (!olBossWindowOpen()) { olBossShowMessage(OL_BOSS.CLOSED_TEXT); return; }
  olBossShowMessage(
    "Only level " + OL_BOSS.MIN_LEVEL + " and above can enter this map.\nThe event ends at 10:00 PM.",
    "BOSS EVENT",
    [
      { label: "ENTER MAP", onClick: () => {
          if ((player.level || 1) < OL_BOSS.MIN_LEVEL) {
            olBossShowMessage("You cannot enter the map. Required level " + OL_BOSS.MIN_LEVEL + " and above.");
            return;
          }
          netSend({ type: "bossEnter" });   // the server checks level + schedule again, then moves me
        } },
      { label: "CANCEL" }
    ]
  );
}

// The server moved me into the arena, or (ended:true) back out at 10 PM.
function olBossApplyMove(msg) {
  const num = netLevelByMap[msg.map];
  if (num === undefined || typeof switchToLevel !== "function") return;
  if (!switchToLevel(num)) return;
  netOnlineLevel = num;
  bots.length = 0;
  otherPlayers.clear();
  playerPos.x = msg.spawnX;
  playerPos.y = msg.spawnY;
  // Died right when the event ended: respawn at the NEW spot, not at the old arena coordinates.
  if (isDead) netDeathPos = { x: msg.spawnX, y: msg.spawnY };
  for (const p of msg.players || []) netAddRemote(p);
  netSetBotHost(!!msg.botHost, msg.bots);
  if (!netIsBotHost && Array.isArray(msg.bots) && msg.bots.length) netApplyBotsSnapshot(msg.bots);
  netApplyDrops(msg.drops);
  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
  netStateTimer = 0;
  netSendState();
  const evName = msg.eventName || "BOSS EVENT";
  if (msg.ended) {
    const t = msg.text || ("The " + evName + " has ended. You were returned to your last position.");
    netToast(t);
    olBossShowMessage(t, evName);
  } else {
    netToast("Entered " + evName);
  }
}


// =============================================================================
// CLAN WAR (online) — CWmap
// =============================================================================
// Players WITH A CLAN enter through WAR ZONE > CLAN WAR, Tue / Thu / Sat / Sun,
// 8 PM - 9 PM (Philippine time). Inside they can hurt each other (not clanmates).
// AUTHENTICATE (top middle) fills a bar for 30 s — dying cancels it. The clan that
// authenticates last wins; everybody else is sent back to their last position and
// a message scrolls across the top of EVERY player's screen on the server. After
// 9 PM the winners stay and the button becomes CLAIM REWARD; the reward goes
// straight into every ONLINE clanmate's inventory, then they leave after 20 s.
// All rules + the reward list are enforced by the server (CLAN_WAR in server.js).
// Hard-coded here (keep in sync with CLAN_WAR in server.js):
const OL_CW = {
  KEY: "CWmap",
  DAYS: [3, 4, 6, 0],    // Tuesday, Thursday, Saturday, Sunday
  START_HOUR: 20,        // 8 PM  (20)   — hours can have decimals: 13.5 = 1:30 PM
  END_HOUR: 21,        // 9 PM  (21)
  TZ_OFFSET_HOURS: 8,    // Philippine time
  // The AUTHENTICATE / CLAIM REWARD pad lying on the map floor (top middle of the map).
  // x, y = its CENTER in map pixels, size = its width/height. Keep in sync with CLAN_WAR.PAD in server.js.
  PAD: { x: 1000, y: 150, size: 110 },
  CLOSED_TEXT: "CLAN WAR is only available on Tuesday, Thursday, Saturday and Sunday, 8PM to 9PM only."
};

(function olCwInstallStyle() {
  const st = document.createElement("style");
  st.id = "olCwStyle";
  st.textContent = `
    #cwAuthBtn { position:fixed; top:calc(34px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:893; display:none;
      pointer-events:none; font-family:'Courier New',Courier,monospace; font-weight:900; letter-spacing:2px; font-size:11px; padding:5px 14px;
      color:#fff3d6; border:1px solid rgba(255,200,90,0.8); border-radius:5px; white-space:nowrap;
      background:rgba(40,24,4,0.85); text-shadow:0 0 6px rgba(255,200,90,0.7); }
    #cwAuthBarWrap { position:fixed; top:calc(66px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:893; display:none;
      width:min(52vw,220px); height:12px; box-sizing:border-box; background:rgba(0,0,0,0.65); border:1px solid rgba(255,255,255,0.45); border-radius:3px; overflow:hidden; pointer-events:none; }
    #cwAuthBar { height:100%; width:0%; background:linear-gradient(180deg,#5dff7a,#1fbf3d); }
    #cwBanner { position:fixed; top:calc(90px + env(safe-area-inset-top, 0px)); left:50%; transform:translateX(-50%); z-index:9100; display:none;
      width:min(72vw,440px); overflow:hidden; white-space:nowrap; pointer-events:none; padding:4px 0; border-radius:4px;
      background:rgba(20,0,0,0.72); border:1px solid rgba(255,200,90,0.6); }
    #cwBannerText { display:inline-block; padding-left:100%; font-family:'Courier New',Courier,monospace; font-weight:900; font-size:13px; letter-spacing:1px;
      color:#ffd86b; text-shadow:0 0 6px rgba(255,170,40,0.8); animation:cwBannerMove 9s linear 2; }
    #cwActionBtn { position:fixed; left:50%; bottom:22%; transform:translateX(-50%); z-index:9001; display:none; cursor:pointer; touch-action:manipulation;
      font-family:'Courier New',Courier,monospace; font-weight:700; font-size:14px; letter-spacing:2px; padding:12px 26px; border:none; color:#bdfff2;
      background:url('image/optionsborder.png') center center / 100% 100% no-repeat, url('image/savehud.png') center center / 100% 100% no-repeat; }
    #cwActionBtn:active { transform:translateX(-50%) scale(0.94); }
    #cwRewardBox { position:fixed; left:50%; bottom:calc(22% + 58px); transform:translateX(-50%); z-index:9000; display:none; box-sizing:border-box;
      padding:10px 12px 12px; border:1px solid rgba(255,200,90,0.85); border-radius:6px; background:rgba(20,14,4,0.94); color:#ffe9b0;
      font-family:'Courier New',Courier,monospace; text-align:center; max-width:94vw; }
    #cwRewardTitle { font-weight:900; font-size:12px; letter-spacing:2px; margin-bottom:6px; }
    #cwRewardGrid { display:grid; grid-template-columns:repeat(4, 46px); grid-template-rows:repeat(4, 46px); gap:4px; justify-content:center; }
    .cwSlot { box-sizing:border-box; width:46px; height:46px; border:1px solid rgba(255,255,255,0.28); border-radius:4px; background:rgba(0,0,0,0.5);
      display:flex; align-items:center; justify-content:center; position:relative; touch-action:manipulation; }
    .cwSlot.has { border-color:rgba(255,200,90,0.9); cursor:pointer; }
    .cwSlot img { max-width:38px; max-height:38px; pointer-events:none; }
    .cwSlot .cwQty { position:absolute; right:2px; bottom:0; font-size:9px; font-weight:900; color:#fff; text-shadow:0 0 3px #000; }
    .cwSlot.sel { border-color:#5dff7a; box-shadow:0 0 8px #5dff7a; }
    #cwRewardShare { margin-top:6px; font-size:10px; font-weight:900; color:#ffd86b; }
    #cwRewardHint { margin-top:6px; font-size:10px; opacity:0.85; }
    #cwRewardClose { position:absolute; top:2px; right:6px; cursor:pointer; font-weight:900; font-size:14px; color:#ffd86b; }
    @keyframes cwBannerMove { from { transform:translateX(0); } to { transform:translateX(-100%); } }
  `;
  document.head.appendChild(st);
})();

const cwAuthBtn = document.createElement("div");   // status label only (the real button is the pad on the map floor)
cwAuthBtn.id = "cwAuthBtn";
document.body.appendChild(cwAuthBtn);
const cwAuthBarWrap = document.createElement("div");
cwAuthBarWrap.id = "cwAuthBarWrap";
cwAuthBarWrap.innerHTML = '<div id="cwAuthBar"></div>';
document.body.appendChild(cwAuthBarWrap);
const cwBannerEl = document.createElement("div");
cwBannerEl.id = "cwBanner";
cwBannerEl.innerHTML = '<span id="cwBannerText"></span>';
document.body.appendChild(cwBannerEl);

const cwActionBtn = document.createElement("button");
cwActionBtn.id = "cwActionBtn";
document.body.appendChild(cwActionBtn);
const cwRewardBox = document.createElement("div");
cwRewardBox.id = "cwRewardBox";
cwRewardBox.innerHTML = '<span id="cwRewardClose">X</span><div id="cwRewardTitle">CLAN WAR REWARD</div><div id="cwRewardGrid"></div><div id="cwRewardShare"></div><div id="cwRewardHint">Choose ONLY ONE item (weapon, armor, ring or accessory). Tap an item to see its stats.</div>';
document.body.appendChild(cwRewardBox);

let olCwState = null;   // {phase, owner, ownerName, claimed, exitAt(performance ms)} while inside CWmap
let olCwAuth = null;    // {start, seconds} while my authentication bar is running

function olCwInside() { return netIsOnline() && netMapByLevel[netOnlineLevel] === OL_CW.KEY; }
function olCwReset() { olCwState = null; olCwAuth = null; window.cwFrozen = false; olCwBoxOpen = false; olCwPick = -1; olCwBoxKey = ""; olCwRefresh(); olCwUpdateAction(); }
function olCwOnState(msg) {
  olCwState = {
    phase: msg.phase, owner: !!msg.owner, ownerName: msg.ownerName || "", claimed: !!msg.claimed,
    exitAt: msg.claimed ? performance.now() + (msg.exitIn || 0) * 1000 : 0,
    rewards: Array.isArray(msg.rewards) ? msg.rewards : null
  };
  if (olCwState.claimed) olCwBoxOpen = false;
  olCwUpdateAction();
  olCwRefresh();
}
// Shows the status label + authentication bar (HUD) from olCwState / olCwAuth (also called ~5x a second).
// The AUTHENTICATE / CLAIM REWARD "button" itself is the pad on the map floor (drawCwPad below).
function olCwRefresh() {
  if (!olCwInside() || !olCwState) {
    cwAuthBtn.style.display = "none"; cwAuthBarWrap.style.display = "none";
    return;
  }
  const st = olCwState;
  let label = "";
  if (st.phase === "ended") {
    cwAuthBarWrap.style.display = "none";
    if (st.owner && !st.claimed) label = "STAND ON THE CLAIM REWARD PAD";
    else if (st.claimed) label = "LEAVING IN " + Math.max(0, Math.ceil((st.exitAt - performance.now()) / 1000)) + "s";
    else label = "CLAN WAR ENDED";
  } else if (olCwAuth) {
    const pct = Math.min(100, ((performance.now() - olCwAuth.start) / (olCwAuth.seconds * 1000)) * 100);
    document.getElementById("cwAuthBar").style.width = pct + "%";
    cwAuthBarWrap.style.display = "block";
    label = "AUTHENTICATING...";
  } else {
    cwAuthBarWrap.style.display = "none";
    label = st.owner ? "YOUR CLAN OWNS THIS" : "STAND ON THE AUTHENTICATE PAD";
  }
  cwAuthBtn.textContent = label;
  cwAuthBtn.style.display = label ? "block" : "none";
}
setInterval(olCwRefresh, 200);

// ---- the pad on the map floor -------------------------------------------------
const olCwPadImgs = {};
function olCwPadImage(path) {
  if (!olCwPadImgs[path]) { const im = new Image(); im.src = path; olCwPadImgs[path] = im; }
  return olCwPadImgs[path];
}
// What the pad currently is: "auth" (authenticate.png), "claim" (claimreward.png) or null (hidden).
function olCwPadMode() {
  if (!olCwInside() || !olCwState) return null;
  const st = olCwState;
  if (st.phase === "ended") return (st.owner && !st.claimed) ? "claim" : null;
  return "auth";
}
// Called by game.js while drawing the world (under the players).
function drawCwPad(ctx, offX, offY) {
  const mode = olCwPadMode();
  if (!mode) return;
  const P = OL_CW.PAD, x = offX + P.x - P.size / 2, y = offY + P.y - P.size / 2;
  const img = olCwPadImage(mode === "claim" ? "image/claimreward.png" : "image/authenticate.png");
  ctx.save();
  if (mode === "auth" && olCwState.owner) ctx.globalAlpha = 0.45;   // my clan already owns it
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, P.size, P.size);
  else {   // fallback until the picture loads / if it is missing
    ctx.fillStyle = mode === "claim" ? "rgba(255,200,60,0.75)" : "rgba(60,200,120,0.75)";
    ctx.fillRect(x, y, P.size, P.size);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x, y, P.size, P.size);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px 'Courier New', monospace"; ctx.textAlign = "center";
    ctx.fillText(mode === "claim" ? "CLAIM REWARD" : "AUTHENTICATE", x + P.size / 2, y + P.size / 2 + 3);
  }
  ctx.restore();
}
// Standing on the pad pops up a button (AUTHENTICATE / CLAIM REWARD) on screen. The server re-checks the distance.
let olCwBoxOpen = false;
let olCwBoxKey = "";
function olCwTouchingPad() {
  if (typeof playerPos === "undefined") return false;
  const P = OL_CW.PAD, h = P.size / 2;
  const cx = Math.max(P.x - h, Math.min(playerPos.x, P.x + h)), cy = Math.max(P.y - h, Math.min(playerPos.y, P.y + h));
  return Math.hypot(playerPos.x - cx, playerPos.y - cy) < playerPos.radius;
}
// Builds the entry the shared item-stats popup (index.html) understands, for one reward.
function olCwRewardEntry(r) {
  try {
    if (r.kind === "gold") return { type: "gold", name: "Gold", data: { image: "image/goldenorb.png", description: "Gold from the Clan War reward, shared between the online clan members." }, qty: r.total || 0 };
    if (r.kind === "weapon") { const d = getWeapon(r.type); return d && { type: "weapon", name: r.type, data: Object.assign({}, d, { image: d.image || ("image/" + r.type + ".png") }) }; }
    if (r.kind === "armor" || r.kind === "ring" || r.kind === "accessory") {
      const d = getArmor(r.type);
      return d && { type: (d.category === "ring" || d.category === "accessory") ? d.category : "armor", name: r.type, data: Object.assign({}, d, { defense: d.physicalDefense }) };
    }
    if (r.kind === "stone" || r.kind === "orb") { const d = getUpgradeItem(r.type); return d && { type: r.kind, name: r.type, data: d, qty: r.total || 1 }; }
  } catch (e) {}
  return null;
}
let olCwPick = -1;   // index of the gear item I selected (only ONE can be chosen)
function olCwIsStack(r) { return r.kind === "gold" || r.kind === "stone" || r.kind === "orb"; }
function olCwBuildBox() {
  const rewards = (olCwState && olCwState.rewards) || [];
  if (olCwPick >= 0 && (!rewards[olCwPick] || rewards[olCwPick].taken)) olCwPick = -1;   // someone else took it first
  const key = JSON.stringify(rewards) + "|" + olCwPick;
  if (key === olCwBoxKey) return;
  olCwBoxKey = key;
  const grid = document.getElementById("cwRewardGrid");
  grid.innerHTML = "";
  for (let i = 0; i < 16; i++) {
    const slot = document.createElement("div");
    slot.className = "cwSlot";
    const r = rewards[i];
    const entry = (r && !r.taken && !(olCwIsStack(r) && r.total <= 0)) ? olCwRewardEntry(r) : null;   // taken / used-up items disappear
    if (entry) {
      slot.classList.add("has");
      if (i === olCwPick) slot.classList.add("sel");
      const img = document.createElement("img");
      img.src = entry.data.image || ("image/" + entry.name + ".png");
      slot.appendChild(img);
      if (olCwIsStack(r) || r.total > 1) { const q = document.createElement("span"); q.className = "cwQty"; q.textContent = r.total; slot.appendChild(q); }
      slot.addEventListener("click", () => {
        if (!olCwIsStack(r)) { olCwPick = i; olCwBoxKey = ""; olCwBuildBox(); }   // select this one (replaces the previous choice)
        if (typeof window.openItemStatsPopup === "function") window.openItemStatsPopup(null, entry);
      });
    }
    grid.appendChild(slot);
  }
  const shares = rewards.filter((r) => olCwIsStack(r) && r.share > 0).map((r) => r.share + " " + (r.kind === "gold" ? "gold" : r.type));
  document.getElementById("cwRewardShare").textContent = shares.length ? "Your share: " + shares.join(", ") : "";
}
document.getElementById("cwRewardClose").addEventListener("click", () => { olCwBoxOpen = false; olCwUpdateAction(); });
// Shows / hides the action button + reward box (runs ~7x a second).
function olCwUpdateAction() {
  const mode = olCwPadMode();
  const show = !!mode && !isDead && !olCwAuth && olCwTouchingPad() && !(mode === "auth" && olCwState.owner);
  if (!show) { cwActionBtn.style.display = "none"; cwRewardBox.style.display = "none"; return; }
  cwActionBtn.style.display = "block";
  if (mode === "auth") { cwActionBtn.textContent = "AUTHENTICATE"; cwRewardBox.style.display = "none"; return; }
  cwActionBtn.textContent = olCwBoxOpen ? "CLAIM" : "CLAIM REWARD";
  if (olCwBoxOpen) { olCwBuildBox(); cwRewardBox.style.display = "block"; } else cwRewardBox.style.display = "none";
}
setInterval(olCwUpdateAction, 150);
cwActionBtn.addEventListener("click", () => {
  const mode = olCwPadMode();
  if (!mode || !olCwTouchingPad()) return;
  if (mode === "auth") { if (!olCwAuth && !isDead) netSend({ type: "cwAuth" }); return; }   // the server runs the 30 s timer; dying cancels it
  if (!olCwBoxOpen) { olCwBoxOpen = true; olCwUpdateAction(); return; }                      // 1st tap: open the reward box
  const rw = (olCwState && olCwState.rewards) || [];
  const gearLeft = rw.some((r) => !olCwIsStack(r) && !r.taken);
  if (gearLeft && olCwPick < 0) { netToast("Choose one item first"); return; }
  netSend({ type: "cwClaim", pick: olCwPick });                                              // 2nd tap: claim -> MY 20 s countdown starts
});

function olCwWindowOpen() {
  const d = new Date(Date.now() + OL_CW.TZ_OFFSET_HOURS * 3600 * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return OL_CW.DAYS.includes(d.getUTCDay()) && h >= OL_CW.START_HOUR && h < OL_CW.END_HOUR;
}
// WAR ZONE > CLAN WAR
function olCwClick() {
  if (!netIsOnline()) return;
  if (olCwInside()) { olBossShowMessage("You are already inside the Clan War map.", "CLAN WAR"); return; }
  if (!olCwWindowOpen()) { olBossShowMessage(OL_CW.CLOSED_TEXT, "CLAN WAR"); return; }
  netSend({ type: "cwEnter" });   // the server checks clan + schedule, then moves me (or answers cwDenied)
}

// Message that scrolls right-to-left across the top centre of the screen.
function olCwBanner(text) {
  const t = document.getElementById("cwBannerText");
  t.textContent = text;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  cwBannerEl.style.display = "block";
  clearTimeout(olCwBanner._t);
  olCwBanner._t = setTimeout(() => { cwBannerEl.style.display = "none"; }, 18200);
}

// Reward from the server: straight into my inventory (same calls a ground pickup uses).
function olCwApplyReward(items) {
  if (!Array.isArray(items)) return;
  const got = [], full = [];
  for (const it of items) {
    const n = Math.max(1, it.amount || 1);
    if (it.kind === "gold") { if (typeof pickUpGoldOrb === "function") pickUpGoldOrb(it.amount); got.push(it.amount + " gold"); continue; }
    let okCount = 0;
    for (let k = 0; k < n; k++) {
      let ok = true;
      if (it.kind === "weapon") ok = typeof pickUpWeaponDrop === "function" && pickUpWeaponDrop(it.type);
      else if (it.kind === "armor" || it.kind === "ring" || it.kind === "accessory") ok = typeof pickUpArmorDrop === "function" && pickUpArmorDrop(it.type);
      else if (it.kind === "stone" || it.kind === "orb") ok = typeof pickUpUpgradeDrop === "function" && pickUpUpgradeDrop(it.type, it.kind);
      if (ok) okCount++;
    }
    if (okCount) got.push((n > 1 ? okCount + " " : "") + it.type);
    if (okCount < n) full.push((n - okCount > 1 ? (n - okCount) + " " : "") + it.type);
  }
  if (got.length) netToast("Clan War reward: " + got.join(", "));
  if (full.length) netToast("Inventory full — could not receive: " + full.join(", "));
}

// Countdown label while inside the arena
const olBossTimerEl = document.createElement("div");
olBossTimerEl.id = "olBossTimer";
document.body.appendChild(olBossTimerEl);
setInterval(() => {
  const inside = netIsOnline() && netMapByLevel[netOnlineLevel] === OL_BOSS.KEY;
  if (!inside) { olBossTimerEl.style.display = "none"; return; }
  const left = Math.max(0, olBossMsLeft());
  const h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60, sec = Math.floor(left / 1000) % 60;
  olBossTimerEl.textContent = "BOSS EVENT  " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  olBossTimerEl.style.display = "block";
}, 1000);

// ---------------------------------------------------------------------------
// TEMP DEBUG BADGE — remove once online enemies are confirmed working.
// Shows on screen (top-left) so you don't need devtools/console to check:
//   - whether THIS build is the one actually running (BOTFIX v6 marker —
//     if you don't see this badge at all, your phone is running an OLD
//     cached copy of online.js, not the updated one)
//   - whether this device is currently hosting the room's enemies
//   - how many bots exist right now and what AI state each one is in
//     (patrol/look/chase/attack/search) — if bots exist but are frozen,
//     "moving:0" here tells you the AI loop itself isn't advancing them.
// ---------------------------------------------------------------------------
let netDebugTimer = 0;
// Set to true only while debugging: the badge rewrites on-screen text several
// times a second, which costs frame rate on phones.
const OL_SHOW_DEBUG_BADGE = false;
function netDebugTick(dt) {
  if (!OL_SHOW_DEBUG_BADGE) {
    const old = document.getElementById("netDebugBadge");
    if (old) old.remove();
    return;
  }
  netDebugTimer += dt * 1000;
  if (netDebugTimer < 400) return;
  netDebugTimer = 0;
  let el = document.getElementById("netDebugBadge");
  if (!el) {
    el = document.createElement("div");
    el.id = "netDebugBadge";
    el.style.cssText =
      "position:fixed;left:6px;top:6px;z-index:99999;background:rgba(0,0,0,0.75);" +
      "color:#0f0;font:11px 'Courier New',monospace;padding:5px 8px;border-radius:4px;" +
      "white-space:pre;pointer-events:none;line-height:1.4;";
    document.body.appendChild(el);
  }
  if (!netIsOnline()) { el.textContent = "BOTFIX v8 | offline"; return; }
  const states = {};
  let moving = 0;
  for (const b of bots) { states[b.state] = (states[b.state] || 0) + 1; if (b.isMoving) moving++; }
  const cloudLv = onlineProfile && onlineProfile.characterProgress && onlineProfile.characterProgress[player.name]
    ? onlineProfile.characterProgress[player.name].level : "-";
  el.textContent =
    "BOTFIX v8 SAVEFIX v14 | host:" + (netIsBotHost ? "YES" : "no") +
    " | bots:" + bots.length + " moving:" + moving +
    "\nstates: " + JSON.stringify(states) +
    "\nothers in room:" + otherPlayers.size +
    "\nlv:" + player.level + " pts:" + (player.statPoints || 0) + " | cloud lv:" + cloudLv +
    " | acct:" + (onlineProfileActive ? "online" : "NOT SWAPPED") + " | save:" + olLastSaveNote + " | sess:" + olSessionNote +
    "\nload:" + olLastLoadNote;
}

// ---------------------------------------------------------------------------
// Per-frame tick (called from game.js update() while online)
// ---------------------------------------------------------------------------
function netUpdate(dt) {
  netDebugTick(dt);
  // Smooth remote players toward their last reported position.
  const k = Math.min(1, dt * 15);
  for (const p of otherPlayers.values()) {
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
  }

  // Guest: smooth puppet enemies toward the host's last reported position
  // (the host's own bots need no smoothing — updateBots() already moved
  // them for real this frame).
  if (!netIsBotHost) {
    const kb = Math.min(1, dt * 12);
    for (const b of bots) {
      if (b._netTX == null || !b.alive) continue;
      b.x += (b._netTX - b.x) * kb;
      b.y += (b._netTY - b.y) * kb;
    }
  }

  // SOLID BODIES. The host's enemies already get pushed out of the host's
  // player by updateBots(), but a guest's enemies are just puppets that follow
  // the host's positions, so a guest walked straight through them. Guests
  // therefore push THEMSELVES out of enemies here. Players are also solid to
  // each other: each side moves half the overlap, so together they separate.
  if (typeof isDead === "undefined" || !isDead) {
    const pr = playerPos.radius || 12;
    if (!netIsBotHost) {
      for (const b of bots) {
        if (!b.alive) continue;
        const dx = playerPos.x - b.x, dy = playerPos.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = pr + b.radius;
        if (dist > 0 && dist < minDist) {
          const push = minDist - dist;
          playerPos.x += (dx / dist) * push;
          playerPos.y += (dy / dist) * push;
        }
      }
    }
    for (const p of otherPlayers.values()) {
      if (p.alive === false) continue;
      const dx = playerPos.x - p.x, dy = playerPos.y - p.y;
      const dist = Math.hypot(dx, dy);
      const minDist = pr + (p.radius || 14);
      if (dist > 0 && dist < minDist) {
        const push = (minDist - dist) * 0.5;
        playerPos.x += (dx / dist) * push;
        playerPos.y += (dy / dist) * push;
      }
    }
  }

  // Send my own state ~20 times a second.
  netStateTimer += dt * 1000;
  if (netStateTimer >= NET_STATE_INTERVAL) {
    netStateTimer = 0;
    netSendState();
  }

  // Host: broadcast enemy positions/health ~10 times a second.
  if (netIsBotHost) {
    netBotsTimer += dt * 1000;
    if (netBotsTimer >= NET_BOTS_INTERVAL) {
      netBotsTimer = 0;
      netSendBotsSnapshot();
    }
  }
}

function netSendState() {
  // invSlotData (index.html) holds the currently equipped
  // weapon/armor/accessory ({name, data} | null per slot) — only the
  // item name goes over the wire, same as everything else here; other
  // clients look its image up locally (getWeapon()/getArmor()) the same
  // way the local Equip popup already does.
  const eq = (typeof invSlotData !== "undefined") ? invSlotData : null;
  netSend({
    type: "state",
    x: Math.round(playerPos.x * 10) / 10,
    y: Math.round(playerPos.y * 10) / 10,
    health: Math.max(0, Math.round(player.currentHealth)),
    maxHealth: Math.round(player.health || 100),
    mana: Math.max(0, Math.round(player.currentMana || 0)),
    maxMana: Math.round(player.mana || 0),
    exp: Math.round(player.exp || 0),
    maxExp: Math.round(player.maxExp || (typeof getExpForLevel === "function" ? getExpForLevel(player.level || 1) : 0)),
    level: player.level || 1,
    alive: !isDead,
    weapon: (eq && eq.weapon) ? eq.weapon.name : null,
    armor: (eq && eq.armor) ? eq.armor.name : null,
    accessory: (eq && eq.accessory) ? eq.accessory.name : null
  });
}

// ---------------------------------------------------------------------------
// Outgoing visuals (game.js calls these; they do nothing outside online mode)
// ---------------------------------------------------------------------------
function netSendBullet(b) {
  if (!netIsOnline() || !b.isMortar) return;
  netSend({
    type: "bullet",
    x: b.x, y: b.y, vx: b.vx, vy: b.vy,
    targetX: b.targetX, targetY: b.targetY,
    hitEffect: b.hitEffect, projectile: b.projectile,
    explosionRadius: b.explosionRadius
  });
}

function netFx(effect, x, y, follow, angle, size) {
  if (!netIsOnline() || !effect) return;
  netSend({ type: "fx", effect, x, y, follow: !!follow, angle, size });
}

function netSound(url) {
  if (!netIsOnline() || !url) return;
  netSend({ type: "sound", sound: url, x: playerPos.x, y: playerPos.y });
}

// ---------------------------------------------------------------------------
// Dealing damage to other players (attacker side)
// ---------------------------------------------------------------------------
function netRollCrit(critContext, base) {
  if (typeof rollCharacterCritical === "function") return rollCharacterCritical(critContext, base);
  const isCritical = Math.random() < (critContext.criticalChance || 0);
  return { damage: isCritical ? base * (1 + (critContext.criticalDamage || 0)) : base, isCritical };
}

function netSendHit(targetId, physicalDamage, magicalDamage, isCritical, knockback, isSkillHit) {
  netSend({
    type: "hit",
    targetId,
    physicalDamage: Math.round(physicalDamage),
    magicalDamage: Math.round(magicalDamage),
    isCritical: !!isCritical,
    srcX: playerPos.x, srcY: playerPos.y,
    knockback: knockback || 0,
    // SKILL LOCK — see damageBot()'s isSkillHit comment above; same idea,
    // for PvP hits. netHitPlayers() (used only by skill effects) always
    // passes true here; netMeleeStrike() (the basic weapon swing) never does.
    isSkillHit: !!isSkillHit
  });
}

// Hits every living remote player for which test(p) is true. Each target
// rolls its own crit. Used by melee skills, beams and blasts — i.e. every
// call here is a skill hit, hence the hardcoded isSkillHit: true below.
function netHitPlayers(test, physicalDamage, magicalDamage, critContext) {
  if (!netIsOnline() || isDead || !netPvpOn()) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive || !test(p)) continue;
    const phys = netRollCrit(critContext, physicalDamage || 0);
    const mag = netRollCrit(critContext, magicalDamage || 0);
    netSendHit(p.id, phys.damage, mag.damage, phys.isCritical || mag.isCritical, 0, true);
  }
}

// Basic melee swing: short reach, front cone only (same shape as vs bots).
// Not a skill — isSkillHit is left false (netSendHit's default).
function netMeleeStrike(attackDir, reach, attackResult) {
  if (!netIsOnline() || isDead || !netPvpOn()) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const dx = p.x - playerPos.x;
    const dy = p.y - playerPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + p.radius) continue;
    if (dist > 0.001 && (dx / dist) * attackDir.x + (dy / dist) * attackDir.y < 0.3) continue;
    netSendHit(p.id, attackResult.physicalDamage || 0, attackResult.magicalDamage || 0, attackResult.isCritical, 0);
  }
}

// My mortar shot landed: everyone inside its radius is hit, weaker toward
// the edge (same falloff as against bots) and pushed away from the blast.
function netMortarLanded(b) {
  if (!netIsOnline() || isDead || !netPvpOn()) return;
  for (const p of otherPlayers.values()) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - b.x, p.y - b.y);
    if (dist > b.explosionRadius + p.radius) continue;
    const falloff = getAoeFalloff(Math.min(dist, b.explosionRadius), b.explosionRadius);
    const phys = Math.max(1, Math.round((b.damage || 0) * falloff));
    const mag = Math.round((b.magicalDamage || 0) * falloff);
    // srcX/srcY = blast center, so the victim is pushed away from it.
    netSend({
      type: "hit", targetId: p.id,
      physicalDamage: phys, magicalDamage: mag, isCritical: false,
      srcX: b.x, srcY: b.y,
      knockback: (b.knockback || 0) * falloff
    });
  }
}

// ---------------------------------------------------------------------------
// Taking damage (victim side)
// ---------------------------------------------------------------------------
function netApplyHit(msg) {
  if (isDead || !netPvpOn() || performance.now() < netSpawnProtectUntil) return;

  const blocked = (typeof rollArmorBlock === "function") && rollArmorBlock(player);
  if (!blocked) {
    applyDamageToPlayer(player, {
      physicalDamage: msg.physicalDamage || 0,
      magicalDamage: msg.magicalDamage || 0,
      isCritical: !!msg.isCritical
    });

    // Knockback — away from the attack's source point.
    if (msg.knockback > 0 && player.currentHealth > 0) {
      const dx = playerPos.x - msg.srcX;
      const dy = playerPos.y - msg.srcY;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) {
        playerPos.x = Math.max(playerPos.radius, Math.min(WORLD_SIZE_X - playerPos.radius, playerPos.x + (dx / d) * msg.knockback));
        playerPos.y = Math.max(playerPos.radius, Math.min(WORLD_SIZE_Y - playerPos.radius, playerPos.y + (dy / d) * msg.knockback));
      }
    }
  }

  healthDisplay.textContent = Math.max(0, Math.round(player.currentHealth));
  if (player.currentHealth <= 0) netOnDeath(msg.from);
}

function netOnDeath(killerId) {
  if (isDead) return;
  isDead = true;
  netDeathPos = { x: playerPos.x, y: playerPos.y };
  player.currentHealth = 0;
  healthDisplay.textContent = 0;
  bullets.length = 0;

  netSend({ type: "died", killerId });
  netSendState();

  let secondsLeft = NET_RESPAWN_SECONDS;
  respawnTimerDisplay.textContent = secondsLeft;
  deathOverlay.style.display = "flex";

  if (netRespawnInterval) clearInterval(netRespawnInterval);
  netRespawnInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      respawnTimerDisplay.textContent = secondsLeft;
      return;
    }
    clearInterval(netRespawnInterval);
    netRespawnInterval = null;
    netRespawn();
  }, 1000);
}

function netRespawn() {
  respawnPlayerOffline();   // full health, gear re-applied (it also picks a random spawn point — overridden just below)
  // Dying inside the Clan War: respawn in the World Map at my last spot (the server moves me, see "worldEnter").
  const cwDeath = (typeof olCwInside === "function") && olCwInside();
  // Respawn on the spot where I died instead of a random spawn point.
  if (netDeathPos && !cwDeath) {
    playerPos.x = netDeathPos.x;
    playerPos.y = netDeathPos.y;
    netDeathPos = null;
  }
  isDead = false;
  deathOverlay.style.display = "none";
  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
  netSendState();
  if (cwDeath) { netDeathPos = null; netSend({ type: "worldEnter", respawn: true }); }
}

// ---------------------------------------------------------------------------
// Incoming messages
// ---------------------------------------------------------------------------
function netHandle(msg) {
  switch (msg.type) {
    case "shopPaid":
      // The server has a paid shop order for this account: collect it now.
      olShopClaim();
      break;

    case "pointsUpdate":
      // The server changed my points balance (ad reward / owner gift).
      if (typeof msg.points === "number") { olShopPoints = msg.points; olShopUpdateBar(); }
      break;

    case "playerAdd":
      netAddRemote(msg.player);
      netToast(msg.player.name + " joined");
      break;

    // BOSS EVENT: the server moved me into / out of the arena (see olBossApplyMove).
    case "bossMove":
      olBossApplyMove(msg);
      break;
    case "bossDenied":
      olBossShowMessage(msg.reason || "You cannot enter the map.");
      break;

    // CLAN WAR (see the CLAN WAR block next to OL_CW)
    case "cwMove":    olBossApplyMove(msg); olCwReset(); break;
    case "cwDenied":  olBossShowMessage(msg.reason || "You cannot enter the map.", "CLAN WAR"); break;
    case "cwState":   olCwOnState(msg); break;
    case "cwAuthStart": olCwAuth = { start: performance.now(), seconds: msg.seconds || 30 }; window.cwFrozen = true; if (typeof input !== "undefined") { input.moveVector = { x: 0, y: 0 }; input.isShooting = false; } olCwRefresh(); olCwUpdateAction(); break;
    case "cwAuthFail":  window.cwFrozen = false; if (olCwAuth) { olCwAuth = null; netToast("Authentication failed"); olCwRefresh(); } break;
    case "cwAuthDone":  olCwAuth = null; window.cwFrozen = false; netToast("Authentication complete!"); olCwRefresh(); break;
    case "cwOwned":   olCwBanner("The " + (msg.clanName || "clan") + " owned this Clan War"); break;
    case "cwReward":  olCwApplyReward(msg.items); break;

    case "mapChanged":
      // The server decides exactly where I land after a portal (see
      // game_server.js's getPortalArrivalSpawn()) — apply that now so a
      // modified client's own guess never sticks.
      if (typeof msg.spawnX === "number" && typeof msg.spawnY === "number") {
        playerPos.x = msg.spawnX;
        playerPos.y = msg.spawnY;
      }
      // The server moved me to another map's room: those are the players I see now.
      otherPlayers.clear();
      for (const p of msg.players || []) netAddRemote(p);
      netSetBotHost(!!msg.botHost, msg.bots);
      if (!netIsBotHost && Array.isArray(msg.bots) && msg.bots.length) netApplyBotsSnapshot(msg.bots);
      netApplyDrops(msg.drops);   // items still lying on this map
      break;

    case "playerRemove": {
      const p = otherPlayers.get(msg.id);
      if (p) netToast(p.name + " left");
      otherPlayers.delete(msg.id);
      break;
    }

    case "state": {
      const p = otherPlayers.get(msg.id);
      if (!p) break;
      const wasAlive = p.alive;
      p.tx = msg.x; p.ty = msg.y;
      p.health = msg.health; p.maxHealth = msg.maxHealth;
      p.mana = msg.mana; p.maxMana = msg.maxMana;
      p.exp = msg.exp; p.maxExp = msg.maxExp;
      p.level = msg.level; p.alive = msg.alive;
      // Equipped gear (name only — VIEW popup below looks its image up
      // locally via getWeapon()/getArmor(), same as the local Equip ring).
      p.weapon = msg.weapon || null;
      p.armor = msg.armor || null;
      p.accessory = msg.accessory || null;
      // Snap (don't glide) after they respawn somewhere else.
      if (!wasAlive && p.alive) { p.x = p.tx; p.y = p.ty; }
      break;
    }

    case "bullet":
      bullets.push({
        x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
        radius: 4, damage: 0,
        hitEffect: msg.hitEffect, projectile: msg.projectile,
        ownerId: msg.from, ownerType: "remote",
        isMortar: true,
        targetX: msg.targetX, targetY: msg.targetY,
        explosionRadius: msg.explosionRadius
      });
      break;

    case "fx": {
      if (typeof createHitEffect !== "function") break;
      const p = otherPlayers.get(msg.from);
      createHitEffect(msg.x, msg.y, msg.effect, (msg.follow && p) ? p : null, msg.angle, msg.size || undefined);
      break;
    }

    case "sound":
      if (typeof playPositionalSound === "function") {
        playPositionalSound(msg.sound, (msg.x || 0) - playerPos.x, (msg.y || 0) - playerPos.y, { baseVolume: 1.0 });
      }
      break;

    case "hit":
      netApplyHit(msg);
      break;

    // Someone else took damage: show the floating number above them too.
    case "dmgNum":
      if (typeof createDamageNumber === "function" && msg.amount >= 1) {
        createDamageNumber(msg.x, msg.y, msg.amount, { isCritical: !!msg.isCritical });
      }
      break;

    // An enemy bot (hosted by someone else in the room) hit ME.
    case "botHitPlayer":
      netApplyBotHit(msg);
      break;

    case "kill":
      if (msg.killerName) netToast(msg.killerName + " eliminated " + msg.victimName);
      else netToast(msg.victimName + " was eliminated");
      break;

    // Someone I'm near touched me and hit ADD FRIEND — show the ACCEPT /
    // DECLINE popup (see netOnFriendRequest above).
    case "friendRequest":
      netOnFriendRequest(msg);
      break;

    // The person I sent a friend request to responded.
    case "friendResponse":
      if (msg.accept) {
        netAddFriend(msg.from, msg.fromName || ("Player " + msg.from));
        netToast((msg.fromName || "Player") + " accepted your friend request");
      } else {
        netToast((msg.fromName || "Player") + " declined your friend request");
      }
      break;

    // Someone touched me and tapped INVITE PARTY — show the ACCEPT / DECLINE
    // popup (see netOnPartyInvite above).
    case "partyInvite":
      netOnPartyInvite(msg);
      break;

    // The person I invited responded (their party membership itself arrives
    // separately as "partyUpdate", below).
    case "partyResponse":
      if (msg.accept) netToast((msg.fromName || "Player") + " joined your party");
      else netToast((msg.fromName || "Player") + " declined your party invite");
      break;

    // Server-authoritative party roster — sent to every member whenever the
    // party's membership changes (join/leave/kick/dissolve). An empty/absent
    // roster means I'm not in a party.
    case "partyUpdate":
      netParty = (msg.partyId != null && Array.isArray(msg.members) && msg.members.length > 1)
        ? { id: msg.partyId, members: msg.members }
        : null;
      netRenderPartyPanel();
      break;

    case "partyKicked":
      netParty = null;
      netRenderPartyPanel();
      netSetPartyPanelOpen(false);
      netToast("You were removed from the party");
      break;

    // Something about a party invite/join couldn't go through — just tell
    // the player why (full party, already in one, etc).
    case "partyError":
      if (msg.reason) netToast(msg.reason);
      break;

    // A party member within range shared their kill's exp with me (see the
    // addCharacterExp() override below) — apply MY share here. Uses the
    // ORIGINAL (non-overridden) exp function directly since this amount is
    // already my final split, not something to split again.
    case "partyExpAward":
      netApplyPartyExpAward(msg.amount);
      break;

    // A party member within range used POWERBOOST / DEFENSEBOOST (skill.js) — the server
    // checked party + range, so just start the same buff on myself (uses this
    // mode's own skill numbers via getSkill()).
    // The server's own mana count after a skill use. It only ever LOWERS my
    // mana (regen stays local), so a fake/stale client number can't stand.
    case "manaSync": {
      if (typeof msg.mana === "number" && typeof player !== "undefined" && player.currentMana > msg.mana) {
        player.currentMana = msg.mana;
      }
      break;
    }

    case "skillBuff": {
      if (typeof isDead !== "undefined" && isDead) break;
      const def = (typeof getSkill === "function") ? getSkill(msg.skill) : null;
      if (def && (def.attackIncrease || def.defenseIncrease) && typeof applyAuraBuff === "function") {
        applyAuraBuff(def);
        netToast("Party buff: " + def.skill);
      } else if (def && netIsPercentHeal(def)) {
        // A party member in range used HEAL — heal me by the same percent.
        netApplyPercentHeal(def);
        if (def.hitEffect && typeof createHitEffect === "function" && typeof playerPos !== "undefined") {
          createHitEffect(playerPos.x, playerPos.y, def.hitEffect, playerPos);
        }
        netToast("Healed by a party member");
      }
      break;
    }

    // Someone touched me and tapped ADD CLAN — show the ACCEPT CLAN / REJECT
    // popup (see netOnClanInvite above).
    case "clanInvite":
      netOnClanInvite(msg);
      break;

    // Server-authoritative clan roster — sent to every member whenever the
    // clan's membership changes (create/invite accepted/leave/disband). An
    // absent clanId means I'm not (or no longer) in a clan. index.html owns
    // the CREATE CLAN / CLAN popup UI; this just hands it the fresh roster.
    case "clanUpdate":
      if (typeof window.applyClanUpdate === "function") window.applyClanUpdate(msg);
      break;

    // Something about creating/inviting/joining a clan couldn't go through —
    // just tell the player why (no clan yet, already in one, clan full...).
    case "clanError":
      if (msg.reason) netToast(msg.reason);
      if (typeof window.applyClanError === "function") window.applyClanError(msg);   // stops "Creating..." + shows the reason in the CREATE CLAN window
      break;

    // Someone touched me and tapped TRADE — show the ACCEPT / CANCEL popup
    // (see netOnTradeRequest above).
    case "tradeRequest":
      netOnTradeRequest(msg);
      break;

    // The person I sent a trade request to responded. Accepting opens the
    // Trade screen separately via "tradeStart" (server-confirmed) below —
    // this is just the toast for a decline, or a stale reply.
    case "tradeResponse":
      if (!msg.accept) netToast((msg.fromName || "Player") + " declined your trade request");
      break;

    // Server has paired us up for a trade — open the screen (works whether
    // I was the one who sent the request or the one who accepted it).
    case "tradeStart":
      netOpenTradeScreen(msg.from, msg.fromName);
      break;

    // My trade partner changed their offer (item added/removed, gold
    // changed) — repaint the read-only THEIR OFFER side to match, and
    // un-confirm both sides the same way the server just did.
    case "tradeOffer":
      if (netTradePartnerId == null || msg.from !== netTradePartnerId) break;
      netTradeTheirOffer = Array.isArray(msg.items) ? msg.items.slice(0, TRADE_OFFER_SIZE) : new Array(TRADE_OFFER_SIZE).fill(null);
      while (netTradeTheirOffer.length < TRADE_OFFER_SIZE) netTradeTheirOffer.push(null);
      netTradeTheirGold = Math.max(0, Math.trunc(Number(msg.gold) || 0));
      netTradeMyConfirmed = false;
      netTradeTheirConfirmed = false;
      tradeUpdateAcceptState();
      tradeRenderTheirOffer();
      break;

    // My trade partner hit ACCEPT on their side.
    case "tradeConfirm":
      if (netTradePartnerId == null || msg.from !== netTradePartnerId) break;
      netTradeTheirConfirmed = true;
      tradeUpdateAcceptState();
      break;

    // Both sides have confirmed — apply the swap to my own inventory.
    case "tradeComplete":
      netTradeApplyComplete();
      break;

    // My trade partner cancelled/declined, disconnected, or left — close
    // the screen (if it's even open) and reset my own trade state.
    case "tradeCancelled":
      if (netTradePartnerId != null) {
        netToast((msg.fromName || "Player") + " cancelled the trade");
      }
      netTradeReset();
      netCloseTradeScreen();
      netCloseTradeRequestPopup();
      break;

    // A trade request/response couldn't go through (already trading, that
    // player's gone, etc.) — just tell the player why.
    case "tradeError":
      if (msg.reason) netToast(msg.reason);
      break;

    // CDM SEND (hidden dev tool) — see "HIDDEN CDM BUTTON" near the top of this file.
    case "cmdGive":
      olCmdReceive(msg);
      break;
    case "cmdGiveResult":
      olCmdOnResult(msg);
      break;
    case "cmdCatalog":
      olCmdOnCatalog(msg);
      break;

    // CHAT BOX (online gameplay) — server.js's "chatMessage" case relays a
    // WORLD broadcast ({scope:"world", fromName, text}) or a PRIVATE
    // whisper ({scope:"private", fromName, toName, text}, sent to both
    // sides). index.html owns the CHATBOX window UI; this just hands it
    // whatever arrives.
    case "chatMessage":
      if (typeof window.applyChatMessage === "function") window.applyChatMessage(msg);
      // WORLD messages also float as a speech bubble above the sender's
      // character in the game world (see netShowWorldChatBubble/
      // drawRemotePlayers below), so nearby players can read it without
      // opening the CHATBOX. Whispers stay private, so no bubble for those.
      if (msg.scope === "world") netShowWorldChatBubble(msg.fromName, msg.text);
      break;

    // Chat couldn't go through (bad @name format, target offline, etc).
    case "chatError":
      if (msg.reason) netToast(msg.reason);
      break;

    // ---- ENEMIES (PvE) --------------------------------------------------
    case "botHost":
      netSetBotHost(!!msg.host, msg.bots);
      break;

    case "bots":
      // Only meaningful if I'm NOT the host — the host is my own local
      // simulation and already knows its own state. (The server only ever
      // relays this to non-hosts anyway, but the guard is cheap and safe.)
      if (!netIsBotHost) netApplyBotsSnapshot(msg.list);
      break;

    case "dropAdd":
      netApplyDrops(msg.drops);
      break;

    case "invDropAdd":
      netApplyDrops([msg.drop]);
      break;

    case "partyLootAward":
      netApplyPartyLootAward(msg);
      break;

    case "dropGone":
      netRemoveDrop(msg.id);
      break;

    case "botsReset":
      bots.length = 0;   // the old host is gone; wait for the new one's first snapshot
      break;

    case "botHit":
      // I'm the enemy host: someone else's attack landed on one of my
      // enemies — apply it for real (same function offline uses), same as
      // if I'd hit it myself.
      if (netIsBotHost) {
        const bot = bots[msg.idx];
        if (bot && bot.alive) {
          _localDamageBot(bot, msg.amount, msg.isCritical, true);
          if (typeof botGotHit === "function") botGotHit(bot, msg.srcX, msg.srcY);
          // EXP FIX: this hit came from ANOTHER player (msg.from), relayed
          // to me only because I host this room's enemies. If it just
          // killed the bot, credit for the kill belongs to that other
          // player — and their own client already awarded it to them
          // directly, the instant their attack landed (see damageBot()'s
          // guest branch in this file + game.js's per-attack exp blocks).
          // Flagging expAwarded here (with NO local exp given) stops
          // game.js's per-frame catch-all loop from also crediting ME for
          // a kill I didn't make, the next time it runs.
          if (!bot.alive) bot.expAwarded = true;
        }
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Connecting / starting / leaving
// ---------------------------------------------------------------------------
function netConnect(character, serverId, channel) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sock;
    try {
      sock = new WebSocket(getOnlineServerUrl());
    } catch (e) {
      reject(new Error("Bad server address"));
      return;
    }

    // Free hosting can take up to a minute to wake a sleeping server.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch (e) {}
      reject(new Error("Connection timed out. The server may be asleep or down - wait a minute and try again."));
    }, 75000);

    // The account's login token rides along with "join" so the server knows WHICH
    // ACCOUNT this is (that's what lets clans be saved to the account).
    sock.onopen = async () => {
      let token;
      try {
        const r = await window.supabaseClient.auth.getSession();
        token = r && r.data && r.data.session ? r.data.session.access_token : undefined;
      } catch (e) {}
      // LAST POSITION: where this account's character last logged out (saved with the
      // online profile, see olCloudProfile). The server checks it and starts me there.
      let lastPos;
      try {
        const lp = onlineProfile && onlineProfile.lastPosition;
        // Same character -> use the saved spot. Also when the saved name no longer exists on the
        // server (the character was renamed in character_server.js): it is the same account, so
        // the position still counts instead of silently starting at the default spawn.
        if (lp && (lp.character === character || (typeof olCharImages === "object" && Object.keys(olCharImages).length && !olCharImages[lp.character]))) {
          lastPos = { map: lp.map, x: lp.x, y: lp.y };
        }
      } catch (e) {}
      try { sock.send(JSON.stringify({ type: "join", character, server: serverId, channel, name: onlinePlayerName || undefined, token, lastPos })); } catch (e) {}
    };

    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (!settled) {
        if (msg.type === "init") {
          settled = true;
          clearTimeout(timer);
          netSocket = sock;
          myId = msg.id;   // bullet-owner id used by game.js
          window.netMyName = msg.name || null;   // my name as the server accepted it (shown above my own health bar, see game.js)
          netServerId = msg.server;
          netChannel = msg.channel;
          netChannelPvp = !!msg.pvp;   // server decides which channel is PvP
          otherPlayers.clear();
          for (const p of msg.players) netAddRemote(p);
          resolve(msg);
        } else if (msg.type === "full") {
          settled = true;
          clearTimeout(timer);
          reject(new Error("This server is full — try another server"));
        } else if (msg.type === "joinError") {
          settled = true;
          clearTimeout(timer);
          reject(new Error(msg.reason || "Could not join that server"));
        }
        return;
      }
      netHandle(msg);
    };

    sock.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Could not reach the server. Check your internet connection, or the server may be down."));
    };

    sock.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Server closed the connection"));
      } else if (netSocket === sock) {
        netSocket = null;
        if (gameMode === "online" && gameStarted) {
          netToast("Disconnected from server");
          if (typeof window.onOnlineDisconnected === "function") window.onOnlineDisconnected();
        }
      }
    };
  });
}

// Called from the character-select screen once an Online character is
// chosen. Returns true if the match started, false (after showing why) if not.
window.startGameOnline = async function (characterName, serverId, channel) {
  characterName = characterName || "soldier";
  serverId = serverId || 1;
  channel = Number(channel);   // the server rejects a channel that does not exist
  netWakeServer();
  const connectStart = Date.now();
  const showConnecting = () => netStatus(
    "Connecting to server... " + Math.round((Date.now() - connectStart) / 1000) + "s");
  showConnecting();
  const connectTicker = setInterval(showConnecting, 1000);

  let initMsg = null;   // declared OUTSIDE the try so the enemy-host setup below can read it
  try {
    initMsg = await netConnect(characterName, serverId, channel);
    netApplyServerData(initMsg.data);   // online numbers come from the server
    // The server's table is now active: make sure the name matches a character in it.
    if (typeof resolveCharacterName === "function") characterName = resolveCharacterName(characterName);
    // maps: newest server sends WORLD_MAPS; a slightly older one sent a single WORLD_MAP
    const d = initMsg.data || {};
    const maps = d.WORLD_MAPS || (d.WORLD_MAP ? { worldmap: d.WORLD_MAP } : null);
    netOnlineLevel = netRegisterWorldMaps(maps, initMsg.map || d.START_MAP || "worldmap", d.MAP_MUSIC);  // the online maps (initMsg.map = the map I logged out on)
    netRefreshGearFromTables();         // owned weapons/armor use them too
  } catch (err) {
    clearInterval(connectTicker);
    netStatus("");
    const hadOnlineData = netUsingServerData;
    netRestoreOfflineData();
    if (hadOnlineData) netRefreshGearFromTables();
    if (netSocket) { try { netSocket.close(); } catch (e) {} netSocket = null; }
    netServerId = 0;
    netChannel = -1;
    netChannelPvp = false;
    alert("Online mode: " + err.message);
    return false;
  }
  clearInterval(connectTicker);
  // Ghost-HUD fix: switch to the online HUD (hides SAVE/EXIT/PAUSE) BEFORE
  // dropping the "Connecting..." cover below. The caller normally does this
  // itself once this function returns, but that was too late — it left a
  // gap, right as the cover disappeared, where the offline SAVE/EXIT/PAUSE
  // buttons (visible by default) flashed as ghosts before the online HUD
  // took over.
  if (typeof setOnlineHud === "function") setOnlineHud(true);
  netStatus("");

  // Swap this ACCOUNT's online progress in (level, points, gold, gear, skills),
  // parking the offline progress until the player leaves (see olEnterOnlineProfile).
  try {
    olEnterOnlineProfile();
    netRefreshGearFromTables();   // the account's gear uses the server's numbers
  } catch (e) { console.error("Online profile swap failed:", e); }

  // The character this account created is the one whose gear/progress is used.
  try { localStorage.setItem("selectedCharacterName", characterName); } catch (e) {}
  window.startGameOffline(netOnlineLevel, characterName, "online");
  try { olApplySavedCharacter(characterName); } catch (e) { console.error("Restoring saved character failed:", e); }

  // Back on the exact spot where I logged out (the server validated it and sent it in "init").
  if (typeof initMsg.spawnX === "number" && typeof initMsg.spawnY === "number") {
    playerPos.x = initMsg.spawnX;
    playerPos.y = initMsg.spawnY;
  }

  // ENEMIES (PvE): startGameOffline() above just spawned this client's own
  // local enemies (same code path as offline) — decide now whether I'm the
  // one simulating this room's enemies for everyone, or whether I should
  // drop those and wait for the host's snapshot instead (see netSetBotHost).
  netSetBotHost(!!initMsg.botHost, initMsg.bots);
  if (!netIsBotHost && Array.isArray(initMsg.bots) && initMsg.bots.length) {
    netApplyBotsSnapshot(initMsg.bots);
  }
  netApplyDrops(initMsg.drops);   // items other players already left lying around

  // Same loadout hook-up the offline level buttons do after starting.
  if (typeof ensureDefaultWeaponLoaded === "function") ensureDefaultWeaponLoaded(characterName);
  if (typeof ensureDefaultArmorLoaded === "function") ensureDefaultArmorLoaded(characterName);
  if (typeof ensureDefaultSkillsLoaded === "function") ensureDefaultSkillsLoaded(characterName);
  if (typeof applyEquippedWeaponToPlayer === "function") applyEquippedWeaponToPlayer();
  if (typeof applyEquippedArmorToPlayer === "function") applyEquippedArmorToPlayer();
  if (typeof applyEquippedSkillsToPlayer === "function") applyEquippedSkillsToPlayer();

  netToast("Server " + serverId + " · Channel " + channel + (netChannelPvp ? " (PvP)" : " (no player damage)"));
  netSpawnProtectUntil = performance.now() + NET_SPAWN_PROTECT_MS;
netStateTimer = 0;
netSendState();

if (typeof startOnlineAutoSave === "function") {
  startOnlineAutoSave();
}

netParty = null;             // fresh match, fresh party (server never carries one over either)
netRenderPartyPanel();
netUpdatePartyButtonVisibility();

return true;
};

// Leave the arena and close the connection (EXIT button / disconnect).
// skipSave=true is used only when this device was logged in elsewhere and must NOT
// write its (now stale) progress back over the other device's newer save.
window.exitOnlineGame = function (skipSave) {
  if (!skipSave) saveOnlinePlayerData();   // captures the online progress right now, uploads in the background
  stopOnlineAutoSave();

  // existing lines...
  if (netRespawnInterval) {
    clearInterval(netRespawnInterval);
    netRespawnInterval = null;
  }
  const sock = netSocket;
  netSocket = null;               // so onclose doesn't treat this as a drop
  if (sock) { try { sock.close(); } catch (e) {} }

  otherPlayers.clear();
  bullets.length = 0;
  isDead = false;
  deathOverlay.style.display = "none";
  myId = null;
  netServerId = 0;
  netChannel = -1;
  netChannelPvp = false;
  netLevelByMap = {};
  netMapByLevel = {};
  netIsBotHost = false;    // so a stale flag can't leak into the next match
  netBotsTimer = 0;
  netParty = null;
  netRenderPartyPanel();
  netUpdatePartyButtonVisibility();
  netSetPartyPanelOpen(false);
  olCmdReset();                   // hidden CDM button goes away again until the code is retyped

  window.exitOfflineGame();       // stops the loop, clears obstacles
  olLeaveOnlineProfile();         // the online progress is saved; bring the OFFLINE progress back
  // If the character screen is showing again, rebuild it so it shows the CURRENT online level.
  setTimeout(() => {
    try {
      if (olScreens && olScreens.char && getComputedStyle(olScreens.char).display !== "none") olShowCharacter();
    } catch (e) {}
  }, 300);
  const wasOnlineData = netUsingServerData;
  netRestoreOfflineData();        // offline mode goes back to the public files' numbers
  if (wasOnlineData) netRefreshGearFromTables();
  olCmdRefreshBoxes();            // CDM boxes go back to the offline numbers too
  gameMode = null;
  netStatus("");
};
// PROFILE button (top-right, beside EXIT): save, leave the match and go back to the
// Character screen (DELETE / START GAME) — it shows the CURRENT online level.
window.openOnlineProfile = async function () {
  window.exitOnlineGame();          // captures the progress and starts the upload
  netStatus("Saving your progress...");
  await olWaitForSaves(10000);      // wait until the cloud has it
  netStatus("");
  olShowCharacter();
};
// =============================================================================
// ONLINE PROFILE — the account's progress is separate from OFFLINE progress
// =============================================================================
// Online progress (level, exp, stat points, gold, gear, storage, skills) lives in
// Supabase (player_data.game_data.onlineProfile), one per account. While an online
// match is running, that profile is swapped into the game; when the player leaves
// (EXIT / disconnect) it is uploaded and the OFFLINE progress is swapped back.
// So: online and offline never share progress, and "Reset data" (which only wipes
// this device's offline data) can't touch the online account.
//
// The offline values are also parked in localStorage under OL_BACKUP_KEY while an
// online match runs. If the page is closed mid-match, this file (which loads before
// the game reads its saved data) puts them back on the next start.
// (OL_BACKUP_KEY / OL_PROGRESS_KEYS + the offline-profile recovery: public data/online.js)

let onlineProfile = null;          // this account's saved online progress (null until loaded)
let onlineProfileActive = false;   // true while the game is running on the online profile
let olOfflineMemory = null;        // offline progress parked in memory while online is active
let olSaveTimer = null;

function olFreshProfile() {
  return {
    selectedCharacterName: onlineCharacterName || null,
    characterProgress: {},
    gold: 0,
    invEquip: null,
    invGrid: null,
    skillEquip: [],
    friendsList: []
  };
}

// What goes to the cloud: the profile without offline-only bits.
// friendsList comes from window.friendsList (not from `snap` — that's a
// general getProfileSnapshot() the offline side also uses, and never knew
// about friends) so it rides along with the rest of the account's saved
// progress instead of being in-memory-only. See netAddFriend() in the
// "TOUCHING ANOTHER PLAYER" section above.
function olCloudProfile(snap) {
  const prof = {
    selectedCharacterName: snap.selectedCharacterName,
    characterProgress: snap.characterProgress,
    gold: snap.gold,
    invEquip: snap.invEquip,
    invGrid: snap.invGrid,
    skillEquip: snap.skillEquip,
    friendsList: Array.isArray(window.friendsList) ? window.friendsList : []
  };
  // LAST POSITION — map + x/y where the player is right now, so logging in again
  // puts them back on the same spot (sent in "join", checked by the server).
  try {
    const mapKey = netMapByLevel[netOnlineLevel];
    if (gameMode === "online" && mapKey !== undefined && isFinite(playerPos.x) && isFinite(playerPos.y)) {
      prof.lastPosition = { character: player.name, map: mapKey, x: Math.round(playerPos.x), y: Math.round(playerPos.y) };
    } else if (onlineProfile && onlineProfile.lastPosition) {
      prof.lastPosition = onlineProfile.lastPosition;   // not in a match right now: keep the saved one
    }
  } catch (e) {
    if (onlineProfile && onlineProfile.lastPosition) prof.lastPosition = onlineProfile.lastPosition;
  }
  return prof;
}

// Swap the account's online profile INTO the game (called as an online match starts).
function olEnterOnlineProfile() {
  if (onlineProfileActive || typeof window.getProfileSnapshot !== "function") return;
  if (!olOfflineMemory) olOfflineMemory = window.getProfileSnapshot();

  const keys = {};
  for (const k of OL_PROGRESS_KEYS) keys[k] = localStorage.getItem(k);
  // If the offline values were already parked by an earlier login, keep those.
  if (!localStorage.getItem(OL_BACKUP_KEY)) {
    try { localStorage.setItem(OL_BACKUP_KEY, JSON.stringify({ keys })); } catch (e) {}
  }

  const prof = onlineProfile ? JSON.parse(JSON.stringify(onlineProfile)) : olFreshProfile();
  prof.selectedCharacterName = onlineCharacterName || prof.selectedCharacterName;
  window.applyProfileSnapshot(prof);
  onlineProfileActive = true;

  // Restore the account's saved friends (see olCloudProfile() above) instead
  // of starting every session with an empty window.friendsList.
  window.friendsList = Array.isArray(prof.friendsList) ? prof.friendsList.slice() : [];
  if (typeof renderFriendList === "function") renderFriendList();

  // Save soon after every level-up / point spent (game.js reports those here).
  if (!window.persistCharacterProgress || !window.persistCharacterProgress._olWrapped) {
    const orig = window.persistCharacterProgress;
    if (typeof orig === "function") {
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        if (onlineProfileActive) olQueueSave();
        return r;
      };
      wrapped._olWrapped = true;
      window.persistCharacterProgress = wrapped;
    }
  }
}

// Swap the OFFLINE progress back in (called after the online profile was captured/saved).
function olLeaveOnlineProfile() {
  if (!onlineProfileActive) return;
  onlineProfileActive = false;
  if (olOfflineMemory && typeof window.applyProfileSnapshot === "function") {
    window.applyProfileSnapshot(olOfflineMemory);
  }
  olOfflineMemory = null;
  try { localStorage.removeItem(OL_BACKUP_KEY); } catch (e) {}
  // Friends are an online-only concept (see netAddFriend()'s comment) — clear
  // the in-memory list so offline mode's FRIEND window doesn't show a stale
  // one. It's restored from the saved account again next time
  // olEnterOnlineProfile() runs.
  window.friendsList = [];
  if (typeof renderFriendList === "function") renderFriendList();
}

// startGameOffline() only brings back level/exp from the saved progress and
// resets everything else to the character's raw baseline. For an ONLINE account
// we restore the whole character: level, exp, unspent stat points and the points
// already spent (with their stat bonuses), straight from the account's profile.
function olApplySavedCharacter(name) {
  const prog = onlineProfile && onlineProfile.characterProgress ? onlineProfile.characterProgress[name] : null;
  if (typeof player === "undefined") return;
  if (!prog) {
    // Brand-new character: nothing saved, so NO points either. (The previous character's
    // unspent/spent points were still sitting in memory and showed up on the new one.)
    player.statPoints = 0;
    player.spentVit = 0; player.spentDex = 0; player.spentInt = 0; player.spentPow = 0;
    return;
  }

  const cap = (typeof gameRule === "function") ? gameRule("MAX_LEVEL") : 40;
  player.level = Math.max(1, Math.min(cap, Math.round(prog.level) || 1));
  player.exp = Number(prog.exp) || 0;
  if (typeof getExpForLevel === "function") player.maxExp = getExpForLevel(player.level);
  if (typeof getBaseMaxHealthForLevel === "function") {
    player.baseMaxHealth = getBaseMaxHealthForLevel(name, player.level);
    player.health = player.baseMaxHealth;
  }

  player.statPoints = Number(prog.statPoints) || 0;
  player.spentVit = Number(prog.spentVit) || 0;
  player.spentDex = Number(prog.spentDex) || 0;
  player.spentInt = Number(prog.spentInt) || 0;
  player.spentPow = Number(prog.spentPow) || 0;

  // The stats were just reset to the raw baseline: put the spent points' bonuses back.
  if ((player.spentVit || player.spentDex || player.spentInt || player.spentPow) && typeof applyAttributeBonus === "function") {
    const beforeHealth = player.health || 0;
    applyAttributeBonus(player, player.spentVit, player.spentDex, player.spentInt, player.spentPow);
    player.baseMaxHealth = (player.baseMaxHealth || 0) + ((player.health || 0) - beforeHealth);
  }
  player.currentHealth = player.health;
  player.currentMana = player.mana;
}

let olLastSaveNote = "none";
let olLastLoadNote = "not loaded";

function olQueueSave() {
  if (olSaveTimer) return;
  olSaveTimer = setTimeout(() => { olSaveTimer = null; if (onlineProfileActive) saveOnlinePlayerData(); }, 3000);
}

// (olQueueSave is already a global function; index.html calls it directly. Its timer only saves while online.)

// Phone locked / app switched away / app closed: push the latest progress right away.
// The progress is ALSO written to this device first (see olWritePending), so even if
// the app is killed before the upload finishes, the next login uploads it.


function olSaveNowOnLeave() {
  try {
    if (onlineProfileActive && window.getGameMode && window.getGameMode() === "online") saveOnlinePlayerData();
  } catch (e) { console.error("Save on leave failed:", e); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") olSaveNowOnLeave(); });
window.addEventListener("pagehide", olSaveNowOnLeave);

// ---- Local "pending" copy: last online progress that may not have reached the cloud yet.
let olKnownUid = null;
function olPendingKey(uid) { return "olPending:" + uid; }
function olWritePending(uid, payload) {
  try { localStorage.setItem(olPendingKey(uid), JSON.stringify(payload)); } catch (e) {}
}
function olReadPending(uid) {
  try { const r = localStorage.getItem(olPendingKey(uid)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function olClearPending(uid, savedAt) {
  try {
    const cur = olReadPending(uid);
    if (cur && cur.savedAt <= savedAt) localStorage.removeItem(olPendingKey(uid));
  } catch (e) {}
}

// Write the row WITHOUT relying on upsert (upsert needs INSERT *and* UPDATE policies;
// a plain update only needs UPDATE). Falls back to insert when the row doesn't exist.
function olIsNetworkError(err) {
  return !!err && /failed to fetch|networkerror|network request|load failed|timeout|aborted|fetch/i.test(String(err.message || err));
}
function olSleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

// ---- ACCOUNT API: every WRITE to the player's cloud row goes through the game server ----
// The browser can no longer write the player_data table itself (see supabase_lockdown.sql);
// it can only READ its own row. Saves and the "which device owns the account" claim are sent
// to the server (server.js /api/save and /api/session), which checks them (save_guard.js)
// and then writes with its own key.
function olApiBase() { return getOnlineServerUrl().replace(/^ws/i, "http"); }

async function olApiPost(path, body, opts) {
  const s = await window.supabaseClient.auth.getSession();
  const tok = s && s.data && s.data.session && s.data.session.access_token;
  if (!tok) return { status: 401, json: { error: "UNAUTHORIZED" } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);   // a sleeping free host can take ~1 min to wake
  try {
    const res = await fetch(olApiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: "no-store",
      keepalive: !!(opts && opts.keepalive)   // small requests sent while the app is closing
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { status: res.status, json: json || {} };
  } finally { clearTimeout(timer); }
}

// The server cut the gold down (it could not explain the amount): follow it.
function olApplyServerGold(fixed) {
  try {
    if (typeof playerGold === "number" && typeof addGold === "function" && playerGold > fixed) {
      console.warn("Server corrected gold: " + playerGold + " -> " + fixed);
      addGold(fixed - playerGold);
    }
  } catch (e) {}
}

// Sends the save to the server, which atomically stores it ONLY IF it is newer than what's
// already there and answers with exactly what the database now holds (same shape as before),
// so there is no need to read the row back afterwards to find out whether the save "stuck".
async function olCloudWriteOnce(user, payload) {
  const r = await olApiPost("/api/save", { session: olSessionId || null, game_data: payload });
  const j = r.json || {};
  // Another account already uses this character name (checked BEFORE the session check: it is also a 409).
  if (j.error === "NAME_TAKEN") return { error: { message: "NAME_TAKEN" } };
  // The server refuses saves from any device that does not own the account right now.
  if (r.status === 409 || j.error === "SESSION_TAKEN") {
    olHandleKicked("A: server refused the save (owner=" + String(olSessionId).slice(0, 8) + ", claimed=" + olSessionClaimed + ")");
    return { error: { message: "SESSION_TAKEN" }, kicked: true };
  }
  if (r.status !== 200 || !j.ok) {
    const code = j.error || ("HTTP " + r.status);
    // busy / asleep / no database key yet: worded so the retry logic treats it like a network hiccup
    if (r.status >= 500 || r.status === 429) return { error: { message: "fetch failed (HTTP " + r.status + " " + code + ")" } };
    return { error: { message: "save refused: " + code } };
  }
  if (typeof j.goldFixed === "number") olApplyServerGold(j.goldFixed);
  const data = j.cloud || null;
  olLastEcho = data && data.savedAt ? data.savedAt : "none";
  return { error: null, cloud: data };
}

// Same write, but a network hiccup ("Failed to fetch": weak signal, wifi <-> mobile data
// switch, the phone waking up) is retried a few times before giving up.
async function olCloudWrite(user, payload) {
  let last = null;
  const waits = [0, 1500, 4000, 4000];
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await olSleep(waits[i]);
    try {
      const r = await olCloudWriteOnce(user, payload);
      if (!r.error) return r;
      if (r.kicked) return r;
      last = r.error;
    } catch (e) {
      last = { message: String((e && e.message) || e) };
    }
    if (!olIsNetworkError(last)) return { error: last };
  }
  return { error: last };
}

// Can this phone reach Supabase at all right now? Used only to explain a failed save.
async function olProbeHost() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(SUPABASE_URL + "/auth/v1/health", { headers: { apikey: SUPABASE_KEY }, signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return "host reachable (" + r.status + ")";
  } catch (e) {
    return "host NOT reachable";
  }
}

// After a failed save keep trying in the background (progress is safe on the device meanwhile).
let olRetryTimer = null;
function olScheduleRetry(uid) {
  if (olRetryTimer) return;
  olRetryTimer = setTimeout(() => {
    olRetryTimer = null;
    const pend = olReadPending(uid);
    if (!pend) return;
    const run = () => olUploadPayload(pend);
    olSaveChain = olSaveChain.then(run, run).catch(() => {});
  }, 10000);
}
window.addEventListener("online", () => {
  if (olKnownUid && olReadPending(olKnownUid)) olScheduleRetry(olKnownUid);
});

// Local session lookup (no network round-trip) — much faster/safer when the app is closing.
async function olCurrentUser() {
  try {
    const s = await window.supabaseClient.auth.getSession();
    if (s && s.data && s.data.session && s.data.session.user) return s.data.session.user;
  } catch (e) {}
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    return user || null;
  } catch (e) { return null; }
}

// =============================================================================
// ONLINE ACCOUNT SYSTEM — Supabase
// =============================================================================

let onlineAccountScreen = null;

console.log("ONLINE.JS: account section reached");

// ============================================================
// SUPABASE ONLINE PLAYER DATA
// ============================================================

async function loadOnlinePlayerData() {
  if (!window.supabaseClient) {
    console.log("Supabase client not loaded.");
    return false;
  }

  const user = await olCurrentUser();

  if (!user) {
    console.log("No online user to load.");
    return false;
  }
  olKnownUid = user.id;
  await olWaitForSaves();   // a save that is still uploading must land BEFORE we read the row back

  try {
    let data = await olRestSelect(user.id, "game_data");   // never a cached/old answer
    let error = null;
    if (data === undefined) {
      const r = await window.supabaseClient.from("player_data").select("game_data").eq("id", user.id).maybeSingle();
      data = r.data; error = r.error;
    }

    if (error) {
      console.error("Load online player data error:", error);
      olLastLoadNote = "ERROR " + (error.message || "").slice(0, 70);
      return false;
    }

    const gd = data && data.game_data;
    olCloudBase = (gd && gd.savedAt) || 0;   // what the cloud held when we loaded it
    olStale = false;
    olConflictShown = false;

    // Which character this account created for online play (if any).
    onlineCharacterName = olValidCharacter(gd && gd.onlineCharacter)
      || olValidCharacter(localStorage.getItem("onlineCharacter:" + user.id));
    // The typed character name is part of the ACCOUNT's cloud data, so it follows the
    // account to any phone (this device's copy is only a fallback).
    onlinePlayerName = (gd && typeof gd.onlinePlayerName === "string" && gd.onlinePlayerName.trim())
      || localStorage.getItem("onlinePlayerName:" + user.id)
      || null;
    if (onlinePlayerName) { try { localStorage.setItem("onlinePlayerName:" + user.id, onlinePlayerName); } catch (e) {} }

    // Park the offline progress as it is right now (before anything online touches it).
    if (!onlineProfileActive && typeof window.getProfileSnapshot === "function") {
      olOfflineMemory = window.getProfileSnapshot();
    }

    // Newest progress that may not be in the cloud row yet: the copy saved on this
    // device (app closed / offline) or the one this page session just made
    // (EXIT / PROFILE, then straight back in). The NEWEST of cloud / device / session wins,
    // so an old cloud row can never bring the character back to a lower level.
    let pending = olReadPending(user.id);
    if (olLastPayload && olLastPayloadUid === user.id && (!pending || olLastPayload.savedAt > pending.savedAt)) {
      pending = olLastPayload;
    }
    // A local copy is only trusted if the cloud has NOT changed since that copy was made
    // (pending.base = the cloud version it was built on). If another device saved in the
    // meantime, the local copy is OLD and must never replace the account's newer data.
    // (Comparing device clocks was not safe: two phones never agree on the time.)
    if (pending && gd && gd.savedAt && !(pending.savedAt > gd.savedAt && (pending.base || 0) >= gd.savedAt)) {
      if (pending.savedAt !== gd.savedAt) console.log("Dropped an old device copy - the account has newer data in the cloud.");
      olClearPending(user.id, Number.MAX_SAFE_INTEGER);
      if (olLastPayload && olLastPayloadUid === user.id) olLastPayload = null;
      pending = null;
    }
    if (pending && pending.onlineProfile && (!gd || !gd.savedAt || pending.savedAt > gd.savedAt)) {
      onlineProfile = pending.onlineProfile;
      // (a saved null means the character was deleted - don't fall back to the older cloud/device name)
      onlineCharacterName = ("onlineCharacter" in pending)
        ? olValidCharacter(pending.onlineCharacter)
        : onlineCharacterName;
      // same for the name (a saved null = the character was deleted, name cleared)
      if ("onlinePlayerName" in pending) onlinePlayerName = pending.onlinePlayerName || null;
      console.log("Recovered unsent online progress from this device.");
      olLastLoadNote = "recovered newer copy (device/session)";
      olMyWrites.add(pending.savedAt);
      const r = await olCloudWrite(user, pending);
      if (!r.error && r.cloud && r.cloud.savedAt >= pending.savedAt) {
        olClearPending(user.id, pending.savedAt);
        olCloudBase = r.cloud.savedAt;
      } else if (!r.error) {
        olLastSaveNote = "NOT STORED - kept on device, retrying"; olScheduleRetry(user.id);
      } else { olLastSaveNote = "FAILED " + (r.error.message || "").slice(0, 70) + " (retrying)"; olScheduleRetry(user.id); }
      return true;
    }

    if (gd && gd.onlineProfile) {
      onlineProfile = gd.onlineProfile;          // returning player: their saved online progress
      console.log("Online player data loaded.");
      const cp = onlineProfile.characterProgress || {};
      olLastLoadNote = "cloud row found, chars:" + JSON.stringify(Object.keys(cp).map(k => k + ":lv" + cp[k].level)) +
        " grid items:" + (Array.isArray(onlineProfile.invGrid) ? onlineProfile.invGrid.filter(Boolean).length : 0) + " v" + String(gd.savedAt || 0).slice(-6);
      return true;
    }

    // First time this account is used online: a FRESH profile (level 1) — it does
    // not inherit anything from offline play.
    onlineProfile = olFreshProfile();
    olLastLoadNote = "no cloud row -> fresh profile";
    const firstSavedAt = Date.now();
    olMyWrites.add(firstSavedAt);
    const { error: insertError } = await olCloudWrite(user,
      { onlineCharacter: onlineCharacterName, onlinePlayerName: onlinePlayerName || null, onlineProfile, savedAt: firstSavedAt });

    if (!insertError) olCloudBase = firstSavedAt;
    if (insertError) {
      console.error("Create online player data error:", insertError);
      olLastSaveNote = "FAILED " + (insertError.message || "").slice(0, 70);
      // Keep playing with a fresh profile; saves will keep retrying (and keep a local copy).
      return true;
    }

    console.log("New online player data created.");
    return true;

  } catch (err) {
    console.error("Load online player data exception:", err);
    return false;
  }
}


// Saves run ONE AT A TIME, in the order they were made. Before, autosave / level-up /
// EXIT saves could overlap and an older one could reach the cloud LAST, putting the
// character back to a lower level.
let olSaveChain = Promise.resolve();
let olNewestSavedAt = 0;
// CROSS-DEVICE SAFETY — the savedAt of the cloud copy this session last loaded or
// saved. Before every upload the cloud row is checked: if ANOTHER phone saved
// since (a newer savedAt that isn't one of our own writes), this phone's data is
// stale and must NOT overwrite it (that's how a deleted level-9 character used to
// come back from a phone that still had the old copy open).
let olCloudBase = 0;
let olLastEcho = null;   // savedAt the server echoed back right after our last update
const olMyWrites = new Set();   // savedAt values written by this session
let olStale = false;            // true once a conflict was detected: no more uploads until reload
let olConflictShown = false;
let olLastPayload = null;        // newest payload made in this page session
let olLastPayloadUid = null;

// =============================================================================
// SINGLE ACTIVE SESSION — only one device may be logged into an account at once.
// On login this device writes a random id into player_data.active_session
// (claiming the account); a poll then watches that column, and if it ever shows
// a DIFFERENT id, some other device has logged in since and claimed it instead —
// this device is kicked out (and must not save, or it would stomp the newer data).
// Requires the active_session column from single_session_setup.sql; if that
// migration hasn't been run yet, the update/select below just error silently and
// this feature is inactive (no crash, no behavior change).
// =============================================================================

// Reads columns of this account's row with a plain REST call that can NEVER come from a
// cache (a phone webview may hand back an OLD answer to a normal read - that made a stale
// level show up and hid the "logged in elsewhere" change). Returns the row object,
// null (no row), or undefined (couldn't check).
async function olRestSelect(uid, cols) {
  try {
    const s = await window.supabaseClient.auth.getSession();
    const tok = s && s.data && s.data.session && s.data.session.access_token;
    if (!tok) return undefined;
    const r = await fetch(SUPABASE_URL + "/rest/v1/player_data?select=" + cols + "&id=eq." + encodeURIComponent(uid) + "&id=neq." + olNewSessionId(), {   // valid cache-buster (an unknown "_" param is rejected by PostgREST, which forced the cached fallback below)
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + tok, Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
      cache: "no-store"
    });
    if (!r.ok) return undefined;
    const rows = await r.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) { return undefined; }
}

let olSessionId = null;
let olSessionWatchTimer = null;
let olSessionUid = null;
let olSessionClaimed = false;   // true only once the DB has been read back showing OUR id
let olKicked = false;

// The DB column is type uuid, so the id MUST be a valid UUID. crypto.randomUUID() is missing
// in some phone webviews / plain-http pages; the old fallback text id was rejected by the
// database, so that device silently never claimed the account (and could not be kicked).
function olNewSessionId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  const b = new Array(16);
  try { crypto.getRandomValues(b = new Uint8Array(16)); }
  catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => (x + 0x100).toString(16).slice(1)).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}
let olSessionNote = "no claim yet";

function olStopSessionWatch() {
  if (olSessionWatchTimer) { clearInterval(olSessionWatchTimer); olSessionWatchTimer = null; }
}

async function olHandleKicked(why) {
  if (olKicked) return;
  olKicked = true;
  olStale = true;   // block any further save this device might still have queued
  olStopSessionWatch();
  try { stopOnlineAutoSave(); } catch (e) {}
  // This device's copy is now OLD: throw it away everywhere so it can never be
  // "recovered" over the newer account data on the next login.
  olLastPayload = null;
  try { if (olSessionUid) localStorage.removeItem(olPendingKey(olSessionUid)); } catch (e) {}
  try { if (olKnownUid) localStorage.removeItem(olPendingKey(olKnownUid)); } catch (e) {}
  try {
    if (window.getGameMode && window.getGameMode() === "online") window.exitOnlineGame(true);
  } catch (e) {}
  try { if (olSessionUid) localStorage.removeItem(olPendingKey(olSessionUid)); } catch (e) {}
  alert("This account was logged in on another device, so this phone has been signed out of online play." + (why ? "\n\n[reason " + why + "]" : ""));
  try { location.reload(); } catch (e) {}
}

// Reads which device currently owns the account.
// Returns "mine", "other", or "unknown" (network error / no row / column missing).
async function olReadSessionOwner(uid) {
  try {
    let data = await olRestSelect(uid, "active_session");
    if (data === undefined) {   // REST check impossible: fall back to the normal client
      const r = await window.supabaseClient.from("player_data").select("active_session").eq("id", uid).neq("id", olNewSessionId()).maybeSingle();
      if (r.error) return "unknown";
      data = r.data;
    }
    if (!data || !data.active_session) return "unknown";
    return data.active_session === olSessionId ? "mine" : "other";
  } catch (e) { return "unknown"; }
}

// "other" is only believed after a second read a moment later (one odd answer
// must never sign a device out).
async function olSessionTakenByOther(uid) {
  if (!olSessionClaimed || olKicked || !olSessionId) return false;
  if ((await olReadSessionOwner(uid)) !== "other") return false;
  await olSleep(1500);
  return (await olReadSessionOwner(uid)) === "other";
}

let olClaiming = false;
async function olCheckSessionNow(uid) {
  if (olKicked || olClaiming) return;
  if (!olSessionClaimed) { await olClaimSession(uid, false); return; }   // claim failed earlier: retry only if the account is NOT owned by someone else
  if (await olSessionTakenByOther(uid)) olHandleKicked("B: background check, another id owns the row");
}

function olStartSessionWatch(uid) {
  olStopSessionWatch();
  olSessionWatchTimer = setInterval(() => { olCheckSessionNow(uid); }, 10000);
}

// A phone that was asleep / in the background wakes up: check right away, BEFORE it
// can save anything (background timers are frozen, so the 10 s poll can be very late).
// This re-CLAIMS (not just checks) because going to background now releases the claim
// (see olReleaseSessionOnExit below) — a brief backgrounding must restore it on return,
// or the row would sit unclaimed until the next full login, letting some other device
// claim it with no conflict warning to either side.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && olSessionUid) olClaimSession(olSessionUid, false);
});

// Clears active_session back to null, but ONLY if it still holds OUR session id
// (the eq() below is the guard: if some other device has since claimed the row,
// this update matches nothing and their claim is left untouched).
// Uses a raw fetch with keepalive so the request can still reach the server even
// if the page/app is being torn down right after this call (a normal supabase-js
// call has no such guarantee once beforeunload/pagehide starts).
async function olReleaseSession(uid, sid) {
  if (!uid || !sid) return false;
  try {
    // The server clears the claim, and only if it still holds OUR session id.
    const r = await olApiPost("/api/session", { action: "release", session: sid }, { keepalive: true });
    if (r.status === 200 && r.json && r.json.ok) {
      console.log("SESSION RELEASE: active_session cleared.");
      return true;
    }
    console.warn("SESSION RELEASE refused:", r.status, r.json);
    return false;
  } catch (e) {
    console.error("SESSION RELEASE EXCEPTION:", e);
    return false;
  }
}

// Closing or backgrounding this device should free the slot: without this, the account
// stays "claimed" by this device forever in the DB, and the NEXT device to open it
// (even this same phone, later) gets kicked with "reason C" even though nothing is
// actually still logged in anywhere. Only the device that currently holds the claim can
// release it, and only if nothing has re-claimed it since (see the eq() guard above).
function olReleaseSessionOnExit() {
  if (olSessionClaimed && olSessionUid && olSessionId) olReleaseSession(olSessionUid, olSessionId);
}

// Full LOG OUT (from the in-game OPTIONS popup) — different from EXIT / going to
// the Character screen: those just leave the current match while staying signed
// in, so the account is still "claimed" by this device afterward. This instead:
//   1. saves whatever progress is pending,
//   2. releases the active_session claim (order matters: this needs the still-
//      valid auth token, so it must happen BEFORE signOut),
//   3. signs out of Supabase entirely, so the login screen asks for the
//      password again next time instead of silently reusing the old session,
//   4. clears this device's in-memory session state so a later login starts
//      completely fresh rather than tangled up with the old claim/uid.
// The actual screen change (closing the match, showing the start menu) is left
// to the caller — see the gameOptionsLogoutBtn handler in index.html.
window.olFullLogout = async function () {
  // Stop the watcher first so it cannot interfere with logout.
  olStopSessionWatch();

  // Stop automatic save timers.
  try {
    if (olSaveTimer) {
      clearTimeout(olSaveTimer);
      olSaveTimer = null;
    }
  } catch (e) {}

  try {
    if (olRetryTimer) {
      clearTimeout(olRetryTimer);
      olRetryTimer = null;
    }
  } catch (e) {}

  // Save current progress before logout.
  try {
    if (onlineProfileActive) {
      saveOnlinePlayerData();
      await olWaitForSaves(8000);
    }
  } catch (e) {
    console.error("LOGOUT SAVE ERROR:", e);
  }

  // Save these BEFORE clearing them.
  const logoutUid = olSessionUid;
  const logoutSessionId = olSessionId;

  // IMPORTANT:
  // Clear the database session BEFORE signing out of Supabase.
  let released = false;

  try {
    released = await olReleaseSession(
      logoutUid,
      logoutSessionId
    );
  } catch (e) {
    console.error("LOGOUT RELEASE ERROR:", e);
  }

  console.log(
    "LOGOUT SESSION RELEASE:",
    released ? "SUCCESS" : "FAILED"
  );

  // Clear local session state.
  olKicked = false;
  olSessionClaimed = false;
  olSessionId = null;
  olSessionUid = null;
  olKnownUid = null;
  olSessionNote = released
    ? "logged out"
    : "logout release failed";

  olStale = false;
  olConflictShown = false;
  olLastPayload = null;
  olLastPayloadUid = null;

  // Bring the OFFLINE progress back (this used to be skipped by forcing
  // onlineProfileActive = false first, which left online data in the offline save).
  try { olLeaveOnlineProfile(); } catch (e) {}
  onlineProfile = null;

  // Finally sign out ONLY this device's Supabase session.
  try {
    if (window.supabaseClient && window.supabaseClient.auth) {
      const { error } =
        await window.supabaseClient.auth.signOut({
          scope: "local"
        });

      if (error) {
        console.error("SUPABASE LOGOUT ERROR:", error);
      }
    }
  } catch (e) {
    console.error("SUPABASE LOGOUT EXCEPTION:", e);
  }
};



// Claims the account for this device and VERIFIES it by reading the row back.
// fresh=true (a new login) makes a new id; fresh=false re-asserts the current one
// (used after the row has just been created for a brand-new account).
// The watcher only starts once the claim is confirmed, so a failed claim can never
// make this device kick ITSELF out (the old id from the other device stayed in the row).
async function olClaimSession(uid, fresh) {
  if (olClaiming) return olSessionClaimed;
  olClaiming = true;
  try {
    if (fresh || !olSessionId || olSessionUid !== uid) {
      olSessionId = olNewSessionId();
      olKicked = false;
    }
    olSessionUid = uid;
    if (!fresh) {
      // Re-assert / retry: NEVER take the account from another device.
      const owner0 = await olReadSessionOwner(uid);
      if (owner0 === "mine") { olSessionClaimed = true; olSessionNote = "claimed"; olStartSessionWatch(uid); return true; }
      if (owner0 === "other") { olSessionClaimed = false; olSessionNote = "LOST - account owned by another device"; olHandleKicked("C: re-claim found another id (fresh=" + fresh + ")"); return false; }
    }
    olSessionClaimed = false;
    let why = "";
    for (let i = 0; i < 3 && !olSessionClaimed; i++) {
      try {
        // The server upserts the row (a brand-new account confirmed by email link has no
        // player_data row yet at first login) and changes only active_session.
        const r = await olApiPost("/api/session", { action: "claim", session: olSessionId });
        if (r.status !== 200 || !(r.json && r.json.ok)) why = "claim: " + ((r.json && r.json.error) || ("HTTP " + r.status));
        else {
          const owner = await olReadSessionOwner(uid);
          if (owner === "mine") olSessionClaimed = true; else why = "read-back: " + owner;
        }
      } catch (e) { why = String((e && e.message) || e).slice(0, 60); }
      if (!olSessionClaimed && i < 2) await olSleep(800);
    }
    olSessionNote = olSessionClaimed ? "claimed" : ("NOT claimed (" + why + ")");
    olStartSessionWatch(uid);   // keeps running; retries the claim if needed
    return olSessionClaimed;
  } finally { olClaiming = false; }
}

function olWaitForSaves(maxMs) {
  return Promise.race([
    olSaveChain.catch(() => {}),
    new Promise((res) => setTimeout(res, maxMs || 10000))
  ]);
}

// Reads this account's cloud row DIRECTLY (plain REST call, HTTP cache off, using the
// login token) — so a cached or lagging answer can't make a good save look lost.
// Returns the game_data object, null (no row), or undefined (couldn't check).
async function olFetchCloudRow(uid) {
  try {
    const s = await window.supabaseClient.auth.getSession();
    const tok = s && s.data && s.data.session && s.data.session.access_token;
    if (!tok) return undefined;
    const r = await fetch(SUPABASE_URL + "/rest/v1/player_data?select=game_data&id=eq." + encodeURIComponent(uid) + "&_=" + Date.now(), {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + tok, Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store"
    });
    if (!r.ok) return undefined;
    const rows = await r.json();
    return rows && rows[0] ? (rows[0].game_data || null) : null;
  } catch (e) { return undefined; }
}

async function olUploadPayload(payload) {
  if (payload.savedAt < olNewestSavedAt) return true;   // a newer save is queued behind this one
  const user = await olCurrentUser();
  if (!user) {
    console.log("No online user to save.");
    olLastSaveNote = "FAILED no login session";
    return false;
  }
  olKnownUid = user.id;

  // Another phone changed this account since we loaded it? Then this phone's copy is
  // stale: don't overwrite the newer data (and drop the stale device copy).
  if (olStale) {
    olLastSaveNote = "BLOCKED - account changed on another device";
    return false;
  }

  // Still the device that owns the account? (another phone may have logged in since)
  if (await olSessionTakenByOther(user.id)) {
    olHandleKicked("D: check before saving");
    olLastSaveNote = "BLOCKED - account taken by another device";
    return false;
  }
  if (olKicked) return false;

  olWritePending(user.id, payload);
  olMyWrites.add(payload.savedAt);

  try {
    const { error, cloud } = await olCloudWrite(user, payload);
    if (error) {
      if (olKicked) { olLastSaveNote = "BLOCKED - account taken by another device"; return false; }
      if (error.message === "NAME_TAKEN") {   // someone took this name a moment ago: drop it and ask for another
        olClearPending(user.id, payload.savedAt);
        olNameWasTaken(user.id);
        olLastSaveNote = "NAME TAKEN - choose another name";
        return false;
      }
      console.error("Save online player data error:", error);
      const kb = Math.round(JSON.stringify(payload).length / 1024);
      olLastSaveNote = "FAILED " + (error.message || "").slice(0, 50) + " (" + kb + "KB, retrying)";
      olScheduleRetry(user.id);
      olProbeHost().then((h) => { if (/^FAILED/.test(olLastSaveNote)) olLastSaveNote += " | " + h; });
      return false;
    }

    // save_player_data() is atomic: `cloud` is exactly what the database now holds,
    // from the SAME transaction that tried to write it. No follow-up read needed.
    const stored = cloud && cloud.savedAt;
    const cp = payload.onlineProfile && payload.onlineProfile.characterProgress || {};
    const lvTxt = Object.keys(cp).map(k => k + ":lv" + cp[k].level).join(",") || "-";

    if (!stored || stored < payload.savedAt) {
      // Shouldn't happen (the DB function always stores or reports the newer row) -
      // stay defensive and keep the data on device, retrying.
      olLastSaveNote = "NOT STORED - cloud row has savedAt=" + (stored || "none") + " but this save is " + payload.savedAt + " - kept on device, retrying";
      olScheduleRetry(user.id);
      return false;
    }

    if (stored > payload.savedAt && !olMyWrites.has(stored)) {
      // The database rejected our write because a save we don't recognize (higher
      // savedAt, not one of ours) is already stored - another device changed this
      // account since we loaded it. Keep that newer data; don't touch it further.
      olStale = true;
      try { localStorage.removeItem(olPendingKey(user.id)); } catch (e) {}
      olLastSaveNote = "CONFLICT - account changed on another device";
      if (!olConflictShown) {
        olConflictShown = true;
        setTimeout(() => alert("This account was changed on another device, so this phone's progress was NOT saved (to protect the newer data). Close the game and log in again to load your latest data."), 0);
      }
      return false;
    }

    olClearPending(user.id, payload.savedAt);
    olCloudBase = Math.max(olCloudBase, stored);
    olLastSaveNote = "ok " + new Date().toLocaleTimeString() + " [" + lvTxt + "]";
    console.log("Online player data saved.");
    return true;
  } catch (err) {
    console.error("Save online player data exception:", err);
    olLastSaveNote = "FAILED " + String((err && err.message) || err).slice(0, 70);
    olScheduleRetry(user.id);
    return false;
  }
}

async function saveOnlinePlayerData() {
  if (!window.supabaseClient) {
    console.log("Supabase client not loaded.");
    return false;
  }

  // A device that was signed out (account used elsewhere) must not save anything -
  // not even a local copy, or that old copy could later overwrite the newer account data.
  if (olKicked) return false;

  // Capture the progress FIRST (synchronously) — the caller may tear the match
  // down right after calling this, before the network round-trip finishes.
  if (onlineProfileActive && typeof window.getProfileSnapshot === "function") {
    onlineProfile = olCloudProfile(window.getProfileSnapshot());
  }
  // Never upload before the account's data has been loaded: it would replace the
  // real saved progress with nothing.
  if (!onlineProfile) {
    console.log("Online profile not loaded yet - nothing to save.");
    return false;
  }
  // Always newer than the cloud copy this session loaded, even if this phone's clock is behind.
  olNewestSavedAt = Math.max(Date.now(), olNewestSavedAt + 1, olCloudBase + 1);
  const payload = {
    base: olCloudBase,   // the cloud version this save was built on (see loadOnlinePlayerData)
    onlineCharacter: onlineCharacterName || null,
    onlinePlayerName: onlinePlayerName || null,
    onlineProfile: JSON.parse(JSON.stringify(onlineProfile)),
    savedAt: olNewestSavedAt
  };
  olLastPayload = payload;
  olLastPayloadUid = olKnownUid;

  // Keep a copy on this device right away (synchronously — the app may be closing);
  // it is removed once the cloud confirms the save.
  if (olKnownUid) olWritePending(olKnownUid, payload);

  const run = () => olUploadPayload(payload);
  const p = olSaveChain.then(run, run);
  olSaveChain = p.catch(() => {});
  return p;
}


window.loadOnlinePlayerData = loadOnlinePlayerData;
window.saveOnlinePlayerData = saveOnlinePlayerData;

// ============================================================
// AUTOMATIC ONLINE SAVE
// ============================================================

let onlineAutoSaveTimer = null;

function startOnlineAutoSave() {
  stopOnlineAutoSave();

  onlineAutoSaveTimer = setInterval(() => {
    if (window.getGameMode && window.getGameMode() === "online") {
      saveOnlinePlayerData();
    }
  }, 10000);
}

function stopOnlineAutoSave() {
  if (onlineAutoSaveTimer) {
    clearInterval(onlineAutoSaveTimer);
    onlineAutoSaveTimer = null;
  }
}

window.startOnlineAutoSave = startOnlineAutoSave;
window.stopOnlineAutoSave = stopOnlineAutoSave;

// Every Supabase auth call goes through here so a failure is always SHOWN as a
// message (before, a missing/blocked login library or a network error left the
// screen stuck on "Logging in..." with no explanation).
async function olSafeAuth(method, ...args) {
  if (!window.supabaseClient || !window.supabaseClient.auth) {
    return { data: {}, error: { message: "The login service did not load (weak or blocked connection). Reload the game and try again." } };
  }
  try {
    return await window.supabaseClient.auth[method](...args);
  } catch (e) {
    return { data: {}, error: { message: "Could not reach the login service: " + ((e && e.message) || e) + ". Check your internet connection." } };
  }
}

// Ask the game server to wake up early (free hosting sleeps when idle and takes
// up to a minute to start), so it is ready by the time the player picks a server.
function netWakeServer() {
  try {
    const url = getOnlineServerUrl().replace(/^ws/, "http") + "/servers";
    fetch(url, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  } catch (e) {}
}

function openOnlineAccountScreen() {
  netWakeServer();
  if (onlineAccountScreen) {
    // Clear the old "Login successful." (or error) text left from the previous visit.
    try {
      const m = document.getElementById("onlineAccountMessage");
      if (m) m.textContent = "";
    } catch (e) {}
    onlineAccountScreen.style.display = "flex";
    return;
  }

  onlineAccountScreen = document.createElement("div");
  onlineAccountScreen.id = "onlineAccountScreen";
  onlineAccountScreen.style.cssText =
    "position:fixed;inset:0;z-index:30000;background:#050505;color:#fff;" +
    "display:flex;align-items:center;justify-content:center;" +
    "font-family:'Courier New',monospace;padding:20px;box-sizing:border-box;";

  onlineAccountScreen.innerHTML = `
    <div style="
      width:min(420px,100%);
      background:#101010;
      border:2px solid #4df;
      border-radius:12px;
      box-shadow:0 0 25px rgba(68,221,255,.35);
      padding:24px;
      box-sizing:border-box;
    ">
      <div style="
        text-align:center;
        color:#4df;
        font-size:24px;
        font-weight:bold;
        letter-spacing:3px;
        margin-bottom:24px;
      ">ONLINE ACCOUNT</div>

      <input id="onlineEmailInput"
        type="email"
        autocomplete="email"
        placeholder="Email / Gmail"
        style="
          width:100%;
          padding:14px;
          margin-bottom:12px;
          box-sizing:border-box;
          background:#181818;
          color:#fff;
          border:1px solid #555;
          border-radius:6px;
          font:16px Arial;
        ">

      <input id="onlinePasswordInput"
        type="password"
        autocomplete="current-password"
        placeholder="Password"
        style="
          width:100%;
          padding:14px;
          margin-bottom:16px;
          box-sizing:border-box;
          background:#181818;
          color:#fff;
          border:1px solid #555;
          border-radius:6px;
          font:16px Arial;
        ">

      <button id="onlineLoginBtn" style="
        width:100%;
        padding:13px;
        margin-bottom:10px;
        background:#168aad;
        color:#fff;
        border:0;
        border-radius:6px;
        font:bold 16px Arial;
      ">LOGIN</button>

      <button id="onlineCreateBtn" style="
        width:100%;
        padding:13px;
        margin-bottom:10px;
        background:#333;
        color:#fff;
        border:1px solid #777;
        border-radius:6px;
        font:bold 16px Arial;
      ">CREATE ACCOUNT</button>

      <button id="onlineForgotBtn" style="
        width:100%;
        padding:10px;
        margin-bottom:8px;
        background:none;
        color:#4df;
        border:0;
        font:14px Arial;
      ">FORGOT PASSWORD?</button>

      <button id="onlineChangeBtn" style="
        width:100%;
        padding:10px;
        margin-bottom:14px;
        background:none;
        color:#aaa;
        border:0;
        font:14px Arial;
      ">CHANGE PASSWORD</button>

      <button id="onlineAccountBackBtn" style="
        width:100%;
        padding:11px;
        background:#222;
        color:#fff;
        border:1px solid #555;
        border-radius:6px;
        font:bold 14px Arial;
      ">BACK</button>

      <div id="onlineAccountMessage" style="
        min-height:20px;
        margin-top:16px;
        text-align:center;
        color:#aaa;
        font:14px Arial;
      "></div>
    </div>
  `;

  document.body.appendChild(onlineAccountScreen);

  const emailInput = document.getElementById("onlineEmailInput");
  const passwordInput = document.getElementById("onlinePasswordInput");
  const message = document.getElementById("onlineAccountMessage");

  function showAccountMessage(text, good = false) {
    message.textContent = text;
    message.style.color = good ? "#6f6" : "#ff8888";
  }

  document.getElementById("onlineLoginBtn").onclick = async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showAccountMessage("Enter your email and password.");
      return;
    }

    showAccountMessage("Logging in...", true);

    const { data, error } = await olSafeAuth("signInWithPassword", {
      email,
      password
    });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    if (!data.user) {
      showAccountMessage("Login failed.");
      return;
    }

    showAccountMessage("Login successful.", true);

setTimeout(async () => {
  // Ghost-HUD fix: keep this screen up (it's opaque, z-index:30000) while
  // the account/data loads instead of hiding it right away — hiding it
  // here used to leave a gap, before the next screen is ready, where
  // nothing covered the gameplay HUD underneath and the SAVE/EXIT/PAUSE
  // buttons (visible by default, see index.html) showed through as
  // ghosts. Only hide it once we're about to hand off to the next screen.
  showAccountMessage("Loading your account...", true);

  let claimed = false;

  try {
    claimed = await olClaimSession(data.user.id, true);
  } catch (e) {
    claimed = false;
  }

  // NEVER continue into the online game if this device did not
  // successfully claim the account.
  if (!claimed) {
    showAccountMessage(
      "Could not claim this account session. Please try logging in again.\n[" + olSessionNote + "]"
    );
    return;
  }

  const loaded = await loadOnlinePlayerData();

  if (!loaded) {
    showAccountMessage(
      "Could not load your online data. Check your connection and try again."
    );
    return;
  }

  onlineAccountScreen.style.display = "none";
  onlineAfterLogin();
}, 500);
  };

  document.getElementById("onlineCreateBtn").onclick = async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showAccountMessage("Enter an email and password.");
      return;
    }

    if (password.length < 6) {
      showAccountMessage("Password must be at least 6 characters.");
      return;
    }

    showAccountMessage("Creating account...", true);

    const { data, error } = await olSafeAuth("signUp", {
      email,
      password
    });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    if (data.session) {
      showAccountMessage("Account created successfully.", true);

      setTimeout(async () => {
        // Same ghost-HUD fix as the login handler above: stay visible
        // (opaque, z-index:30000) until the next screen is actually ready.
        showAccountMessage("Loading your account...", true);
        try { await olClaimSession(data.session.user.id, true); } catch (e) {}
        const loaded = await loadOnlinePlayerData();
        if (!loaded) {
          showAccountMessage("Could not load your online data. Check your connection and try again.");
          return;
        }
        onlineAccountScreen.style.display = "none";
        onlineAfterLogin();
      }, 500);
    } else {
      showAccountMessage(
        "Account created. Check your email to confirm your account.",
        true
      );
    }
  };

  document.getElementById("onlineForgotBtn").onclick = async () => {
    const email = emailInput.value.trim();

    if (!email) {
      showAccountMessage("Enter your email first.");
      return;
    }

    showAccountMessage("Sending password reset email...", true);

    const redirectUrl = window.location.href.split("#")[0];

    const { error } =
      await olSafeAuth("resetPasswordForEmail", email, {
        redirectTo: redirectUrl
      });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    showAccountMessage(
      "Password reset email sent. Check your inbox.",
      true
    );
  };

  document.getElementById("onlineChangeBtn").onclick = async () => {
    const newPassword = passwordInput.value;

    if (!newPassword || newPassword.length < 6) {
      showAccountMessage("Enter a new password (minimum 6 characters).");
      return;
    }

    const {
      data: { user }
    } = await window.supabaseClient.auth.getUser();

    if (!user) {
      showAccountMessage("You must be logged in to change your password.");
      return;
    }

    showAccountMessage("Changing password...", true);

    const { error } =
      await window.supabaseClient.auth.updateUser({
        password: newPassword
      });

    if (error) {
      showAccountMessage(error.message);
      return;
    }

    showAccountMessage("Password changed successfully.", true);
    passwordInput.value = "";
  };

  document.getElementById("onlineAccountBackBtn").onclick = () => {
    onlineAccountScreen.style.display = "none";
    startMenu.style.display = "flex";
    showAccountMessage("");
  };
}

window.openOnlineAccountScreen = openOnlineAccountScreen;

// =============================================================================
// ONLINE ACCOUNTS  (no email, no domain, no Resend) - the Online button opens this
// =============================================================================
// Separate entry on the start menu (button below Offline / Online). It uses the
// SAME Supabase accounts + player_data table as normal Online, so after logging
// in everything (character, servers, saving, session claim) is identical.
//
// How it works: the game makes a random Player ID + secret, turns the ID into a
// fake email (mw-<id>@GUEST_EMAIL_DOMAIN) and uses the secret as the password.
// The player is shown ONE recovery code = ID + secret. Uninstalling the game
// wipes this device, so the recovery code is the only way back in.
//
// REQUIRED in Supabase: Authentication -> Sign In / Providers -> Email ->
// turn OFF "Confirm email" (otherwise sign-up returns no session).
// If Supabase ever rejects the fake address as "invalid", change the domain below.
const GUEST_EMAIL_DOMAIN = "guest.metalwars.game";
const GUEST_STORE_KEY = "mwGuestCredentials";
const GUEST_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/1/I/O
const GUEST_ID_LEN = 8;
const GUEST_SECRET_LEN = 12;

let guestScreen = null;

function guestRandom(n) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);            // 32 divides 2^32, so no modulo bias
  let s = "";
  for (let i = 0; i < n; i++) s += GUEST_ALPHABET[a[i] % GUEST_ALPHABET.length];
  return s;
}

function guestMakeCreds() {
  return { id: guestRandom(GUEST_ID_LEN), secret: guestRandom(GUEST_SECRET_LEN) };
}

function guestEmail(id) {
  return "mw-" + id.toLowerCase() + "@" + GUEST_EMAIL_DOMAIN;
}

// MW-8F42K91Q-X7K2-P9M4-T3WR
function guestFormatCode(c) {
  return "MW-" + c.id + "-" + c.secret.match(/.{1,4}/g).join("-");
}

function guestParseCode(text) {
  const raw = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 2 + GUEST_ID_LEN + GUEST_SECRET_LEN || raw.slice(0, 2) !== "MW") return null;
  return { id: raw.slice(2, 2 + GUEST_ID_LEN), secret: raw.slice(2 + GUEST_ID_LEN) };
}

function guestLoadStored() {
  try {
    const c = JSON.parse(localStorage.getItem(GUEST_STORE_KEY) || "null");
    return c && c.id && c.secret ? c : null;
  } catch (e) { return null; }
}
function guestStore(c) {
  try { localStorage.setItem(GUEST_STORE_KEY, JSON.stringify(c)); } catch (e) {}
}

function openGuestOnlineScreen() {
  netWakeServer();
  if (!guestScreen) buildGuestScreen();
  guestShowView("home");
  guestScreen.style.display = "flex";
}
window.openGuestOnlineScreen = openGuestOnlineScreen;

function buildGuestScreen() {
  guestScreen = document.createElement("div");
  guestScreen.id = "guestOnlineScreen";
  guestScreen.style.cssText =
    "position:fixed;inset:0;z-index:30000;background:#050505;color:#fff;" +
    "display:flex;align-items:center;justify-content:center;overflow:auto;" +
    "font-family:'Courier New',monospace;padding:20px;box-sizing:border-box;";

  const btn = (id, label, style) =>
    '<button id="' + id + '" style="width:100%;padding:13px;margin-bottom:10px;border-radius:6px;font:bold 16px Arial;' + style + '">' + label + "</button>";
  const PRIMARY = "background:#168aad;color:#fff;border:0;";
  const SECOND = "background:#333;color:#fff;border:1px solid #777;";
  const BACK = "background:#222;color:#fff;border:1px solid #555;font-size:14px;";

  guestScreen.innerHTML =
    '<div style="width:min(420px,100%);background:#101010;border:2px solid #4df;border-radius:12px;' +
    'box-shadow:0 0 25px rgba(68,221,255,.35);padding:24px;box-sizing:border-box;">' +
      '<div style="text-align:center;color:#4df;font-size:24px;font-weight:bold;letter-spacing:3px;margin-bottom:8px;">ONLINE</div>' +
      '<div style="text-align:center;color:#8ab;font:13px Arial;margin-bottom:20px;">No email needed. Your progress is saved on the server.</div>' +

      '<div id="guestViewHome">' +
        btn("guestPlayBtn", "PLAY ONLINE", PRIMARY) +
        btn("guestShowCodeBtn", "SHOW MY RECOVERY CODE", SECOND) +
        btn("guestRecoverBtn", "RECOVER ACCOUNT", SECOND) +
        btn("guestOldLoginBtn", "OLD EMAIL ACCOUNT LOGIN", "background:none;color:#8ab;border:0;font-size:13px;") +
        btn("guestBackBtn", "BACK", BACK) +
      "</div>" +

      '<div id="guestViewRecover" style="display:none;">' +
        '<div style="color:#cde;font:14px Arial;margin-bottom:10px;">Enter the recovery code you saved:</div>' +
        '<input id="guestCodeInput" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" ' +
          'placeholder="MW-XXXXXXXX-XXXX-XXXX-XXXX" style="width:100%;padding:14px;margin-bottom:14px;box-sizing:border-box;' +
          'background:#181818;color:#fff;border:1px solid #555;border-radius:6px;font:16px \'Courier New\',monospace;">' +
        btn("guestRecoverGoBtn", "RECOVER", PRIMARY) +
        btn("guestRecoverBackBtn", "BACK", BACK) +
      "</div>" +

      '<div id="guestViewCode" style="display:none;">' +
        '<div style="color:#fc6;font:bold 14px Arial;margin-bottom:10px;text-align:center;">SAVE THIS RECOVERY CODE</div>' +
        '<div id="guestCodeText" style="text-align:center;background:#000;border:1px dashed #4df;border-radius:8px;padding:16px 8px;' +
          'font:bold 19px \'Courier New\',monospace;color:#6f6;letter-spacing:1px;word-break:break-all;margin-bottom:12px;user-select:all;-webkit-user-select:all;"></div>' +
        '<div style="color:#f99;font:13px Arial;margin-bottom:14px;line-height:1.4;">Take a screenshot or write it down. If you uninstall the game or lose this phone, this code is the ONLY way to get your account back. We cannot recover it for you.</div>' +
        btn("guestCopyBtn", "COPY CODE", SECOND) +
        btn("guestCodeContinueBtn", "I SAVED IT - CONTINUE", PRIMARY) +
      "</div>" +

      '<div id="guestMessage" style="min-height:20px;margin-top:10px;text-align:center;color:#aaa;font:14px Arial;white-space:pre-line;"></div>' +
    "</div>";

  document.body.appendChild(guestScreen);

  const $ = (id) => document.getElementById(id);
  const msg = (t, good) => { const m = $("guestMessage"); m.textContent = t || ""; m.style.color = good ? "#6f6" : "#ff8888"; };
  let busy = false;
  let afterCode = null;   // what "I SAVED IT - CONTINUE" does

  window.guestShowView = function (v) {
    $("guestViewHome").style.display = v === "home" ? "block" : "none";
    $("guestViewRecover").style.display = v === "recover" ? "block" : "none";
    $("guestViewCode").style.display = v === "code" ? "block" : "none";
    msg("");
    if (v === "home") {
      const has = !!guestLoadStored();
      $("guestPlayBtn").textContent = has ? "CONTINUE" : "PLAY ONLINE";
      $("guestShowCodeBtn").style.display = has ? "block" : "none";
    }
  };

  // Same hand-off the normal Online login uses: claim the account for this
  // device, load its saved data, then go to character / servers.
  async function enterGame(userId, isNew) {
    msg("Loading your account...", true);
    let claimed = false;
    try { claimed = await olClaimSession(userId, true); } catch (e) { claimed = false; }
    if (!claimed && !isNew) {
      msg("Could not claim this account session. Please try again.\n[" + olSessionNote + "]");
      return false;
    }
    const loaded = await loadOnlinePlayerData();
    if (!loaded) {
      msg("Could not load your online data. Check your connection and try again.");
      return false;
    }
    guestScreen.style.display = "none";
    onlineAfterLogin();
    return true;
  }

  async function signInWith(creds) {
    const { data, error } = await olSafeAuth("signInWithPassword", { email: guestEmail(creds.id), password: creds.secret });
    if (error) {
      const m = String(error.message || "");
      return { error: /invalid login/i.test(m) ? "Wrong recovery code, or this account does not exist." : m };
    }
    if (!data || !data.user) return { error: "Login failed." };
    return { user: data.user };
  }

  async function createGuest() {
    const creds = guestMakeCreds();
    const { data, error } = await olSafeAuth("signUp", { email: guestEmail(creds.id), password: creds.secret });
    if (error) {
      const m = String(error.message || "");
      return { error: /invalid/i.test(m) && /email/i.test(m)
        ? "The server rejected the guest address. Change GUEST_EMAIL_DOMAIN in online.js.\n(" + m + ")" : m };
    }
    if (!data || !data.session || !data.user) {
      return { error: "Guest sign-up needs 'Confirm email' turned OFF in Supabase (Authentication > Sign In / Providers > Email)." };
    }
    return { creds, user: data.user };
  }

  $("guestPlayBtn").onclick = async () => {
    if (busy) return; busy = true;
    try {
      const stored = guestLoadStored();
      if (stored) {
        msg("Logging in...", true);
        const r = await signInWith(stored);
        if (r.error) { msg(r.error); return; }
        await enterGame(r.user.id, false);
        return;
      }
      msg("Creating guest account...", true);
      const r = await createGuest();
      if (r.error) { msg(r.error); return; }
      guestStore(r.creds);
      $("guestCodeText").textContent = guestFormatCode(r.creds);
      afterCode = () => enterGame(r.user.id, true);
      guestShowView("code");
    } finally { busy = false; }
  };

  $("guestShowCodeBtn").onclick = () => {
    const stored = guestLoadStored();
    if (!stored) return;
    $("guestCodeText").textContent = guestFormatCode(stored);
    afterCode = () => guestShowView("home");
    guestShowView("code");
    $("guestCodeContinueBtn").textContent = "DONE";
  };

  $("guestCodeContinueBtn").onclick = async () => {
    if (busy || !afterCode) return; busy = true;
    try { await afterCode(); } finally { busy = false; $("guestCodeContinueBtn").textContent = "I SAVED IT - CONTINUE"; }
  };

  $("guestCopyBtn").onclick = async () => {
    const text = $("guestCodeText").textContent;
    try {
      await navigator.clipboard.writeText(text);
      msg("Code copied.", true);
    } catch (e) {
      msg("Copy not available - please screenshot or write the code down.");
    }
  };

  $("guestRecoverBtn").onclick = () => { $("guestCodeInput").value = ""; guestShowView("recover"); };
  $("guestRecoverBackBtn").onclick = () => guestShowView("home");

  $("guestRecoverGoBtn").onclick = async () => {
    if (busy) return; busy = true;
    try {
      const creds = guestParseCode($("guestCodeInput").value);
      if (!creds) { msg("That code doesn't look right. It starts with MW- and has 20 letters/numbers."); return; }
      msg("Recovering account...", true);
      const r = await signInWith(creds);
      if (r.error) { msg(r.error); return; }
      guestStore(creds);   // this device is now linked to the recovered account
      await enterGame(r.user.id, false);
    } finally { busy = false; }
  };

  // Accounts made before the switch (email + password) can still log in here.
  $("guestOldLoginBtn").onclick = () => {
    guestScreen.style.display = "none";
    openOnlineAccountScreen();
  };

  $("guestBackBtn").onclick = () => {
    guestScreen.style.display = "none";
    startMenu.style.display = "flex";
  };
}


// =============================================================================
// ONLINE FLOW
// =============================================================================
//   Online -> Account (login / create)
//          -> Create Character   (first time only: pick one of the characters)
//          -> Servers            (SERVER 1..5, 0/500 each)   tap -> Start / Cancel
//          -> Channels           (CHANNEL 0 = PvP, CHANNEL 1 = no player damage)
//                                                            tap -> Start / Cancel
//          -> Your character     bottom-left DELETE (type DELETE to confirm) / bottom-right START GAME
//          -> the map from the server (worldmap_server.js)
//
// Set this to true to show the Create Character screen after EVERY login
// (the picked character replaces the saved one). false = only when the
// account has no character yet.
const ONLINE_ALWAYS_SHOW_CREATE = false;

let onlineCharacterName = null;   // the character this account created
let onlinePlayerName = null;      // the name typed for that character (shown in-game, replaces "Player N")
let olServer = 0;                 // server picked in the lobby = INTERNAL id (group * serverCount + number)
let olGroup = 0;                  // server GROUP picked first (0-based: Nexus, Titan, ...)
let olChannel = 0;
let olServerData = null;          // last answer of the server's /servers list
let olPollTimer = null;
let olFetching = false;
let olScreens = null;             // { server, channel, char } once built

function olValidCharacter(name) {
  if (!name || typeof CHARACTERS === "undefined") return null;
  if (olCharImages && olCharImages[name]) return name;   // a character from the SERVER's list (character_server.js)
  // The server's list is known: ONLINE only knows ITS characters. A name that is only still
  // in the offline character.js (e.g. an old "Brawler" saved on the account) must NOT win,
  // or the account keeps showing the old name. Follow it to the server's character instead.
  const serverNames = olCharImages ? Object.keys(olCharImages) : [];
  if (serverNames.length) {
    const want = String(name).trim().toLowerCase();
    const hit = serverNames.find((k) => k.toLowerCase() === want);
    return hit || serverNames[0];
  }
  if (CHARACTERS[name]) return name;
  // The server's list has NOT arrived yet (fresh page load, the saved account is read first):
  // keep the saved name as it is. Resolving it against the OFFLINE character.js here turned
  // "Berserker" into "Brawler", so the saved position was thrown away on join.
  // olSyncCharacterImages() re-checks the name as soon as the server's list is known.
  if (!serverNames.length && typeof name === "string") return name;
  // The account saved a name that no longer exists (character renamed in
  // character.js / character_server.js): follow it to the matching character
  // instead of treating the account as having none.
  return (typeof resolveCharacterName === "function") ? resolveCharacterName(name) : null;
}

// ONLINE CHARACTER PICTURES: the picker opens BEFORE the server has sent its
// game data, so it would show the offline character.js pictures. This asks
// the server (character_server.js) for its pictures and keeps them in a
// separate map, so offline mode's own CHARACTERS table is never touched.
let olCharImages = {};
window.olCharacterImage = function (name, fallback) {
  return olCharImages[name] || fallback;
};
// The ONLINE character list = the names in character_server.js (same order). The
// picker (index.html) uses this instead of the offline character.js list.
window.olCharacterNames = function () {
  return Object.keys(olCharImages);
};
async function olSyncCharacterImages() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    const base = getOnlineServerUrl().replace(/^ws/i, "http");
    const res = await fetch(base + "/characters", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data === "object") olCharImages = data;
    // the account's saved name was read before this list existed: check it against the server's list now
    if (onlineCharacterName) onlineCharacterName = olValidCharacter(onlineCharacterName) || onlineCharacterName;
    // an already-open picker switches to the server's character list
    if (typeof window.olRefreshCharacterPicker === "function") window.olRefreshCharacterPicker();
    // refresh anything already on screen (picker orbs)
    document.querySelectorAll("#charCarousel .charSlide img").forEach((img) => {
      const n = img.getAttribute("alt");
      if (olCharImages[n]) img.src = olCharImages[n];
    });
  } catch (e) { /* keep the offline pictures */ }
}

// ONLINE CHARACTER STATS: same idea as the pictures above, for the stats popup
// (index.html openCharacterStatsPopup) — the real numbers from the server's
// character_server.js, kept apart from offline mode's own CHARACTERS table.
let olCharStats = {};
window.olCharacterStats = function (name) {
  return olCharStats[name] || null;
};
async function olSyncCharacterStats() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    const base = getOnlineServerUrl().replace(/^ws/i, "http");
    const res = await fetch(base + "/characterstats", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data === "object") olCharStats = data;
  } catch (e) { /* keep the offline numbers */ }
}

olSyncCharacterImages();   // start fetching the server's character list as soon as online mode loads

// Called right after a successful login / account creation.
async function onlineAfterLogin() {
  olSyncCharacterStats();
  await olSyncCharacterImages();   // the server's character list must be known before the name is checked below
  if (olValidCharacter(onlineCharacterName) && !ONLINE_ALWAYS_SHOW_CREATE) {
    olShowGroups();
  } else {
    openCharacterSelectFromHub("online-create");
  }
}
window.onlineAfterLogin = onlineAfterLogin;

// Called by the character picker (index.html) when "Select" is pressed on the
// Create Character screen — playerName is whatever was typed in the "Name
// Your Character" popup (see olOpenNamePopup below).
window.onlineCharacterCreated = function (name, playerName) {
  onlineCharacterName = olValidCharacter(name);
  if (!onlineCharacterName) return;
  if (playerName) {
    onlinePlayerName = String(playerName).trim().slice(0, 16) || onlinePlayerName;
  }
  window.supabaseClient.auth.getUser().then(({ data }) => {
    if (data && data.user) {
      try { localStorage.setItem("onlineCharacter:" + data.user.id, onlineCharacterName); } catch (e) {}
      if (onlinePlayerName) {
        try { localStorage.setItem("onlinePlayerName:" + data.user.id, onlinePlayerName); } catch (e) {}
      }
    }
  }).catch(() => {});
  saveOnlinePlayerData();
  olShowGroups();
};

// ---- CREATE CHARACTER name popup -------------------------------------------
// Small popup shown right after picking a character on the Create Character
// screen: the player types the name their character will be known by online
// (shown above their health bar, and to other players), then taps Create.
// Ask the server if a character name is free (names are unique, ignoring upper/lower case).
// Returns { available:true } | { available:false, reason } | { error:true, reason }.
async function olCheckNameAvailable(name) {
  try {
    const r = await olApiPost("/api/checkname", { name });
    const j = r.json || {};
    if (r.status === 200 && j.ok) return { available: !!j.available, reason: j.reason || "This name is already in use. Choose another name." };
    return { error: true, reason: "Could not check the name right now. Check your internet and try again." };
  } catch (e) {
    return { error: true, reason: "Could not check the name right now. Check your internet and try again." };
  }
}

// The server refused a save because the name got taken in the meantime (two players typed the
// same name at once): forget the name + character and send the player back to Create Character.
function olNameWasTaken(uid) {
  try { localStorage.removeItem("onlineCharacter:" + uid); } catch (e) {}
  try { localStorage.removeItem("onlinePlayerName:" + uid); } catch (e) {}
  onlineCharacterName = null;
  onlinePlayerName = null;
  setTimeout(() => {
    alert("This character name was just taken by another player. Please choose a different name.");
    try { olHide(); olStopPolling(); } catch (e) {}
    openCharacterSelectFromHub("online-create");
  }, 0);
}

function olOpenNamePopup(characterName, onCreated) {
  olEnsureStyles();
  if (document.getElementById("olNamePopup")) return;

  const wrap = document.createElement("div");
  wrap.id = "olNamePopup";
  wrap.className = "olPopup";
  wrap.innerHTML =
    '<div class="olPopupPanel">' +
      '<div class="olPopupTitle">Name Your Character</div>' +
      '<div class="olPopupSub">Tap the box below to type a name.</div>' +
      '<input class="olDeleteInput" type="text" placeholder="Character name" maxlength="16" autocomplete="off" ' +
        'autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done">' +
      '<div class="olDeleteErr"></div>' +
      '<div class="charButtonsRow"><button class="charBtn cancelBtn">Cancel</button>' +
      '<button class="charBtn startBtn">Create Name</button></div>' +
    '</div>';

  const input = wrap.querySelector(".olDeleteInput");
  const err = wrap.querySelector(".olDeleteErr");
  const close = () => wrap.remove();

  let checking = false;
  const tryCreate = async () => {
    if (checking) return;
    const typed = input.value.trim().replace(/\s+/g, " ");
    if (!typed) { err.textContent = "Enter a name for your character."; return; }
    checking = true;
    err.textContent = "Checking name...";
    const res = await olCheckNameAvailable(typed);
    checking = false;
    if (!wrap.isConnected) return;   // popup was cancelled while checking
    if (res.error || !res.available) { err.textContent = res.reason; return; }
    close();
    onCreated(typed);
  };

  input.addEventListener("input", () => { err.textContent = ""; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    tryCreate();
  });
  wrap.querySelector(".cancelBtn").addEventListener("click", close);
  wrap.querySelector(".startBtn").addEventListener("click", tryCreate);
  wrap.addEventListener("click", (ev) => { if (ev.target === wrap) close(); });
  document.body.appendChild(wrap);
  // No auto-focus: on mobile that pops the keyboard immediately and covers
  // the popup before the player ever sees it. The player taps the box
  // themselves when ready to type, same as any other text field.
}
window.olOpenNamePopup = olOpenNamePopup;

// ---- small UI helpers ------------------------------------------------------
function olEnsureStyles() {
  if (document.getElementById("olStyles")) return;
  const st = document.createElement("style");
  st.id = "olStyles";
  st.textContent = `
    .olScreen { position:fixed; inset:0; display:none; flex-direction:column; z-index:9950; overflow:hidden;
      background:url('image/bleveloption.png') center center / cover no-repeat rgba(0,0,0,0.55); }
    .olList { position:absolute; top:64px; left:50%; transform:translateX(-50%); width:min(360px,88vw);
      max-height:calc(100% - 130px); overflow-y:auto; display:flex; flex-direction:column; gap:10px; z-index:9960; }
    .olList .hubBtn { width:100%; box-sizing:border-box; }
    .olText { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .olText small { font-size:9px; font-weight:400; letter-spacing:1px; color:#8bd; text-transform:none; }
    .olCount { margin-left:auto; font-size:12px; color:#7f9; text-shadow:0 0 6px #4f8; white-space:nowrap; }
    .olCount.full { color:#f66; text-shadow:0 0 6px #f44; }
    .olNote { position:absolute; left:20px; bottom:26px; z-index:9960; font:11px 'Courier New',monospace;
      letter-spacing:1px; color:#9cd; max-width:60%; }
    .olCharCard { align-self:center; display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 26px;
      border:2px solid rgba(100,220,255,0.5); border-radius:14px;
      background:linear-gradient(180deg, rgba(10,22,32,0.9), rgba(4,9,16,0.94));
      box-shadow:0 0 20px rgba(70,200,255,0.35); font-family:'Courier New',monospace; color:#dff; }
    .olCharOrb { width:96px; height:96px; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center;
      border:2px solid rgba(100,220,255,0.6); background:radial-gradient(circle at 35% 30%, rgba(120,200,255,0.25), rgba(0,0,0,0.6) 70%); }
    .olCharOrb img { width:88%; height:88%; object-fit:contain; }
    .olCharName { font-size:15px; font-weight:900; letter-spacing:3px; text-transform:uppercase; text-shadow:0 0 6px #4df; }
    .olCharLv { font-size:11px; letter-spacing:2px; color:#9cd; }
    .olHint { text-align:center; font:11px 'Courier New',monospace; letter-spacing:1px; color:#9cd; }
    .olPopup { position:fixed; inset:0; z-index:10700; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.65); }
    .olPopupPanel { width:min(88vw,340px); box-sizing:border-box; padding:18px 16px 16px; text-align:center;
      border:2px solid rgba(100,220,255,0.5); border-radius:14px; font-family:'Courier New',monospace; color:#dff;
      background:linear-gradient(180deg, rgba(10,22,32,0.95), rgba(4,9,16,0.97)); box-shadow:0 0 20px rgba(70,200,255,0.35); }
    .olPopupTitle { font-size:16px; font-weight:900; letter-spacing:3px; text-transform:uppercase; text-shadow:0 0 6px #4df; }
    .olPopupSub { margin-top:6px; font-size:11px; letter-spacing:1px; color:#9cd; }
    /* Character screen: Back moves to the top-right so DELETE (bottom-left) and START GAME (bottom-right) have the corners */
    #onlineCharScreen .menuBackBtn { top:20px; bottom:auto; }
    .olBottomBtn { position:absolute; bottom:20px; z-index:10000; padding:12px 22px; border-radius:10px; border:2px solid transparent;
      font-family:'Courier New',Courier,monospace; font-size:13px; font-weight:900; letter-spacing:2px; text-transform:uppercase;
      cursor:pointer; touch-action:manipulation; transition:transform 0.08s ease; }
    .olBottomBtn:active { transform:scale(0.95); }
    .olDeleteBtn { left:20px; background:rgba(255,80,80,0.12); border-color:rgba(255,100,100,0.5); color:#f88; }
    .olStartBtn { right:20px; background:rgba(80,255,140,0.12); border-color:rgba(100,255,150,0.55); color:#6f8;
      box-shadow:0 0 14px rgba(80,255,150,0.25); }
    .olDeletePanel { border-color:rgba(255,100,100,0.55); box-shadow:0 0 20px rgba(255,80,80,0.35); }
    .olDeletePanel .olPopupTitle { color:#f88; text-shadow:0 0 6px #f44; }
    .olDeleteMsg { margin-top:10px; font-size:12px; line-height:1.5; letter-spacing:1px; color:#dff; }
    .olDeleteMsg b { color:#f88; }
    .olDeleteInput { display:block; width:100%; box-sizing:border-box; margin-top:12px; padding:10px 8px; text-align:center;
      font-family:'Courier New',Courier,monospace; font-size:16px; font-weight:900; letter-spacing:4px; text-transform:uppercase;
      color:#dff; background:rgba(0,0,0,0.5); border:2px solid rgba(255,100,100,0.5); border-radius:8px; outline:none; }
    .olDeleteInput:focus { border-color:#f66; box-shadow:0 0 10px rgba(255,80,80,0.45); }
    .olDeleteErr { min-height:14px; margin-top:6px; font-size:11px; letter-spacing:1px; color:#f66; }
  `;
  document.head.appendChild(st);
}

function olMakeScreen(id, title, onBack) {
  const el = document.createElement("div");
  el.id = id;
  el.className = "olScreen";
  el.innerHTML =
    '<div class="hubTitle"></div><div class="olList"></div><div class="olNote"></div>' +
    '<button class="menuBackBtn">Back</button>';
  el.querySelector(".hubTitle").textContent = title;
  el.querySelector(".menuBackBtn").addEventListener("click", onBack);
  document.body.appendChild(el);
  return el;
}

function olRow(main, sub) {
  const b = document.createElement("button");
  b.className = "hubBtn";
  b.innerHTML =
    '<span class="hubBtnRing"><span class="hubBtnDot"></span></span>' +
    '<span class="olText"><span class="olMain"></span>' + (sub ? '<small class="olSub"></small>' : '') + '</span>' +
    '<span class="olCount"></span>';
  b.querySelector(".olMain").textContent = main;
  if (sub) b.querySelector(".olSub").textContent = sub;
  return b;
}

// Popup with a title and two buttons: Cancel + a confirm button.
function olConfirm(title, sub, startLabel, onStart) {
  const wrap = document.createElement("div");
  wrap.className = "olPopup";
  wrap.innerHTML =
    '<div class="olPopupPanel"><div class="olPopupTitle"></div><div class="olPopupSub"></div>' +
    '<div class="charButtonsRow"><button class="charBtn cancelBtn">Cancel</button>' +
    '<button class="charBtn startBtn"></button></div></div>';
  wrap.querySelector(".olPopupTitle").textContent = title;
  wrap.querySelector(".olPopupSub").textContent = sub || "";
  wrap.querySelector(".startBtn").textContent = startLabel;
  const close = () => wrap.remove();
  wrap.querySelector(".cancelBtn").addEventListener("click", close);
  wrap.querySelector(".startBtn").addEventListener("click", () => { close(); onStart(); });
  document.body.appendChild(wrap);
}

function olBuildScreens() {
  if (olScreens) return olScreens;
  olEnsureStyles();

  // ---- SERVER GROUPS (Nexus Server, Titan Server, ...) ----
  const group = olMakeScreen("onlineGroupScreen", "Select Server", () => {
    olHide(); olStopPolling();
    startMenu.style.display = "flex";
  });

  // ---- SERVERS (1..N inside the picked group) ----
  const server = olMakeScreen("onlineServerScreen", "Servers", () => { olHide(); olShowGroups(); });
  // (the Server / Channel rows are built by olEnsureRows() once the server's /servers answer arrives)

  // ---- CHANNELS ----
  const channel = olMakeScreen("onlineChannelScreen", "Channels", () => { olHide(); olShowServers(); });

  // ---- YOUR CHARACTER ----
  const ch = olMakeScreen("onlineCharScreen", "Character", () => { olHide(); olShowChannels(); });
  ch.insertAdjacentHTML("beforeend",
    '<button class="olBottomBtn olDeleteBtn">Delete</button>' +
    '<button class="olBottomBtn olStartBtn">Start Game</button>');
  ch.querySelector(".olDeleteBtn").addEventListener("click", olOpenDeletePopup);
  ch.querySelector(".olStartBtn").addEventListener("click", () => {
    if (olValidCharacter(onlineCharacterName)) olStartGame();
  });

  olScreens = { group, server, channel, char: ch };
  return olScreens;
}

function olHide() {
  if (!olScreens) return;
  for (const k in olScreens) olScreens[k].style.display = "none";
}

// ---- live server / channel counts -----------------------------------------
// Builds the Server 1..N and Channel rows from the server's /servers answer
// (serverCount + channels come from the server, not from this file).
function olEnsureRows() {
  if (!olScreens || !olServerData) return;
  const n = Number(olServerData.serverCount) || 0;
  const groups = Array.isArray(olServerData.groups) && olServerData.groups.length ? olServerData.groups : ["Server"];
  const groupList = olScreens.group.querySelector(".olList");
  if (groupList.querySelectorAll("[data-group]").length !== groups.length) {
    groupList.innerHTML = "";
    groups.forEach((gname, g) => {
      const row = olRow(gname);
      row.dataset.group = g;
      row.addEventListener("click", () => { olGroup = g; olShowServers(); });
      groupList.appendChild(row);
    });
  }
  const serverList = olScreens.server.querySelector(".olList");
  // rebuild when the count changed OR a different group was opened (ids differ per group)
  if (serverList.querySelectorAll("[data-server]").length !== n || serverList.dataset.group !== String(olGroup)) {
    serverList.innerHTML = "";
    serverList.dataset.group = String(olGroup);
    for (let i = 1; i <= n; i++) {
      const gid = olGroup * n + i;   // internal id the server uses
      const row = olRow("Server " + i);
      row.dataset.server = gid;
      row.addEventListener("click", () => {
        const info = olServerInfo(gid);
        olConfirm(olGroupName() + " - Server " + i, info.text + " players", "Start", () => { olServer = gid; olShowChannels(); });
      });
      serverList.appendChild(row);
    }
  }
  const defs = Array.isArray(olServerData.channels) ? olServerData.channels : [];
  const chList = olScreens.channel.querySelector(".olList");
  if (chList.querySelectorAll("[data-channel]").length !== defs.length) {
    chList.innerHTML = "";
    for (const def of defs) {
      const row = olRow("Channel " + def.id, def.desc);
      row.dataset.channel = def.id;
      row.addEventListener("click", () => {
        olConfirm(olServerLabel() + " - Channel " + def.id, def.desc, "Start", () => { olChannel = def.id; olShowCharacter(); });
      });
      chList.appendChild(row);
    }
  }
}

function olGroupName() {
  const g = olServerData && Array.isArray(olServerData.groups) ? olServerData.groups[olGroup] : null;
  return g || "Server";
}
// "Nexus Server - Server 7" for the internal id olServer
function olServerLabel() {
  const n = olServerData ? Number(olServerData.serverCount) || 1 : 1;
  return olGroupName() + " - Server " + (((olServer - 1) % n) + 1);
}

function olServerInfo(id) {
  const s = olServerData && olServerData.servers && olServerData.servers.find((x) => x.id === id);
  if (!s) return { players: null, max: null, text: "-", full: false, channels: [null, null] };
  return { players: s.players, max: s.max, text: s.players + "/" + s.max, full: s.players >= s.max, channels: s.channels || [null, null] };
}

function olRenderCounts() {
  if (!olScreens) return;
  olEnsureRows();
  const sn = olServerData ? Number(olServerData.serverCount) || 0 : 0;
  for (const row of olScreens.group.querySelectorAll("[data-group]")) {
    const g = Number(row.dataset.group);
    let sum = 0;
    for (let i = 1; i <= sn; i++) { const inf = olServerInfo(g * sn + i); if (inf.players) sum += inf.players; }
    row.querySelector(".olCount").textContent = sum + " online";
  }
  for (const row of olScreens.server.querySelectorAll("[data-server]")) {
    const info = olServerInfo(Number(row.dataset.server));
    const c = row.querySelector(".olCount");
    c.textContent = info.full ? "FULL " + info.text : info.text;
    c.classList.toggle("full", info.full);
  }
  const info = olServerInfo(olServer);
  for (const row of olScreens.channel.querySelectorAll("[data-channel]")) {
    const n = info.channels[Number(row.dataset.channel)];
    row.querySelector(".olCount").textContent = (n == null) ? "" : n + " online";
  }
}

async function olRefreshCounts() {
  if (olFetching) return;
  olFetching = true;
  const note = olScreens && olScreens.group.querySelector(".olNote");
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);   // free hosts can take ~1 min to wake up
    const base = getOnlineServerUrl().replace(/^ws/i, "http");
    const res = await fetch(base + "/servers", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error("bad status");
    olServerData = await res.json();
    if (note) note.textContent = "";
  } catch (e) {
    if (note) note.textContent = olServerData ? "Connection lost - retrying..." : "Connecting to server... (it can take up to a minute to wake up)";
  } finally {
    olFetching = false;
    olRenderCounts();
  }
}

function olStartPolling() {
  olStopPolling();
  olRefreshCounts();
  olPollTimer = setInterval(olRefreshCounts, 5000);
}
function olStopPolling() {
  if (olPollTimer) { clearInterval(olPollTimer); olPollTimer = null; }
}

// ---- screens ---------------------------------------------------------------
function olShowGroups() {
  const sc = olBuildScreens();
  olHide();
  sc.group.style.display = "flex";
  olRenderCounts();
  olStartPolling();
}

function olShowServers() {
  const sc = olBuildScreens();
  olHide();
  sc.server.querySelector(".hubTitle").textContent = olGroupName();
  sc.server.style.display = "flex";
  olRenderCounts();
  olStartPolling();
}

function olShowChannels() {
  const sc = olBuildScreens();
  olHide();
  sc.channel.querySelector(".hubTitle").textContent = olServerLabel() + " - Channels";
  sc.channel.style.display = "flex";
  olRenderCounts();
  olStartPolling();   // keeps the per-channel counts fresh
}

function olShowCharacter() {
  const sc = olBuildScreens();
  olStopPolling();
  olHide();

  const name = olValidCharacter(onlineCharacterName);
  const def = name ? (CHARACTERS[name] || (olCharImages[name] ? { image: olCharImages[name], level: 1 } : null)) : null;
  let level = def && def.level || 1;
  const onlineProg = onlineProfile && onlineProfile.characterProgress && name ? onlineProfile.characterProgress[name] : null;
  if (onlineProg && onlineProg.level) level = onlineProg.level;   // the account's ONLINE level

  const list = sc.char.querySelector(".olList");
  list.innerHTML = "";
  if (!def) {
    list.innerHTML = '<div class="olHint">No character yet.</div>';
  } else {
    const card = document.createElement("div");
    card.className = "olCharCard";
    card.innerHTML =
      '<div class="olCharOrb"><img alt=""></div><div class="olCharName"></div><div class="olCharLv"></div>';
    card.querySelector("img").src = olCharImages[name] || def.image;
    card.querySelector(".olCharName").textContent = name;
    card.querySelector(".olCharLv").textContent = "Level " + level;
    list.appendChild(card);
    const hint = document.createElement("div");
    hint.className = "olHint";
    hint.textContent = olServerLabel() + " - Channel " + olChannel;
    list.appendChild(hint);
  }
  // DELETE (bottom-left) / START GAME (bottom-right) only make sense with a character.
  for (const b of sc.char.querySelectorAll(".olBottomBtn")) b.style.display = def ? "" : "none";
  sc.char.style.display = "flex";
}

// ---- DELETE character ------------------------------------------------------
// Bottom-left DELETE on the Character screen: asks for the word DELETE (Enter to confirm).
function olOpenDeletePopup() {
  const name = olValidCharacter(onlineCharacterName);
  if (!name || document.getElementById("olDeletePopup")) return;

  const wrap = document.createElement("div");
  wrap.id = "olDeletePopup";
  wrap.className = "olPopup";
  wrap.innerHTML =
    '<div class="olPopupPanel olDeletePanel">' +
      '<div class="olPopupTitle">Delete Character</div>' +
      '<div class="olDeleteMsg"></div>' +
      '<input class="olDeleteInput" type="text" placeholder="DELETE" maxlength="12" autocomplete="off" ' +
        'autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done">' +
      '<div class="olDeleteErr"></div>' +
      '<div class="charButtonsRow"><button class="charBtn cancelBtn">Cancel</button></div>' +
    '</div>';
  const msg = wrap.querySelector(".olDeleteMsg");
  msg.appendChild(document.createTextNode("Are you sure you want to delete "));
  const b = document.createElement("b");
  b.textContent = name;
  msg.appendChild(b);
  msg.appendChild(document.createTextNode("? This cannot be undone. If yes, type DELETE and press Enter."));

  const input = wrap.querySelector(".olDeleteInput");
  const err = wrap.querySelector(".olDeleteErr");
  const close = () => wrap.remove();

  input.addEventListener("input", () => { err.textContent = ""; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (input.value.trim().toUpperCase() === "DELETE") {
      close();
      olDeleteCharacter(name);
    } else {
      err.textContent = "Type DELETE to confirm.";
    }
  });
  wrap.querySelector(".cancelBtn").addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
}

// Removes the account's online character AND its online progress (level, gear, gold, skills),
// saves that to the cloud, then sends the player to Create Character to make a new one.
let olDeleting = false;
async function olDeleteCharacter(name) {
  if (olDeleting) return;
  olDeleting = true;
  try {
    netStatus("Deleting " + name + "...");
    let uid = olKnownUid;
    try { const u = await olCurrentUser(); if (u) uid = u.id; } catch (e) {}
    if (uid) {
      try { localStorage.removeItem("onlineCharacter:" + uid); } catch (e) {}
      try { localStorage.removeItem("onlinePlayerName:" + uid); } catch (e) {}
    }

    onlineCharacterName = null;
    onlinePlayerName = null;   // deleted character's name shouldn't carry over to the next one
    onlineProfile = olFreshProfile();     // selectedCharacterName is null now, nothing left of the old character
    saveOnlinePlayerData();               // queued + copied to this device right away
    await olWaitForSaves(10000);          // wait until the cloud has it
    if (/^(FAILED|NOT STORED|CONFLICT|BLOCKED)/.test(olLastSaveNote)) {
      alert("The character was deleted on this phone, but the SERVER did not get it yet:\n" + olLastSaveNote +
        "\nKeep the game open with internet - it keeps retrying.");
    }
  } catch (e) {
    console.error("Delete character failed:", e);
  } finally {
    olDeleting = false;
    netStatus("");
  }
  olHide();
  olStopPolling();
  openCharacterSelectFromHub("online-create");
}

// If another phone saved this account while this app was sitting open with an old copy,
// pick up the newer cloud data BEFORE playing (otherwise the stale copy would be played
// and later blocked from saving).
async function olSyncFromCloud() {
  try {
    const user = await olCurrentUser();
    if (!user || !window.supabaseClient) return;
    let gd = await olFetchCloudRow(user.id);
    if (gd === undefined) {
      const r = await window.supabaseClient.from("player_data")
        .select("game_data").eq("id", user.id).maybeSingle();
      gd = r && !r.error && r.data ? r.data.game_data : null;
    }
    if (!gd || !gd.savedAt || gd.savedAt <= olCloudBase || olMyWrites.has(gd.savedAt)) return;
    const pend = olReadPending(user.id);
    if (pend && pend.savedAt > gd.savedAt) { olCloudBase = gd.savedAt; return; }   // unsent newer local data wins
    if (gd.onlineProfile) onlineProfile = gd.onlineProfile;
    onlineCharacterName = olValidCharacter(gd.onlineCharacter);
    onlinePlayerName = (typeof gd.onlinePlayerName === "string" && gd.onlinePlayerName.trim()) || null;
    olCloudBase = gd.savedAt;
    olStale = false;
    olConflictShown = false;
    try { localStorage.removeItem(olPendingKey(user.id)); } catch (e) {}
    console.log("Picked up newer account data saved from another device.");
  } catch (e) { console.error("Cloud sync before start failed:", e); }
}

async function olStartGame() {
  const sc = olBuildScreens();
  olHide();
  await olSyncFromCloud();
  if (!olValidCharacter(onlineCharacterName)) {   // the character was deleted on another phone
    openCharacterSelectFromHub("online-create");
    return;
  }
  const ok = await window.startGameOnline(onlineCharacterName, olServer, olChannel);
  if (ok) {
    if (typeof setOnlineHud === "function") setOnlineHud(true);
  } else {
    sc.char.style.display = "flex";   // connection failed - back to the character screen
  }
}
