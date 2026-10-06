// Spawns a particle at each target (entities: at their location + yOffset).
// o: { particle, count?=1, spread?=0, yOffset?=0, vars? }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "particle",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.particle === "string" ? [] : ["`particle` id is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const count = o.count ?? 1;
    const spread = o.spread ?? 0;
    const yOff = o.yOffset ?? 0;
    const locs = [];
    for (const t of targets) {
      const l = a.locOf(t);
      for (let i = 0; i < count; i++) {
        locs.push({
          x: l.x + (spread ? (rng.next() * 2 - 1) * spread : 0),
          y: l.y + yOff + (spread ? rng.next() * spread : 0),
          z: l.z + (spread ? (rng.next() * 2 - 1) * spread : 0),
        });
      }
    }
    a.spawnParticles(ctx.boss.dimension, o.particle, locs, o.vars);
  },
};
