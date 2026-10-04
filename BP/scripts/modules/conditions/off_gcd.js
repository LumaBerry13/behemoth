// offGcd — the boss's global cooldown (set by the `gcd` mechanic) has expired.
/** @type {import("../../types/config").Condition} */
export default {
  name: "offGcd",
  test(ctx) {
    return ctx.boss.gcdUntil <= ctx.services.scheduler.tick;
  },
};
