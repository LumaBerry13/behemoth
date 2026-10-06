// lineOfSight — no solid block between the caster's head and its current
// target's head (in `targetIf`: the target being tested). False without a target.
/** @type {import("../../types/config").Condition} */
export default {
  name: "lineOfSight",
  test(ctx, target) {
    const a = ctx.services.adapter;
    const t = target === ctx.caster ? ctx.boss.getTarget() : target;
    if (!t || !ctx.caster.isValid) return false;
    const to = a.isEntity(t) ? a.getHeadLocation(t) : a.locOf(t);
    return a.lineOfSight(ctx.boss.dimension, a.getHeadLocation(ctx.caster), to);
  },
};
