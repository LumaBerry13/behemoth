// Applies a status effect to entity targets (MythicMobs `potion`).
// o: { effect (Bedrock id, e.g. "slowness"), ticks, amplifier?=0 }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "potion",
  defaultTargeter: "@target",
  validate(o) {
    const errors = [];
    if (typeof o.effect !== "string") errors.push("`effect` (Bedrock effect id) is required");
    if (!Number.isInteger(o.ticks) || o.ticks < 1) errors.push("`ticks` must be a positive integer");
    if (o.amplifier !== undefined && (!Number.isInteger(o.amplifier) || o.amplifier < 0)) errors.push("`amplifier` must be an integer ≥ 0");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      try {
        a.addEffect(t, o.effect, o.ticks, o.amplifier ?? 0);
      } catch {
        ctx.services.log.warn(`potion: unknown effect "${o.effect}"`);
      }
    }
  },
};
