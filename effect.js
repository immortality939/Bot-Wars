const HIT_EFFECTS = {

    "9mm": {
        image: "9mm.png",

        frameWidth: 300,
        frameHeight: 161,
        frames: 8,

        // EFFECT DISPLAY SIZE
        width: 30,
        height: 30,

        speed: 40,

        // HIT SOUND
        soundEffect: "22mm.mp3"
    }

};


const hitEffects = [];


function createHitEffect(x, y, effectName) {

    const effect = HIT_EFFECTS[effectName];

    if (!effect) return;


    // PLAY HIT SOUND
    if (effect.soundEffect) {

        const sound = new Audio(effect.soundEffect);
        sound.volume = 0.7;
        sound.play();

    }


    const img = new Image();
    img.src = effect.image;


    hitEffects.push({

        x:x,
        y:y,

        image:img,

        frame:0,

        frameWidth:effect.frameWidth,
        frameHeight:effect.frameHeight,

        frames:effect.frames,

        width:effect.width,
        height:effect.height,

        timer:0,

        speed:effect.speed

    });

}



function updateHitEffects(dt){

    for(let i = hitEffects.length-1;i>=0;i--){

        const e = hitEffects[i];

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




function drawHitEffects(ctx,offsetX,offsetY){

    for(const e of hitEffects){

        ctx.drawImage(

            e.image,

            e.frame * e.frameWidth,
            0,

            e.frameWidth,
            e.frameHeight,


            offsetX + e.x - e.width / 2,
            offsetY + e.y - e.height / 2,

            e.width,
            e.height

        );

    }

}