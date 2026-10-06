// Explosion at each target (MythicMobs explosion). By default it breaks no
// blocks and sets no fire; breakBlocks also needs the mobGriefing game rule.
// Players are hurt by the vanilla explosion; the boss itself is the source
// (so it is not hurt and its friendly-fire rules apply).
// o: { power?=3, breakBlocks?=false, fire?=false }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "explosion",
  defaultTargeter: "@SelfLocation",
  validate(o) {
    const p = o.power ?? 3;
    return typeof p === "number" && p > 0 && p <= 16 ? [] : ["`power` must be 0–16"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const breaks = !!o.breakBlocks && a.mobGriefing();
    for (const t of targets) {
      a.createExplosion(ctx.boss.dimension, a.locOf(t), o.power ?? 3, { breaksBlocks: breaks, causesFire: !!o.fire, source: ctx.caster });
    }
  },
};
