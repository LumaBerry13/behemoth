// Removes every status effect from entity targets (MythicMobs `potionclear`).
// o: {}
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "potionClear",
  defaultTargeter: "@self",
  validate() {
    return [];
  },
  execute(ctx, targets) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t)) a.clearEffects(t);
  },
};
