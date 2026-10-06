// entityType{types=minecraft:zombie|minecraft:husk} — the target's entity type is one of these.
// Tests the target it is given (skill `if`: the caster; `targetIf`: each target).
/** @type {import("../../types/config").Condition} */
export default {
  name: "entityType",
  validate(args) {
    return typeof (args.types ?? args.type) === "string" ? [] : ["use the form entityType{types=minecraft:zombie|minecraft:husk}"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    if (!a.isEntity(target)) return false;
    const types = String(args.types ?? args.type).split(/[|,]/).map((s) => s.trim());
    return types.includes(target.typeId);
  },
};
