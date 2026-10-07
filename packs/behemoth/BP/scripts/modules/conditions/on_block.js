// onBlock{blocks=air|stone} — the block under the target's feet matches one of the names
// (MythicMobs onblock). Matching is by substring, like inBlock. Unloaded blocks never match.
// Tests the target it is given (skill `if`: the caster; `targetIf`: each target).
/** @type {import("../../types/config").Condition} */
export default {
  name: "onBlock",
  validate(args) {
    return typeof args.blocks === "string" && args.blocks ? [] : ["use the form onBlock{blocks=air|stone}"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    const loc = a.locOf(target);
    const id = a.getBlockTypeId(ctx.boss.dimension, { x: loc.x, y: loc.y - 0.1, z: loc.z });
    if (!id) return false;
    return String(args.blocks).split("|").some((b) => b && id.includes(b.trim()));
  },
};
