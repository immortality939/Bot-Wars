import { WebSocketServer } from "ws";
import http from "http";
import { getWeapon } from "./weapon_online.js";


const PORT = process.env.PORT || 3000;

const server = http.createServer();

const wss = new WebSocketServer({
  server
});


const clients = new Map();

let nextId = 1;



wss.on("connection", (ws) => {


  const id = nextId++;


  const color =
    `hsl(${Math.random() * 360},70%,60%)`;


  clients.set(id, {

    id,

    x:350,
    y:350,

    color,

    health:100,

    shield:100,

    armor:10

  });



  ws.send(JSON.stringify({

    type:"init",

    id

  }));



  // send existing players

  for(const [pid,data] of clients){

    if(pid===id) continue;


    ws.send(JSON.stringify({

      type:"playerAdd",

      player:{...data}

    }));

  }



  broadcastExcept(ws,{

    type:"playerAdd",

    player:{...clients.get(id)}

  });





ws.on("message",(msg)=>{


try{


const data = JSON.parse(msg);



// PLAYER MOVEMENT

if(data.type==="move" && clients.has(id)){


const p = clients.get(id);


p.x=data.x;

p.y=data.y;


// shield stays server controlled

broadcastExcept(ws,{

type:"playerMove",

id,

x:p.x,

y:p.y,

shield:p.shield

});


}





// PLAYER SHOOTS

if(data.type==="bullet"){

const weapon = getWeapon(data.weapon);

if(!weapon){
  console.log("Unknown weapon:", data.weapon);
  return;
}

console.log("Weapon fired:", data.weapon);
console.log("Damage:", weapon.damage);


broadcast({

type:"bullet",

ownerId:id,

x:data.x,

y:data.y,

vx:data.vx,

vy:data.vy,

damage:weapon.damage,

hitEffect:weapon.hitEffect

});

}






// PLAYER HIT

if(data.type==="hit" && clients.has(data.targetId)){


const target = clients.get(data.targetId);


let damage = data.damage;


console.log("Incoming damage:", damage);
console.log("Shield before:", target.shield);
console.log("Armor:", target.armor);



// SHIELD FIRST

if(target.shield > 0){


target.shield -= damage;


if(target.shield < 0){


damage = Math.abs(target.shield);


target.shield = 0;


}
else{


damage = 0;


}

}




console.log("Damage after shield:", damage);



// ARMOR ONLY PROTECTS HEALTH

if(damage > 0){


damage -= target.armor;


if(damage < 1){

damage = 1;

}


target.health -= damage;


if(target.health < 0){

target.health = 0;

}


}



console.log("Final HP damage:", damage);
console.log("Health left:", target.health);
console.log("Shield left:", target.shield);



broadcast({

type:"playerHealth",

id:data.targetId,

health:target.health,

shield:target.shield

});





if(target.health <= 0){


broadcast({

type:"playerDied",

id:data.targetId

});



setTimeout(()=>{


if(clients.has(data.targetId)){


const p = clients.get(data.targetId);


p.health=100;

p.shield=100;

p.x=350;

p.y=350;



broadcast({

type:"playerHealth",

id:data.targetId,

health:100,

shield:100

});



broadcast({

type:"playerMove",

id:data.targetId,

x:350,

y:350,

shield:100

});


}


},1000);



}


}






// 2. ARMOR ONLY PROTECTS HEALTH


if(damage > 0){


damage -= target.armor;



if(damage < 1){

damage = 1;

}



target.health = Math.max(

0,

target.health - damage

);



}







broadcast({


type:"playerHealth",


id:data.targetId,


health:target.health,


shield:target.shield


});







// DEATH


if(target.health <= 0){



broadcast({

type:"playerDied",

id:data.targetId

});






setTimeout(()=>{


if(clients.has(data.targetId)){



const p = clients.get(data.targetId);



p.health=100;

p.shield=100;

p.x=350;

p.y=350;



broadcast({

type:"playerHealth",

id:data.targetId,

health:100,

shield:100

});




broadcast({

type:"playerMove",

id:data.targetId,

x:350,

y:350,

shield:100

});



}


},1000);



}



}





}catch(e){

console.error(e);

}


});






ws.on("close",()=>{


clients.delete(id);



broadcast({

type:"playerRemove",

id

});


});



});








function broadcast(msg){


const data = JSON.stringify(msg);


for(const client of wss.clients){


if(client.readyState===1)

client.send(data);


}


}





function broadcastExcept(exclude,msg){


const data = JSON.stringify(msg);


for(const client of wss.clients){


if(client===exclude) continue;


if(client.readyState===1)

client.send(data);


}


}






server.listen(PORT,()=>{


console.log(
"Server listening on port",
PORT
);


});
