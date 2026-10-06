// @Line{spacing=1} — points every `spacing` blocks on the straight line from
// the caster to its current target (MythicMobs @Line), e.g. for a row of
// explosions or effects.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "Line",
  validate(o) {
    const s = o.spacing ?? 1;
    return typeof s === "number" && s > 0.1 ? [] : ["`spacing` must be > 0.1"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const t = ctx.inherited?.[0] ?? ctx.boss.getTarget();
    if (!t) return [];
    const from = ctx.boss.location;
    const to = a.locOf(t);
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const s = o.spacing ?? 1;
    const out = [];
    for (let d = s; d <= len + 1e-6 && out.length < 128; d += s) {
      const k = d / len;
      out.push(a.location({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }));
    }
    return out;
  },
};
