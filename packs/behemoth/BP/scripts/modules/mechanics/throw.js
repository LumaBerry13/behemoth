// Knocks entity targets away from the caster (MythicMobs `throw`).
// Options use MythicMobs units: velocity and velocityY are divided by 10 to get
// blocks/tick. [VERIFY by feel against the Java original]
// o: { velocity?=1, velocityY?=1 }
import { flatDirection } from "../../core/vec.js";

const MM_SCALE = 0.1;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "throw",
  defaultTargeter: "@target",
  validate(o) {
    const errors = [];
    if (o.velocity !== undefined && typeof o.velocity !== "number") errors.push("`velocity` must be a number");
    if (o.velocityY !== undefined && typeof o.velocityY !== "number") errors.push("`velocityY` must be a number");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const from = ctx.boss.location;
    const v = (o.velocity ?? 1) * MM_SCALE;
    const vy = (o.velocityY ?? 1) * MM_SCALE;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      const dir = flatDirection(from, t.location);
      a.push(t, { x: dir.x * v, y: vy, z: dir.z * v });
    }
  },
};
