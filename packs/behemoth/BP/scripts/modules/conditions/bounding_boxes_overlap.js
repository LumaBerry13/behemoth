// boundingBoxesOverlap{w=2;h=4.5} — the target's box touches the caster's (MythicMobs
// boundingboxesoverlap, e.g. pushing players out of a boss's body). The Script API does not
// expose collision boxes, so the caster's size is given (the converter writes the entity's
// collision box) and entities count as 0.6 wide, 1.8 tall [VERIFY for non-player targets].
const TARGET_W = 0.6;
const TARGET_H = 1.8;

/** @type {import("../../types/config").Condition} */
export default {
  name: "boundingBoxesOverlap",
  validate(args) {
    const errors = [];
    for (const k of ["w", "h"]) if (typeof args[k] !== "number" || args[k] <= 0) errors.push(`\`${k}\` must be > 0 (the caster's collision box)`);
    return errors;
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    if (!a.isEntity(target) || target.id === ctx.caster.id) return false;
    const c = ctx.caster.location;
    const t = target.location;
    const reach = (Number(args.w) + TARGET_W) / 2;
    if (Math.abs(t.x - c.x) > reach || Math.abs(t.z - c.z) > reach) return false;
    return t.y < c.y + Number(args.h) && t.y + TARGET_H > c.y;
  },
};
