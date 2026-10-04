// Places temporary blocks in a flat disc around each target, on air only, then
// turns them back to air after `ticks`. Respects the mobGriefing game rule
// unless `force`. Pending restores survive reloads (BossManager.placeTempBlocks).
// o: { block, radius?=2, ticks?=100, y?=0, force?=false }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "tempBlocks",
  defaultTargeter: "@SelfLocation",
  validate(o) {
    const errors = [];
    if (typeof o.block !== "string" || !o.block.includes(":")) errors.push("`block` must be a namespaced block id");
    if (o.radius !== undefined && (typeof o.radius !== "number" || o.radius < 0 || o.radius > 8)) errors.push("`radius` must be 0–8");
    if (o.ticks !== undefined && (!Number.isInteger(o.ticks) || o.ticks < 1)) errors.push("`ticks` must be a positive integer");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const r = o.radius ?? 2;
    for (const t of targets) {
      const c = a.locOf(t);
      const locs = [];
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
          if (dx * dx + dz * dz <= r * r) locs.push({ x: c.x + dx, y: c.y + (o.y ?? 0), z: c.z + dz });
        }
      }
      ctx.services.bosses.placeTempBlocks(ctx.boss.dimension, locs, o.block, o.ticks ?? 100, !!o.force);
    }
  },
};
