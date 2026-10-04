// Damage equal to a fraction of each target's max (or current) health
// (MythicMobs `percentDamage`).
// o: { percent (0–1), current?=false, cause?="entityAttack" }
import { dealDamage } from "../shared/deal_damage.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "percentDamage",
  defaultTargeter: "@target",
  validate(o) {
    return typeof o.percent === "number" && o.percent > 0 && o.percent <= 1 ? [] : ["`percent` must be 0–1"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (!a.isEntity(t) || !a.hasHealth(t)) continue;
      const h = a.getHealth(t);
      dealDamage(ctx, t, (o.current ? h.current : h.max) * o.percent, o.cause);
    }
  },
};
