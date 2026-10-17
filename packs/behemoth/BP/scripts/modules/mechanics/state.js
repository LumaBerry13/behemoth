// Plays a configured animation on the caster (design doc §6).
// o: { anim, controller?="bhm_action", layer?, stop?=false, blendOut? (seconds), nextState?, lock?=false, wait?=false }
//   layer — play it on its own layer (controller bhm_layer_<n>) on top of the action animation
//           (MythicMobs state with a priority: looping strafe / walk layers)
//   stop  — stop this animation wherever it plays (MythicMobs state{r=true})
//   lock — keep the casting lock until the animation ends
//   wait — pause this skill's sequence until the animation ends
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "state",
  validate(o, vctx) {
    const errors = [];
    if (typeof o.anim !== "string") errors.push("`anim` (animation key) is required");
    else if (!vctx.config.animations?.[o.anim]) errors.push(`animation "${o.anim}" not found in config.animations`);
    if (o.layer !== undefined && (!Number.isInteger(o.layer) || o.layer < 0)) errors.push("`layer` must be an integer ≥ 0");
    return errors;
  },
  execute(ctx, _targets, o) {
    if (o.stop) {
      ctx.boss.stopAnim(o.anim, o.blendOut);
      return 0;
    }
    const length = ctx.boss.playAnim(o.anim, {
      controller: o.layer !== undefined ? `bhm_layer_${o.layer}` : o.controller,
      blendOutTime: o.blendOut,
      nextState: o.nextState,
      lock: !!o.lock,
    });
    return o.wait ? length : 0;
  },
};
