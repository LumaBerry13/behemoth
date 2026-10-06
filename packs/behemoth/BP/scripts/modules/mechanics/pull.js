// Pulls entity targets toward the caster.
// o: { velocity?=0.8 (blocks/tick), height?=0.2 }
import { flatDirection } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "pull",
  defaultTargeter: "@target",
  validate(o) {
    return o.velocity === undefined || typeof o.velocity === "number" ? [] : ["`velocity` must be a number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const to = ctx.boss.location;
    const v = o.velocity ?? 0.8;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      const dir = flatDirection(t.location, to);
      a.push(t, { x: dir.x * v, y: o.height ?? 0.2, z: dir.z * v });
    }
  },
};
