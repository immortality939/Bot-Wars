/**
 * auth.js — account system for the Bot-Wars WebSocket server.
 *
 * Handles the four messages the game client sends:
 *   register        -> registerResult        (emails a confirmation link)
 *   login           -> loginResult           (blocked until email is confirmed)
 *   forgotPassword  -> forgotPasswordResult  (emails a temporary password)
 *   changePassword  -> changePasswordResult  (old password + new password)
 * plus one HTTP route:  GET /verify?token=...  (the link in the email)
 *
 * ---------------------------------------------------------------------------
 * HOW TO PLUG IT INTO A server.js
 * (the server.js delivered next to this file already does all of this — this is
 *  only needed if you keep your own server.js)
 * ---------------------------------------------------------------------------
 *   const { createAuth, createHttpMailer } = require("./auth");
 *
 *   const auth = createAuth({
 *     baseUrl: process.env.PUBLIC_URL,            // e.g. https://bot-wars-1.onrender.com
 *     mailer: createHttpMailer(),                  // reads MAIL_* env vars, see below
 *     // Optional: set up your own per-connection session state after login.
 *     onLogin: (ws, player) => { ws.playerName = player.username; },
 *   });
 *
 *   // 1) HTTP server: let auth answer /verify first
 *   const server = http.createServer((req, res) => {
 *     if (auth.handleHttp(req, res)) return;
 *     ...your existing handler...
 *   });
 *   //    (Express instead?  app.get("/verify", auth.handleHttp);)
 *
 *   // 2) WebSocket: in your ws.on("message") handler, right after JSON.parse:
 *   if (await auth.handleMessage(ws, msg)) return;   // it was an account message
 *
 * ---------------------------------------------------------------------------
 * ENV VARS
 * ---------------------------------------------------------------------------
 *   PUBLIC_URL      public https URL of this server (used in the email link)
 *   MAIL_PROVIDER   "brevo" or "resend"
 *   MAIL_API_KEY    API key from that provider
 *   MAIL_FROM       sender address, must be verified with the provider
 *                   (Brevo: a verified single sender;  Resend: an address on your verified domain)
 *   MAIL_FROM_NAME  optional display name (default "Bot-Wars")
 *   DATA_DIR        where accounts.json is stored (default ./data)
 *
 * NOTE: Render's free web services block SMTP ports (25/465/587), so this
 * sends mail through the providers' HTTPS APIs instead — no SMTP needed.
 * NOTE: accounts.json lives on disk. On Render's free tier the disk is wiped on
 * every redeploy/restart, so for a real launch swap the store for a database
 * (see createFileStore — it's ~30 lines to replace).
 *
 * No npm dependencies: Node 18+ only (crypto, fs, global fetch).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

// ------------------------------------------------------------------ settings
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // confirmation link lives 24h
const TEMP_PASSWORD_TTL_MS = 60 * 60 * 1000; // temporary password lives 1h
const FORGOT_COOLDOWN_MS = 60 * 1000; // 1 temp-password email / minute / account
const MAX_FAILS = 5; // wrong passwords before a lockout
const LOCKOUT_MS = 5 * 60 * 1000;

// ------------------------------------------------------------------ validation
const isValidEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
// Same rule the client enforces: more than 8 chars, letters AND numbers.
const isValidPassword = (p) =>
  typeof p === "string" && p.length > 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
const isValidUsername = (u) => typeof u === "string" && /^[A-Za-z0-9_]{3,20}$/.test(u);

// ------------------------------------------------------------------ hashing
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(secret, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function checkSecret(secret, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(secret, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function makeTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no 0/O/1/l/I
  for (;;) {
    let out = "";
    for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
    if (isValidPassword(out)) return out; // guarantees a letter + a digit
  }
}

// ------------------------------------------------------------------ storage
// Simple JSON-file store (in-memory Map, saved on every change).
function createFileStore(dir) {
  const file = path.join(dir, "accounts.json");
  const accounts = new Map(); // usernameKey -> account
  try {
    for (const a of JSON.parse(fs.readFileSync(file, "utf8"))) accounts.set(a.usernameKey, a);
  } catch (_) {
    /* first run: no file yet */
  }

  let saving = Promise.resolve();
  function save() {
    // Serialize writes; write to a temp file then rename so a crash can't corrupt the data.
    saving = saving.then(async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = file + ".tmp";
      await fs.promises.writeFile(tmp, JSON.stringify([...accounts.values()]), "utf8");
      await fs.promises.rename(tmp, file);
    }).catch((err) => console.error("[auth] could not save accounts:", err));
    return saving;
  }

  return {
    getByUsername: (u) => accounts.get(u.toLowerCase()),
    getByEmail: (e) => [...accounts.values()].find((a) => a.emailKey === e.toLowerCase()),
    getByVerifyHash: (h) => [...accounts.values()].find((a) => a.verifyHash === h),
    put(account) { accounts.set(account.usernameKey, account); return save(); },
    remove(account) { accounts.delete(account.usernameKey); return save(); },
  };
}

// ------------------------------------------------------------------ mail (HTTPS APIs, no SMTP)
function createHttpMailer(env = process.env) {
  const provider = (env.MAIL_PROVIDER || "").toLowerCase();
  const apiKey = env.MAIL_API_KEY;
  const from = env.MAIL_FROM;
  const fromName = env.MAIL_FROM_NAME || "Bot-Wars";

  return async function sendMail({ to, subject, text, html }) {
    if (!provider || !apiKey || !from) {
      throw new Error("Mail is not configured (set MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM).");
    }
    let res;
    if (provider === "brevo") {
      res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: fromName, email: from },
          to: [{ email: to }],
          subject,
          textContent: text,
          htmlContent: html,
        }),
      });
    } else if (provider === "resend") {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html }),
      });
    } else {
      throw new Error(`Unknown MAIL_PROVIDER "${provider}" (use "brevo" or "resend").`);
    }
    if (!res.ok) throw new Error(`Mail API ${provider} answered ${res.status}: ${await res.text()}`);
  };
}

// ------------------------------------------------------------------ pages
const pageShell = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#04100f;color:#cdfff2;font-family:'Courier New',monospace;text-align:center;padding:20px}
.box{max-width:360px;border:1px solid rgba(0,255,210,.5);padding:28px;background:#081416}h1{font-size:18px;letter-spacing:3px;text-transform:uppercase}p{line-height:1.6;font-size:14px}</style>
</head><body><div class="box">${body}</div></body></html>`;

// ------------------------------------------------------------------ main factory
function createAuth(options = {}) {
  const baseUrl = (options.baseUrl || "").replace(/\/+$/, "");
  const mailer = options.mailer;
  const store = options.store || createFileStore(options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data"));
  const onLogin = options.onLogin || (() => {});
  const now = options.now || (() => Date.now()); // injectable for tests
  const appName = options.appName || "Bot-Wars";

  if (!mailer) throw new Error("createAuth: a mailer is required (e.g. createHttpMailer()).");

  const reply = (ws, type, success, message, extra = {}) =>
    ws.send(JSON.stringify({ type, success, message, ...extra }));

  const isLocked = (a) => a.lockedUntil && a.lockedUntil > now();
  async function registerFail(a) {
    a.failCount = (a.failCount || 0) + 1;
    if (a.failCount >= MAX_FAILS) { a.lockedUntil = now() + LOCKOUT_MS; a.failCount = 0; }
    await store.put(a);
  }

  async function sendVerification(account) {
    const token = crypto.randomBytes(32).toString("hex");
    account.verifyHash = sha256(token);
    account.verifyExpires = now() + VERIFY_TTL_MS;
    const link = `${baseUrl}/verify?token=${token}`;
    await mailer({
      to: account.email,
      subject: `Confirm your ${appName} account`,
      text: `Hi ${account.username},\n\nConfirm your ${appName} account by opening this link (valid for 24 hours):\n${link}\n\nIf you didn't create this account, just ignore this email.`,
      html: `<p>Hi ${account.username},</p><p>Confirm your ${appName} account:</p><p><a href="${link}">Confirm my account</a></p><p>The link is valid for 24 hours. If you didn't create this account, ignore this email.</p>`,
    });
  }

  // Password check that also accepts a live temporary password. Returns "main" | "temp" | null.
  async function matchPassword(account, password) {
    if (await checkSecret(password, account.passHash)) return "main";
    if (account.tempHash && account.tempExpires > now() && (await checkSecret(password, account.tempHash))) return "temp";
    return null;
  }

  // ---- register --------------------------------------------------------
  async function register(ws, msg) {
    const username = String(msg.username || "").trim();
    const email = String(msg.email || "").trim();
    const password = msg.password;

    if (!isValidUsername(username)) return reply(ws, "registerResult", false, "Username must be 3–20 characters: letters, numbers or underscore.");
    if (!isValidEmail(email)) return reply(ws, "registerResult", false, "Please enter a valid email address.");
    if (!isValidPassword(password)) return reply(ws, "registerResult", false, "Password must be more than 8 characters and include letters and numbers.");

    // Unconfirmed accounts whose link expired don't hold their name/email hostage.
    for (const existing of [store.getByUsername(username), store.getByEmail(email)]) {
      if (existing && !existing.verified && existing.verifyExpires < now()) await store.remove(existing);
    }
    if (store.getByUsername(username)) return reply(ws, "registerResult", false, "That username is already taken.");
    if (store.getByEmail(email)) return reply(ws, "registerResult", false, "An account with that email already exists.");

    const account = {
      username,
      usernameKey: username.toLowerCase(),
      email,
      emailKey: email.toLowerCase(),
      passHash: await hashSecret(password),
      verified: false,
      createdAt: now(),
    };
    try {
      await sendVerification(account);
    } catch (err) {
      console.error("[auth] confirmation email failed:", err.message);
      return reply(ws, "registerResult", false, "We couldn't send the confirmation email. Check the address and try again later.");
    }
    await store.put(account);
    reply(ws, "registerResult", true, `Account created! We sent a confirmation link to ${email}. Open it, then log in.`);
  }

  // ---- login -----------------------------------------------------------
  async function login(ws, msg) {
    const username = String(msg.username || "").trim();
    const password = typeof msg.password === "string" ? msg.password : "";
    const bad = "Wrong username or password.";

    const account = username ? store.getByUsername(username) : null;
    if (!account) {
      await hashSecret(password); // burn similar time so timing doesn't reveal which usernames exist
      return reply(ws, "loginResult", false, bad);
    }
    if (isLocked(account)) return reply(ws, "loginResult", false, "Too many wrong attempts. Try again in a few minutes.");

    const which = await matchPassword(account, password);
    if (!which) {
      await registerFail(account);
      return reply(ws, "loginResult", false, bad);
    }
    if (!account.verified) {
      return reply(ws, "loginResult", false, "Please confirm your email first — open the link we sent you, then log in.");
    }

    account.failCount = 0;
    if (which === "temp") {
      // Temporary password becomes the password; the player must pick a new one.
      account.passHash = account.tempHash;
      account.mustChange = true;
    }
    // Any successful login clears a pending temp password (the owner clearly still has access).
    account.tempHash = null;
    account.tempExpires = 0;
    await store.put(account);

    const player = { username: account.username, mustChangePassword: !!account.mustChange };
    ws.user = account.username;
    onLogin(ws, player, account);
    reply(ws, "loginResult", true, "Logged in.", { player });
  }

  // ---- forgot password -------------------------------------------------
  async function forgotPassword(ws, msg) {
    const email = String(msg.email || "").trim();
    if (!isValidEmail(email)) return reply(ws, "forgotPasswordResult", false, "Please enter a valid email address.");

    const generic = "If that email has an account, we've sent it a temporary password. Check your inbox.";
    const account = store.getByEmail(email);
    if (!account) return reply(ws, "forgotPasswordResult", true, generic);
    if (account.lastForgotAt && now() - account.lastForgotAt < FORGOT_COOLDOWN_MS) {
      return reply(ws, "forgotPasswordResult", false, "Please wait a minute before asking again.");
    }
    account.lastForgotAt = now();

    try {
      if (!account.verified) {
        // Never confirmed: send a fresh confirmation link instead.
        await sendVerification(account);
        await store.put(account);
        return reply(ws, "forgotPasswordResult", true, "Your email isn't confirmed yet — we sent a new confirmation link. Open it, then log in.");
      }
      const temp = makeTempPassword();
      account.tempHash = await hashSecret(temp);
      account.tempExpires = now() + TEMP_PASSWORD_TTL_MS;
      await mailer({
        to: account.email,
        subject: `Your ${appName} temporary password`,
        text: `Hi ${account.username},\n\nYour temporary password is:\n\n${temp}\n\nIt works for 1 hour. Log in with it and you'll be asked to choose a new password.\nIf you didn't ask for this, ignore this email — your current password still works.`,
        html: `<p>Hi ${account.username},</p><p>Your temporary password is:</p><p style="font-size:20px;font-family:monospace"><b>${temp}</b></p><p>It works for 1 hour. Log in with it and you'll be asked to choose a new password.</p><p>If you didn't ask for this, ignore this email — your current password still works.</p>`,
      });
      await store.put(account);
      reply(ws, "forgotPasswordResult", true, generic);
    } catch (err) {
      console.error("[auth] forgot-password email failed:", err.message);
      account.tempHash = null;
      account.tempExpires = 0;
      await store.put(account);
      reply(ws, "forgotPasswordResult", false, "We couldn't send the email right now. Please try again later.");
    }
  }

  // ---- change password -------------------------------------------------
  async function changePassword(ws, msg) {
    const username = String(msg.username || "").trim();
    const { oldPassword, newPassword } = msg;
    const bad = "Username or old password is wrong.";

    if (!isValidPassword(newPassword)) {
      return reply(ws, "changePasswordResult", false, "New password must be more than 8 characters and include letters and numbers.");
    }
    if (typeof oldPassword !== "string" || !oldPassword) return reply(ws, "changePasswordResult", false, bad);
    if (newPassword === oldPassword) return reply(ws, "changePasswordResult", false, "New password must be different from the old one.");

    const account = username ? store.getByUsername(username) : null;
    if (!account) {
      await hashSecret(oldPassword);
      return reply(ws, "changePasswordResult", false, bad);
    }
    if (isLocked(account)) return reply(ws, "changePasswordResult", false, "Too many wrong attempts. Try again in a few minutes.");
    if (!(await matchPassword(account, oldPassword))) {
      await registerFail(account);
      return reply(ws, "changePasswordResult", false, bad);
    }
    if (!account.verified) return reply(ws, "changePasswordResult", false, "Please confirm your email first.");

    account.passHash = await hashSecret(newPassword);
    account.tempHash = null;
    account.tempExpires = 0;
    account.mustChange = false;
    account.failCount = 0;
    await store.put(account);
    reply(ws, "changePasswordResult", true, "Password changed.");
  }

  const handlers = { register, login, forgotPassword, changePassword };

  return {
    /** Call for every parsed WS message. Resolves true if it was an account message. */
    async handleMessage(ws, msg) {
      const handler = msg && handlers[msg.type];
      if (!handler) return false;
      try {
        await handler(ws, msg);
      } catch (err) {
        console.error(`[auth] ${msg.type} crashed:`, err);
        reply(ws, `${msg.type}Result`, false, "Something went wrong on the server. Please try again.");
      }
      return true;
    },

    /** Call for every HTTP request. Returns true if it answered (/verify). */
    handleHttp(req, res) {
      const url = new URL(req.url, "http://localhost");
      if (req.method !== "GET" || url.pathname !== "/verify") return false;

      const token = url.searchParams.get("token") || "";
      const account = /^[0-9a-f]{64}$/.test(token) ? store.getByVerifyHash(sha256(token)) : null;
      const ok = account && account.verifyExpires > now();

      if (ok) {
        account.verified = true;
        account.verifyHash = null;
        account.verifyExpires = 0;
        store.put(account);
      }
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(
        ok
          ? pageShell("Email confirmed", `<h1>Email confirmed</h1><p>Your ${appName} account is ready.<br>Go back to the game and log in.</p>`)
          : pageShell("Link expired", `<h1>Link not valid</h1><p>This confirmation link is invalid or has expired.<br>In the game, tap <b>Forgot Account</b> and enter your email to get a new one.</p>`)
      );
      return true;
    },

    store, // exposed for tests / admin scripts
  };
}

module.exports = { createAuth, createHttpMailer, createFileStore };
