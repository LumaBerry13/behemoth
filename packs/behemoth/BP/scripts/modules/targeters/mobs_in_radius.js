// @MobsInRadius{r=8;type=minecraft:zombie} — living non-player entities around
// the caster (optionally of one type), excluding the caster, summons and other
// Behemoth bosses (MythicMobs @MobsInRadius).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "MobsInRadius",
  validate(o) {
    return typeof o.r === "number" && o.r > 0 ? [] : ["`r` (radius) must be a positive number"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    return a.getEntities(ctx.boss.dimension, {
      location: ctx.boss.location, maxDistance: o.r, excludeTags: ["bhm_summon"], ...(o.type ? { type: String(o.type) } : {}),
    }).filter((e) => e.id !== ctx.caster.id && !a.isPlayer(e) && a.hasHealth(e) && !ctx.services.bosses.get(e.id));
  },
};
