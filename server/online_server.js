// =============================================================================
// online_server.js  —  ONLINE-MODE RULES (lives on the SERVER / GitHub only)
// =============================================================================
// The numbers that used to be hardcoded at the top of the public data/online.js.
// They are NOT in the public game files any more: server.js sends ONLINE_RULES
// to the client when it joins (inside GAME_DATA, like every other *_server.js
// file), and server.js ALSO enforces them on incoming messages. So a player who
// edits their own copy of online.js can't change what the server accepts.
//
// To change a rule: edit it here and redeploy the server. No change to the
// public files is needed.
// =============================================================================

const ONLINE_RULES = {
  // ---- servers / channels (the lobby draws its rows from these) ----
  SERVER_COUNT: 20,           // SERVER 1 .. SERVER 5
  SERVER_MAX_PLAYERS: 1000,   // per server (both channels together)
  CHANNELS: [
    { id: 0, pvp: true,  desc: "PvP - players can damage each other" },
    { id: 1, pvp: false, desc: "Safe - no player damage" }
  ],
  PARTY_MAX_SIZE: 6,         // most players one party can hold
  RESPAWN_SECONDS: 10,        // countdown after dying before you can respawn
  SPAWN_PROTECT_MS: 2000,    // brief invulnerability after joining / respawning / changing map
  STATE_INTERVAL_MS: 50,     // ms between position updates (~20/s) — server drops faster ones
  BOTS_INTERVAL_MS: 100,     // ms between enemy snapshots (~10/s), enemy host only
  TOUCH_RANGE: 150,          // world units: how close a player must be to tap them (friend / party / trade)
  TRADE_OFFER_SIZE: 8,       // most items one side can put up in a trade
  TRADE_MAX_GOLD: 1000000    // most gold one side can put up in a trade
};

// ---- export for server.js (Node) ----
if (typeof module !== "undefined") module.exports = { ONLINE_RULES };
