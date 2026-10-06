// hasEffect{effect=slowness} — the target has this potion effect (MythicMobs haspotioneffect).
// Tests the target it is given (skill `if`: the caster; `targetIf`: each target).
/** @type {import("../../types/config").Condition} */
export default {
  name: "hasEffect",
  validate(args) {
    return typeof (args.effect ?? args.type) === "string" ? [] : ["use the form hasEffect{effect=slowness}"];
  },
  test(ctx, target, args) {
    const a = ctx.services.adapter;
    if (!a.isEntity(target)) return false;
    return a.hasEffect(target, String(args.effect ?? args.type));
  },
};
