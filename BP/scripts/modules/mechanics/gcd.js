// Sets the boss's global cooldown (MythicMobs `gcd`). Pair with the `offGcd`
// condition to stop skills overlapping.
// o: { ticks }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "gcd",
  defaultTargeter: "@self",
  validate(o) {
    return Number.isInteger(o.ticks) && o.ticks >= 0 ? [] : ["`ticks` must be a non-negative integer"];
  },
  execute(ctx, _targets, o) {
    ctx.boss.gcdUntil = ctx.services.scheduler.tick + o.ticks;
  },
};
