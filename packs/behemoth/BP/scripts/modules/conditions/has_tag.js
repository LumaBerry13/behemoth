// hasTag{tag=enraged} — the checked entity (the caster for skill-level conditions) has a tag.
/** @type {import("../../types/config").Condition} */
export default {
  name: "hasTag",
  validate(args) {
    return typeof args.tag === "string" ? [] : ["use the form hasTag{tag=name}"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    return a.isEntity(target) && a.hasTag(target, String(args.tag));
  },
};
