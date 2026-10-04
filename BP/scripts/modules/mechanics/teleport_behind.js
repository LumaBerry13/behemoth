// Teleports the caster behind the first entity target, facing its back.
// o: { distance?=1.5 }
import { rotateYaw } from "../../core/vec.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "teleportBehind",
  defaultTargeter: "@target",
  validate(o) {
    return o.distance === undefined || (typeof o.distance === "number" && o.distance > 0) ? [] : ["`distance` must be > 0"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets.find((x) => a.isEntity(x));
    if (!t || !a.isEntity(t)) return;
    const back = rotateYaw({ x: 0, y: 0, z: -(o.distance ?? 1.5) }, a.getYaw(t));
    const l = t.location;
    a.teleport(ctx.caster, { x: l.x + back.x, y: l.y, z: l.z + back.z }, a.getHeadLocation(t));
  },
};
