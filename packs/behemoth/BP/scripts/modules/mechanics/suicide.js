// The caster dies (MythicMobs suicide): its death skills and drops run.
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "suicide",
  defaultTargeter: "@self",
  execute(ctx) {
    const a = ctx.services.adapter;
    ctx.boss.setInvulnerable(false);
    a.applyDamage(ctx.caster, a.getHealth(ctx.caster).max * 10 + 1000, undefined, "selfDestruct");
  },
};
