// Pushes entity targets by a fixed vector (blocks/tick). With relative=true,
// x/z are in the caster's yaw frame (+z forward, +x left).
// o: { x?=0, y?=0, z?=0, relative?=false, clear?=false }
import { rotateYaw } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "velocity",
  defaultTargeter: "@self",
  validate(o) {
    return ["x", "y", "z"].filter((k) => o[k] !== undefined && typeof o[k] !== "number").map((k) => `\`${k}\` must be a number`);
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    let v = { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0 };
    if (o.relative) v = rotateYaw(v, a.getYaw(ctx.caster));
    for (const t of targets) {
      if (!a.isEntity(t)) continue;
      if (o.clear) a.clearVelocity(t);
      a.push(t, v);
    }
  },
};
