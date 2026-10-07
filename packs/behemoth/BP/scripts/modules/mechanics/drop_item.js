// Loot from a skill (MythicMobs `dropitem`). Like the boss's drops it goes into the loot chest
// where the boss dies (D7): items dropped while it lives are kept until then, items dropped
// during the death sequence are added to that chest. config loot.mode "ground" drops them at
// each target instead. Once per target, so @self gives the items once.
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
    const items = o.items.map((it) => ({ item: it.item, amount: it.amount ?? 1 }));
    for (const t of targets) ctx.services.bosses.addLoot(ctx.boss, items, a.locOf(t));
  },
};
