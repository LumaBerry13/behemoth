// Deals flat damage to entity targets. The caster never damages itself.
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
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id || !a.hasHealth(t)) continue;
      a.applyDamage(t, o.amount, ctx.caster, o.cause ?? "entityAttack");
    }
  },
};
