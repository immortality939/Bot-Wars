// =============================================================================
// save_guard.js — SERVER-SIDE CHECKS FOR ONLINE ACCOUNT SAVES
// =============================================================================
// The client used to write the player's gold / items / level straight into the
// Supabase player_data table, so a modified client could write anything. Now the
// only thing allowed to write that table is server.js (service key), and every
// save passes through review() below first.
//
// What it does NOT do: it does not run the whole game on the server. Gold is
// still counted by the player's client; this module only makes sure the number
// that reaches the database is one the server can explain:
//
//   GOLD    new gold <= saved gold + gold the SERVER saw this player pick up
//           (gold orbs, party splits, trades) + a small refilling "slack" that
//           covers things the server can't see (e.g. a server restart that lost
//           the pickups since the last save). Anything above is cut off and the
//           client is told the corrected amount.
//   ITEMS   the count of items can only grow by what the server saw picked up /
//           traded, by what the gold spent could have bought in the shop, by
//           the free starter gear, or by a small refilling slack. Extra items
//           are removed. Unknown item names, bad quantities and oversized item
//           data are removed / clamped.
//   LEVEL   a character's level can't jump faster than a refilling slack
//           allows and can't pass MAX_LEVEL. A jump that is too fast is
//           reverted to the last saved progress of that character.
//   SHAPE   only known fields are stored, with size limits on everything.
//
// Numbers live in LIMITS below — tune them without touching server.js.
// =============================================================================
"use strict";

const LIMITS = {
  MAX_SAVE_BYTES: 200 * 1024,       // whole game_data JSON
  MAX_GOLD: 2000000000,
  GOLD_SLACK_MAX: 500,              // gold the server may "not be able to explain" at once...
  GOLD_SLACK_PER_SEC: 1,            // ...refilling this fast
  ITEM_SLACK_MAX: 4,                // items that may appear without a server-seen cause...
  ITEM_SLACK_PER_SEC: 1 / 60,       // ...refilling this fast
  ITEM_CREDIT_CAP: 300,             // most unspent pickup credit kept per account
  GOLD_CREDIT_CAP: 5000000,
  LEVEL_SLACK_MAX: 5,               // levels that may be gained at once...
  LEVEL_SLACK_PER_SEC: 1 / 30,      // ...refilling this fast
  GRID_MAX: 64,                     // inventory grid size (INVENTORY_GRID_SIZE in index.html)
  ENTRY_DATA_MAX_BYTES: 2000,       // one item's "data" blob
  MAX_QTY: 9999,
  MAX_CHARACTERS: 12,
  MAX_FRIENDS_BYTES: 20 * 1024,
  MAX_SAVES_PER_MINUTE: 60
};

const ITEM_TYPES_OK = ["armor", "weapon", "stone", "orb", "materials", "magazine", "accessory", "ring"];
const STACKABLE = ["stone", "orb", "materials"];
const EQUIP_SLOTS = ["weapon", "armor", "magazine", "accessory", "ring1", "ring2", "accessory2", "gear", "relic"];
const SAFE_NAME = /^[A-Za-z0-9_ .+\-]{1,40}$/;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clampInt = (v, lo, hi, fb) => {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fb;
  return Math.max(lo, Math.min(hi, n));
};
const jsonSize = (v) => { try { return JSON.stringify(v).length; } catch (e) { return Infinity; } };
const clone = (v) => JSON.parse(JSON.stringify(v));

function createSaveGuard(GAME_DATA) {
  const D = GAME_DATA || {};
  const MAX_LEVEL = (typeof D.gameRule === "function" && Number(D.gameRule("MAX_LEVEL"))) || 40;
  const CHARS = D.CHARACTERS || {};

  // names that are real items in the online game data
  const knownNames = new Set([
    ...Object.keys(D.WEAPONS || {}), ...Object.keys(D.ARMOR_TYPES || {}),
    ...Object.keys(D.STONE_TYPES || {}), ...Object.keys(D.ORB_TYPES || {})
  ]);
  // starter gear every character begins with: always free to appear
  const starterNames = new Set();
  for (const k of Object.keys(CHARS)) {
    const c = CHARS[k] || {};
    if (c.weaponName) starterNames.add(String(c.weaponName));
    if (c.armor) starterNames.add(String(c.armor));
  }
  // shop price per item name (what a purchase costs)
  const shopPrice = new Map();
  for (const list of [D.SHOP_WEAPONS, D.SHOP_ARMORS, D.SHOP_STONES, D.SHOP_ACCESSORIES]) {
    for (const e of (Array.isArray(list) ? list : [])) if (e && e.name && e.price > 0) shopPrice.set(String(e.name), Number(e.price));
  }
  const MAX_ORB = Math.max(1, ...Object.values(D.BOT_TYPES || {}).map((b) => Number(b && b.goldOrbAmount) || 0));

  // ---- per-account running state (memory only; a restart just resets it) ----
  const accts = new Map();
  function acct(uid, now) {
    let a = accts.get(uid);
    if (!a) {
      a = { goldCredit: 0, itemCredit: 0,
        goldSlack: LIMITS.GOLD_SLACK_MAX, itemSlack: LIMITS.ITEM_SLACK_MAX, levelSlack: LIMITS.LEVEL_SLACK_MAX,
        slackAt: now, saveTimes: [] };
      accts.set(uid, a);
    }
    return a;
  }
  function refill(a, now) {
    const dt = Math.max(0, (now - a.slackAt) / 1000);
    a.slackAt = now;
    a.goldSlack = Math.min(LIMITS.GOLD_SLACK_MAX, a.goldSlack + dt * LIMITS.GOLD_SLACK_PER_SEC);
    a.itemSlack = Math.min(LIMITS.ITEM_SLACK_MAX, a.itemSlack + dt * LIMITS.ITEM_SLACK_PER_SEC);
    a.levelSlack = Math.min(LIMITS.LEVEL_SLACK_MAX, a.levelSlack + dt * LIMITS.LEVEL_SLACK_PER_SEC);
  }

  // ---- credits: called by server.js when IT sees something happen ----------
  function creditGold(uid, n, now = Date.now()) {
    if (!uid) return;
    const a = acct(uid, now);
    a.goldCredit = Math.min(LIMITS.GOLD_CREDIT_CAP, a.goldCredit + Math.max(0, Math.round(Number(n) || 0)));
  }
  function creditItems(uid, n, now = Date.now()) {
    if (!uid) return;
    const a = acct(uid, now);
    a.itemCredit = Math.min(LIMITS.ITEM_CREDIT_CAP, a.itemCredit + Math.max(0, Math.round(Number(n) || 0)));
  }
  function clampOrbAmount(n) { return Math.max(0, Math.min(MAX_ORB, Math.trunc(Number(n) || 0))); }

  // ---- rate limit on how often one account may save ---------------------------
  function allowSaveRate(uid, now = Date.now()) {
    const a = acct(uid, now);
    a.saveTimes = a.saveTimes.filter((t) => now - t < 60000);
    if (a.saveTimes.length >= LIMITS.MAX_SAVES_PER_MINUTE) return false;
    a.saveTimes.push(now);
    return true;
  }

  // ---- item entry cleaning ---------------------------------------------------
  function cleanEntry(e, allowed, notes) {
    if (e === null || e === undefined) return null;
    if (!isObj(e)) { notes.push("dropped non-object item"); return null; }
    // starter gear is built client-side with `kind` instead of `type` — accept both
    const type = String(e.type || e.kind || "");
    const name = String(e.name || "");
    if (!ITEM_TYPES_OK.includes(type) || !SAFE_NAME.test(name)) { notes.push("dropped bad item " + name.slice(0, 20)); return null; }
    const mustBeKnown = type === "weapon" || type === "armor" || type === "stone" || type === "orb";
    if (mustBeKnown && !allowed.has(name)) { notes.push("dropped unknown item " + name); return null; }
    const out = { type, name, data: null, qty: 1 };
    if (STACKABLE.includes(type)) out.qty = clampInt(e.qty, 1, LIMITS.MAX_QTY, 1);
    if (e.data !== null && e.data !== undefined) {
      if (jsonSize(e.data) <= LIMITS.ENTRY_DATA_MAX_BYTES) out.data = clone(e.data);
      else notes.push("cleared oversized data on " + name);
    }
    return out;
  }

  function cleanInventory(prof, allowed, notes) {
    const grid = Array.isArray(prof.invGrid) ? prof.invGrid.slice(0, LIMITS.GRID_MAX) : [];
    const cleanGrid = grid.map((e) => cleanEntry(e, allowed, notes));
    while (cleanGrid.length < grid.length) cleanGrid.push(null);
    let equip = null;
    if (isObj(prof.invEquip)) {
      equip = {};
      for (const slot of EQUIP_SLOTS) equip[slot] = cleanEntry(prof.invEquip[slot], allowed, notes);
    }
    return { grid: cleanGrid, equip };
  }

  function countItems(grid, equip) {
    const m = new Map();
    const add = (e) => { if (e) { const k = e.type + "|" + e.name; m.set(k, (m.get(k) || 0) + (e.qty || 1)); } };
    for (const e of grid) add(e);
    if (equip) for (const s of EQUIP_SLOTS) add(equip[s]);
    return m;
  }

  // take `n` units of key away from the newest places first (grid back-to-front, then equip)
  function removeUnits(grid, equip, key, n) {
    const [type, name] = key.split("|");
    for (let i = grid.length - 1; i >= 0 && n > 0; i--) {
      const e = grid[i];
      if (!e || e.type !== type || e.name !== name) continue;
      const take = Math.min(n, e.qty || 1);
      if ((e.qty || 1) - take <= 0) grid[i] = null; else e.qty -= take;
      n -= take;
    }
    if (equip) for (const s of EQUIP_SLOTS) {
      const e = equip[s];
      if (n > 0 && e && e.type === type && e.name === name) {
        const take = Math.min(n, e.qty || 1);
        if ((e.qty || 1) - take <= 0) equip[s] = null; else e.qty -= take;
        n -= take;
      }
    }
  }

  // ---- the review ------------------------------------------------------------
  // storedGD: the game_data row currently in the database (or null)
  // incoming: the game_data the client wants to store
  // returns { ok:false, error } or { ok:true, gameData, goldFixed, notes, commit }
  //   goldFixed: set only when the gold was cut down (tell the client)
  //   commit():  call once the database write succeeded
  function review(uid, storedGD, incoming, now = Date.now()) {
    const notes = [];
    if (!isObj(incoming)) return { ok: false, error: "BAD_SAVE" };
    if (jsonSize(incoming) > LIMITS.MAX_SAVE_BYTES) return { ok: false, error: "SAVE_TOO_BIG" };
    const savedAt = Number(incoming.savedAt);
    if (!isFinite(savedAt) || savedAt <= 0) return { ok: false, error: "BAD_SAVE" };

    const a = acct(uid, now);
    refill(a, now);
    const oldProf = (storedGD && isObj(storedGD.onlineProfile)) ? storedGD.onlineProfile : null;

    // top level: only known fields
    const gd = { savedAt };
    if (Number.isFinite(Number(incoming.base))) gd.base = Number(incoming.base);
    if ("onlineCharacter" in incoming) gd.onlineCharacter = (typeof incoming.onlineCharacter === "string" && incoming.onlineCharacter.length <= 40) ? incoming.onlineCharacter : null;
    if ("onlinePlayerName" in incoming) gd.onlinePlayerName = (typeof incoming.onlinePlayerName === "string") ? incoming.onlinePlayerName.replace(/[\r\n\t]+/g, " ").trim().slice(0, 16) || null : null;

    let goldFixed = null;
    let slackGoldUsed = 0, slackItemsUsed = 0, slackLevelUsed = 0;
    const goldCreditSeen = a.goldCredit, itemCreditSeen = a.itemCredit;

    if (isObj(incoming.onlineProfile)) {
      const ip = incoming.onlineProfile;
      const prof = {};
      prof.selectedCharacterName = (typeof ip.selectedCharacterName === "string" && ip.selectedCharacterName.length <= 40) ? ip.selectedCharacterName : null;

      // ---------- characters / levels ----------
      const cpIn = isObj(ip.characterProgress) ? ip.characterProgress : {};
      const cpOld = (oldProf && isObj(oldProf.characterProgress)) ? oldProf.characterProgress : {};
      const cp = {};
      for (const name of Object.keys(cpIn).slice(0, LIMITS.MAX_CHARACTERS)) {
        const src = cpIn[name];
        if (!isObj(src) || !(CHARS[name] || cpOld[name]) || !SAFE_NAME.test(name)) { notes.push("dropped character " + name.slice(0, 20)); continue; }
        const c = clone(src);
        c.level = clampInt(src.level, 1, MAX_LEVEL, 1);
        c.exp = Math.max(0, Number(src.exp) || 0);
        for (const f of ["statPoints", "spentVit", "spentDex", "spentInt", "spentPow"]) if (f in c) c[f] = clampInt(src[f], 0, 100000, 0);
        if (jsonSize(c) > 4000) { notes.push("dropped oversized character " + name.slice(0, 20)); continue; }
        const oldLevel = cpOld[name] && Number(cpOld[name].level) ? clampInt(cpOld[name].level, 1, MAX_LEVEL, 1) : 1;
        const gain = c.level - oldLevel;
        if (gain > 0) {
          if (gain <= a.levelSlack + 1e-9) {
            slackLevelUsed += gain; a.levelSlack -= gain;   // (undone below if the save is not committed)
          } else if (cpOld[name]) {
            notes.push("level jump on " + name + " reverted");
            cp[name] = clone(cpOld[name]);
            continue;
          } else {
            notes.push("level jump on new character " + name + " reduced to 1");
            c.level = 1; c.exp = 0;
          }
        }
        cp[name] = c;
      }
      prof.characterProgress = cp;

      // ---------- items ----------
      const allowed = new Set(knownNames);
      if (oldProf) {
        for (const e of (Array.isArray(oldProf.invGrid) ? oldProf.invGrid : [])) if (e && e.name) allowed.add(String(e.name));
        if (isObj(oldProf.invEquip)) for (const s of EQUIP_SLOTS) { const e = oldProf.invEquip[s]; if (e && e.name) allowed.add(String(e.name)); }
      }
      const inv = cleanInventory(ip, allowed, notes);
      const oldInv = oldProf ? cleanInventory(oldProf, new Set([...allowed]), []) : { grid: [], equip: null };
      const before = countItems(oldInv.grid, oldInv.equip);
      const after = countItems(inv.grid, inv.equip);

      // ---------- gold ----------
      const oldGold = oldProf ? clampInt(oldProf.gold, 0, LIMITS.MAX_GOLD, 0) : 0;
      let newGold = clampInt(ip.gold, 0, LIMITS.MAX_GOLD, 0);
      const ceiling = oldGold + goldCreditSeen;
      if (newGold > ceiling) {
        const excess = newGold - ceiling;
        const useSlack = Math.min(excess, Math.floor(a.goldSlack));
        slackGoldUsed = useSlack;
        const fixed = ceiling + useSlack;
        if (fixed < newGold) { notes.push("gold cut from " + newGold + " to " + fixed); goldFixed = fixed; newGold = fixed; }
      }
      prof.gold = newGold;

      // ---------- item gains ----------
      let spent = Math.max(0, ceiling - newGold);                 // gold the player spent since the last save
      let creditLeft = itemCreditSeen;
      let slackLeft = Math.floor(a.itemSlack);
      for (const [key, n] of after) {
        let gain = n - (before.get(key) || 0);
        if (gain <= 0) continue;
        const name = key.split("|")[1];
        if (starterNames.has(name)) continue;                     // free starter gear
        const price = shopPrice.get(name);
        if (price) {                                              // bought in the shop?
          const buys = Math.min(gain, Math.floor(spent / price));
          spent -= buys * price; gain -= buys;
        }
        if (gain > 0) { const useC = Math.min(gain, creditLeft); creditLeft -= useC; gain -= useC; }
        if (gain > 0) { const useS = Math.min(gain, slackLeft); slackLeft -= useS; slackItemsUsed += useS; gain -= useS; }
        if (gain > 0) { notes.push("removed " + gain + " x " + name + " (not explained)"); removeUnits(inv.grid, inv.equip, key, gain); }
      }
      prof.invGrid = inv.grid;
      if (inv.equip) prof.invEquip = inv.equip; else prof.invEquip = null;

      // ---------- the rest ----------
      prof.skillEquip = Array.isArray(ip.skillEquip)
        ? ip.skillEquip.slice(0, 24).map((s) => (typeof s === "string" && s.length <= 40) ? s : null) : [];
      prof.friendsList = (Array.isArray(ip.friendsList) && jsonSize(ip.friendsList) <= LIMITS.MAX_FRIENDS_BYTES) ? clone(ip.friendsList) : [];
      if (isObj(ip.lastPosition) && isFinite(Number(ip.lastPosition.x)) && isFinite(Number(ip.lastPosition.y))) {
        prof.lastPosition = { character: String(ip.lastPosition.character || "").slice(0, 40), map: String(ip.lastPosition.map || "").slice(0, 40),
          x: Math.round(Number(ip.lastPosition.x)), y: Math.round(Number(ip.lastPosition.y)) };
      }
      gd.onlineProfile = prof;
    }

    // slack is only really spent if the save is committed: put it back now, take it in commit()
    a.levelSlack += slackLevelUsed;

    return {
      ok: true, gameData: gd, goldFixed, notes,
      commit() {
        const b = acct(uid, Date.now());
        b.goldCredit = Math.max(0, b.goldCredit - goldCreditSeen);
        b.itemCredit = Math.max(0, b.itemCredit - itemCreditSeen);
        b.goldSlack = Math.max(0, b.goldSlack - slackGoldUsed);
        b.itemSlack = Math.max(0, b.itemSlack - slackItemsUsed);
        b.levelSlack = Math.max(0, b.levelSlack - slackLevelUsed);
      }
    };
  }

  return { review, creditGold, creditItems, clampOrbAmount, allowSaveRate, LIMITS, MAX_ORB };
}

module.exports = { createSaveGuard, LIMITS };
