// @Bone{bone=edge4;x=0;y=-2;z=1} — a bone's pivot from baked tracks (ModelEngine
// @modelpart with o=model), plus an offset in the model's yaw frame
// (entity space, blocks: +Z forward, +X left, +Y up). Without a baked track or
// rest-pose entry for the bone, the boss position is used as the base.
import { rotateYaw } from "../../core/vec.js";

/** @param {unknown} v */
const num = (v) => (typeof v === "number" ? v : 0);

/** @type {import("../../types/config").Targeter} */
export default {
  name: "Bone",
  validate(o) {
    return typeof o.bone === "string" && o.bone ? [] : ["`bone` name is required"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const boss = ctx.boss;
    const off = rotateYaw({ x: num(o.x), y: num(o.y), z: num(o.z) }, a.getYaw(boss.entity));
    const base = boss.getBonePosition(o.bone) ?? boss.location;
    return [a.location({ x: base.x + off.x, y: base.y + off.y, z: base.z + off.z })];
  },
};
