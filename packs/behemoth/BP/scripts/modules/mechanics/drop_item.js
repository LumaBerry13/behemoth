// Drops items on the ground at each target (MythicMobs `dropitem`).
// o: { items: [{ item (Bedrock item id), amount?=1 }] }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "dropItem",
  defaultTargeter: "@self",
  validate(o) {
    if (!Array.isArray(o.items) || !o.items.length) return ["`items` must be a non-empty list of { item, amount }"];
    const errors = [];
    for (const it of o.items) {
      if (!it || typeof it.item !== "string" || !it.item) errors.push("every item needs an `item` id");
      else if (it.amount !== undefined && (!Number.isInteger(it.amount) || it.amount < 1)) errors.push(`${it.item}: \`amount\` must be an integer ≥ 1`);
    }
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      const loc = a.locOf(t);
      for (const it of o.items) {
        if (!a.spawnItem(ctx.boss.dimension, it.item, it.amount ?? 1, loc)) ctx.services.log.warn(`dropItem: "${it.item}" failed to spawn`);
      }
    }
  },
};
