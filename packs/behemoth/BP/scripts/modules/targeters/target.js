// @target — the boss's current target (highest threat, else nearest player in range).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "target",
  resolve(ctx) {
    const t = ctx.boss.getTarget();
    return t ? [t] : [];
  },
};
