// @Forward{f=3;y=0} — the point f blocks in front of the caster (negative =
// behind), using body yaw, raised by y. MythicMobs @forward with lockpitch.
import { rotateYaw } from "../../core/vec.js";

/** @type {import("../../types/config").Targeter} */
export default {
  name: "Forward",
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const l = ctx.boss.location;
    const d = rotateYaw({ x: 0, y: 0, z: typeof o.f === "number" ? o.f : 1 }, a.getYaw(ctx.boss.entity));
    return [a.location({ x: l.x + d.x, y: l.y + (typeof o.y === "number" ? o.y : 0), z: l.z + d.z })];
  },
};
