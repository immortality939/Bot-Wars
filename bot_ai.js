// =============================================================================
// bot_ai.js — SERVER-RUN ENEMIES (online mode)
// =============================================================================
// Before: one player's phone per room ("the host") ran the enemy AI and told the
// server what happened, so a modified game could fake enemy damage, deaths and
// loot. Now: THIS file runs the enemies on the server (Render). Nobody hosts.
//
// Every number (health, speed, damage, view range, respawn, drops...) is still
// read from server/bot_server.js, so you keep editing enemies there.
// This file is NOT in the server/ folder on purpose: everything in server/ is
// sent to every player's game when they join, this file stays on Render only.
//
// What it does (same rules as bot.js's updateSingleBot):
//   patrol -> look around -> see a player (view range, view angle, line of
//   sight) -> chase -> melee attack (attackSpeed, crit, weapon damage) ->
//   lose the player -> search -> patrol.  Hit by a player: it turns and chases.
//   Dies at 0 health, drops loot / gold orb, respawns after def.respawn seconds.
//
// Bot skills (botSkill in bot_server.js, e.g. "slash1,barrage,cannonblast,deadlystrike")
// are included: the enemy tries its skills first (in list order, when off cooldown)
// and falls back to its normal melee attack, same as bot.js tryBotUseSkill().
// =============================================================================
"use strict";

const TURN_SPEED = Math.PI * 1.5;       // rad/s, same as bot.js rotateToward()
const VISION_CHECK_MS = 120;            // same as bot.js
const PLAYER_RADIUS = 14;               // what bot.js uses for other players

const degToRad = (d) => (d * Math.PI) / 180;
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function rotateToward(cur, target, dt) {
  const diff = angleDiff(cur, target);
  const step = TURN_SPEED * dt;
  if (Math.abs(diff) <= step) return target;
  return cur + Math.sign(diff) * step;
}
function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function lineHitsRect(x1, y1, x2, y2, r) {
  const l = r.x, rt = r.x + r.width, t = r.y, b = r.y + r.height;
  return segmentsIntersect(x1, y1, x2, y2, l, t, rt, t) ||
         segmentsIntersect(x1, y1, x2, y2, rt, t, rt, b) ||
         segmentsIntersect(x1, y1, x2, y2, rt, b, l, b) ||
         segmentsIntersect(x1, y1, x2, y2, l, b, l, t);
}
function hasLineOfSight(x1, y1, x2, y2, obstacles) {
  for (const o of obstacles) if (lineHitsRect(x1, y1, x2, y2, o)) return false;
  return true;
}
function insideAnyObstacle(x, y, obstacles, pad) {
  for (const o of obstacles) {
    if (x >= o.x - pad && x <= o.x + o.width + pad && y >= o.y - pad && y <= o.y + o.height + pad) return true;
  }
  return false;
}

function createBotEngine(D, MAPS, OBSTACLE_TYPES) {
  const BOT_TYPES = D.BOT_TYPES || {};
  const WEAPONS = D.WEAPONS || {};
  const ARMOR_TYPES = D.ARMOR_TYPES || {};
  const ITEM_TYPES = D.ITEM_TYPES || {};
  const MELEE = (D.ATTACK_MODES && D.ATTACK_MODES.melee) || { meleeRange: 33 };
  const SKILLS = D.SKILLS || {};
  const SKILL_LOCK_MS = typeof D.SKILL_LOCK_MS === "number" ? D.SKILL_LOCK_MS : 700;
  const healthForLevel = typeof D.getHealthForLevel === "function"
    ? D.getHealthForLevel
    : (base) => base;

  // armor.js getArmorStats(): a number is a plain defense value, a string is an armor name
  function armorStats(field) {
    if (typeof field === "number") return { armorValue: field, health: 0, bonuses: {} };
    const def = ARMOR_TYPES[field];
    if (!def) return { armorValue: 0, health: 0, bonuses: {} };
    const bonuses = {};
    for (const f of ["physicalDamage", "magicalAttack", "magicalDefense", "criticalChance",
      "criticalDamage", "mana", "movementSpeed", "hpRegen", "manaRegen"]) {
      if (typeof def[f] === "number") bonuses[f] = def[f];
    }
    return { armorValue: def.physicalDefense || 0, health: def.health || 0, bonuses };
  }

  // skill_server.js does not export its damage formula, so this is a copy of
  // getSkillEffectiveStats()/getSkillDamageResult() for an enemy as the "player".
  function skillDamage(sk, b) {
    const wpn = (b.weapon && b.weapon.physicalDamage) || 0;
    let phys = 0, mag = 0;
    if (typeof sk.physicalDamage === "number") phys = sk.physicalDamage + b.physicalDamage + wpn;
    if (typeof sk.physicalPercent === "number") phys = (b.physicalDamage + wpn) * sk.physicalPercent;
    if (typeof sk.magicalAttack === "number") mag = sk.magicalAttack + b.magicalAttack;
    if (typeof sk.magicalPercent === "number") mag = b.magicalAttack * sk.magicalPercent;
    const chance = (sk.criticalChance || 0) + (b.critChance || 0);
    const cdmg = (sk.criticalDamage || 0) + (b.critDamage || 0);
    const roll = (v) => { const c = Math.random() < chance; return { v: c ? v * (1 + cdmg) : v, c }; };
    const ph = roll(phys), mg = roll(mag);
    return { physicalDamage: ph.v, magicalDamage: mg.v, isCritical: ph.c || mg.c };
  }

  function makeBot(index, typeName, x, y) {
    const def = BOT_TYPES[typeName];
    if (!def) return null;
    const weapon = WEAPONS[def.weaponName];
    if (!weapon) return null;
    const as = armorStats(def.physicalDefense);
    const bon = as.bonuses;
    const maxH = healthForLevel(def.health, def.level || 1) + as.health;
    return {
      i: index, t: typeName,
      x, y, sx: x, sy: y,
      radius: def.radius || 12,
      alive: true, h: maxH, mh: maxH, respawnAt: 0,
      respawnMs: (typeof def.respawn === "number" ? def.respawn : 10) * 1000,
      active: def.active === true,
      aggroed: false, aggroLost: 0,
      aggroForget: (typeof def.aggroForgetTime === "number" ? def.aggroForgetTime : 3) * 1000,
      speed: def.movementSpeed + (bon.movementSpeed || 0),
      viewRange: def.viewRange, viewAngle: def.viewAngle || 80,
      patrolInterval: def.patrolInterval, patrolRadius: def.patrolRadius, lookDuration: def.lookDuration,
      hpRegen: (def.hpRegen || 0) + (bon.hpRegen || 0),
      attackMs: (typeof def.attackSpeed === "number" ? def.attackSpeed : 1) * 1000,
      weaponDamage: weapon.physicalDamage || 0,
      physicalDamage: (typeof def.physicalDamage === "number" ? def.physicalDamage : 0) + (bon.physicalDamage || 0),
      magicalAttack: (typeof def.magicalAttack === "number" ? def.magicalAttack : 0) + (bon.magicalAttack || 0),
      critChance: (def.criticalChance || 0) + (bon.criticalChance || 0),
      critDamage: (def.criticalDamage || 0) + (bon.criticalDamage || 0),
      lastAttack: 0,
      botSkills: String(def.botSkill || "").split(",").map((n) => n.trim()).filter((n) => n && SKILLS[n]),
      skillCd: {}, skillLockUntil: 0, volley: null,
      weapon: { physicalDamage: weapon.physicalDamage || 0 },
      state: "patrol", stateT: 0,
      patrolTx: x, patrolTy: y,
      fa: Math.random() * Math.PI * 2,
      lookBase: 0, lookTarget: Math.random() * Math.PI * 2, lookSide: 1,
      lastKnown: null,
      visionT: 0, visionId: undefined, canSee: false,
      moving: false
    };
  }

  function resetBot(b) {
    b.x = b.sx; b.y = b.sy;
    b.h = b.mh; b.alive = true;
    b.aggroed = false; b.aggroLost = 0;
    b.lastAttack = 0; b.skillCd = {}; b.skillLockUntil = 0; b.volley = null;
    b.state = "patrol"; b.stateT = 0;
    b.patrolTx = b.sx; b.patrolTy = b.sy;
    b.fa = Math.random() * Math.PI * 2;
    b.lookBase = 0; b.lookTarget = Math.random() * Math.PI * 2; b.lookSide = 1;
    b.lastKnown = null; b.visionT = 0; b.visionId = undefined; b.canSee = false;
    b.moving = false;
  }

  // Builds the enemy list for a map. Fixed spots (map.bots / map.botSpawns) first,
  // then map.enemyBots entries ({name, quantity}) at random clear spots.
  function spawnList(map) {
    const out = [];
    const W = map.worldWidth || 2000, H = map.worldHeight || 2000;
    const obstacles = map.obstacles || [];
    const add = (name, x, y) => {
      const b = makeBot(out.length, name, x, y);
      if (b) out.push(b); else console.warn("bot_ai: skipped enemy (unknown type or weapon):", name);
    };
    for (const e of (map.enemyBots || [])) {
      for (let n = 0; n < (e.quantity || 0); n++) {
        let x = W / 2, y = H / 2;
        for (let k = 0; k < 60; k++) {
          const px = 30 + Math.random() * (W - 60), py = 30 + Math.random() * (H - 60);
          if (!insideAnyObstacle(px, py, obstacles, 30)) { x = px; y = py; break; }
        }
        add(e.name, x, y);
      }
    }
    for (const s of (map.botSpawns || [])) add(s.name, s.x, s.y);
    for (const s of (map.bots || [])) add(s.name, s.x, s.y);
    return out;
  }

  // ---- obstacle / body collisions (copied from bot.js) ----------------------
  function solveObstacles(b, obstacles) {
    for (const o of obstacles) {
      const type = OBSTACLE_TYPES[o.name];
      let cx, cy;
      if (type && type.collision === "circle") {
        const ox = o.x + o.width / 2, oy = o.y + o.height / 2;
        const r = Math.min(o.width, o.height) / 2;
        const d = Math.hypot(b.x - ox, b.y - oy) || 1;
        cx = ox + ((b.x - ox) / d) * r; cy = oy + ((b.y - oy) / d) * r;
      } else {
        cx = Math.max(o.x, Math.min(b.x, o.x + o.width));
        cy = Math.max(o.y, Math.min(b.y, o.y + o.height));
      }
      const dx = b.x - cx, dy = b.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < b.radius) {
        const overlap = b.radius - dist;
        b.x += (dist > 0 ? dx / dist : 1) * overlap;
        b.y += (dist > 0 ? dy / dist : 0) * overlap;
      }
    }
  }
  function pushApart(b, ox, oy, oradius, ratio, other) {
    const dx = b.x - ox, dy = b.y - oy;
    const dist = Math.hypot(dx, dy);
    const minDist = b.radius + oradius;
    if (dist > 0 && dist < minDist) {
      const nx = dx / dist, ny = dy / dist, overlap = minDist - dist;
      b.x += nx * overlap * ratio; b.y += ny * overlap * ratio;
      if (other) { other.x -= nx * overlap * (1 - ratio); other.y -= ny * overlap * (1 - ratio); }
    } else if (dist === 0) {
      b.x += 0.5;
    }
  }

  function moveToward(b, tx, ty, dt) {
    const dx = tx - b.x, dy = ty - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    b.x += (dx / dist) * b.speed * dt;
    b.y += (dy / dist) * b.speed * dt;
  }
  function startLook(b) {
    b.state = "look"; b.stateT = 0;
    b.lookBase = b.fa; b.lookSide = 1; b.lookTarget = b.lookBase - degToRad(50);
  }
  function pickPatrol(b, W, H) {
    b.patrolTx = Math.max(b.radius, Math.min(W - b.radius, b.x + (Math.random() * 2 - 1) * b.patrolRadius));
    b.patrolTy = Math.max(b.radius, Math.min(H - b.radius, b.y + (Math.random() * 2 - 1) * b.patrolRadius));
  }

  // One room's enemies.
  function createRoomSim(mapKey) {
    const map = MAPS[mapKey];
    if (!map) return null;
    const sim = {
      mapKey,
      W: map.worldWidth || 2000, H: map.worldHeight || 2000,
      obstacles: map.obstacles || [],
      bots: spawnList(map),
      last: Date.now()
    };

    // Call when a player arrives after the room sat empty (so dt doesn't jump).
    sim.touch = (now) => { sim.last = now; };

    // players: array of { id, x, y, alive, protectUntil }
    // returns { fx: [ready-to-broadcast "fx"/"sound" messages], hits: [{targetId, physicalDamage, magicalDamage, isCritical, srcX, srcY}] }
    sim.step = (now, players) => {
      const dt = Math.min(0.25, Math.max(0, (now - sim.last) / 1000));
      sim.last = now;
      const hits = [];
      const fx = [];   // visual/sound messages everyone in the room should get (swings, skill effects)
      const alivePlayers = players.filter((p) => p.alive);

      // One skill shot/hit: show the effect to everyone, then damage the locked target if it is inside the shape.
      const fireSkillShot = (b, sk, dirX, dirY, targetId, isRepeat) => {
        const range = sk.range || 0, halfW = (sk.width || 80) / 2;
        const angle = Math.atan2(dirY, dirX);
        const isMelee = sk.activationType === "melee";
        if (sk.skillSound && !isRepeat) fx.push({ type: "sound", sound: sk.skillSound, x: b.x, y: b.y });
        if (sk.hitEffect) {
          if (isMelee) fx.push({ type: "fx", from: 0, x: b.x, y: b.y, effect: sk.hitEffect, angle: 0 });
          else if (sk.attackType === "beam") fx.push({ type: "fx", from: 0, x: b.x, y: b.y, effect: sk.hitEffect, angle,
            size: { width: range, height: halfW * 2, anchorAtStart: true, flipX: true, travelSpeed: sk.travelSpeed || 900 } });
          else fx.push({ type: "fx", from: 0, x: b.x, y: b.y, effect: sk.hitEffect, angle,
            size: { width: range, height: halfW * 2, anchorAtStart: true } });
        }
        const t = alivePlayers.find((p) => p.id === targetId);
        if (!t) return;
        let inside;
        if (isMelee) inside = Math.hypot(t.x - b.x, t.y - b.y) <= (sk.radius || 0) + b.radius + PLAYER_RADIUS;
        else {
          const rx = t.x - b.x, ry = t.y - b.y;
          const along = rx * dirX + ry * dirY;
          inside = along >= 0 && along <= range && Math.abs(rx * -dirY + ry * dirX) <= halfW + PLAYER_RADIUS;
        }
        if (!inside || (t.protectUntil && now < t.protectUntil)) return;
        const r = skillDamage(sk, b);
        hits.push({
          targetId: t.id,
          physicalDamage: Math.max(0, Math.round(r.physicalDamage || 0)),
          magicalDamage: Math.max(0, Math.round(r.magicalDamage || 0)),
          isCritical: !!r.isCritical, srcX: t.x, srcY: t.y
        });
      };
      // First skill that is off cooldown (list order = priority). Returns true if one was fired.
      const tryUseSkill = (b, dx, dy, dist, targetId) => {
        if (!b.botSkills.length || now < b.skillLockUntil) return false;
        for (const name of b.botSkills) {
          const sk = SKILLS[name];
          if (now - (b.skillCd[name] || -1e15) < (typeof sk.cooldown === "number" ? sk.cooldown : 5000)) continue;
          b.skillCd[name] = now; b.lastAttack = now; b.skillLockUntil = now + SKILL_LOCK_MS;
          const len = dist || 1, dirX = dx / len, dirY = dy / len;
          fireSkillShot(b, sk, dirX, dirY, targetId, false);
          const shots = Math.floor(sk.shotTimes || sk.hitNum || 1);
          if (shots > 1) b.volley = { sk, dirX, dirY, targetId, remaining: shots - 1,
            intervalMs: (sk.shotInterval != null ? sk.shotInterval : (sk.hitInterval || 0)) * 1000, timer: 0 };
          return true;
        }
        return false;
      };

      for (const b of sim.bots) {
        if (!b.alive) {
          if (now >= b.respawnAt) resetBot(b);
          continue;
        }
        if (b.h < b.mh && b.hpRegen > 0) b.h = Math.min(b.mh, b.h + b.mh * b.hpRegen * dt);

        // keep dripping out the rest of a multi-hit skill (slash1's 2 hits, deadlystrike's 5 shots)
        if (b.volley) {
          const v = b.volley;
          v.timer += dt * 1000;
          if (v.timer >= v.intervalMs) {
            v.timer = 0; v.remaining--;
            fireSkillShot(b, v.sk, v.dirX, v.dirY, v.targetId, true);
            if (v.remaining <= 0) b.volley = null;
          }
        }

        // --- vision: nearest visible player in range / cone / line of sight
        b.visionT += dt * 1000;
        if (b.visionT >= VISION_CHECK_MS || b.visionId === undefined) {
          b.visionT = 0;
          let best = null, bestDist = Infinity;
          for (const p of alivePlayers) {
            const dx = p.x - b.x, dy = p.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > b.viewRange || dist >= bestDist) continue;
            if (Math.abs(angleDiff(b.fa, Math.atan2(dy, dx))) > degToRad(b.viewAngle / 2)) continue;
            if (!hasLineOfSight(b.x, b.y, p.x, p.y, sim.obstacles)) continue;
            best = p; bestDist = dist;
          }
          b.visionId = best ? best.id : null;
          b.canSee = !!best;
        }
        const target = b.canSee ? alivePlayers.find((p) => p.id === b.visionId) : null;
        if (b.canSee && !target) { b.canSee = false; b.visionId = null; }
        const dxp = target ? target.x - b.x : 0, dyp = target ? target.y - b.y : 0;
        const distp = target ? Math.hypot(dxp, dyp) : Infinity;

        if (b.aggroed && !b.active) {
          if (target) b.aggroLost = 0;
          else {
            b.aggroLost += dt * 1000;
            if (b.aggroLost >= b.aggroForget) { b.aggroed = false; b.aggroLost = 0; b.lastKnown = null; }
          }
        }
        const hostile = b.active || b.aggroed;
        b.moving = false;
        const reach = b.radius + (MELEE.meleeRange || 0) + PLAYER_RADIUS;

        if (hostile && target) {
          b.lastKnown = { x: target.x, y: target.y };
          b.state = distp <= reach ? "attack" : "chase";
        } else if (hostile && b.lastKnown) {
          b.state = "search";
        } else if (b.state !== "look") {
          b.state = "patrol";
        }

        switch (b.state) {
          case "attack": {
            b.fa = Math.atan2(dyp, dxp);
            if (target && tryUseSkill(b, dxp, dyp, distp, target.id)) break;   // skill first, like bot.js
            if (target && distp <= reach && now - b.lastAttack >= b.attackMs) {
              b.lastAttack = now;
              const roll = (base) => {
                const crit = Math.random() < b.critChance;
                return { v: crit ? base * (1 + b.critDamage) : base, crit };
              };
              const ph = roll(b.weaponDamage + b.physicalDamage);
              const mg = roll(b.magicalAttack);
              const reachOut = b.radius + (MELEE.meleeRange || 10);
              fx.push({
                type: "fx", from: 0,
                x: b.x + Math.cos(b.fa) * reachOut,
                y: b.y + Math.sin(b.fa) * reachOut,
                angle: b.fa,
                effect: MELEE.hitEffect || "basicattack"
              });
              if (!(target.protectUntil && now < target.protectUntil)) {
                hits.push({
                  targetId: target.id,
                  physicalDamage: Math.max(0, Math.round(ph.v)),
                  magicalDamage: Math.max(0, Math.round(mg.v)),
                  isCritical: ph.crit || mg.crit,
                  srcX: b.x + Math.cos(b.fa) * reachOut,
                  srcY: b.y + Math.sin(b.fa) * reachOut
                });
              }
            }
            break;
          }
          case "chase":
            b.fa = Math.atan2(dyp, dxp);
            moveToward(b, target.x, target.y, dt);
            b.moving = true;
            break;
          case "search": {
            const dx = b.lastKnown.x - b.x, dy = b.lastKnown.y - b.y;
            if (Math.hypot(dx, dy) < 10) { b.lastKnown = null; startLook(b); }
            else { b.fa = Math.atan2(dy, dx); moveToward(b, b.lastKnown.x, b.lastKnown.y, dt); b.moving = true; }
            break;
          }
          case "look":
            b.stateT += dt * 1000;
            b.fa = rotateToward(b.fa, b.lookTarget, dt);
            if (Math.abs(angleDiff(b.fa, b.lookTarget)) < 0.05) {
              b.lookSide = -b.lookSide;
              b.lookTarget = b.lookBase + b.lookSide * degToRad(50);
            }
            if (b.stateT >= b.lookDuration) { b.state = "patrol"; b.stateT = 0; pickPatrol(b, sim.W, sim.H); }
            break;
          default: {   // patrol
            b.stateT += dt * 1000;
            const dx = b.patrolTx - b.x, dy = b.patrolTy - b.y;
            if (Math.hypot(dx, dy) < 5 || b.stateT >= b.patrolInterval) startLook(b);
            else { b.fa = Math.atan2(dy, dx); moveToward(b, b.patrolTx, b.patrolTy, dt); b.moving = true; }
          }
        }

        b.x = Math.max(b.radius, Math.min(sim.W - b.radius, b.x));
        b.y = Math.max(b.radius, Math.min(sim.H - b.radius, b.y));
        solveObstacles(b, sim.obstacles);
        for (const p of alivePlayers) pushApart(b, p.x, p.y, PLAYER_RADIUS, 1);
        for (const o of sim.bots) if (o !== b && o.alive) pushApart(b, o.x, o.y, o.radius, 0.5, o);
      }
      return { hits, fx };
    };

    // A player's attack landed on enemy `idx`. Returns { killed, drops } or null.
    sim.hitBot = (idx, amount, srcX, srcY, now) => {
      const b = sim.bots[idx];
      if (!b || !b.alive) return null;
      b.h -= Math.max(0, amount);
      if (b.h > 0) {
        // botGotHit(): the enemy turns on whoever hit it
        b.aggroed = true; b.aggroLost = 0;
        b.lastKnown = { x: srcX, y: srcY };
        b.state = "chase"; b.stateT = 0;
        b.fa = Math.atan2(srcY - b.y, srcX - b.x);
        return { killed: false, drops: [] };
      }
      b.h = 0; b.alive = false; b.respawnAt = now + b.respawnMs; b.moving = false; b.volley = null;
      return { killed: true, drops: sim.rollDrops(b) };
    };

    // Same rules as item_server.js spawnItemsOnBotDeath() / spawnGoldOrbOnBotDeath()
    sim.rollDrops = (b) => {
      const def = BOT_TYPES[b.t] || {};
      const out = [];
      const names = Array.isArray(def.spawnItem) ? def.spawnItem
        : String(def.spawnItem || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const d = ITEM_TYPES[name] || (WEAPONS[name] && WEAPONS[name].category === "weapon" ? WEAPONS[name] : null) ||
          (ARMOR_TYPES[name] && ["armor", "ring", "accessory"].includes(ARMOR_TYPES[name].category) ? ARMOR_TYPES[name] : null) ||
          (D.STONE_TYPES || {})[name] || (D.ORB_TYPES || {})[name] || null;
        if (!d) continue;
        if (Math.random() < (d.spawnChance || 0)) {
          const a = Math.random() * Math.PI * 2, sc = out.length * 14;
          out.push({ t: name, x: b.x + Math.cos(a) * sc, y: b.y + Math.sin(a) * sc });
        }
      }
      const chance = def.spawnGoldOrbChance || 0;
      if (chance && Math.random() < chance) {
        const a = Math.random() * Math.PI * 2, sc = 30 + Math.random() * 15;
        out.push({ t: "goldOrb", x: b.x + Math.cos(a) * sc, y: b.y + Math.sin(a) * sc, amt: def.goldOrbAmount || 0 });
      }
      return out;
    };

    // Same shape the host used to stream ("bots" message list).
    sim.snapshot = (now) => sim.bots.map((b) => ({
      i: b.i, t: b.t,
      x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
      h: Math.max(0, Math.round(b.h)), mh: Math.round(b.mh),
      a: b.alive,
      fa: Math.round(b.fa * 100) / 100,
      mv: !!b.moving,
      sx: Math.round(b.sx * 10) / 10, sy: Math.round(b.sy * 10) / 10,
      rm: b.alive ? 0 : Math.max(0, Math.round(b.respawnAt - now))
    }));

    return sim;
  }

  return { createRoomSim };
}

module.exports = { createBotEngine };
