// variable{name=x;eq=3} — compare a boss variable (set by setVariable).
// One of: eq, ne, gt, ge, lt, le. Missing variables count as 0 for numeric
// comparisons; eq/ne also compare strings and booleans.
const OPS = { eq: "==", ne: "!=", gt: ">", ge: ">=", lt: "<", le: "<=" };

/** @type {import("../../types/config").Condition} */
export default {
  name: "variable",
  validate(args) {
    if (typeof args.name !== "string") return ["use the form variable{name=x;eq=3}"];
    return Object.keys(OPS).some((k) => k in args) ? [] : ["needs one of eq, ne, gt, ge, lt, le"];
  },
  test(ctx, _target, args) {
    const v = ctx.boss.vars[String(args.name)];
    for (const [k] of Object.entries(OPS)) {
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
