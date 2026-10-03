// @EntitiesInRadius{r=4} — living entities around the caster, excluding the caster,
// its summons, and creative/spectator players.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "EntitiesInRadius",
  validate(o) {
    return typeof o.r === "number" && o.r > 0 ? [] : ["`r` (radius) must be a positive number"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const all = a.getEntities(ctx.boss.dimension, {
      location: ctx.boss.location,
      maxDistance: o.r,
      excludeTags: ["mb_summon"],
    });
    return all.filter(
      (e) => e.id !== ctx.caster.id && a.hasHealth(e) && (!a.isPlayer(e) || a.isTargetablePlayer(e))
    );
  },
};
