// @SelfLocation{x=0;y=0;z=0} — the caster's position (works after death), with an optional offset.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "SelfLocation",
  resolve(ctx, o) {
    const l = ctx.boss.location;
    return [ctx.services.adapter.location({ x: l.x + (o.x ?? 0), y: l.y + (o.y ?? 0), z: l.z + (o.z ?? 0) })];
  },
};
