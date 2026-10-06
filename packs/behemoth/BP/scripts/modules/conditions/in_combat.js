// inCombat — the caster has a target (threat or a targetable player in range).
/** @type {import("../../types/config").Condition} */
export default {
  name: "inCombat",
  test(ctx) {
    return !ctx.boss.dead && ctx.boss.getTarget() !== undefined;
  },
};
