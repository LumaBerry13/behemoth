// Sets the health of entity targets (MythicMobs sethealth). With percent=true
// `amount` is a fraction of max health (0.5 = half).
// o: { amount, percent?=false }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setHealth",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.amount === "number" && o.amount >= 0 ? [] : ["`amount` must be a number ≥ 0"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (!a.isEntity(t) || !a.hasHealth(t)) continue;
      const h = a.getHealth(t);
      a.setHealth(t, o.percent ? h.max * o.amount : o.amount);
    }
  },
};
