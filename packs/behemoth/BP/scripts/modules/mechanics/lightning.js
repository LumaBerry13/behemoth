// Strikes vanilla lightning at each target location (vanilla damage and fire).
// o: {}
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "lightning",
  defaultTargeter: "@target",
  execute(ctx, targets) {
    const a = ctx.services.adapter;
    for (const t of targets) a.spawnEntity(ctx.boss.dimension, "minecraft:lightning_bolt", a.locOf(t));
  },
};
