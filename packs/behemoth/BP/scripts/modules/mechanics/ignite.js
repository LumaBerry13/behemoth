// Sets entity targets on fire.
// o: { ticks?=60 }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "ignite",
  defaultTargeter: "@target",
  validate(o) {
    return o.ticks === undefined || (Number.isInteger(o.ticks) && o.ticks > 0) ? [] : ["`ticks` must be a positive integer"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t) && t.id !== ctx.caster.id) a.ignite(t, (o.ticks ?? 60) / 20);
  },
};
