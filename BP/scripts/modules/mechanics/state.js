// Plays a configured animation on the caster (design doc §6).
// o: { anim, controller?="mb_action", blendOut? (seconds), nextState?, lock?=false, wait?=false }
//   lock — keep the casting lock until the animation ends
//   wait — pause this skill's sequence until the animation ends
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "state",
  validate(o, vctx) {
    const errors = [];
    if (typeof o.anim !== "string") errors.push("`anim` (animation key) is required");
    else if (!vctx.config.animations?.[o.anim]) errors.push(`animation "${o.anim}" not found in config.animations`);
    return errors;
  },
  execute(ctx, _targets, o) {
    const length = ctx.boss.playAnim(o.anim, {
      controller: o.controller,
      blendOutTime: o.blendOut,
      nextState: o.nextState,
      lock: !!o.lock,
    });
    return o.wait ? length : 0;
  },
};
