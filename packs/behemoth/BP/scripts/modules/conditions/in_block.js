// inBlock{blocks=water|lava} — the caster's block (at its feet) matches one of
// the names. Matching is by substring, so "water" also matches flowing_water.
/** @type {import("../../types/config").Condition} */
export default {
  name: "inBlock",
  validate(args) {
    return typeof args.blocks === "string" && args.blocks ? [] : ["use the form inBlock{blocks=water|lava}"];
  },
  test(ctx, _target, args) {
    const id = ctx.services.adapter.getBlockTypeId(ctx.boss.dimension, ctx.boss.location);
    return String(args.blocks).split("|").some((b) => b && id.includes(b.trim()));
  },
};
