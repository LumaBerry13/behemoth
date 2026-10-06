// Pauses the sequence until a named marker of the current animation is reached.
// o: { marker }
// Continues immediately (debug log) if no playing animation has that marker,
// or if the marker has already passed.
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "waitMarker",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (typeof o.marker !== "string") return ["`marker` is required"];
    const found = Object.values(vctx.config.animations ?? {}).some((an) => an.markers?.[o.marker] !== undefined);
    return found ? [] : [`no animation in config.animations defines marker "${o.marker}"`];
  },
  execute(ctx, _targets, o) {
    const anim = ctx.boss.anim;
    const at = anim?.data.markers?.[o.marker];
    if (!anim || at === undefined) {
      ctx.services.log.debug(`waitMarker "${o.marker}": not in current animation, skipped`);
      return 0;
    }
    return Math.max(0, at - ctx.boss.animTick());
  },
};
