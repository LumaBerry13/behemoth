// variable{name=x;eq=3} — compare a variable (set by setVariable). One of:
// eq, ne, gt, ge, lt, le. `name` (or `var`) may carry a scope: caster.x
// (default), target.x, trigger.x, skill.x, global.x. Missing variables count
// as 0 for numeric comparisons; eq/ne also compare strings and booleans.
const OPS = { eq: "==", ne: "!=", gt: ">", ge: ">=", lt: "<", le: "<=" };

/** @type {import("../../types/config").Condition} */
export default {
  name: "variable",
  validate(args) {
    if (typeof (args.name ?? args.var) !== "string") return ["use the form variable{name=x;eq=3}"];
    return Object.keys(OPS).some((k) => k in args) ? [] : ["needs one of eq, ne, gt, ge, lt, le"];
  },
  test(ctx, target, args) {
    const v = ctx.services.vars.get(ctx, String(args.name ?? args.var), target === ctx.caster ? undefined : target);
    for (const k of Object.keys(OPS)) {
      if (!(k in args)) continue;
      const want = args[k];
      if (k === "eq") return v === want || Number(v ?? 0) === want;
      if (k === "ne") return !(v === want || Number(v ?? 0) === want);
      const n = Number(v ?? 0);
      const w = Number(want);
      return k === "gt" ? n > w : k === "ge" ? n >= w : k === "lt" ? n < w : n <= w;
    }
    return false;
  },
};
