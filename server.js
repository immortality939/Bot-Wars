import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Map(); // id -> { id, x, y, color, health }
let nextId = 1;

wss.on("connection", (ws) => {
  const id = nextId++;
  const color = `hsl(${Math.random() * 360}, 70%, 60%)`;

  clients.set(id, {
    id,
    x: 350,
    y: 350,
    color,
    health: 100
  });

  // Send own id to client
  ws.send(JSON.stringify({ type: "init", id }));

  // Send existing players to new client
  for (const [pid, data] of clients) {
    if (pid === id) continue;
    ws.send(JSON.stringify({
      type: "playerAdd",
      player: { ...data }
    }));
  }

  // Tell others about new player
  const newData = clients.get(id);
  broadcastExcept(ws, {
    type: "playerAdd",
    player: { ...newData }
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // Handle player movement
      if (data.type === "move" && clients.has(id)) {
        const p = clients.get(id);
        p.x = data.x;
        p.y = data.y;

        broadcastExcept(ws, {
  type: "playerMove",
  id,
  x: p.x,
  y: p.y,
  health: p.health
});
      }

      // Handle bullet fired by a player
      if (data.type === "bullet") {
        broadcast({
  type: "bullet",
  ownerId: id,
  x: data.x,
  y: data.y,
  vx: data.vx,
  vy: data.vy,
  damage: data.damage,
  hitEffect: data.hitEffect
});
      }
      
      // Handle shooting sound
if (data.type === "shootSound") {

  broadcastExcept(ws, {

    type: "shootSound",

    sound: data.sound,

    ownerId: id

  });

}

      // Handle player hit (damage)
      // Handle player hit (damage)
// Handle player hit (damage)
if (data.type === "hit" && clients.has(data.targetId)) {

  const target = clients.get(data.targetId);

  target.health = Math.max(
    0,
    target.health - data.damage
  );


  broadcast({
    type: "playerHealth",
    id: data.targetId,
    health: target.health
  });


  if (target.health <= 0) {

    broadcast({
      type: "playerDied",
      id: data.targetId
    });


    setTimeout(() => {

      if (!clients.has(data.targetId)) return;


      const respawnPlayer = clients.get(data.targetId);

      respawnPlayer.health = 100;
      respawnPlayer.x = 350;
      respawnPlayer.y = 350;


      broadcast({
        type: "playerHealth",
        id: data.targetId,
        health: 100
      });


      broadcast({
  type: "playerMove",
  id: data.targetId,
  x: 350,
  y: 350,
  health: 100
});


    }, 1000);

  }

}
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    broadcast({
      type: "playerRemove",
      id
    });
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastExcept(excludeWs, msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client === excludeWs) continue;
    if (client.readyState === 1) client.send(data);
  }
}

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
