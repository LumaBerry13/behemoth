// @RandomLocationsNearTarget{amount=3;radius=4;minRadius=0} — random points
// around the caster's current target (MythicMobs @RandomLocationsNearTargets).
/** @param {Record<string, any>} o @param {string} long @param {string} short @param {number} def */
const opt = (o, long, short, def) => (typeof o[long] === "number" ? o[long] : typeof o[short] === "number" ? o[short] : def);

/** @type {import("../../types/config").Targeter} */
export default {
  name: "RandomLocationsNearTarget",
  validate(o) {
    const amount = opt(o, "amount", "a", 1);
    return Number.isInteger(amount) && amount >= 1 && amount <= 64 ? [] : ["`amount` must be an integer 1–64"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const t = ctx.inherited?.[0] ?? ctx.boss.getTarget();
    if (!t) return [];
    const l = a.locOf(t);
    const r = opt(o, "radius", "r", 4);
    const minR = opt(o, "minRadius", "minr", 0);
    const out = [];
    for (let i = 0; i < opt(o, "amount", "a", 1); i++) {
      const ang = rng.next() * Math.PI * 2;
      const d = Math.sqrt(minR * minR + rng.next() * (r * r - minR * minR));
      const p = { x: l.x + Math.cos(ang) * d, y: l.y, z: l.z + Math.sin(ang) * d };
      if (o.onSurface) p.y = a.surfaceY(ctx.boss.dimension, p);
      out.push(a.location(p));
    }
    return out;
  },
};
