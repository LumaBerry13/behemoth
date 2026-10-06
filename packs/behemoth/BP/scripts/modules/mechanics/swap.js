// Swaps places with the (first) target (MythicMobs swap).
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "swap",
  defaultTargeter: "@target",
  execute(ctx, targets) {
    const a = ctx.services.adapter;
    const t = targets.find((x) => a.isEntity(x));
    if (!t || !a.isEntity(t)) return;
    const mine = { ...ctx.caster.location };
    const theirs = { ...t.location };
    a.teleport(ctx.caster, theirs);
    a.teleport(t, mine);
  },
};
