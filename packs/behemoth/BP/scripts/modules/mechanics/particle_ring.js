// Horizontal ring of particles around each target.
// o: { particle, radius?=3, points?=16, yOffset?=0.1, vars? }
import { ring } from "../../core/vec.js";

const MAX_POINTS = 128;

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "particleRing",
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
    const yOff = o.yOffset ?? 0.1;
    for (const t of targets) {
      const l = a.locOf(t);
      const pts = ring({ x: l.x, y: l.y + yOff, z: l.z }, o.radius ?? 3, o.points ?? 16);
      a.spawnParticles(ctx.boss.dimension, o.particle, pts, o.vars);
    }
  },
};
