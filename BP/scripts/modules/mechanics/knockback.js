// Knocks entity targets away from the caster (blocks/tick; `throw` takes
// MythicMobs units instead).
// o: { velocity?=0.8, height?=0.3 }
import { flatDirection } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "knockback",
  defaultTargeter: "@target",
  validate(o) {
    return o.velocity === undefined || typeof o.velocity === "number" ? [] : ["`velocity` must be a number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const from = ctx.boss.location;
    const v = o.velocity ?? 0.8;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      const dir = flatDirection(from, t.location);
      a.push(t, { x: dir.x * v, y: o.height ?? 0.3, z: dir.z * v });
    }
  },
};
