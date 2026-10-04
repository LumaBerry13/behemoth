// Disables player targets' shields for a while (MythicMobs `shieldbreak`).
// o: { ticks }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "shieldBreak",
  defaultTargeter: "@target",
  validate(o) {
    return Number.isInteger(o.ticks) && o.ticks > 0 ? [] : ["`ticks` must be a positive integer"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isPlayer(t)) a.shieldCooldown(t, o.ticks);
  },
};
