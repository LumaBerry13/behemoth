// The caster turns to the rotation of its (first) target (MythicMobs
// matchrotation, e.g. a slash effect matching its boss via @Parent).
// o: { pitch?=false } also copy the pitch

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "matchRotation",
  defaultTargeter: "@Parent",
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets.find((x) => a.isEntity(x));
    if (!t || !a.isEntity(t)) return;
    const r = a.getRotation(t);
    a.setRotation(ctx.caster, o.pitch ? r.x : a.getRotation(ctx.caster).x, r.y);
  },
};
