// Sets the boss's walking speed as a multiple of its entity-JSON speed
// (MythicMobs `setspeed`). 0 roots it in place without changing the AI group.
// o: { multiplier }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setSpeed",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.multiplier === "number" && o.multiplier >= 0 ? [] : ["`multiplier` must be a number ≥ 0"];
  },
  execute(ctx, _targets, o) {
    ctx.boss.setSpeed(o.multiplier);
  },
};
