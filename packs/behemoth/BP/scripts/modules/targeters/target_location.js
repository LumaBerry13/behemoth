// @TargetLocation{y=0} — the current target's position, captured at resolve time.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "TargetLocation",
  resolve(ctx, o) {
    const t = ctx.boss.getTarget();
    if (!t) return [];
    const l = t.location;
    return [ctx.services.adapter.location({ x: l.x + (o.x ?? 0), y: l.y + (o.y ?? 0), z: l.z + (o.z ?? 0) })];
  },
};
