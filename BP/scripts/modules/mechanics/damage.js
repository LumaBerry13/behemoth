// Deals flat damage to entity targets, scaled by config.stats.damageMultiplier
// (default 1). The caster never damages itself.
// o: { amount, cause?="entityAttack" }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "damage",
  defaultTargeter: "@target",
  validate(o) {
    return typeof o.amount === "number" && o.amount > 0 ? [] : ["`amount` must be a positive number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const amount = o.amount * (ctx.boss.config.stats?.damageMultiplier ?? 1);
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id || !a.hasHealth(t)) continue;
      const before = ctx.services.log.isDebug ? a.getHealth(t).current : 0;
      a.applyDamage(t, amount, ctx.caster, o.cause ?? "entityAttack");
      if (ctx.services.log.isDebug) {
        ctx.services.log.debug(`damage ${amount} → ${t.typeId}: hp ${before} → ${a.getHealth(t).current}`);
      }
    }
  },
};
