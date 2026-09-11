import fs from "fs";
import crypto from "crypto";

const FILE = "./players.json";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour


// Load all players
function loadPlayers() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }

    const data = fs.readFileSync(FILE, "utf8");

    return JSON.parse(data);
}


// Save all players
function savePlayers(players) {
    fs.writeFileSync(
        FILE,
        JSON.stringify(players, null, 2)
    );
}


// -----------------------------------------------------------------------
// PASSWORD HASHING (scrypt, built into Node — no extra dependency)
// Stored as "salt:hash" (both hex). Old plaintext passwords already saved
// in players.json (no ":" in them) still work via verifyPassword()'s
// legacy fallback below, so existing accounts aren't locked out.
// -----------------------------------------------------------------------
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return salt + ":" + hash;
}

function verifyPassword(password, stored) {
    if (!stored) return false;

    if (!stored.includes(":")) {
        // Legacy plaintext account (e.g. seeded players.json entries).
        return stored === password;
    }

    const [salt, hash] = stored.split(":");
    const check = crypto.scryptSync(password, salt, 64).toString("hex");

    // Constant-time compare to avoid leaking timing info.
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(check, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function makeToken() {
    return crypto.randomBytes(24).toString("hex");
}


// -----------------------------------------------------------------------
// VALIDATION — same rules on client (for instant feedback) and here
// (so nothing bad reaches players.json even if a client is modified).
// -----------------------------------------------------------------------
export function validateUsername(username) {
    if (!username || typeof username !== "string") return "Username is required.";
    if (username.length < 3 || username.length > 20) return "Username must be 3-20 characters.";
    if (!/^[A-Za-z0-9_]+$/.test(username)) return "Username can only contain letters, numbers, and underscores.";
    return null;
}

export function validatePassword(password) {
    if (!password || typeof password !== "string") return "Password is required.";
    if (password.length <= 8) return "Password must be more than 8 characters.";
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return "Password must contain both letters and numbers.";
    }
    return null;
}

export function validateEmail(email) {
    if (!email || typeof email !== "string") return "Email is required.";
    // Simple, practical email check (not full RFC 5322).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    return null;
}


// -----------------------------------------------------------------------
// ACCOUNT CREATION
// -----------------------------------------------------------------------
export function createPlayer(username, password, email) {

    const usernameError = validateUsername(username);
    if (usernameError) return { success: false, message: usernameError };

    const passwordError = validatePassword(password);
    if (passwordError) return { success: false, message: passwordError };

    const emailError = validateEmail(email);
    if (emailError) return { success: false, message: emailError };

    let players = loadPlayers();

    // Check existing username (case-insensitive)
    let exists = players.find(
        p => p.username.toLowerCase() === username.toLowerCase()
    );

    if (exists) {
        return {
            success: false,
            message: "Username already exists"
        };
    }

    let emailTaken = players.find(
        p => (p.email || "").toLowerCase() === email.toLowerCase()
    );

    if (emailTaken) {
        return {
            success: false,
            message: "An account with that email already exists"
        };
    }

    const verifyToken = makeToken();

    let newPlayer = {

        username,
        password: hashPassword(password),
        email,

        verified: false,
        verifyToken,
        verifyTokenExpires: Date.now() + VERIFY_TOKEN_TTL_MS,

        resetToken: null,
        resetTokenExpires: null,


        // Game data
        level: 1,
        xp: 0,
        coins: 100,


        // Last position
        map: "start",
        x: 500,
        y: 300,


        inventory: []

    };


    players.push(newPlayer);

    savePlayers(players);


    return {
        success: true,
        message: "Account created",
        player: newPlayer,
        verifyToken
    };

}


// Confirms the account tied to a verification token (the link the player
// clicks from their email). Returns the username on success so the caller
// can greet them / prefill the login form.
export function verifyEmailToken(token) {
    if (!token) return { success: false, message: "Missing verification token." };

    let players = loadPlayers();
    let player = players.find(p => p.verifyToken === token);

    if (!player) {
        return { success: false, message: "This verification link is invalid or has already been used." };
    }

    if (player.verifyTokenExpires && Date.now() > player.verifyTokenExpires) {
        return { success: false, message: "This verification link has expired. Please request a new one." };
    }

    player.verified = true;
    player.verifyToken = null;
    player.verifyTokenExpires = null;

    savePlayers(players);

    return { success: true, message: "Email verified! You can log in now.", username: player.username };
}

// Issues a fresh verification token for an already-registered, unverified
// account (used for "resend verification email").
export function regenerateVerifyToken(username) {
    let players = loadPlayers();
    let player = players.find(p => p.username.toLowerCase() === (username || "").toLowerCase());

    if (!player) return { success: false, message: "Account not found." };
    if (player.verified) return { success: false, message: "This account is already verified." };

    const verifyToken = makeToken();
    player.verifyToken = verifyToken;
    player.verifyTokenExpires = Date.now() + VERIFY_TOKEN_TTL_MS;

    savePlayers(players);

    return { success: true, verifyToken, email: player.email, username: player.username };
}



// Login player
export function loginPlayer(username, password) {

    let players = loadPlayers();

    let player = players.find(
        p => p.username.toLowerCase() === (username || "").toLowerCase()
    );

    if (!player || !verifyPassword(password, player.password)) {
        return {
            success: false,
            message: "Wrong username or password"
        };
    }

    if (!player.verified) {
        return {
            success: false,
            needsVerification: true,
            message: "Please verify your email before logging in. Check your inbox for the confirmation link."
        };
    }

    // Never send the password hash back to the client.
    const { password: _pw, verifyToken: _vt, resetToken: _rt, ...safePlayer } = player;

    return {
        success: true,
        player: safePlayer
    };

}


// -----------------------------------------------------------------------
// FORGOT / RESET PASSWORD
// -----------------------------------------------------------------------
export function createPasswordResetToken(email) {
    let players = loadPlayers();
    let player = players.find(p => (p.email || "").toLowerCase() === (email || "").toLowerCase());

    if (!player) {
        // Caller should still show a generic "check your email" message so
        // this can't be used to find out which emails have accounts.
        return { success: false };
    }

    const resetToken = makeToken();
    player.resetToken = resetToken;
    player.resetTokenExpires = Date.now() + RESET_TOKEN_TTL_MS;

    savePlayers(players);

    return { success: true, resetToken, username: player.username };
}

export function resetPasswordWithToken(token, newPassword) {
    if (!token) return { success: false, message: "Missing reset token." };

    const passwordError = validatePassword(newPassword);
    if (passwordError) return { success: false, message: passwordError };

    let players = loadPlayers();
    let player = players.find(p => p.resetToken === token);

    if (!player) {
        return { success: false, message: "This reset link is invalid or has already been used." };
    }

    if (player.resetTokenExpires && Date.now() > player.resetTokenExpires) {
        return { success: false, message: "This reset link has expired. Please request a new one." };
    }

    player.password = hashPassword(newPassword);
    player.resetToken = null;
    player.resetTokenExpires = null;

    savePlayers(players);

    return { success: true, message: "Password updated! You can log in now.", username: player.username };
}



// Save game progress
export function savePlayer(username, data) {

    let players = loadPlayers();


    let player = players.find(
        p => p.username === username
    );


    if (!player) {
        return false;
    }


    Object.assign(player, data);


    savePlayers(players);


    return true;

}



// Load player data
export function getPlayer(username) {

    let players = loadPlayers();


    return players.find(
        p => p.username === username
    );

}
