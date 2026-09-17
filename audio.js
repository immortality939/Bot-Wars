// audio.js
//
// Shared "positional" audio system used for gunfire and bullet-impact
// sounds. Goal: a shot or hit that happens far from the local player
// should sound distant — quieter AND more muffled (low-passed), the
// way real gunfire sounds duller and loses its crack over distance —
// while something close by stays crisp and loud. Also pans left/right
// based on where the source is relative to the player.
//
// Everything here degrades gracefully: if the Web Audio API is
// unavailable or a browser blocks it before a user gesture, sounds
// still play (just without distance shaping) via a plain <audio>
// fallback, so gameplay is never blocked on audio.

const SOUND_MAX_DISTANCE = 1000;   // beyond this, sound is effectively inaudible
const SOUND_FULL_DISTANCE = 60;    // inside this radius, no falloff at all
const SOUND_MIN_LOWPASS_HZ = 500;  // filter cutoff at max distance (very muffled)
const SOUND_MAX_LOWPASS_HZ = 20000; // filter cutoff up close (no filtering)

let _audioCtx = null;
const _bufferCache = new Map();   // url -> decoded AudioBuffer (or a pending Promise)

function _getAudioContext() {
  if (_audioCtx) return _audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  _audioCtx = new Ctx();
  return _audioCtx;
}

// Some browsers start the context "suspended" until a user gesture.
// Call this from any click/keydown/touchstart handler you already have.
function unlockAudio() {
  const ctx = _getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function _loadBuffer(url) {
  const ctx = _getAudioContext();
  if (!ctx) return Promise.reject(new Error("no audio context"));

  const cached = _bufferCache.get(url);
  if (cached) return cached;

  const promise = fetch(url)
    .then(res => res.arrayBuffer())
    .then(data => ctx.decodeAudioData(data))
    .catch(err => {
      _bufferCache.delete(url); // allow a retry later instead of caching a failure
      throw err;
    });

  _bufferCache.set(url, promise);
  return promise;
}

// Plain fallback: no distance shaping, just a flat volume.
function _playFlat(url, volume) {
  try {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(() => {});
  } catch (err) {
    // ignore — never let audio errors break gameplay
  }
}

// Core entry point.
//
//   url         - sound file to play
//   dx, dy      - vector FROM the listener (local player) TO the sound's
//                 source, in world/canvas units (same units as x/y
//                 elsewhere in the game)
//   options:
//     baseVolume  - volume at/inside SOUND_FULL_DISTANCE (default 1.0)
//     maxDistance - override SOUND_MAX_DISTANCE for this sound
//
// Distance and stereo pan are derived from dx/dy; nothing else needed.
function playPositionalSound(url, dx, dy, options) {
  if (!url) return;
  const opts = options || {};
  const baseVolume = opts.baseVolume !== undefined ? opts.baseVolume : 1.0;
  const maxDistance = opts.maxDistance || SOUND_MAX_DISTANCE;

  const distance = Math.hypot(dx, dy);

  if (distance >= maxDistance) return; // too far to hear at all

  // 0 = right at the listener, 1 = at max hearing range
  const t = Math.max(0, Math.min(1, (distance - SOUND_FULL_DISTANCE) / (maxDistance - SOUND_FULL_DISTANCE)));

  // Volume falls off faster than linearly (closer to how loudness is
  // actually perceived), then scaled by baseVolume.
  const falloff = 1 - t;
  const volume = baseVolume * (falloff * falloff);

  if (volume <= 0.01) return;

  const ctx = _getAudioContext();
  if (!ctx) {
    _playFlat(url, volume);
    return;
  }
  if (ctx.state === "suspended") {
    // Can't use filtered/panned playback until unlocked — fall back
    // rather than silently dropping the sound.
    _playFlat(url, volume);
    return;
  }

  // Stereo pan: -1 (full left) to 1 (full right), based on the
  // sideways component of the direction to the source.
  const pan = Math.max(-1, Math.min(1, dx / (maxDistance * 0.5)));

  // Lowpass cutoff: full range up close, muffled far away.
  const lowpassHz = SOUND_MAX_LOWPASS_HZ - t * (SOUND_MAX_LOWPASS_HZ - SOUND_MIN_LOWPASS_HZ);

  _loadBuffer(url).then(buffer => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpassHz;

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = pan;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    if (panner) {
      source.connect(filter).connect(panner).connect(gain).connect(ctx.destination);
    } else {
      source.connect(filter).connect(gain).connect(ctx.destination);
    }

    source.start(0);
  }).catch(() => {
    // Decoding/fetch failed (bad path, CORS, etc.) — fall back to a
    // simple flat-volume play so the sound still isn't lost entirely.
    _playFlat(url, volume);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { playPositionalSound, unlockAudio };
}
