// moving — the caster is moving horizontally.
const MIN_SPEED = 0.02; // blocks/tick

/** @type {import("../../types/config").Condition} */
export default {
  name: "moving",
  test(ctx) {
    const v = ctx.services.adapter.getVelocity(ctx.caster);
    return Math.hypot(v.x, v.z) > MIN_SPEED;
  },
};
