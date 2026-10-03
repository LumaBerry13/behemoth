// hasTarget — the boss currently has a valid target.
/** @type {import("../../types/config").Condition} */
export default {
  name: "hasTarget",
  test(ctx) {
    return !!ctx.boss.getTarget();
  },
};
