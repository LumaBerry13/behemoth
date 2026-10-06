// Launches the caster toward the first target.
// o: { velocity?=1.0 (horizontal), height?=0.6 (vertical) }
import { flatDirection, distance } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "leap",
  defaultTargeter: "@target",
  validate(o) {
    const errors = [];
    if (o.velocity !== undefined && typeof o.velocity !== "number") errors.push("`velocity` must be a number");
    if (o.height !== undefined && typeof o.height !== "number") errors.push("`height` must be a number");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets[0];
    if (!t || !ctx.caster.isValid) return;
    const from = ctx.caster.location;
    const to = a.locOf(t);
    if (distance(from, to) < 0.5) return;
    const dir = flatDirection(from, to);
    const v = o.velocity ?? 1.0;
    a.clearVelocity(ctx.caster);
    a.push(ctx.caster, { x: dir.x * v, y: o.height ?? 0.6, z: dir.z * v });
  },
};
