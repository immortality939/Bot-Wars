// ---------------------------------------------------------------------------
// DAMAGE NUMBERS — floating "-123" style popups shown whenever the player
// hits a bot or a bot/enemy hits the player. Same pattern as effect.js's
// HIT_EFFECTS: one shared sprite sheet (number1.png), one entry per digit
// describing its frame inside that sheet, an instance array, and
// create/update/draw functions called from game.js's update loop and
// render pass.
//
// UNLIKE HIT_EFFECTS, there's no animation strip to step through — each
// digit is a single static glyph — so a damage number instance is just a
// short-lived, rising, fading row of glyph frames instead of a frame
// counter.
// ---------------------------------------------------------------------------

// NUMBER SHEET — number1.png: a 5-column x 2-row grid of 102x165 cells
// (510x330 total). Layout per the actual image: top row is 1,2,3,4,5;
// bottom row is 6,7,8,9,0 (zero sits last, not first).
const NUMBER_SHEET = {
    image: "image/number1.png",

    frameWidth: 102,
    frameHeight: 165
};

// FRAME LOOKUP — name -> top-left xy inside number1.png (see NUMBER_SHEET
// above for the shared frameWidth/frameHeight every glyph uses).
const NUMBER_FRAMES = {
    one:   { x: 0,   y: 0   },
    two:   { x: 102, y: 0   },
    three: { x: 204, y: 0   },
    four:  { x: 306, y: 0   },
    five:  { x: 408, y: 0   },
    six:   { x: 0,   y: 165 },
    seven: { x: 102, y: 165 },
    eight: { x: 204, y: 165 },
    nine:  { x: 306, y: 165 },
    zero:  { x: 408, y: 165 }
};

// Digit character ("0"-"9") -> NUMBER_FRAMES key, so a damage amount like
// 123 can be turned into ["one", "two", "three"] and drawn glyph by glyph.
const NUMBER_DIGIT_NAMES = [
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine"
];


const damageNumbers = [];


// IMAGE CACHE — reuses effect.js's _getEffectImage() (same file-loads-once
// pattern as botImageCache/itemImageCache/hitEffects' own cache) instead
// of standing up a second cache just for this one sheet. number.js loads
// after effect.js in index.html so this is always defined by the time a
// damage number actually needs to draw.
function _getNumberImage() {
    if (typeof _getEffectImage === "function") {
        return _getEffectImage(NUMBER_SHEET.image);
    }
    // Fallback if effect.js hasn't loaded for some reason — still works,
    // just without the shared cache.
    const img = new Image();
    img.src = NUMBER_SHEET.image;
    return img;
}


// ---------------------------------------------------------------------------
// CREATE — call this any place damage actually lands, e.g.:
//   createDamageNumber(bot.x, bot.y - bot.radius, amount, { isCritical })
//   createDamageNumber(playerPos.x, playerPos.y - playerPos.radius, dmg)
//
// amount     - the number to show (rounded, floored at 0 for display).
// options:
//   isCritical - draws the glyphs bigger with a red glow, same idea as
//                weapon.js/skill.js's own crit multiplier.
//   lifetime   - how long (ms) the popup rises + fades before it's
//                removed. Defaults to 800ms.
// ---------------------------------------------------------------------------
function createDamageNumber(x, y, amount, options) {
    options = options || {};

    const value = Math.max(0, Math.round(amount));
    const digits = String(value).split("").map(function (ch) {
        return NUMBER_DIGIT_NAMES[Number(ch)];
    });

    // DISPLAY SIZE — digitSize is the rendered HEIGHT of each glyph;
    // width is derived from it below (drawDamageNumbers()) using
    // NUMBER_SHEET's actual frame aspect ratio (102x165, not square
    // like the old number.png's 200x200 cells), so a digit renders at
    // its correct proportions instead of being squashed/stretched into
    // a square. Critical hits are drawn noticeably bigger so they read
    // as a bigger deal, same intent as effect.js's radius-based EFFECT
    // DISPLAY SIZE comments.
    const digitSize = options.isCritical ? 24 : 17;

    const instance = {
        digits: digits,

        image: _getNumberImage(),

        // Small random horizontal jitter so several hits landing on the
        // same target in quick succession don't perfectly overlap.
        x: x + (Math.random() * 16 - 8),
        y: y,

        digitSize: digitSize,

        // RISE + FADE — time-based instead of frame-based (there's no
        // animation strip here, just one static glyph per digit), same
        // spirit as updateHitEffects()'s timer/speed pattern.
        age: 0,
        lifetime: options.lifetime || 800,
        riseSpeed: 0.04, // px per ms

        isCritical: !!options.isCritical
    };

    damageNumbers.push(instance);

    return instance;
}


function updateDamageNumbers(dt) {
    for (let i = damageNumbers.length - 1; i >= 0; i--) {

        const n = damageNumbers[i];
        n.age += dt * 1000;

        if (n.age >= n.lifetime) {
            damageNumbers.splice(i, 1);
        }
    }
}


function drawDamageNumbers(ctx, offsetX, offsetY) {
    // Each glyph's source cell is 102x165 (NUMBER_SHEET, number1.png) --
    // a tall rectangle, not a square like the old number.png's 200x200
    // cells were. digitSize is the desired rendered HEIGHT; digitWidth
    // is derived from it via the sheet's own width/height ratio so a
    // digit keeps its real proportions instead of being squashed wide.
    const digitAspect = NUMBER_SHEET.frameWidth / NUMBER_SHEET.frameHeight;

    for (const n of damageNumbers) {

        const progress = n.age / n.lifetime; // 0 -> 1 over its lifetime
        const riseY = n.y - n.age * n.riseSpeed;
        const alpha = 1 - progress; // linear fade out

        const digitWidth = n.digitSize * digitAspect;
        const totalWidth = n.digits.length * digitWidth;
        let drawX = offsetX + n.x - totalWidth / 2;
        const drawY = offsetY + riseY - n.digitSize / 2;

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);

        if (n.isCritical) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
}

        for (const digitName of n.digits) {

            const frame = NUMBER_FRAMES[digitName];
            if (!frame) continue;

            ctx.drawImage(

                n.image,

                frame.x, frame.y,
                NUMBER_SHEET.frameWidth, NUMBER_SHEET.frameHeight,

                drawX, drawY,
                digitWidth, n.digitSize

            );

            drawX += digitWidth;
        }

        ctx.restore();
    }
}
