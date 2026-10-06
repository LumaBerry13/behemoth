// Adds a tag to each entity target.
// o: { tag }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "addTag",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.tag === "string" && o.tag ? [] : ["`tag` is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isEntity(t)) a.addTag(t, o.tag);
  },
};
