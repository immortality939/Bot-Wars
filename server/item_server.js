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
  },

  shield: {
    name: "shield",
    image: "image/shield.png",
    radius: 10,

    shieldHitpoints: 80,
    spawnChance: 1.45,    // 45%
  },

  speedup: {
    name: "speedup",
    image: "image/speedup.png",
    radius: 10,

    speedBonus: 30,      // flat add to movementSpeed (e.g. 100 -> 130)
    duration: 20000,     // ms (20 sec)
    spawnChance: 0.6,   // 60%

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

    icon: "image/powerup.png"
  },

  // GOLD ORB — unlike health/shield/speedup/powerup above, this doesn't
  // apply a stat effect to the player on pickup. Its `category: "gold"`
  // routes it to pickUpGoldOrb() instead of applyItemEffect() (see
  // createItemDrop()'s category line and checkItemPickup() below), which
  // adds the drop's own `amount` to the player's gold total (index.html's
  // addGold()) rather than putting anything in an inventory slot.
  //
  // No goldAmount here anymore — the amount now comes from whichever bot
  // dropped it (see spawnGoldOrbAmount on that bot's BOT_TYPES entry in
  // bot_server.js), carried through spawnItemsOnBotDeath() ->
  // createItemDrop() onto the drop itself, instead of being a single
  // fixed number for every gold orb regardless of source.
  goldOrb: {
    name: "goldOrb",
    image: "image/goldenorb.png",
    radius: 10,

    category: "gold",
    spawnChance: 0.75,   // 75% chance to drop when a bot that carries this item dies
  }

};



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
// OPTIONAL DESPAWN — set to a millisecond value (e.g. 30000 for 30 sec) if
// dropped items should disappear after a while. 0 = never despawn.
// ---------------------------------------------------------------------------
const ITEM_DESPAWN_TIME = 0;



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

function createItemDrop(typeName, x, y, amount) {

  const itemDef = ITEM_TYPES[typeName];
  const weaponDef = itemDef ? null : getLootableWeaponDef(typeName);
  // armor.js's own getLootableArmorDef() — see its header comment — is
  // the one used here, same as getLootableWeaponDef() above is for
  // WEAPONS.
  const armorDef = (itemDef || weaponDef) ? null : (typeof getLootableArmorDef === "function" ? getLootableArmorDef(typeName) : null);
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
    // itemDef.category lets a plain ITEM_TYPES entry opt into its own
    // pickup routing (e.g. goldOrb's "gold", handled separately in
    // checkItemPickup() below) instead of the generic "item" ->
    // applyItemEffect() path health/shield/speedup/powerup use.
    category: weaponDef ? "weapon" : (armorDef ? "armor" : (upgradeDef ? upgradeDef.category : ((itemDef && itemDef.category) || "item"))),

    // Only set for gold orbs (see the `amount` param) — carries the
    // spawning bot's spawnGoldOrbAmount through to pickUpGoldOrb() below,
    // since goldOrb no longer has a fixed goldAmount of its own.
    amount: amount,

    x: x,
    y: y,
    radius: def.radius || 10,

    image: getItemImage(imagePath),
    spawnTime: performance.now()
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

    image: getItemImage(imagePath),
    spawnTime: performance.now()
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
function spawnItemsOnBotDeath(spawnItemList, x, y, amount) {

  const drops = [];

  if (!spawnItemList) return drops;

  const typeNames = Array.isArray(spawnItemList)
    ? spawnItemList
    : String(spawnItemList).split(",").map(s => s.trim()).filter(Boolean);

  for (const typeName of typeNames) {

    const itemDef = ITEM_TYPES[typeName];
    const weaponDef = itemDef ? null : getLootableWeaponDef(typeName);
    const armorDef = (itemDef || weaponDef) ? null : (typeof getLootableArmorDef === "function" ? getLootableArmorDef(typeName) : null);
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

      drops.push(createItemDrop(typeName, dropX, dropY, amount));
    }
  }

  return drops;
}



// ---------------------------------------------------------------------------
// UPDATE — ages out drops if ITEM_DESPAWN_TIME is set. No-op otherwise.
// ---------------------------------------------------------------------------
function updateItemDrops(itemDrops, dt) {

  if (!ITEM_DESPAWN_TIME) return;

  const now = performance.now();

  for (let i = itemDrops.length - 1; i >= 0; i--) {
    if (now - itemDrops[i].spawnTime >= ITEM_DESPAWN_TIME) {
      itemDrops.splice(i, 1);
    }
  }
}



// ---------------------------------------------------------------------------
// PICKUP — call every frame with the live itemDrops array + the player.
// Removes any drop the player is touching. A regular pickup (health,
// shield, speedup, powerup) applies its effect immediately; a weapon
// drop instead goes into the storage grid inventory to be equipped
// later (see pickUpWeaponDrop below).
// ---------------------------------------------------------------------------
function checkItemPickup(itemDrops, player, playerPos) {

  for (let i = itemDrops.length - 1; i >= 0; i--) {

    const drop = itemDrops[i];

    const dx = playerPos.x - drop.x;
    const dy = playerPos.y - drop.y;
    const dist = Math.hypot(dx, dy);

    if (dist < playerPos.radius + drop.radius) {
      if (drop.category === "weapon") {
        pickUpWeaponDrop(drop.type);
      } else if (drop.category === "armor") {
        pickUpArmorDrop(drop.type);
      } else if (drop.category === "invItem") {
        pickUpInventoryDrop(drop);
      } else if (drop.category === "gold") {
        pickUpGoldOrb(drop.type, drop.amount);
      } else if (drop.category === "stone" || drop.category === "orb") {
        pickUpUpgradeDrop(drop.type, drop.category);
      } else {
        applyItemEffect(player, drop.type);
      }
      itemDrops.splice(i, 1);
    }
  }
}



// ---------------------------------------------------------------------------
// WEAPON PICKUP — hands a dropped weapon off to the storage grid
// inventory (addItemToInventory, defined in index.html) instead of
// applying an instant stat effect. Weapons are gear to equip later via
// the Inventory screen or the in-gameplay equip popup, not a consumable.
// No-op (weapon is simply lost) if the grid is already full —
// addItemToInventory shows its own "Inventory full" toast in that case.
// ---------------------------------------------------------------------------
function pickUpWeaponDrop(weaponName) {

  if (typeof getWeapon !== "function") return;

  const weaponData = getWeapon(weaponName);
  if (!weaponData) return;

  if (typeof addItemToInventory !== "function") return;

  const added = addItemToInventory(
    "weapon",
    weaponName,
    { ...weaponData, image: "image/" + weaponName + ".png" },
    1
  );

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + weaponName);
  }
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
function pickUpArmorDrop(armorName) {

  if (typeof getArmor !== "function") return;

  const armorData = getArmor(armorName);
  if (!armorData) return;

  if (typeof addItemToInventory !== "function") return;

  const added = addItemToInventory(
    "armor",
    armorName,
    { ...armorData, defense: armorData.physicalDefense },
    1
  );

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + armorName);
  }
}



// ---------------------------------------------------------------------------
// UPGRADE-ITEM PICKUP — hands a dropped stone/orb (from upgrade.js) off
// to the storage grid inventory, same idea as pickUpWeaponDrop() above.
// Stones/orbs are never equipped in the Weapon/Armor slots — just stored
// until used on a weapon/armor item by the upgrade system.
// ---------------------------------------------------------------------------
function pickUpUpgradeDrop(typeName, category) {

  if (typeof getUpgradeItem !== "function") return;

  const upgradeData = getUpgradeItem(typeName);
  if (!upgradeData) return;

  if (typeof addItemToInventory !== "function") return;

  const added = addItemToInventory(category, typeName, upgradeData, 1);

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + typeName);
  }
}



// ---------------------------------------------------------------------------
// GOLD ORB PICKUP — unlike every other pickup above, this never touches
// the storage grid inventory or a player stat. It just adds the drop's own
// `amount` straight to the player's gold total via index.html's
// addGold()/GOLD_KEY (the same running total shown in the Inventory
// screen's gold bar and the gameplay small-bag popup).
//
// `amount` comes from whichever bot dropped this orb (its
// spawnGoldOrbAmount in bot_server.js), carried onto the drop by
// createItemDrop() — goldOrb itself no longer has a fixed amount in
// ITEM_TYPES.
// ---------------------------------------------------------------------------
function pickUpGoldOrb(typeName, amount) {

  const def = ITEM_TYPES[typeName];
  if (!def) return;

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
  if (typeof addItemToInventory !== "function") return;

  const added = addItemToInventory(drop.invType, drop.name, drop.data, drop.qty || 1);

  if (added && typeof showHubToast === "function") {
    showHubToast("Picked up " + drop.name);
  }
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
        const physicalDefense = (player.physicalDefense || 0) + (player.armor || 0);
        const magicalDefense = player.magicalDefense || 0;
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
    const physicalDefense = (player.physicalDefense || 0) + (player.armor || 0);
    const magicalDefense = player.magicalDefense || 0;
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
    const imgSize = drop.radius * 2;

    ctx.save();
    ctx.translate(screenX, screenY);

    if (drop.image && drop.image.complete && drop.image.naturalWidth > 0) {
      ctx.drawImage(drop.image, -imgSize / 2, -imgSize / 2, imgSize, imgSize);
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
    updateItemDrops,
    checkItemPickup,
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
if (typeof module !== "undefined") module.exports = { ITEM_TYPES };
