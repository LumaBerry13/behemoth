// Pushes the caster horizontally toward the first target (MythicMobs `propel`,
// with lockpitch). Use with @Forward{f=-8} for a backward jump.
// o: { velocity?=1 (blocks/tick), height?=0.2 }
import { flatDirection } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "propel",
  defaultTargeter: "@target",
  validate(o) {
    return o.velocity === undefined || typeof o.velocity === "number" ? [] : ["`velocity` must be a number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets[0];
    if (!t || !ctx.caster.isValid) return;
    const dir = flatDirection(ctx.caster.location, a.locOf(t));
    const v = o.velocity ?? 1;
    a.clearVelocity(ctx.caster);
    a.push(ctx.caster, { x: dir.x * v, y: o.height ?? 0.2, z: dir.z * v });
  },
};
