// lineOfSight — no solid block between the caster's head and its current
// target's head. False without a target.
/** @type {import("../../types/config").Condition} */
export default {
  name: "lineOfSight",
  test(ctx) {
    const a = ctx.services.adapter;
    const t = ctx.boss.getTarget();
    if (!t || !ctx.caster.isValid) return false;
    return a.lineOfSight(ctx.boss.dimension, a.getHeadLocation(ctx.caster), a.getHeadLocation(t));
  },
};
