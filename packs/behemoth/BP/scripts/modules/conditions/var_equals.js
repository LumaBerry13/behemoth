// varEquals{var=caster.attacking;val=true} — a variable equals a value
// (MythicMobs varequals; compared as text, so true == "true"). A variable that
// is not set never matches. Scopes: caster (default), target, trigger, skill,
// global. `val` may contain <placeholders>.

/** @type {import("../../types/config").Condition} */
export default {
  name: "varEquals",
  validate(args) {
    const name = args.var ?? args.name;
    if (typeof name !== "string" || !name) return ["use the form varEquals{var=caster.x;val=1}"];
    return (args.val ?? args.value) === undefined ? ["`val` is required"] : [];
  },
  test(ctx, target, args) {
    const vars = ctx.services.vars;
    const name = String(args.var ?? args.name);
    const t = target === ctx.caster ? undefined : target;
    if (!vars.has(ctx, name, t)) return false;
    let want = String(args.val ?? args.value);
    if (want.includes("<")) want = vars.format(ctx, want, t);
    return String(vars.get(ctx, name, t)) === want;
  },
};
