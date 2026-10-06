// @RandomLocationsNearCaster{amount=4;radius=18;minRadius=4;spacing=2} —
// random points around the caster at its height, at least minRadius away and
// (best effort) `spacing` blocks apart (MythicMobs @RandomLocationsNearCaster
// a/r/minr/s [VERIFY] meaning of s). onSurface=true drops each point to the ground.

/** @param {Record<string, any>} o @param {string} long @param {string} short @param {number} def */
const opt = (o, long, short, def) => (typeof o[long] === "number" ? o[long] : typeof o[short] === "number" ? o[short] : def);

/** @type {import("../../types/config").Targeter} */
export default {
  name: "RandomLocationsNearCaster",
  validate(o) {
    const errors = [];
    const amount = opt(o, "amount", "a", 1);
    const r = opt(o, "radius", "r", 5);
    const minR = opt(o, "minRadius", "minr", 0);
    if (!Number.isInteger(amount) || amount < 1 || amount > 64) errors.push("`amount` must be an integer 1–64");
    if (r <= 0 || minR < 0 || minR > r) errors.push("need 0 ≤ minRadius ≤ radius, radius > 0");
    return errors;
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const amount = opt(o, "amount", "a", 1);
    const r = opt(o, "radius", "r", 5);
    const minR = opt(o, "minRadius", "minr", 0);
    const spacing = opt(o, "spacing", "s", 0);
    const dy = typeof o.y === "number" ? o.y : 0;
    const l = ctx.boss.location;
    const dim = ctx.boss.dimension;
    /** @type {{ x: number, y: number, z: number }[]} */
    const pts = [];
    for (let tries = 0; pts.length < amount && tries < amount * 12; tries++) {
      const ang = rng.next() * Math.PI * 2;
      // Uniform over the ring's area.
      const d = Math.sqrt(minR * minR + rng.next() * (r * r - minR * minR));
      const p = { x: l.x + Math.cos(ang) * d, y: l.y + dy, z: l.z + Math.sin(ang) * d };
      if (spacing > 0 && pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < spacing)) continue;
      if (o.onSurface) p.y = a.surfaceY(dim, p);
      pts.push(p);
    }
    return pts.map((p) => a.location(p));
  },
};
