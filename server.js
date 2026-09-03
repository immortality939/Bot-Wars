import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Map(); // id -> { id, x, y, color, health, shield }
let nextId = 1;

wss.on("connection", (ws) => {
  const id = nextId++;
  const color = `hsl(${Math.random() * 360}, 70%, 60%)`;

  clients.set(id, {
  id,
  x: 350,
  y: 350,
  color,
  health: 100,
  shield: 100,
  armor: 2
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
        p.shield = data.shield;

        broadcastExcept(ws, {
  type: "playerMove",
  id,
  x: p.x,
  y: p.y,
  shield: p.shield
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
          damage: data.damage
        });
      }

      // Handle player hit (damage)
      // Handle player hit (damage)
// Handle player hit (damage)
if (data.type === "hit" && clients.has(data.targetId)) {
 const target = clients.get(data.targetId);

// Apply armor reduction
let damage = data.damage - target.armor;

// Minimum 1 damage
if (damage < 1) {
  damage = 1;
}

if (target.shield > 0) {

  target.shield -= damage;

  if (target.shield < 0) {
    damage = Math.abs(target.shield);
    target.shield = 0;
  } else {
    damage = 0;
  }

}

target.health = Math.max(0, target.health - damage);

  broadcast({
 type:"playerHealth",
 id:data.targetId,
 health:target.health,
 shield:target.shield
});

  // If player died, broadcast death event
  if (target.health <= 0) {
    broadcast({
      type: "playerDied",
      id: data.targetId
    });

    // Respawn player after 1 second
    setTimeout(() => {
      if (clients.has(data.targetId)) {
        const respawnedPlayer = clients.get(data.targetId);
        respawnedPlayer.health = 100;
        respawnedPlayer.shield = 100;
        respawnedPlayer.x = 350;
        respawnedPlayer.y = 350;

        broadcast({
  type:"playerHealth",
  id: data.targetId,
  health:100,
  shield:100
});

        broadcast({
          type: "playerMove",
          id: data.targetId,
          x: 350,
          y: 350
        });
      }
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
