// @Parent — the entity that summoned the caster with `summon` (MythicMobs
// @parent), e.g. a minion targeting its boss. Empty if it is gone.

/** @type {import("../../types/config").Targeter} */
export default {
  name: "Parent",
  resolve(ctx) {
    const a = ctx.services.adapter;
    const id = a.getDynamic(ctx.caster, "bhm:parent");
    const e = typeof id === "string" ? a.getEntity(id) : undefined;
    return e?.isValid ? [e] : [];
  },
};
