const HIT_EFFECTS = {

    "vacuum": {
        image: "image/vacuum.png",

        frameWidth: 600,
        frameHeight: 200,
        frames: 13,

        // EFFECT DISPLAY SIZE — radius resizes the animation (drawn at
        // radius*2 x radius*2, see createHitEffect() below). Overrides
        // width/height when set; width/height are still the fallback
        // for any effect that doesn't set a radius.
        radius: 80,
        width: 30,
        height: 30,

        speed: 40,

        // HIT SOUND
        soundEffect: "music/vacuum.mp3"
    },
    
    // HEAL — played by fireSkill2() (game.js, skill.js's "heal1" skill) at
    // the player's position, with followTarget set so it tracks the
    // player instead of staying pinned to one spot. It plays its 13
    // frames once (~520ms) and vanishes, same as "9mm".
    "heal1": {
        image: "image/heal1.png",

        frameWidth: 192,
        frameHeight: 192,
        frames: 13,

        // EFFECT DISPLAY SIZE — see "9mm" above for how radius resizes this.
        radius: 30,
        width: 60,
        height: 60,

        speed: 40,

        // HIT SOUND
        soundEffect: "music/heal1.mp3"
    },
        "basicattack": {
        image: "image/basicattack.png",

        frameWidth: 64,
        frameHeight: 47,
        frames: 9,

        // EFFECT DISPLAY SIZE — see "9mm" above for how radius resizes this.
        radius: 25,
        width: 60,
        height: 60,

        speed: 40,

        // HIT SOUND
        soundEffect: "music/basicattack.mp3"
    },


    "slash1": {
        image: "image/slash1.png",

        frameWidth: 200,
        frameHeight: 200,
        frames: 20,

        // EFFECT DISPLAY SIZE — see "9mm" above for how radius resizes this.
        // Bump this if the slash should visually cover more of skill.js's
        // slash1.radius (150) AoE — 30 (60px across) is quite small next
        // to that hit range.
        radius: 150,
        width: 60,
        height: 60,

        speed: 30,

        // HIT SOUND
        soundEffect: "music/slash1.mp3"
    },
    // ORB ELEMENTAL EFFECTS — played via createHitEffect() when an orb's
    // effect triggers on a bot (see applyOrbEffect() in bot.js, which
    // looks these up by the orbEffect name set on each orb in upgrade.js).
    // Adjust frameWidth/frameHeight/frames below to match the real
    // sprite sheets once those images are in place.
    electric: {
        image: "image/electricelement.png",

        frameWidth: 265,
        frameHeight: 265,
        frames: 69,

        radius: 20,
        width: 40,
        height: 40,

        speed: 120
    },

    fire: {
        image: "image/fireelement.png",

        frameWidth: 265,
        frameHeight: 260,
        frames: 47,

        radius: 20,
        width: 40,
        height: 40,

        speed: 120
    },

    ice: {
        image: "image/iceelement.png",

        frameWidth: 204,
        frameHeight: 216,
        frames: 58,

        radius: 20,
        width: 40,
        height: 40,

        speed: 120
    },

    // UNIT EXPLODE — played by damageBot() (bot.js) at a bot's position the
    // moment it dies, via createHitEffect(bot.x, bot.y, bot.unitExplode).
    // Plays once and vanishes, same as "9mm".
    unitexplode: {
        image: "image/unitexplode.png",

        frameWidth: 130,
        frameHeight: 130,
        frames: 20,

        // EFFECT DISPLAY SIZE — see "9mm" above for how radius resizes this.
        radius: 40,
        width: 80,
        height: 80,

        speed: 60
    }

};


const hitEffects = [];


// IMAGE CACHE — same pattern as botImageCache (bot.js) / itemImageCache
// (item.js) / getProjectileImage (game.js): reuse one Image object per
// sprite file instead of creating (and re-decoding) a brand new one on
// every single hit. createHitEffect() below used to do `new Image()`
// on every call — meaning every bullet impact, every skill use, every
// bot death was allocating and decoding its sprite sheet from scratch,
// which adds up fast with rapid-fire weapons or an AoE skill hitting
// several bots at once. This was one of the bigger, easy-to-miss lag
// sources in the game.
const _effectImageCache = {};

function _getEffectImage(path) {
    if (!_effectImageCache[path]) {
        const img = new Image();
        img.src = path;
        _effectImageCache[path] = img;
    }
    return _effectImageCache[path];
}


// sizeOverride (optional) — { width, height, anchorAtStart, flipX,
// travelSpeed } in world pixels. width/height stretch this ONE instance
// of the effect to a specific size instead of using the effect's own
// fixed radius/width/height from HIT_EFFECTS above (e.g. skill.js's
// "vacuum" barrage stretches the "vacuum" effect to exactly match its
// own range/width fields, which can change, instead of the sprite
// always being a fixed square). anchorAtStart:true draws the sprite
// growing forward from (x,y) instead of centered on it — pass the
// PLAYER's own position as x,y with this set so a directional effect
// visibly starts at the player and reaches forward toward its target.
// flipX:true mirrors the sprite artwork left-right in place (no
// repositioning) — use this if a sprite's own baked-in animation/motion
// reads as flowing the wrong way once anchored/rotated (see
// drawHitEffects()'s flipX comment). travelSpeed (world pixels/second,
// requires anchorAtStart) makes the effect actually GROW from 0 up to
// its full `width` at that speed instead of appearing at full length
// instantly — since it's anchored at (x,y), the far edge visibly
// travels outward while the near edge stays pinned at the caster. Omit
// travelSpeed and the effect still appears at full width immediately,
// same as before. Omit sizeOverride entirely and every effect draws
// exactly as before (fixed size, centered on x,y, unflipped, instant).
function createHitEffect(x, y, effectName, followTarget, angle, sizeOverride) {

    const effect = HIT_EFFECTS[effectName];

    if (!effect) return null;


    // PLAY HIT SOUND — distance-based: a bullet impact far from the
    // local player sounds quieter and more muffled than one right next
    // to you. Falls back to flat playback if playerPos/playPositionalSound
    // aren't available yet (e.g. called before game.js has loaded).
    if (effect.soundEffect) {

        if (typeof playPositionalSound === "function" && typeof playerPos !== "undefined") {
            playPositionalSound(effect.soundEffect, x - playerPos.x, y - playerPos.y, { baseVolume: 0.7 });
        } else {
            const sound = new Audio(effect.soundEffect);
            sound.volume = 0.7;
            sound.play();
        }

    }


    const img = _getEffectImage(effect.image);

    // RADIUS — resizes the animation to radius*2 x radius*2 (see each
    // effect's "EFFECT DISPLAY SIZE" comment above). Falls back to the
    // effect's explicit width/height for any effect that doesn't set a
    // radius, so this stays backward-compatible.
    const size = effect.radius != null ? effect.radius * 2 : null;

    const instance = {

        x:x,
        y:y,

        image:img,

        frame:0,

        frameWidth:effect.frameWidth,
        frameHeight:effect.frameHeight,

        frames:effect.frames,

        // COLUMNS — how many frames sit in one row of the sprite sheet.
        // Optional manual override (set `columns` on the HIT_EFFECTS
        // entry) for sheets drawHitEffects() can't measure yet (image
        // not decoded). If not set, drawHitEffects() figures this out
        // itself from the actual loaded image width, so both a single
        // long horizontal strip AND a multi-row grid sheet work without
        // needing to hardcode the layout here.
        columns: effect.columns || null,

        width: (sizeOverride && typeof sizeOverride.travelSpeed === "number") ? 0
            : (sizeOverride && typeof sizeOverride.width === "number") ? sizeOverride.width
            : (size != null ? size : effect.width),
        height: (sizeOverride && typeof sizeOverride.height === "number") ? sizeOverride.height : (size != null ? size : effect.height),

        // TARGET WIDTH / TRAVEL SPEED — see sizeOverride comment above.
        // targetWidth is the full width this effect grows toward;
        // travelSpeed (world px/second) is how fast `width` climbs
        // toward it each frame (see updateHitEffects() below). null
        // travelSpeed means no growth at all — width is already the
        // final value set above, same as before this feature existed.
        targetWidth: (sizeOverride && typeof sizeOverride.width === "number") ? sizeOverride.width : (size != null ? size : effect.width),
        travelSpeed: (sizeOverride && typeof sizeOverride.travelSpeed === "number") ? sizeOverride.travelSpeed : null,

        timer:0,

        speed:effect.speed,

        // Optional — any object with live x/y (e.g. a bot). When set,
        // the effect's position is synced to it every frame instead of
        // staying pinned to wherever it was when the effect started, so
        // it follows a moving bot instead of getting left behind.
        followTarget: followTarget || null,

        // ANGLE (radians) — which way the sprite should face, e.g. the
        // attacker's strike direction. Sprite art is drawn as if facing
        // right (angle 0) by default; drawHitEffects() rotates around
        // the effect's center to match. null/undefined = no rotation
        // (used by effects that aren't directional, like bullet impacts
        // or AoE swings centered on the player).
        angle: (typeof angle === "number") ? angle : null,

        // ANCHOR AT START — see sizeOverride comment above. false (the
        // normal case) centers the sprite on (x,y); true draws it
        // starting AT (x,y) and extending forward along `angle` instead,
        // so a beam-style effect visibly originates at its caster.
        anchorAtStart: !!(sizeOverride && sizeOverride.anchorAtStart),

        // FLIP X — see sizeOverride comment above. Mirrors the sprite's
        // own artwork left-right in place, for a sprite whose baked-in
        // animation reads as flowing backward once pointed at a target.
        flipX: !!(sizeOverride && sizeOverride.flipX)

    };

    hitEffects.push(instance);

    return instance;

}



function updateHitEffects(dt){

    for(let i = hitEffects.length-1;i>=0;i--){

        const e = hitEffects[i];

        if(e.followTarget){
            e.x = e.followTarget.x;
            e.y = e.followTarget.y;
        }

        // TRAVEL — grows `width` from 0 up to targetWidth at travelSpeed
        // world px/second (see createHitEffect()'s sizeOverride comment).
        // Only effects created with a travelSpeed do this; everything
        // else keeps its fixed width exactly as before.
        if (e.travelSpeed != null && e.width < e.targetWidth) {
            e.width = Math.min(e.targetWidth, e.width + e.travelSpeed * dt);
        }

        e.timer += dt*1000;


        if(e.timer >= e.speed){

            e.timer=0;
            e.frame++;


            if(e.frame >= e.frames){

                hitEffects.splice(i,1);
                continue;

            }

        }

    }

}




// ---------------------------------------------------------------------------
// WEAPON UPGRADE AURA — a colored glow drawn around a character whose
// equipped weapon.upgradeLevel (see upgrade.js/index.html) is high enough
// to show a visible tier. Purely canvas-drawn (no sprite assets needed),
// so it scales to any character radius and works for the player or any
// bot. Levels 1-3 show nothing; the glow appears at +4 and gets
// progressively richer up to the max tier at +9.
// ---------------------------------------------------------------------------
const UPGRADE_AURA_TIERS = {
  4: "200, 230, 255", // very light blue
  5: "150, 210, 255", // light blue
  6: "196, 132, 84",  // copper
  7: "220, 40, 40",   // red
  8: "255, 215, 0"    // gold
  // 9 is handled separately below — dark gold ring w/ light gold ring
  // circling around it + orbiting red dots
};

// Cheap "glow" helper — fakes a shadowBlur halo around a stroked/filled
// shape by drawing a handful of progressively wider, fainter strokes
// underneath the real one instead of asking the canvas to blur anything.
// No shadowBlur cost at all, and this is called once per bot per frame
// (see bot.js/game.js), so this matters a lot more than a one-off effect.
function drawGlowRing(ctx, radius, color, baseAlpha, baseWidth) {
  const passes = 3;
  for (let i = passes; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${color}, ${(baseAlpha * (i / passes) * 0.35).toFixed(3)})`;
    ctx.lineWidth = baseWidth + i * 2.5;
    ctx.stroke();
  }
  // Crisp core stroke on top so the ring still reads clearly, not just fuzz.
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${color}, ${baseAlpha})`;
  ctx.lineWidth = baseWidth;
  ctx.stroke();
}

function drawGlowDot(ctx, x, y, radius, color, baseAlpha) {
  const passes = 3;
  for (let i = passes; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(x, y, radius + i * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color}, ${(baseAlpha * (i / passes) * 0.3).toFixed(3)})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${color}, ${baseAlpha})`;
  ctx.fill();
}

function drawWeaponUpgradeAura(ctx, characterRadius, upgradeLevel) {

  if (!upgradeLevel || upgradeLevel < 4) return;

  const auraRadius = characterRadius + 8;
  const now = performance.now();

  ctx.save();

  if (upgradeLevel < 9) {

    const color = UPGRADE_AURA_TIERS[upgradeLevel] || UPGRADE_AURA_TIERS[8];
    // Strength scales a little with level so +6/+7/+8 read as visibly
    // richer than +4/+5.
    const strength = 0.35 + (upgradeLevel - 4) * 0.08;

    const gradient = ctx.createRadialGradient(0, 0, characterRadius * 0.6, 0, 0, auraRadius);
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(0.7, `rgba(${color}, ${strength * 0.5})`);
    gradient.addColorStop(1, `rgba(${color}, ${strength})`);

    ctx.beginPath();
    ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    drawGlowRing(ctx, auraRadius, color, 0.9, 2);

  } else {

    // +9 — max tier. A dark-gold ring hugging the character, with a
    // light-gold ring circling just outside it, plus 4 red dots orbiting
    // further out. A gentle pulse keeps it feeling alive without needing
    // a single spot to rotate around the circle.
    const pulse = 0.85 + Math.sin(now / 600) * 0.15; // ~0.7–1.0

    const innerRingRadius = auraRadius - 3; // dark gold, closest to character
    const outerRingRadius = auraRadius + 5; // light gold, circling around it

    // Soft glow filling the space between the character and the outer ring,
    // darker gold near the character fading into lighter gold outward.
    const glow = ctx.createRadialGradient(0, 0, characterRadius * 0.6, 0, 0, outerRingRadius);
    glow.addColorStop(0, "rgba(184, 134, 11, 0)");
    glow.addColorStop(0.55, "rgba(139, 105, 20, 0.45)");
    glow.addColorStop(1, "rgba(255, 236, 179, 0.35)");

    ctx.beginPath();
    ctx.arc(0, 0, outerRingRadius, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Dark-gold ring — the inner band hugging the character
    drawGlowRing(ctx, innerRingRadius, "139, 105, 20", 0.9 * pulse, 3);

    // Light-gold ring — circles around the dark-gold ring
    drawGlowRing(ctx, outerRingRadius, "255, 236, 179", 0.85 * pulse, 2);

    // 4 red dots circling around the character, outside both gold rings
    const dotOrbitRadius = outerRingRadius + 6;
    const dotSpin = now / 700;

    for (let i = 0; i < 4; i++) {
      const angle = dotSpin + (Math.PI / 2) * i;
      const dx = Math.cos(angle) * dotOrbitRadius;
      const dy = Math.sin(angle) * dotOrbitRadius;

      drawGlowDot(ctx, dx, dy, 3, "255, 40, 40", 0.95);
    }
  }

  ctx.restore();
}



function drawHitEffects(ctx,offsetX,offsetY){

    for(const e of hitEffects){

        // COLUMNS — use the manual override if the effect set one;
        // otherwise figure it out from the actual decoded image width.
        // A plain single-row strip naturally comes out to `frames`
        // columns (naturalWidth / frameWidth == frames); a multi-row
        // grid sheet comes out to however many frames actually fit
        // across one row, and the math below wraps into the next row
        // once `frame` passes that. Falls back to `frames` (assume one
        // row) for the handful of frames before the image finishes
        // decoding, same as the old always-one-row behavior.
        const columns = e.columns
            || (e.image.naturalWidth
                ? Math.max(1, Math.round(e.image.naturalWidth / e.frameWidth))
                : e.frames);

        const col = e.frame % columns;
        const row = Math.floor(e.frame / columns);

        if (e.angle != null) {
            // DIRECTIONAL — rotate around the effect's own center so it
            // visually faces e.angle instead of always drawing as if
            // facing right (see createHitEffect()'s `angle` param).
            ctx.save();
            ctx.translate(offsetX + e.x, offsetY + e.y);
            ctx.rotate(e.angle);

            // ANCHOR AT START (e.g. skill.js's vacuum beam) — draw
            // starting at the effect's own (x,y) and extending forward
            // along +x (which the rotate above has already pointed at
            // the target), instead of centering the sprite on (x,y).
            const destX = e.anchorAtStart ? 0 : -e.width / 2;
            const destY = -e.height / 2;

            if (e.flipX) {
                // FLIP — mirrors the sprite's own artwork left-right
                // WITHOUT moving where it's drawn (see createHitEffect()'s
                // flipX comment): some sprite sheets are authored with
                // their motion baked in right-to-left (e.g. a suction/
                // vacuum swirl), which reads as flowing toward the
                // caster no matter where the rectangle itself sits. This
                // flips just the pixels so the baked-in motion reads
                // left-to-right instead, matching a beam fired outward.
                ctx.translate(destX + e.width / 2, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(
                    e.image,
                    col * e.frameWidth, row * e.frameHeight,
                    e.frameWidth, e.frameHeight,
                    -e.width / 2, destY,
                    e.width, e.height
                );
            } else {
                ctx.drawImage(
                    e.image,
                    col * e.frameWidth, row * e.frameHeight,
                    e.frameWidth, e.frameHeight,
                    destX, destY,
                    e.width, e.height
                );
            }

            ctx.restore();
        } else {

            ctx.drawImage(

                e.image,

                col * e.frameWidth,
                row * e.frameHeight,

                e.frameWidth,
                e.frameHeight,


                offsetX + e.x - e.width / 2,
                offsetY + e.y - e.height / 2,

                e.width,
                e.height

            );

        }

    }

}

// ---------------------------------------------------------------------------
// HEALTH BAR ART — image-based health bars for the player and enemy bots.
// Loaded here (rather than in game.js/bot.js) because both files need it
// and effect.js loads before either of them (see index.html script order).
//
//   healthborder.png / healthborder1.png — the bar's outline, drawn last,
//     stretched over the whole bar rect so it frames it.
//   healthhud.png / healthhud1.png — the filled (current-health) portion,
//     green for the player, blue for enemy bots. Stretched to hpPercent
//     of the bar's width.
//   healthempty.png — shared "missing health" backdrop, drawn first under
//     everything so it shows through wherever the fill doesn't reach.
//
// "1"-suffixed variants are the enemy bot palette (bot.js); the
// unsuffixed ones are the player's own bar and other players' bars
// (game.js).
// ---------------------------------------------------------------------------
const healthBorderImage = new Image();
healthBorderImage.src = "image/healthborder.png";

const healthHudImage = new Image();
healthHudImage.src = "image/healthhud.png";

const healthEmptyImage = new Image();
healthEmptyImage.src = "image/healthempty.png";

const healthBorderImage1 = new Image();
healthBorderImage1.src = "image/healthborder1.png";

const healthHudImage1 = new Image();
healthHudImage1.src = "image/healthhud1.png";

// Draws one image-based health bar at (x, y) sized (w, h). pct is current
// health as a 0..1 fraction. Falls back to a plain filled rect for any
// image that hasn't loaded yet, so the bar still works before assets
// finish loading (or if a file is missing).
function drawImageHealthBar(ctx, x, y, w, h, pct, borderImg, hudImg, emptyImg) {
  const clampedPct = Math.max(0, Math.min(1, pct));

  // Backdrop — the "missing health" look, shown across the full bar so
  // it's visible behind whatever the fill doesn't cover.
  if (emptyImg && emptyImg.complete && emptyImg.naturalWidth > 0) {
    ctx.drawImage(emptyImg, x, y, w, h);
  } else {
    ctx.fillStyle = "#300";
    ctx.fillRect(x, y, w, h);
  }

  // Fill — current health, stretched to pct of the bar's width.
  const fillW = w * clampedPct;
  if (fillW > 0) {
    if (hudImg && hudImg.complete && hudImg.naturalWidth > 0) {
      ctx.drawImage(hudImg, x, y, fillW, h);
    } else {
      ctx.fillStyle = "#00ff55";
      ctx.fillRect(x, y, fillW, h);
    }
  }

  // Border — drawn last, on top, framing the whole bar.
  if (borderImg && borderImg.complete && borderImg.naturalWidth > 0) {
    ctx.drawImage(borderImg, x, y, w, h);
  }
}
