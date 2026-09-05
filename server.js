import { WebSocketServer } from "ws";
import http from "http";
import { WEAPONS } from "./weapon_server.js";
import { CHARACTERS } from "./character_server.js";

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Map();

let nextId = 1;

wss.on("connection", (ws) => {
  const id = nextId++;

  const color = `hsl(${Math.random() * 360},70%,60%)`;

  const baseChar = CHARACTERS.player;

  clients.set(id, {
  id,
  x: 350,
  y: 350,
  color,
  health: baseChar.health,
  armor: baseChar.armor,
  alive: true
});

  // SEND ID
  ws.send(JSON.stringify({
    type: "init",
    id
  }));

  // SEND ONLINE WEAPON CONFIG
  ws.send(JSON.stringify({
    type: "weaponConfig",
    weapons: WEAPONS
  }));

  // SEND ONLINE CHARACTER CONFIG
  ws.send(JSON.stringify({
    type: "characterConfig",
    characters: CHARACTERS
  }));


  // SEND OLD PLAYERS
  for (const [pid, player] of clients) {
    if (pid === id) continue;

    ws.send(JSON.stringify({
      type: "playerAdd",
      player: { ...player }
    }));
  }

  // INFORM OTHER PLAYERS
  broadcastExcept(ws, {
    type: "playerAdd",
    player: { ...clients.get(id) }
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // =========================
      // PLAYER MOVEMENT
      // =========================

      if (data.type === "move") {
        const player = clients.get(id);
        if (!player) return;

        player.x = data.x;
        player.y = data.y;

        broadcastExcept(ws, {
          type: "playerMove",
          id: id,
          x: player.x,
          y: player.y,
          health: player.health
        });
      }

      // =========================
      // BULLETS
      // SHOTGUN + NORMAL
      // =========================

      if (data.type === "bullet") {
        broadcastExcept(ws, {
          type: "bullet",
          ownerId: id,
          x: data.x,
          y: data.y,
          vx: data.vx,
          vy: data.vy,
          damage: data.damage || 0,
          hitEffect: data.hitEffect || "9mm"
        });
      }

      // =========================
      // SHOOT SOUND
      // =========================

      if (data.type === "shootSound") {
        broadcastExcept(ws, {
          type: "shootSound",
          sound: data.sound,
          ownerId: id
        });
      }

      // =========================
      // MUZZLE FLASH
      // =========================

      if (data.type === "muzzleFlash") {
        broadcastExcept(ws, {
          type: "muzzleFlash",
          ownerId: id,
          x: data.x,
          y: data.y,
          dirX: data.dirX,
          dirY: data.dirY
        });
      }

      // =========================
      // DAMAGE
      // =========================

            if (data.type === "hit") {
  const target = clients.get(data.targetId);
  if (!target) return;

  // Ignore damage while dead
  if (!target.alive) return;

        // Armor reduces damage: final = damage - armor, minimum 1
        let finalDamage = data.damage - target.armor;
        if (finalDamage < 1) finalDamage = 1;

        console.log("HIT:", {
          targetId: data.targetId,
          rawDamage: data.damage,
          targetArmor: target.armor,
          finalDamage
        });

        target.health -= finalDamage;

        if (target.health < 0) target.health = 0;

        broadcast({
          type: "playerHealth",
          id: data.targetId,
          health: target.health
        });

        if (target.health <= 0) {

  target.alive = false;

  broadcast({
    type: "playerDied",
    id: data.targetId
  });

          setTimeout(() => {
            const respawn = clients.get(data.targetId);
            if (!respawn) return;

            const baseChar = CHARACTERS.player;

            respawn.health = baseChar.health;
            respawn.x = 350;
            respawn.y = 350;
            respawn.alive = true;

            broadcast({
              type: "playerHealth",
              id: data.targetId,
              health: baseChar.health
            });

            broadcast({
              type: "playerMove",
              id: data.targetId,
              x: 350,
              y: 350,
              health: baseChar.health
            });
          }, 1000);
        }
      }
    } catch (err) {
      console.log(err);
    }
  });

  ws.on("close", () => {
    clients.delete(id);

    broadcast({
      type: "playerRemove",
      id: id
    });
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function broadcastExcept(exclude, message) {
  const data = JSON.stringify(message);

  wss.clients.forEach(client => {
    if (client === exclude) return;

    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

console.log("WEAPONS config:", JSON.stringify(WEAPONS, null, 2));

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
