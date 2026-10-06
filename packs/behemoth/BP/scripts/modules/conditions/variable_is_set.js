// variableIsSet{var=caster.strafe} — the variable exists (MythicMobs variableisset).
/** @type {import("../../types/config").Condition} */
export default {
  name: "variableIsSet",
  validate(args) {
    const name = args.var ?? args.name;
    return typeof name === "string" && name ? [] : ["use the form variableIsSet{var=caster.x}"];
  },
  test(ctx, target, args) {
    return ctx.services.vars.has(ctx, String(args.var ?? args.name), target === ctx.caster ? undefined : target);
  },
};
