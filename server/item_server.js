// =============================================================================
// item_server.js  —  ONLINE MODE copy of item.js
// =============================================================================
// This is the WHOLE online version of item.js: in online mode the game runs
// THIS file (its numbers AND its functions/formulas), not item.js. Edit
// anything in here to change how the game behaves in ONLINE mode.
// item.js (the public file) only controls OFFLINE mode.
//
// This file lives on the SERVER (Render / GitHub), NOT in the public game
// website, so players cannot open or edit it. server.js sends it to each
// player when they join an online match; the game swaps it in for as long as
// the player is online, then puts the offline version back (see online.js).
//
// KEEP IT IN STEP WITH item.js: when item.js gets a new function or a fix,
// copy that change in here too, or online mode keeps running the old version.
// =============================================================================

// item.js
//
// Pickup items for OFFLINE mode.
//
// An "item" here means a dropped pickup that sits on the ground until the
// player walks over it. Bots have a chance to drop one (or more) of these
// when they die (see the `spawnItem` field on each bot type in bot.js).
//
// ITEM_TYPES:
//   HEALTH   — heals the player by a flat amount (capped at max health).
//   SHIELD   — grants the player a pool of "shield" hitpoints. Incoming
//              damage is taken from the shield FIRST, before health, and
//              armor does NOT reduce shield damage (armor only reduces
//              damage that reaches health).
//   SPEEDUP  — temporary movement speed boost. Shows a small icon above
//              the player's health bar while active.
//   POWERUP  — temporarily doubles max health / current health AND
//              current weapon damage. Also shows a small icon above the
//              health bar while active.
//
// Load order required:
//   weapon.js -> armor.js -> character.js -> effect.js -> level.js -> bot.js -> item.js -> game.js
//
// game.js is responsible for:
//   - keeping an `itemDrops` array (same idea as `bullets` / `bots`)
//   - calling spawnItemsOnBotDeath() when a bot dies, pushing the result
//     into itemDrops
//   - calling updateItemDrops() + checkItemPickup() every frame
//   - calling updateActiveEffects() every frame (ticks down speedup /
//     powerup timers and reverts the player's stats when they expire)
//   - calling applyDamageToPlayer() instead of subtracting health/armor
//     directly, so shield hitpoints are respected
//   - calling drawItemDrops() + drawActiveEffectIcons() every frame



// ---------------------------------------------------------------------------
// ITEM TYPES
// Add new item types here the same way BOT_TYPES works in bot.js.
// ---------------------------------------------------------------------------
const ITEM_TYPES = {

  health: {
    name: "health",
    image: "image/health.png",

    // Ground-drawn size. Resizable — just change radius (drawn size is
    // radius * 2, same approach bot.js uses for bot sprites).
    radius: 10,

    healAmount: 50,     // flat heal, capped at the player's max health
    spawnChance: 0.75,    // 75% chance to drop when a bot that carries this item dies
    timeLife: 30000,    // ms — despawns if not looted within 30 sec (see ITEM_DESPAWN_TIME below)
  },

  shield: {
    name: "shield",
    image: "image/shield.png",
    radius: 10,

    shieldHitpoints: 80,
    spawnChance: 1.45,    // 45%
    timeLife: 30000,    // ms — despawns if not looted within 30 sec
  },

  speedup: {
    name: "speedup",
    image: "image/speedup.png",
    radius: 10,

    speedBonus: 30,      // flat add to movementSpeed (e.g. 100 -> 130)
    duration: 20000,     // ms (20 sec)
    spawnChance: 0.6,   // 60%
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    // Small icon drawn above the player's health bar while this is active
    icon: "image/speedup.png"
  },

  powerup: {
    name: "powerup",
    image: "image/powerup.png",
    radius: 10,

    healthMultiplier: 2, // max health & current health both x2
    damageMultiplier: 2, // current weapon's damage x2
    duration: 20000,     // ms (10 sec)
    spawnChance: 0.4,   // 40%
    timeLife: 30000,    // ms — despawns if not looted within 30 sec

    icon: "image/powerup.png"
  }

};



// ---------------------------------------------------------------------------
// GOLD ORB — kept separate from ITEM_TYPES above on purpose, same as
// item.js: every other pickup shares one spawnChance/amount for every bot
// that drops it, but gold orbs need a different chance AND a different
// amount per bot type (see spawnGoldOrbChance / goldOrbAmount on BOT_TYPES
// in bot_server.js — that's the ONLY place those numbers live now). Only
// the sprite/size stay fixed here since every gold orb looks the same
// regardless of amount.
// ---------------------------------------------------------------------------
const GOLD_ORB_IMAGE = "image/goldenorb.png";
const GOLD_ORB_RADIUS = 10;



// ---------------------------------------------------------------------------
// IMAGE CACHE — same pattern as botImageCache in bot.js: reuse one Image
// object per sprite file, no matter how many drops/icons use it.
// ---------------------------------------------------------------------------
const itemImageCache = {};

function getItemImage(filename) {
  if (!itemImageCache[filename]) {
    const img = new Image();
    img.src = filename;
    itemImageCache[filename] = img;
  }
  return itemImageCache[filename];
}



// ---------------------------------------------------------------------------
// DESPAWN — every dropped item disappears if it isn't looted in time. Each
// def above (ITEM_TYPES / WEAPONS / ARMOR_TYPES / STONE_TYPES / ORB_TYPES)
// can carry its own `timeLife` (ms) to override this; ITEM_DESPAWN_TIME
// below is just the fallback used for anything that doesn't set one
// (gold orbs, manually-dropped inventory items, or a def with no timeLife
// field). Set to 0 to disable despawning entirely for whatever falls back
// to it.
// ---------------------------------------------------------------------------
const ITEM_DESPAWN_TIME = 30000; // 30 sec



// ---------------------------------------------------------------------------
// DROP STAT ROLLS — weapons, armor, rings and accessories are PLAIN in
// item_server.js / armor_server.js / weapon_server.js (ONLINE mode) (no stats at all). The stats are rolled here, once, when an
// enemy drops the item, and travel with that one item from then on (ground
// -> inventory -> equip -> saved), so two drops of the same item differ.
//
// Each line of ITEM_ROLL_STATS is one possible stat:
//   min / max  — the whole range, split into tiers by enemy level (see below).
//   chance     — chance (0-1) the item gets this stat at all.
//   decimals   — how many decimals the rolled number keeps.
//   pickOne    — stats sharing a pickOne name are one group: the group is
//                rolled as a whole and only ONE of its stats is added
//                (physicalDamage OR magicalAttack, never both).
//   onlyFor    — (optional) only these item categories can roll it.
//
// ENEMY LEVEL — TIERS. Enemy levels 1-50 are split into ITEM_ROLL_TIERS (5)
// tiers of 10 levels each, and every stat's range is split into the same 5
// equal slices. The enemy's tier decides which slice the number comes from:
//   physicalDamage 1-300  ->  lvl 1-10: 1-60    lvl 11-20: 61-120
//                             lvl 21-30: 121-180  lvl 31-40: 181-240
//                             lvl 41-50: 241-300
// Every other stat is sliced the same way (physicalDefense 1-50 -> 1-10,
// 11-20, 21-30, 31-40, 41-50; health 1-1500 -> 1-300, 301-600, ...).
// Enemies above level 50 use the top tier.
//
// WHICH NUMBER — inside the slice, the CHANCE OF REACHING each number goes in a
// straight line from 100% (the lowest number, always reached) down to the
// "top chance" (the highest number). So with a top chance of 10%, the highest
// number (e.g. 60) comes out 10% of the time; with 40% it comes out 40% of the
// time; with 100% it comes out EVERY time. Numbers in between share the rest.
//   top chance = ITEM_ROLL_TOP_CHANCE_LOW at the FIRST level of the tier,
//                growing to ITEM_ROLL_TOP_CHANCE_HIGH at the LAST level of the
//                tier, PLUS the enemy's increaseSpawnGet (capped at 100%).
// e.g. level 1 enemy: 60 is 10% (40% with increaseSpawnGet 0.3); level 10
// enemy: 60 is 100%; level 11 enemy starts again at 120 being 10%.
// ---------------------------------------------------------------------------
const ITEM_ROLL_MAX_ENEMY_LEVEL = 50;
const ITEM_ROLL_TIERS = 5;
const ITEM_ROLL_TOP_CHANCE_LOW = 0.1;   // chance of the top number at the first level of a tier
const ITEM_ROLL_TOP_CHANCE_HIGH = 1.0;  // chance of the top number at the last level of a tier
const ITEM_ROLL_CATEGORIES = ["weapon", "armor", "ring", "accessory"];
const ITEM_ROLL_STATS = [
  { stat: "physicalDamage",  min: 1,    max: 100,   chance: 1,   decimals: 0, pickOne: "attack" },
  { stat: "magicalAttack",   min: 1,    max: 100,   chance: 1,   decimals: 0, pickOne: "attack" },
  { stat: "physicalDefense", min: 1,    max: 50,    chance: 0.7, decimals: 0 },
  { stat: "magicalDefense",  min: 1,    max: 50,    chance: 0.7, decimals: 0 },
  { stat: "hpRegen",         min: 0.01, max: 0.030, chance: 0.5, decimals: 3 },
  { stat: "manaRegen",       min: 0.01, max: 0.02, chance: 0.5, decimals: 3 },
  { stat: "health",          min: 1,    max: 1500,  chance: 0.4, decimals: 0 },
  { stat: "mana",            min: 1,    max: 100,   chance: 0.4, decimals: 0 },
  { stat: "vit",             min: 1,    max: 50,    chance: 0.3, decimals: 0 },
  { stat: "pow",             min: 1,    max: 50,    chance: 0.3, decimals: 0 },
  { stat: "dex",             min: 1,    max: 50,    chance: 0.3, decimals: 0 },
  { stat: "int",             min: 1,    max: 50,    chance: 0.3, decimals: 0 },
  { stat: "criticalDamage",  min: 0.005, max: 0.18,   chance: 0.2, decimals: 3 },
  { stat: "criticalChance",  min: 0.01, max: 0.05,  chance: 0.2, decimals: 3 },
  // block only works from the armor slot (rollArmorBlock in armor.js), so only armor rolls it.
  { stat: "block",           min: 1,    max: 5,     chance: 0.2, decimals: 0, onlyFor: ["armor"] }
];

// One number for one stat at one enemy level.
function rollOneItemStat(def, enemyLevel, bonus) {
  const lvl = Math.max(1, Math.min(ITEM_ROLL_MAX_ENEMY_LEVEL, Math.floor(Number(enemyLevel)) || 1));
  const levelsPerTier = ITEM_ROLL_MAX_ENEMY_LEVEL / ITEM_ROLL_TIERS;           // 10
  const tier = Math.min(ITEM_ROLL_TIERS - 1, Math.floor((lvl - 1) / levelsPerTier)); // 0..4
  const posInTier = levelsPerTier > 1 ? ((lvl - 1) % levelsPerTier) / (levelsPerTier - 1) : 1; // 0..1

  // This tier's slice of the stat's range. step = smallest unit the stat keeps
  // (1 for whole numbers, 0.001 for 3 decimals) so slices never overlap.
  const step = Math.pow(10, -(def.decimals || 0));
  const width = (def.max - def.min + step) / ITEM_ROLL_TIERS;
  const f = Math.pow(10, def.decimals || 0);
  const lo = Math.round((def.min + tier * width) * f) / f;
  const hi = Math.round((def.min + tier * width + width - step) * f) / f;

  // topChance = chance of getting the HIGHEST number of this slice. `bonus` = the
  // enemy's increaseSpawnGet (bot.js / bot_server.js) is added straight onto it
  // (10% + 0.3 = 40% at the first level of a tier); capped at 100%.
  const topChance = Math.min(1, ITEM_ROLL_TOP_CHANCE_LOW + (ITEM_ROLL_TOP_CHANCE_HIGH - ITEM_ROLL_TOP_CHANCE_LOW) * posInTier + (bonus || 0));
  // The chance of reaching a point x (0 = lowest number, 1 = highest) falls in a
  // straight line from 100% to topChance. Solved backwards from a random 0-1:
  // anything at or below topChance is the highest number, the rest is spread
  // evenly over the numbers below it.
  const u = Math.random();
  let v;
  if (u <= topChance || topChance >= 1) {
    v = hi;
  } else {
    const x = (1 - u) / (1 - topChance);                       // 0..1
    const count = Math.round((hi - lo) / step) + 1;           // how many numbers in the slice
    const idx = Math.min(count - 1, Math.floor(x * count));
    v = lo + idx * step;
  }
  v = Math.round(v * f) / f;
  return Math.max(lo, Math.min(hi, v));
}

// Rolls the stats for ONE dropped item. Returns a plain object like
// { physicalDamage: 8, health: 31 } (empty when nothing rolled / not gear).
function rollItemStats(category, enemyLevel, increaseSpawnGet) {
  const out = {};
  if (ITEM_ROLL_CATEGORIES.indexOf(category) === -1) return out;
  // increaseSpawnGet (from the enemy — BOT_TYPES in bot.js / bot_server.js) is added to
  // every stat's chance (70% + 0.3 = 100%, capped at 100%) and to the chance of the high
  // end of each number range (see rollOneItemStat). Missing / bad value = 0 (no bonus).
  const bonus = (typeof increaseSpawnGet === "number" && increaseSpawnGet > 0) ? increaseSpawnGet : 0;
  const groups = {};
  for (const def of ITEM_ROLL_STATS) {
    if (def.onlyFor && def.onlyFor.indexOf(category) === -1) continue;
    if (def.pickOne) { (groups[def.pickOne] = groups[def.pickOne] || []).push(def); continue; }
    if (Math.random() < Math.min(1, def.chance + bonus)) out[def.stat] = rollOneItemStat(def, enemyLevel, bonus);
  }
  for (const name in groups) {
    const list = groups[name];
    let best = 0, total = 0;
    for (const d of list) { best = Math.max(best, d.chance); total += d.chance; }
    if (!(Math.random() < Math.min(1, best + bonus))) continue;
    let r = Math.random() * total, picked = list[list.length - 1];
    for (const d of list) { r -= d.chance; if (r < 0) { picked = d; break; } }
    out[picked.stat] = rollOneItemStat(picked, enemyLevel, bonus);
  }
  return out;
}



// ---------------------------------------------------------------------------
// CREATE A DROPPED ITEM (sits on the ground until picked up)
// ---------------------------------------------------------------------------
let nextItemDropId = 1;

// A weapon.js entry with category: "weapon" (e.g. WEAPONS.ak47) can be
// dropped/looted the same way as a regular ITEM_TYPES entry — this looks
// it up as a fallback whenever typeName isn't a known item type. Returns
// null if typeName is neither a known item nor a lootable weapon.
function getLootableWeaponDef(typeName) {
  if (typeof WEAPONS === "undefined") return null;
  const weaponDef = WEAPONS[typeName];
  return (weaponDef && weaponDef.category === "weapon") ? weaponDef : null;
}

// Armor + rings + accessories all live in ARMOR_TYPES (armor.js /
// armor_server.js) and drop/pick up the same way — only their
// `category` differs ("armor" / "ring" / "accessory"). The old
// getLootableArmorDef() only accepts "armor", which is why rings and
// accessories in a bot's spawnItem list never dropped.
function getLootableGearDef(typeName) {
  if (typeof getArmor !== "function") return null;
  const d = getArmor(typeName);
  return (d && (d.category === "armor" || d.category === "ring" || d.category === "accessory")) ? d : null;
}

function createItemDrop(typeName, x, y, stats) {

  const itemDef = ITEM_TYPES[typeName];
  const weaponDef = itemDef ? null : getLootableWeaponDef(typeName);
  // armor.js's own getLootableArmorDef() — see its header comment — is
  // the one used here, same as getLootableWeaponDef() above is for
  // WEAPONS.
  const armorDef = (itemDef || weaponDef) ? null : getLootableGearDef(typeName);
  const upgradeDef = (itemDef || weaponDef || armorDef) ? null : (typeof getUpgradeItem === "function" ? getUpgradeItem(typeName) : null);
  const def = itemDef || weaponDef || armorDef || upgradeDef;

  if (!def) {
    throw new Error("Item type not found: " + typeName);
  }

  // Weapons don't carry their own ground-sprite path in weapon.js (same
  // convention the Inventory screen already uses for equip slots) — so
  // it's derived here instead: "image/ak47.png", etc. Armor entries DO
  // carry their own `image` field (armor.js), so those use it directly.
  const imagePath = (itemDef || armorDef) ? def.image : ("image/" + typeName + ".png");

  return {
    id: nextItemDropId++,
    type: typeName,
    // The stats rolled for THIS drop (see rollItemStats() above) — null for
    // anything that isn't gear. Carried to the inventory on pickup.
    stats: stats || null,
    // itemDef.category lets a plain ITEM_TYPES entry opt into its own
    // pickup routing (e.g. goldOrb's "gold", handled separately in
    // checkItemPickup() below) instead of the generic "item" ->
    // applyItemEffect() path health/shield/speedup/powerup use.
    category: weaponDef ? "weapon" : (armorDef ? (armorDef.category || "armor") : (upgradeDef ? upgradeDef.category : ((itemDef && itemDef.category) || "item"))),

    x: x,
    y: y,
    radius: def.radius || 10,
    // Ground-drawn size — see drawItemDrops() below. Uses the def's own
    // width/height (weapon_server.js/armor_server.js) when it has them,
    // so a tall narrow sword icon draws tall and narrow instead of being
    // forced into the square that radius*2 alone would give it. Only
    // falls back to a radius-based square for defs that don't set
    // width/height at all (plain ITEM_TYPES pickups like health/shield/
    // speedup/powerup).
    width: def.width || (def.radius || 10) * 2,
    height: def.height || (def.radius || 10) * 2,

    image: getItemImage(imagePath),
    spawnTime: performance.now(),
    // Per-def override (see the def's own `timeLife`), falling back to
    // ITEM_DESPAWN_TIME — see updateItemDrops() below.
    timeLife: (typeof def.timeLife === "number") ? def.timeLife : ITEM_DESPAWN_TIME
  };
}



// ---------------------------------------------------------------------------
// CREATE A DROPPED ITEM FROM AN INVENTORY ENTRY — used when the player
// drags a weapon/armor/stone/materials item out of the Inventory screen
// or the in-gameplay equip popup and lets go outside any valid slot.
// Unlike createItemDrop() above, this doesn't look typeName up in
// ITEM_TYPES/WEAPONS — it carries the actual inventory entry (name/data/
// qty) along, so armor and stackable stone/materials can be dropped on
// the ground too, not just weapons. Picked back up via
// pickUpInventoryDrop() below, which returns it to the storage grid
// exactly as it was.
// ---------------------------------------------------------------------------
function createInventoryItemDrop(entry, x, y) {
  if (!entry) return null;

  const invType = entry.type || entry.kind;
  const imagePath = (entry.data && entry.data.image) || ("image/" + entry.name + ".png");

  return {
    id: nextItemDropId++,
    type: entry.name,
    invType: invType,
    category: "invItem",

    name: entry.name,
    data: entry.data,
    qty: entry.qty || 1,

    x: x,
    y: y,
    radius: 10,
    // Same width/height carry-over as createItemDrop() above.
    width: (entry.data && entry.data.width) || 20,
    height: (entry.data && entry.data.height) || 20,

    image: getItemImage(imagePath),
    spawnTime: performance.now(),
    timeLife: ITEM_DESPAWN_TIME
  };
}



// ---------------------------------------------------------------------------
// SPAWNING ON BOT DEATH
// spawnItemList is the bot's `spawnItem` field from BOT_TYPES, e.g.:
//   "shield,speedup,powerup,health"
// or, with a lootable weapon mixed in:
//   "shield,speedup,powerup,health,ak47"
// (a comma-separated string, or already an array of type names).
//
// Each type in the list gets its OWN independent chance roll, using that
// type's own spawnChance — from ITEM_TYPES for a regular pickup, or from
// WEAPONS for a weapon marked category: "weapon" (see weapon.js) — so a
// single bot death can drop zero, one, or several items/weapons.
// ---------------------------------------------------------------------------
function spawnItemsOnBotDeath(spawnItemList, x, y, bot) {

  const drops = [];

  if (!spawnItemList) return drops;

  const typeNames = Array.isArray(spawnItemList)
    ? spawnItemList
    : String(spawnItemList).split(",").map(s => s.trim()).filter(Boolean);

  for (const typeName of typeNames) {

    const itemDef = ITEM_TYPES[typeName];
    const weaponDef = itemDef ? null : getLootableWeaponDef(typeName);
    const armorDef = (itemDef || weaponDef) ? null : getLootableGearDef(typeName);
    const upgradeDef = (itemDef || weaponDef || armorDef) ? null : (typeof getUpgradeItem === "function" ? getUpgradeItem(typeName) : null);
    const def = itemDef || weaponDef || armorDef || upgradeDef;

    if (!def) {
      console.warn("item.js: unknown item/weapon type in spawnItem list:", typeName);
      continue;
    }

    if (Math.random() < (def.spawnChance || 0)) {
      // Scatter multiple drops from the same death apart a little so
      // they don't render exactly on top of each other.
      const angle = Math.random() * Math.PI * 2;
      const scatter = drops.length * 14;

      const dropX = x + Math.cos(angle) * scatter;
      const dropY = y + Math.sin(angle) * scatter;

      // ONLINE: no stats are rolled here. The bot host only says WHAT
      // dropped; the SERVER rolls the stats (server.js "dropAdd", using
      // rollItemStats() in this file) so a player can't pick their own.
      drops.push(createItemDrop(typeName, dropX, dropY));
    }
  }

  return drops;
}



// ---------------------------------------------------------------------------
// GOLD ORB SPAWNING — separate from spawnItemsOnBotDeath() above on purpose.
// Every number here comes straight from the bot that died, not from a
// shared ITEM_TYPES entry:
//   chance  <- bot.spawnGoldOrbChance (BOT_TYPES in bot_server.js, e.g. 0.8 = 80%)
//   amount  <- bot.goldOrbAmount      (BOT_TYPES in bot_server.js, e.g. 100)
// Returns an array (0 or 1 drop) so it can be pushed into itemDrops the
// same way spawnItemsOnBotDeath()'s result is.
// ---------------------------------------------------------------------------
function spawnGoldOrbOnBotDeath(chance, amount, x, y) {

  if (!chance || Math.random() >= chance) return [];

  // Small random offset so this never spawns on the exact same pixel as
  // a regular item drop from the same death — matches the minimum
  // scatter radius spawnItemsOnBotDeath() above uses, so a shield (or
  // any other item) and a gold orb from the same kill land apart instead
  // of stacking.
  const angle = Math.random() * Math.PI * 2;
  const scatter = 30 + Math.random() * 15; // 30-45
  const dropX = x + Math.cos(angle) * scatter;
  const dropY = y + Math.sin(angle) * scatter;

  return [{
    id: nextItemDropId++,
    type: "goldOrb",
    category: "gold",

    goldAmount: amount || 0,

    x: dropX,
    y: dropY,
    radius: GOLD_ORB_RADIUS,

    image: getItemImage(GOLD_ORB_IMAGE),
    spawnTime: performance.now(),
    timeLife: ITEM_DESPAWN_TIME
  }];
}



// ---------------------------------------------------------------------------
// UPDATE — ages out drops using each drop's own `timeLife` (set on it at
// creation time, above). A drop with timeLife 0/falsy never despawns.
// ---------------------------------------------------------------------------
function updateItemDrops(itemDrops, dt) {

  const now = performance.now();

  for (let i = itemDrops.length - 1; i >= 0; i--) {
    const drop = itemDrops[i];
    if (drop.timeLife && (now - drop.spawnTime >= drop.timeLife)) {
      itemDrops.splice(i, 1);
    }
  }
}



// ---------------------------------------------------------------------------
// GAMEPLAY "INVENTORY FULL" NOTICE — a small floating message shown over
// the game canvas when a player walks over a gear item (weapon, armor,
// stone/orb, or a manually-dropped inventory item — anything that has to
// go through the storage grid) while that grid is full (see
// INVENTORY_GRID_SIZE / invGridData / addItemToInventory in index.html —
// 4x4 slots x4 pages = 64 total boxes). The item is NOT picked up: it
// stays exactly where it is on the ground so the player can come back for
// it once they've freed up space.
//
// This is intentionally self-contained (its own tiny DOM element) rather
// than reusing index.html's showHubToast()/#hubToast — that toast lives
// inside the hidden #offlineOptionsScreen hub screen and never actually
// shows on top of the gameplay canvas, so it wasn't a visible message
// during a match.
// ---------------------------------------------------------------------------
let gameplayFullNoticeEl = null;
let gameplayFullNoticeTimer = null;

function showGameplayFullNotice(itemLabel) {
  if (typeof document === "undefined") return;

  if (!gameplayFullNoticeEl) {
    gameplayFullNoticeEl = document.createElement("div");
    gameplayFullNoticeEl.style.cssText =
      "position:fixed;top:14%;left:50%;transform:translateX(-50%);" +
      "background:rgba(20,20,20,0.88);color:#fff;font:600 14px/1.3 sans-serif;" +
      "padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.4);z-index:99999;pointer-events:none;" +
      "opacity:0;transition:opacity 0.2s ease;text-align:center;max-width:80vw;";
    document.body.appendChild(gameplayFullNoticeEl);
  }

  gameplayFullNoticeEl.textContent = "Inventory is full";
  gameplayFullNoticeEl.style.opacity = "1";

  if (gameplayFullNoticeTimer) clearTimeout(gameplayFullNoticeTimer);
  gameplayFullNoticeTimer = setTimeout(() => {
    if (gameplayFullNoticeEl) gameplayFullNoticeEl.style.opacity = "0";
  }, 1400);
}

// Minimum time between repeat "inventory full" notices for the SAME
// dropped item, so standing on top of it doesn't spam the message every
// single frame (checkItemPickup runs every frame while the player is
// overlapping the drop).
const INVENTORY_FULL_NOTICE_COOLDOWN = 1500; // ms

function canShowInventoryFullNotice(drop, now) {
  if (!drop._lastFullNoticeAt || (now - drop._lastFullNoticeAt) >= INVENTORY_FULL_NOTICE_COOLDOWN) {
    drop._lastFullNoticeAt = now;
    return true;
  }
  return false;
}



// ---------------------------------------------------------------------------
// PICKUP — call every frame with the live itemDrops array + the player.
//
// NOTE ON NAMING: this is deliberately called runItemPickupCheck(), NOT
// checkItemPickup(). online.js's swap-in step (netInstallServerCode) never
// installs anything named "checkItemPickup" from this file — that name is
// on online.js's own NET_PROTECTED_FUNCTIONS list, kept as its own
// party-loot-aware wrapper no matter what. So a function defined under
// that name here would be silently ignored: dead code, never runs.
//
// runItemPickupCheck is NOT protected, so THIS is the copy that actually
// executes once a player is online — item.js's checkItemPickup is just a
// one-line shell that calls whatever runItemPickupCheck currently resolves
// to (this file's version once swapped in, item.js's own copy otherwise).
// Same pattern already used for pickUpWeaponDrop/pickUpArmorDrop/
// pickUpUpgradeDrop/pickUpInventoryDrop below. Keep this in step with
// item.js's copy the same way the rest of this file is kept in step.
//
// Removes any drop the player is touching. A regular pickup (health,
// shield, speedup, powerup) applies its effect immediately; a weapon
// drop instead goes into the storage grid inventory to be equipped
// later (see pickUpWeaponDrop below).
//
// Weapon/armor/stone/orb/invItem drops go through the shared 64-slot
// storage grid (addItemToInventory), which can be full. Those pickup
// functions now report back whether the item actually fit: if it did,
// the drop is removed from the ground as before; if the grid was full,
// the drop is left in itemDrops untouched (still sits on the floor, can
// still be picked up later) and a small on-screen notice is shown
// instead of silently deleting the item.
// ---------------------------------------------------------------------------
function runItemPickupCheck(itemDrops, player, playerPos) {

  const now = performance.now();

  for (let i = itemDrops.length - 1; i >= 0; i--) {

    const drop = itemDrops[i];

    const dx = playerPos.x - drop.x;
    const dy = playerPos.y - drop.y;
    const dist = Math.hypot(dx, dy);

    if (dist < playerPos.radius + drop.radius) {

      // Consumables (health/shield/speedup/powerup) and gold never touch
      // the storage grid, so they're always "added" — no capacity limit
      // applies to them.
      let added = true;

      if (drop.category === "weapon") {
        added = pickUpWeaponDrop(drop.type, drop.stats);
      } else if (drop.category === "armor" || drop.category === "ring" || drop.category === "accessory") {
        added = pickUpArmorDrop(drop.type, drop.stats);
      } else if (drop.category === "invItem") {
        added = pickUpInventoryDrop(drop);
      } else if (drop.category === "gold") {
        pickUpGoldOrb(drop.goldAmount);
      } else if (drop.category === "stone" || drop.category === "orb") {
        added = pickUpUpgradeDrop(drop.type, drop.category);
      } else {
        applyItemEffect(player, drop.type);
      }

      if (added) {
        itemDrops.splice(i, 1);
      } else if (canShowInventoryFullNotice(drop, now)) {
        showGameplayFullNotice(drop.type);
      }
    }
  }
}



// ---------------------------------------------------------------------------
// WEAPON PICKUP — hands a dropped weapon off to the storage grid
// inventory (addItemToInventory, defined in index.html) instead of
// applying an instant stat effect. Weapons are gear to equip later via
// the Inventory screen or the in-gameplay equip popup, not a consumable.
// Returns false (and leaves the drop on the floor — see checkItemPickup)
// if the grid is already full, instead of silently discarding the item.
// ---------------------------------------------------------------------------
function pickUpWeaponDrop(weaponName, stats) {

  if (typeof getWeapon !== "function") return false;

  const weaponData = getWeapon(weaponName);
  if (!weaponData) return false;

  if (typeof addItemToInventory !== "function") return false;

  const added = addItemToInventory(
    "weapon",
    weaponName,
    { ...weaponData, ...(stats || {}), image: "image/" + weaponName + ".png" },
    1
  );

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + weaponName);
  }

  return !!added;
}



// ---------------------------------------------------------------------------
// ARMOR PICKUP — hands a dropped armor piece off to the storage grid
// inventory, same idea as pickUpWeaponDrop() above. Armor is gear to
// equip later via the Inventory screen or the in-gameplay equip popup
// (Armor slot), not a consumable.
//
// armor.js's ARMOR_TYPES entries store the flat armor bonus under the
// field name `physicalDefense` (e.g. { physicalDefense: 3, health:
// 30, ... }) — but index.html's equip UI (the stats-popup "Defense"
// row, the upgrade formula, applyEquippedArmorToPlayer()) already reads
// that value off a `defense` field on the inventory copy, same name
// pickUpWeaponDrop() doesn't need to touch because weapons don't have
// this base/bonus split. So it's remapped once here, on the way into
// the grid — see armor.js's own header comment for why.
// ---------------------------------------------------------------------------
function pickUpArmorDrop(armorName, stats) {

  if (typeof getArmor !== "function") return false;

  const armorData = getArmor(armorName);
  if (!armorData) return false;

  if (typeof addItemToInventory !== "function") return false;

  const added = addItemToInventory(
    (armorData.category === "ring" || armorData.category === "accessory") ? armorData.category : "armor",
    armorName,
    { ...armorData, ...(stats || {}), defense: (stats && typeof stats.physicalDefense === "number") ? stats.physicalDefense : armorData.physicalDefense },
    1
  );

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + armorName);
  }

  return !!added;
}



// ---------------------------------------------------------------------------
// UPGRADE-ITEM PICKUP — hands a dropped stone/orb (from upgrade.js) off
// to the storage grid inventory, same idea as pickUpWeaponDrop() above.
// Stones/orbs are never equipped in the Weapon/Armor slots — just stored
// until used on a weapon/armor item by the upgrade system.
// ---------------------------------------------------------------------------
function pickUpUpgradeDrop(typeName, category) {

  if (typeof getUpgradeItem !== "function") return false;

  const upgradeData = getUpgradeItem(typeName);
  if (!upgradeData) return false;

  if (typeof addItemToInventory !== "function") return false;

  const added = addItemToInventory(category, typeName, upgradeData, 1);

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + typeName);
  }

  return !!added;
}



// ---------------------------------------------------------------------------
// GOLD ORB PICKUP — unlike every other pickup above, this never touches
// the storage grid inventory or a player stat. It just adds the orb's
// goldAmount straight to the player's gold total via index.html's
// addGold()/GOLD_KEY (the same running total shown in the Inventory
// screen's gold bar and the gameplay small-bag popup).
// ---------------------------------------------------------------------------
function pickUpGoldOrb(amount) {

  const goldAmount = amount || 0;

  if (typeof addGold === "function") {
    addGold(goldAmount);
  }

  if (typeof showHubToast === "function") {
    showHubToast("+" + goldAmount + " gold");
  }
}



// ---------------------------------------------------------------------------
// INVENTORY-ITEM PICKUP — hands a dropped weapon/armor/stone/materials
// item back to the storage grid exactly as it was, for drops created by
// createInventoryItemDrop() (the player's own items dropped on the
// ground) rather than a bot kill. Keeps the entry's own data/qty instead
// of re-deriving stats the way pickUpWeaponDrop() does.
// ---------------------------------------------------------------------------
function pickUpInventoryDrop(drop) {
  if (typeof addItemToInventory !== "function") return false;

  const added = addItemToInventory(drop.invType, drop.name, drop.data, drop.qty || 1);

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + drop.name);
  }

  return !!added;
}



// ---------------------------------------------------------------------------
// APPLY EFFECT
// ---------------------------------------------------------------------------
function applyItemEffect(player, typeName) {

  const def = ITEM_TYPES[typeName];
  if (!def) return;

  if (!player.activeEffects) player.activeEffects = {};

  switch (typeName) {

    case "health": {
      player.currentHealth = Math.min(player.health, player.currentHealth + def.healAmount);
      break;
    }

    case "shield": {
      player.shield = def.shieldHitpoints;
      break;
    }

    case "speedup": {
      // Remember the un-buffed speed the FIRST time speedup kicks in, so
      // picking up a second one mid-buff refreshes the timer instead of
      // stacking on top of an already-boosted speed.
      if (!player.activeEffects.speedup) {
        player.baseMovementSpeed = player.movementSpeed;
        player.movementSpeed = player.baseMovementSpeed + def.speedBonus;
      }

      player.activeEffects.speedup = {
        endTime: performance.now() + def.duration,
        icon: def.icon
      };
      break;
    }

    case "powerup": {
      if (!player.activeEffects.powerup) {
        player.baseMaxHealth = player.health;
        // player.weapon can be null (no weapon equipped yet) -- only
        // remember/buff weapon damage when there actually is a weapon.
        player.baseWeaponDamage = player.weapon ? player.weapon.physicalDamage : undefined;

        player.health = player.baseMaxHealth * def.healthMultiplier;
        player.currentHealth = player.currentHealth * def.healthMultiplier;

        // IMPORTANT: player.weapon is the SAME object reference stored in
        // WEAPONS in weapon.js (character.js's attachWeaponToCharacter()
        // doesn't clone it). Mutating .physicalDamage directly would
        // permanently buff that weapon for everyone. Give the player
        // their own shallow copy instead, so only their weapon is affected.
        if (player.weapon && typeof player.baseWeaponDamage === "number") {
          player.weapon = Object.assign({}, player.weapon, {
            physicalDamage: player.baseWeaponDamage * def.damageMultiplier
          });
        }
      }

      player.activeEffects.powerup = {
        endTime: performance.now() + def.duration,
        icon: def.icon
      };
      break;
    }
  }
}



// ---------------------------------------------------------------------------
// TICK ACTIVE (TIMED) EFFECTS — call every frame. Reverts stats back to
// normal once an effect's duration runs out.
// ---------------------------------------------------------------------------
function updateActiveEffects(player) {

  if (!player.activeEffects) return;

  const now = performance.now();

  if (player.activeEffects.speedup && now >= player.activeEffects.speedup.endTime) {
    player.movementSpeed = player.baseMovementSpeed;
    delete player.activeEffects.speedup;
  }

  if (player.activeEffects.powerup && now >= player.activeEffects.powerup.endTime) {
    player.health = player.baseMaxHealth;
    // Clamp rather than rescale: if the player took damage while the
    // buff was active, they keep that absolute damage instead of it
    // being "healed back" proportionally when max health halves again.
    player.currentHealth = Math.min(player.currentHealth, player.health);

    if (player.weapon && typeof player.baseWeaponDamage === "number") {
      player.weapon = Object.assign({}, player.weapon, {
        physicalDamage: player.baseWeaponDamage
      });
    }

    delete player.activeEffects.powerup;
  }
}



// ---------------------------------------------------------------------------
// DAMAGE — call this instead of subtracting from player.currentHealth
// directly, so shield hitpoints are respected.
//
// Rule: shield absorbs damage BEFORE health, and defense does NOT reduce
// damage taken by the shield (defense only reduces damage that reaches
// health). Any damage left over once the shield breaks spills over onto
// health as normal (defense-reduced).
//
// rawDamage accepts either a plain number (legacy/back-compat — treated
// as pure physical damage) or an attack-result-shaped object carrying
// separate physicalDamage/magicalDamage (e.g. the attackResult passed
// through from getAttackDamage() in character.js).
//
// PHYSICAL DEFENSE is player.physicalDefense (vit/dex attributes +
// character.js's own armor-type combining) PLUS player.armor (the
// separate equipped-armor-SLOT defense value set by
// applyEquippedArmorToPlayer() in index.html) — both are real, additive
// sources of physical mitigation, not alternatives to each other.
// magicalDamage is reduced by player.magicalDefense only (no slot-based
// magical defense exists yet).
// ---------------------------------------------------------------------------
function applyDamageToPlayer(player, rawDamage) {

  const rawPhysical = (typeof rawDamage === "number") ? rawDamage : ((rawDamage && rawDamage.physicalDamage) || 0);
  const rawMagical = (typeof rawDamage === "number") ? 0 : ((rawDamage && rawDamage.magicalDamage) || 0);
  const totalRaw = rawPhysical + rawMagical;

  // DEFENSEBOOST — skill.js's "defenseboost" buff raises the player's TOTAL
  // defense (physicalDefense + equipped armor, and magicalDefense) by its
  // defenseIncrease while it runs. 1 when there is no buff.
  const defBoost = (typeof getDefenseBoostMultiplier === "function") ? getDefenseBoostMultiplier(player) : 1;

  // isCritical rides along on attack-result-shaped rawDamage (see
  // getAttackDamage() in character.js) — used below for the DAMAGE NUMBER
  // popup only, doesn't affect the math above.
  const isCritical = (typeof rawDamage === "object") && !!(rawDamage && rawDamage.isCritical);

  if (player.shield && player.shield > 0) {

    player.shield -= totalRaw;

    if (player.shield <= 0) {
      const overflow = -player.shield;
      player.shield = 0;

      if (overflow > 0) {
        // Split the overflow back into physical/magical proportionally
        // to what the original hit carried, so each portion still gets
        // reduced by its own matching defense stat.
        const overflowRatio = totalRaw > 0 ? (overflow / totalRaw) : 0;
        const physicalDefense = ((player.physicalDefense || 0) + (player.armor || 0)) * defBoost;
        const magicalDefense = (player.magicalDefense || 0) * defBoost;
        const dmg = Math.max(1, Math.round(
          Math.max(0, (rawPhysical * overflowRatio) - physicalDefense) +
          Math.max(0, (rawMagical * overflowRatio) - magicalDefense)
        ));
        player.currentHealth -= dmg;

        // DAMAGE NUMBER — floating popup above the player, same spot
        // every hit uses (see number.js). Only the portion that actually
        // spilled onto health is shown here; a hit fully absorbed by
        // shield shows nothing (see the shield-only branch's comment
        // below).
        if (typeof createDamageNumber === "function" && typeof playerPos !== "undefined") {
          createDamageNumber(playerPos.x, playerPos.y - playerPos.radius, dmg, { isCritical: isCritical });
        }
      }
    }
    // else: shield fully absorbed the hit, health untouched — no damage
    // number, since nothing actually got through to show a number for.

  } else {
    const physicalDefense = ((player.physicalDefense || 0) + (player.armor || 0)) * defBoost;
    const magicalDefense = (player.magicalDefense || 0) * defBoost;
    const dmg = Math.max(1,
      Math.max(0, Math.round(rawPhysical - physicalDefense)) +
      Math.max(0, Math.round(rawMagical - magicalDefense))
    );
    player.currentHealth -= dmg;

    if (typeof createDamageNumber === "function" && typeof playerPos !== "undefined") {
      createDamageNumber(playerPos.x, playerPos.y - playerPos.radius, dmg, { isCritical: isCritical });
    }
  }
}



// ---------------------------------------------------------------------------
// RESET — call when (re)starting an offline level so shield/effects from
// a previous run don't carry over.
// ---------------------------------------------------------------------------
function resetPlayerItemState(player) {
  player.shield = 0;
  player.activeEffects = {};
  delete player.baseMovementSpeed;
  delete player.baseMaxHealth;
  delete player.baseWeaponDamage;
}



// ---------------------------------------------------------------------------
// DRAWING — dropped items on the ground
// ---------------------------------------------------------------------------
function drawItemDrops(ctx, itemDrops, worldOffsetX, worldOffsetY) {

  for (const drop of itemDrops) {

    const screenX = worldOffsetX + drop.x;
    const screenY = worldOffsetY + drop.y;
    // Was always a forced square (radius * 2 on both axes) — a tall
    // narrow sword icon got squashed into that square. Now draws at the
    // drop's own width/height instead (falls back to the old
    // radius-based square only if a drop somehow has neither).
    const imgWidth = drop.width || drop.radius * 2;
    const imgHeight = drop.height || drop.radius * 2;

    ctx.save();
    ctx.translate(screenX, screenY);

    if (drop.image && drop.image.complete && drop.image.naturalWidth > 0) {
      ctx.drawImage(drop.image, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    } else {
      ctx.fillStyle = "#0af";
      ctx.beginPath();
      ctx.arc(0, 0, drop.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}



// ---------------------------------------------------------------------------
// DRAWING — small active-effect icons above the player's health bar.
// Call with the SAME screen-space x/y you use for the player's health bar.
// ---------------------------------------------------------------------------
const ACTIVE_ICON_SIZE = 14;
const ACTIVE_ICON_GAP = 3;

function drawActiveEffectIcons(ctx, player, screenX, screenAboveY) {

  if (!player.activeEffects) return;

  const icons = [];
  if (player.activeEffects.speedup) icons.push(ITEM_TYPES.speedup.icon);
  if (player.activeEffects.powerup) icons.push(ITEM_TYPES.powerup.icon);

  if (icons.length === 0) return;

  const totalWidth = icons.length * ACTIVE_ICON_SIZE + (icons.length - 1) * ACTIVE_ICON_GAP;
  let x = screenX - totalWidth / 2;

  for (const filename of icons) {
    const img = getItemImage(filename);

    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x, screenAboveY, ACTIVE_ICON_SIZE, ACTIVE_ICON_SIZE);
    }

    x += ACTIVE_ICON_SIZE + ACTIVE_ICON_GAP;
  }
}



// ---------------------------------------------------------------------------
// DRAWING — gold "shield dome" glow drawn around a character that has
// shield hitpoints. Call INSIDE the same translate() that centers the
// character at (0,0) — same coordinate space bot.js/game.js already use
// for their own body/health-bar drawing.
// ---------------------------------------------------------------------------
function drawShieldEffect(ctx, characterRadius, shieldAmount, maxShieldAmount) {

  if (!shieldAmount || shieldAmount <= 0) return;

  const domeRadius = characterRadius + 6;

  // Glow fades a bit as the shield gets chipped down, so it visibly
  // weakens instead of just vanishing at 0.
  const strength = Math.max(0, Math.min(1, shieldAmount / (maxShieldAmount || 1)));
  const alpha = 0.25 + 0.35 * strength;

  ctx.save();

  // Soft bright fill, like a glass/light dome wrapping the character
  const gradient = ctx.createRadialGradient(0, 0, characterRadius * 0.5, 0, 0, domeRadius);
  gradient.addColorStop(0, "rgba(255, 215, 0, 0)");
  gradient.addColorStop(0.7, `rgba(255, 215, 0, ${alpha * 0.5})`);
  gradient.addColorStop(1, `rgba(255, 235, 130, ${alpha})`);

  ctx.beginPath();
  ctx.arc(0, 0, domeRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Bright gold rim
  ctx.shadowColor = "rgba(255, 215, 0, 0.9)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(255, 223, 60, 0.95)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}



// ---------------------------------------------------------------------------
// DRAWING — gold shield hitpoint bar, same style/positioning approach as
// the health bar it's meant to sit next to (pass local coords, not
// world/screen coords, matching how the health bar is drawn in game.js).
// ---------------------------------------------------------------------------
function drawShieldBar(ctx, x, y, width, shieldAmount, maxShieldAmount) {

  if (!shieldAmount || shieldAmount <= 0) return;

  const height = 4;
  const percent = Math.max(0, Math.min(1, shieldAmount / (maxShieldAmount || 1)));

  ctx.fillStyle = "#443300";
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = "#ffd700";
  ctx.fillRect(x, y, width * percent, height);
}



// ---------------------------------------------------------------------------
// MISC
// ---------------------------------------------------------------------------
function getAllItemTypes() {
  return Object.keys(ITEM_TYPES);
}



if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    ITEM_TYPES,
    createItemDrop,
    createInventoryItemDrop,
    spawnItemsOnBotDeath,
    spawnGoldOrbOnBotDeath,
    updateItemDrops,
    runItemPickupCheck,
    pickUpWeaponDrop,
    pickUpInventoryDrop,
    pickUpUpgradeDrop,
    pickUpGoldOrb,
    applyItemEffect,
    updateActiveEffects,
    applyDamageToPlayer,
    resetPlayerItemState,
    drawItemDrops,
    drawActiveEffectIcons,
    drawShieldEffect,
    drawShieldBar,
    getAllItemTypes
  };

}


// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { ITEM_TYPES, spawnGoldOrbOnBotDeath, rollItemStats };
