// Draws a flat, pulsing warning circle on the ground at each target for
// `duration` ticks (framework particle bhm:telegraph), so players see where
// an attack will land. Time the attack itself with a line `delay` equal to
// the duration. Placed on the ground below the target unless onSurface=false.
// o: { radius?=3, duration?=20, color?="#FF3333", onSurface?=true }
import { parseColor } from "../shared/particle_vars.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "telegraph",
  defaultTargeter: "@TargetLocation",
  validate(o) {
    const errors = [];
    if (o.radius !== undefined && (typeof o.radius !== "number" || o.radius <= 0)) errors.push("`radius` must be > 0");
    if (o.duration !== undefined && (!Number.isInteger(o.duration) || o.duration < 1)) errors.push("`duration` must be a positive integer (ticks)");
    if (o.color !== undefined && !parseColor(o.color)) errors.push("`color` must be #RRGGBB or #RRGGBBAA");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const dim = ctx.boss.dimension;
    const vars = {
      "variable.size": o.radius ?? 3,
      "variable.lifetime": (o.duration ?? 20) / 20,
      "variable.color": parseColor(o.color ?? "#FF3333") ?? { red: 1, green: 0.2, blue: 0.2, alpha: 1 },
    };
    const locs = targets.map((t) => {
      const l = a.locOf(t);
      return { x: l.x, y: (o.onSurface === false ? l.y : a.surfaceY(dim, l)) + 0.05, z: l.z };
    });
    a.spawnParticles(dim, "bhm:telegraph", locs, vars);
  },
};
