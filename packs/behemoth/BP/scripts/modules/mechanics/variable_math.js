// variableMath{var=caster.n;eq="max(0, x - 0.5)"} — set a variable to the
// result of an expression where x is its current value (MythicMobs
// variablemath). Operators + - * / % ^, functions min max abs floor ceil round
// sqrt sin cos tan pow clamp. The expression may use <placeholders>.
// o: { var, eq, type?=float }
import { compileExpr } from "../shared/math_expr.js";

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "variableMath",
  defaultTargeter: "@self",
  validate(o) {
    const name = o.var ?? o.name;
    if (typeof name !== "string" || !name) return ["`var` is required"];
    const eq = o.eq ?? o.equation;
    if (eq === undefined) return ["`eq` (expression) is required"];
    try {
      compileExpr(String(eq));
      return [];
    } catch (e) {
      return [`eq: ${/** @type {Error} */ (e).message}`];
    }
  },
  execute(ctx, targets, o) {
    const vars = ctx.services.vars;
    const name = String(o.var ?? o.name);
    const a = ctx.services.adapter;
    const fn = compileExpr(String(o.eq ?? o.equation));
    /** @param {import("../../types/config").Target} [t] */
    const apply = (t) => {
      const result = fn(Number(vars.get(ctx, name, t)) || 0);
      if (Number.isFinite(result)) vars.set(ctx, name, result, { type: o.type ?? "float", target: t });
    };
    if (/^target\./i.test(name)) {
      for (const t of targets) if (a.isEntity(t)) apply(t);
    } else apply();
  },
};
