// Removes entity targets from the world (MythicMobs remove): no death, no
// drops. Behemoth entities are torn down properly (their summons go too).
// Players are never removed. Typical use: an effect entity removing itself.

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "remove",
  defaultTargeter: "@self",
  execute(ctx, targets) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t)) ctx.services.bosses.removeEntity(t);
  },
};
