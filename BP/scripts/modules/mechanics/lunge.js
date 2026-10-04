// Dashes the caster toward the first target, staying low (a flat leap).
// o: { velocity?=1.2 (blocks/tick), height?=0.1 }
import { flatDirection } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "lunge",
  defaultTargeter: "@target",
  validate(o) {
    return o.velocity === undefined || typeof o.velocity === "number" ? [] : ["`velocity` must be a number"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets[0];
    if (!t || !ctx.caster.isValid) return;
    const dir = flatDirection(ctx.caster.location, a.locOf(t));
    const v = o.velocity ?? 1.2;
    a.clearVelocity(ctx.caster);
    a.push(ctx.caster, { x: dir.x * v, y: o.height ?? 0.1, z: dir.z * v });
  },
};
