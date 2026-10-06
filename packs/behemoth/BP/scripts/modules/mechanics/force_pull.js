// Teleports entity targets next to the caster (MythicMobs forcepull).
// o: { spread?=1 } random horizontal offset in blocks
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "forcePull",
  defaultTargeter: "@target",
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const rng = ctx.services.random;
    const l = ctx.boss.location;
    const s = o.spread ?? 1;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      a.teleport(t, { x: l.x + (rng.next() - 0.5) * 2 * s, y: l.y, z: l.z + (rng.next() - 0.5) * 2 * s });
    }
  },
};
