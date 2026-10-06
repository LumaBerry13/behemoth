// Compact baked tracks. Boss packs ship bone tracks as base64-encoded
// little-endian int16 triplets (blocks × q), ~4× smaller than JSON number
// arrays — this keeps boss-pack transfers and the framework's config cache small.
//   { q: 1000, n: <frames>, d: "<base64>" }  →  [[x, y, z], ...]
// Plain [[x, y, z], ...] tracks are accepted unchanged.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** @param {string} s @returns {Uint8Array} */
export function base64ToBytes(s) {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v < 0) throw new Error(`invalid base64 character at ${i}`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/**
 * @param {unknown} track
 * @returns {[number, number, number][]}
 */
export function decodeTrack(track) {
  if (Array.isArray(track)) return /** @type {[number, number, number][]} */ (track);
  const t = /** @type {{ q?: number, n?: number, d?: string }} */ (track);
  if (!t || typeof t.d !== "string" || typeof t.q !== "number") throw new Error("unknown track encoding");
  const bytes = base64ToBytes(t.d);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = t.n ?? Math.floor(bytes.byteLength / 6);
  if (frames * 6 > bytes.byteLength) throw new Error("track data shorter than its frame count");
  /** @type {[number, number, number][]} */
  const out = [];
  for (let i = 0; i < frames; i++) {
    out.push([view.getInt16(i * 6, true) / t.q, view.getInt16(i * 6 + 2, true) / t.q, view.getInt16(i * 6 + 4, true) / t.q]);
  }
  return out;
}

/**
 * Decode every compact bone track in a boss config, in place.
 * @param {import("../types/config").BossConfig} config
 */
export function decodeConfigTracks(config) {
  for (const anim of Object.values(config.animations ?? {})) {
    if (!anim?.bones) continue;
    for (const [bone, track] of Object.entries(anim.bones)) anim.bones[bone] = decodeTrack(track);
  }
  return config;
}
