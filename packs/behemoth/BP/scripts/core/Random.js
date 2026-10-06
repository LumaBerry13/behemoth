// Framework RNG. Seedable so a fight can be replayed in debug mode (design doc §11).

/** mulberry32 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let next = Math.random;
let currentSeed = /** @type {number | undefined} */ (undefined);

export const Random = {
  /** @param {number | undefined} seed undefined → Math.random */
  setSeed(seed) {
    currentSeed = seed;
    next = seed === undefined ? Math.random : seeded(seed);
  },
  get seed() {
    return currentSeed;
  },
  /** [0, 1) */
  next() {
    return next();
  },
  /** @param {number} p probability 0–1 */
  chance(p) {
    return p >= 1 || next() < p;
  },
  /** Inclusive integer range. @param {number} min @param {number} max */
  int(min, max) {
    return min + Math.floor(next() * (max - min + 1));
  },
  /** @template T @param {T[]} arr @returns {T | undefined} */
  pick(arr) {
    return arr.length ? arr[Math.floor(next() * arr.length)] : undefined;
  },
};
