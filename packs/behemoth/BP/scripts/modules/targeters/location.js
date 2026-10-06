// @Location{x=10;y=64;z=-5} — a fixed world position (MythicMobs @Location),
// in the caster's dimension. relative=true makes it an offset from the boss's
// spawn point (arena layouts that move with the spawn).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "Location",
  validate(o) {
    return ["x", "y", "z"].every((k) => typeof o[k] === "number") ? [] : ["`x`, `y` and `z` are required"];
  },
  resolve(ctx, o) {
    const base = o.relative ? ctx.boss.spawnPoint : { x: 0, y: 0, z: 0 };
    return [ctx.services.adapter.location({ x: base.x + o.x, y: base.y + o.y, z: base.z + o.z })];
  },
};
