// Line of particles from the caster to each target.
// o: { particle, density?=4 (per block), fromY?=1.5, toY?=1, vars?, + particle library options (color, size, ...) }
import { line } from "../../core/vec.js";
import { particleVars, particleOptionErrors } from "../shared/particle_vars.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "particleLine",
  defaultTargeter: "@target",
  validate(o) {
    return [...(typeof o.particle === "string" ? [] : ["`particle` id is required"]), ...particleOptionErrors(o)];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const s = ctx.boss.location;
    const from = { x: s.x, y: s.y + (o.fromY ?? 1.5), z: s.z };
    for (const t of targets) {
      const l = a.locOf(t);
      a.spawnParticles(ctx.boss.dimension, o.particle, line(from, { x: l.x, y: l.y + (o.toY ?? 1), z: l.z }, o.density ?? 4), particleVars(o));
    }
  },
};
