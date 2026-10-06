// sprinting — a sprinting player (MythicMobs sprinting).
// Tests the target it is given (skill `if`: the caster; `targetIf`: each target).
/** @type {import("../../types/config").Condition} */
export default {
  name: "sprinting",
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    if (!a.isEntity(target)) return false;
    return a.isSprinting(target);
  },
};
