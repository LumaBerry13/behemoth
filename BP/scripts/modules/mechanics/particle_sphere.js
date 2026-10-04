// Sphere of particles around each target.
// o: { particle, radius?=2, points?=40, yOffset?=1, vars? }
import { sphere } from "../../core/vec.js";

const MAX_POINTS = 200;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "particleSphere",
  defaultTargeter: "@SelfLocation",
  validate(o) {
    const errors = [];
    if (typeof o.particle !== "string") errors.push("`particle` id is required");
    if (o.points !== undefined && (!Number.isInteger(o.points) || o.points < 1 || o.points > MAX_POINTS)) {
      errors.push(`\`points\` must be an integer 1–${MAX_POINTS}`);
    }
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      const l = a.locOf(t);
      a.spawnParticles(ctx.boss.dimension, o.particle, sphere({ x: l.x, y: l.y + (o.yOffset ?? 1), z: l.z }, o.radius ?? 2, o.points ?? 40), o.vars);
    }
  },
};
