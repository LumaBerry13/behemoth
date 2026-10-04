// Heals entity targets by a flat amount or a fraction of their max health.
// o: { amount? , percent? (0–1) } — one of them is required
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "heal",
  defaultTargeter: "@self",
  validate(o) {
    if (typeof o.amount === "number" && o.amount > 0) return [];
    if (typeof o.percent === "number" && o.percent > 0 && o.percent <= 1) return [];
    return ["needs `amount` > 0 or `percent` 0–1"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (!a.isEntity(t) || !a.hasHealth(t)) continue;
      const h = a.getHealth(t);
      a.setHealth(t, h.current + (o.amount ?? h.max * o.percent));
    }
  },
};
