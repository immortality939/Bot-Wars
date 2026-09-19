// =============================================================================
// Metal Wars — Online Multiplayer + Accounts + Cloud Saves
// =============================================================================
// Required environment variables:
//   DATABASE_URL   PostgreSQL connection string (Render Postgres works)
//   SMTP_HOST     SMTP server hostname
//   SMTP_PORT     usually 587
//   SMTP_USER     SMTP username
//   SMTP_PASS     SMTP password / app password
//   EMAIL_FROM    sender address, e.g. "Metal Wars <no-reply@example.com>"
//   PUBLIC_URL    public HTTPS server URL, e.g. https://bot-wars-1.onrender.com
//
// The server creates its database tables automatically on startup.
// =============================================================================

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.EMAIL_FROM) {
  console.error("SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM are required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PUBLIC_URL);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/verify") {
      await verifyEmailPage(url.searchParams.get("token"), res);
      return;
    }

    if (url.pathname === "/reset-password" && req.method === "POST") {
      await handleResetPasswordPost(req, res);
      return;
    }

    if (url.pathname === "/reset-password") {
      await resetPasswordPage(url.searchParams.get("token"), res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Metal Wars server is running.");
  } catch (err) {
    console.error("HTTP error:", err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error.");
  }
});

const wss = new WebSocketServer({ server: httpServer });

console.log("Metal Wars server starting on port " + PORT);

// -----------------------------------------------------------------------
// DATABASE / ACCOUNT HELPERS
// -----------------------------------------------------------------------

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === "string" &&
    password.length > 8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password);
}

function send(client, msg) {
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

async function createSession(userId) {
  const token = makeToken();
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    [hashToken(token), userId]
  );
  return token;
}

async function authenticateToken(token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.username, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.email_verified = TRUE`,
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

async function sendVerificationEmail(email, username, token) {
  const verifyUrl = `${PUBLIC_URL}/verify?token=${encodeURIComponent(token)}`;

  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Verify your Metal Wars account",
    text:
      `Hello ${username},\n\n` +
      `Verify your Metal Wars account by opening this link:\n${verifyUrl}\n\n` +
      `If you did not create this account, ignore this email.`,
    html:
      `<div style="font-family:Arial,sans-serif;line-height:1.5">` +
      `<h2>Metal Wars — Verify Your Account</h2>` +
      `<p>Hello ${escapeHtml(username)},</p>` +
      `<p>Click the button below to verify your email address.</p>` +
      `<p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#168cff;color:#fff;text-decoration:none;border-radius:6px">Verify Email</a></p>` +
      `<p>If the button does not work, open:<br>${escapeHtml(verifyUrl)}</p>` +
      `<p>If you did not create this account, ignore this email.</p>` +
      `</div>`
  });
}

async function sendResetEmail(email, username, token) {
  const resetUrl = `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Reset your Metal Wars password",
    text:
      `Hello ${username},\n\n` +
      `Reset your Metal Wars password here:\n${resetUrl}\n\n` +
      `This link expires in 30 minutes.`,
    html:
      `<div style="font-family:Arial,sans-serif;line-height:1.5">` +
      `<h2>Metal Wars — Password Reset</h2>` +
      `<p>Hello ${escapeHtml(username)},</p>` +
      `<p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#168cff;color:#fff;text-decoration:none;border-radius:6px">Reset Password</a></p>` +
      `<p>This link expires in 30 minutes.</p>` +
      `</div>`
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function verifyEmailPage(token, res) {
  if (!token) return writeSimplePage(res, "Metal Wars", "Verification link is missing.");

  const result = await pool.query(
    `UPDATE users
        SET email_verified = TRUE,
            verification_token_hash = NULL,
            verification_expires_at = NULL
      WHERE verification_token_hash = $1
        AND verification_expires_at > NOW()
      RETURNING username`,
    [hashToken(token)]
  );

  if (!result.rowCount) {
    return writeSimplePage(res, "Metal Wars", "This verification link is invalid or has expired.");
  }

  writeSimplePage(
    res,
    "Email Verified",
    `Your Metal Wars account is verified.<br><br>You can return to the game and log in as <b>${escapeHtml(result.rows[0].username)}</b>.`
  );
}


async function handleResetPasswordPost(req, res) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10000) break;
  }

  const params = new URLSearchParams(body);
  const token = params.get("token") || "";
  const password = params.get("password") || "";

  if (!validPassword(password)) {
    return writeSimplePage(res, "Invalid Password", "Password must be more than 8 characters and include letters and numbers.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `UPDATE users
        SET password_hash = $1,
            reset_token_hash = NULL,
            reset_expires_at = NULL
      WHERE reset_token_hash = $2
        AND reset_expires_at > NOW()
      RETURNING username`,
    [passwordHash, hashToken(token)]
  );

  if (!result.rowCount) {
    return writeSimplePage(res, "Reset Failed", "This reset link is invalid or has expired.");
  }

  await pool.query("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)", [result.rows[0].username]);
  writeSimplePage(res, "Password Reset", "Your password has been changed. Return to Metal Wars and log in with your new password.");
}

async function resetPasswordPage(token, res) {
  // This page intentionally performs the password change through a tiny HTML
  // form. The form POST is handled by the same server below.
  if (!token) return writeSimplePage(res, "Metal Wars", "Reset link is missing.");

  const result = await pool.query(
    `SELECT id, username
       FROM users
      WHERE reset_token_hash = $1
        AND reset_expires_at > NOW()`,
    [hashToken(token)]
  );

  if (!result.rowCount) {
    return writeSimplePage(res, "Metal Wars", "This reset link is invalid or has expired.");
  }

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset Password</title></head>
  <body style="font-family:Arial,sans-serif;max-width:420px;margin:40px auto;padding:20px">
  <h2>Metal Wars — Reset Password</h2>
  <p>Account: <b>${escapeHtml(result.rows[0].username)}</b></p>
  <form method="POST" action="/reset-password">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>New password</label><br>
    <input name="password" type="password" required minlength="9" style="width:100%;padding:10px;margin:8px 0 16px">
    <button type="submit" style="padding:10px 16px">Reset Password</button>
  </form></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function writeSimplePage(res, title, message) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
  <body style="font-family:Arial,sans-serif;text-align:center;padding:40px">
  <h2>${escapeHtml(title)}</h2><p>${message}</p></body></html>`);
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) UNIQUE NOT NULL,
      email VARCHAR(320) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token_hash TEXT,
      verification_expires_at TIMESTAMPTZ,
      reset_token_hash TEXT,
      reset_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS player_saves (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      save_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  `);

  console.log("Database ready.");
}

// -----------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------
let nextClientId = 1;
const clients = new Map();
const rooms = new Map();
const MAX_PLAYERS_PER_ROOM = 6;

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function roomClients(room) {
  return room.slots.filter((id) => id !== null).map((id) => clients.get(id)).filter(Boolean);
}

function broadcastToRoom(room, msg, exceptId) {
  for (const c of roomClients(room)) {
    if (c.id !== exceptId) send(c, msg);
  }
}

function broadcastRoomUpdate(room) {
  const slots = room.slots.map((id) => {
    if (id === null) return null;
    const c = clients.get(id);
    if (!c) return null;
    return { id: c.id, character: c.character, isHost: id === room.hostId };
  });
  broadcastToRoom(room, { type: "roomUpdate", roomCode: room.code, hostId: room.hostId, started: room.started, slots });
}

function removeClientFromRoom(client) {
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  const slotIndex = room.slots.indexOf(client.id);
  if (slotIndex !== -1) room.slots[slotIndex] = null;
  broadcastToRoom(room, { type: "playerRemove", id: client.id });

  const remaining = room.slots.filter((id) => id !== null);
  if (!remaining.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === client.id) room.hostId = remaining[0];
  broadcastRoomUpdate(room);
}

function requireAuth(client) {
  if (!client.userId) {
    send(client, { type: "authRequired", message: "Please log in first." });
    return false;
  }
  return true;
}

function startBossFight(room) {
  const playerCount = room.slots.filter((id) => id !== null).length;
  const maxHealth = 500 + playerCount * 400;
  room.started = true;
  room.boss = { health: maxHealth, maxHealth, x: 0, y: 0 };

  broadcastToRoom(room, { type: "bossStart", boss: room.boss });
  broadcastRoomUpdate(room);
}

function applyBossDamage(room, amount, attackerId) {
  if (!room.boss || room.boss.health <= 0) return;
  room.boss.health = Math.max(0, room.boss.health - amount);
  broadcastToRoom(room, { type: "bossUpdate", health: room.boss.health });
  if (room.boss.health <= 0) {
    broadcastToRoom(room, { type: "bossDefeated", killedBy: attackerId });
    room.started = false;
    room.boss = null;
  }
}

// -----------------------------------------------------------------------
// CONNECTION HANDLING
// -----------------------------------------------------------------------
wss.on("connection", (ws) => {
  const id = nextClientId++;
  const client = {
    ws, id, userId: null, username: null, roomCode: null,
    character: null, x: 0, y: 0, health: 100, alive: true
  };
  clients.set(id, client);

  send(client, { type: "init", id });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    try {
      switch (msg.type) {

        // ---- ACCOUNT -------------------------------------------------
        case "auth": {
          const user = await authenticateToken(msg.token);
          if (!user) {
            send(client, { type: "authResult", success: false, message: "Session expired. Please log in again." });
            break;
          }
          client.userId = Number(user.id);
          client.username = user.username;
          send(client, { type: "authResult", success: true, player: user });
          break;
        }

        case "register": {
          const username = String(msg.username || "").trim();
          const email = String(msg.email || "").trim().toLowerCase();
          const password = String(msg.password || "");

          if (!validUsername(username)) {
            send(client, { type: "registerResult", success: false, message: "Username must be 3-24 letters, numbers, or underscores." });
            break;
          }
          if (!validEmail(email)) {
            send(client, { type: "registerResult", success: false, message: "Please enter a valid email address." });
            break;
          }
          if (!validPassword(password)) {
            send(client, { type: "registerResult", success: false, message: "Password must be more than 8 characters and include letters and numbers." });
            break;
          }

          const existing = await pool.query(
            "SELECT username, email FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1",
            [username, email]
          );
          if (existing.rowCount) {
            const row = existing.rows[0];
            const message = row.email.toLowerCase() === email
              ? "That email is already registered."
              : "That username is already taken.";
            send(client, { type: "registerResult", success: false, message });
            break;
          }

          const passwordHash = await bcrypt.hash(password, 12);
          const verifyToken = makeToken();
          const db = await pool.connect();

          try {
            await db.query("BEGIN");
            await db.query(
              `INSERT INTO users
                (username, email, password_hash, email_verified, verification_token_hash, verification_expires_at)
               VALUES ($1, $2, $3, FALSE, $4, NOW() + INTERVAL '24 hours')`,
              [username, email, passwordHash, hashToken(verifyToken)]
            );

            // The account remains unverified until the email link is opened.
            await sendVerificationEmail(email, username, verifyToken);
            await db.query("COMMIT");

            send(client, {
              type: "registerResult",
              success: true,
              message: "Verification email sent. Check your email and verify your account before logging in."
            });
          } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            console.error("Registration/email error:", err);
            send(client, {
              type: "registerResult",
              success: false,
              message: "We could not send the verification email. Please try again."
            });
          } finally {
            db.release();
          }
          break;
        }

        case "login": {
          const username = String(msg.username || "").trim();
          const password = String(msg.password || "");

          const result = await pool.query(
            "SELECT id, username, email, password_hash, email_verified FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
            [username]
          );

          if (!result.rowCount) {
            send(client, { type: "loginResult", success: false, message: "Username or password is incorrect." });
            break;
          }

          const user = result.rows[0];
          const passwordOk = await bcrypt.compare(password, user.password_hash);
          if (!passwordOk) {
            send(client, { type: "loginResult", success: false, message: "Username or password is incorrect." });
            break;
          }
          if (!user.email_verified) {
            send(client, { type: "loginResult", success: false, message: "Please verify your email before logging in." });
            break;
          }

          const token = await createSession(user.id);
          client.userId = Number(user.id);
          client.username = user.username;

          send(client, {
            type: "loginResult",
            success: true,
            token,
            player: { id: Number(user.id), username: user.username, email: user.email }
          });
          break;
        }

        case "forgotPassword": {
          const email = String(msg.email || "").trim().toLowerCase();
          const result = await pool.query(
            "SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [email]
          );

          // Always return the same message so account existence is not exposed.
          if (result.rowCount) {
            const resetToken = makeToken();
            await pool.query(
              `UPDATE users
                  SET reset_token_hash = $1,
                      reset_expires_at = NOW() + INTERVAL '30 minutes'
                WHERE id = $2`,
              [hashToken(resetToken), result.rows[0].id]
            );
            try {
              await sendResetEmail(email, result.rows[0].username, resetToken);
            } catch (err) {
              console.error("Password reset email error:", err);
            }
          }

          send(client, {
            type: "forgotPasswordResult",
            success: true,
            message: "If that email belongs to an account, a password reset link has been sent."
          });
          break;
        }

        case "loadGame": {
          if (!requireAuth(client)) break;
          const result = await pool.query(
            "SELECT save_data, updated_at FROM player_saves WHERE user_id = $1",
            [client.userId]
          );
          send(client, {
            type: "loadGameResult",
            success: true,
            saveData: result.rowCount ? result.rows[0].save_data : null,
            updatedAt: result.rowCount ? result.rows[0].updated_at : null
          });
          break;
        }

        case "saveGame": {
          if (!requireAuth(client)) break;
          if (!msg.saveData || typeof msg.saveData !== "object" || Array.isArray(msg.saveData)) break;

          // Limit the payload so a malformed client cannot fill the database.
          const encoded = JSON.stringify(msg.saveData);
          if (encoded.length > 2_000_000) {
            send(client, { type: "saveGameResult", success: false, message: "Save data is too large." });
            break;
          }

          await pool.query(
            `INSERT INTO player_saves (user_id, save_data, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET save_data = EXCLUDED.save_data, updated_at = NOW()`,
            [client.userId, encoded]
          );
          send(client, { type: "saveGameResult", success: true, savedAt: Date.now() });
          break;
        }

        // ---- ROOM LIFECYCLE -----------------------------------------
        case "createRoom": {
          if (!requireAuth(client)) break;
          const code = makeRoomCode();
          const slots = new Array(MAX_PLAYERS_PER_ROOM).fill(null);
          slots[0] = id;
          const room = { code, hostId: id, slots, started: false, boss: null };
          rooms.set(code, room);
          client.roomCode = code;
          client.character = msg.character || null;
          send(client, { type: "roomCreated", roomCode: code });
          broadcastRoomUpdate(room);
          break;
        }

        case "joinRoom": {
          if (!requireAuth(client)) break;
          const room = rooms.get((msg.roomCode || "").toUpperCase());
          if (!room) { send(client, { type: "roomError", message: "Room not found." }); break; }
          if (room.started) { send(client, { type: "roomError", message: "That room's fight already started." }); break; }
          const freeSlot = room.slots.indexOf(null);
          if (freeSlot === -1) { send(client, { type: "roomError", message: "Room is full (6/6)." }); break; }
          room.slots[freeSlot] = id;
          client.roomCode = room.code;
          client.character = msg.character || null;
          send(client, { type: "roomJoined", roomCode: room.code });
          broadcastRoomUpdate(room);
          break;
        }

        case "setCharacter": {
          if (!requireAuth(client)) break;
          client.character = msg.character || null;
          const room = rooms.get(client.roomCode);
          if (room) broadcastRoomUpdate(room);
          break;
        }

        case "leaveRoom": {
          removeClientFromRoom(client);
          break;
        }

        case "startBoss": {
          if (!requireAuth(client)) break;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          if (room.hostId !== id) {
            send(client, { type: "roomError", message: "Only the host can start the fight." });
            break;
          }
          if (room.started) break;
          startBossFight(room);
          break;
        }

        case "bossDamage": {
          if (!requireAuth(client)) break;
          const room = rooms.get(client.roomCode);
          if (!room || !room.boss) break;
          const amount = Number(msg.damage) || 0;
          if (amount > 0 && amount <= 100000) applyBossDamage(room, amount, id);
          break;
        }

        // ---- GAMEPLAY RELAY -----------------------------------------
        case "playerMove": {
          if (!requireAuth(client)) break;
          client.x = msg.x;
          client.y = msg.y;
          if (msg.health !== undefined) client.health = msg.health;
          if (msg.alive !== undefined) client.alive = msg.alive;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, {
            type: "playerMove", id, x: msg.x, y: msg.y,
            health: msg.health, alive: msg.alive
          }, id);
          break;
        }

        case "shootSound": {
          if (!requireAuth(client)) break;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, {
            type: "shootSound", ownerId: id, sound: msg.sound, x: msg.x, y: msg.y
          }, id);
          break;
        }

        case "bullet": {
          if (!requireAuth(client)) break;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, {
            type: "bullet", ownerId: id, x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
            damage: msg.damage, hitEffect: msg.hitEffect, projectile: msg.projectile,
            isMortar: msg.isMortar || false, targetX: msg.targetX, targetY: msg.targetY,
            explosionRadius: msg.explosionRadius
          }, id);
          break;
        }

        case "muzzleFlash": {
          if (!requireAuth(client)) break;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, {
            type: "muzzleFlash", ownerId: id, x: msg.x, y: msg.y,
            dirX: msg.dirX, dirY: msg.dirY
          }, id);
          break;
        }

        case "playerHealth": {
          if (!requireAuth(client)) break;
          client.health = msg.health;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, { type: "playerHealth", id, health: msg.health });
          break;
        }

        case "playerDied": {
          if (!requireAuth(client)) break;
          client.alive = false;
          const room = rooms.get(client.roomCode);
          if (!room) break;
          broadcastToRoom(room, {
            type: "playerDied", id,
            deadUntil: msg.deadUntil || (Date.now() + 10000)
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("Message error:", msg.type, err);
      send(client, { type: "serverError", message: "Server error while processing that request." });
    }
  });

  ws.on("close", () => {
    removeClientFromRoom(client);
    clients.delete(id);
  });

  ws.on("error", () => {
    removeClientFromRoom(client);
    clients.delete(id);
  });
});

httpServer.on("error", (err) => {
  console.error("HTTP server error:", err);
});

initializeDatabase()
  .then(() => httpServer.listen(PORT, () => console.log("Metal Wars server listening on " + PORT)))
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
