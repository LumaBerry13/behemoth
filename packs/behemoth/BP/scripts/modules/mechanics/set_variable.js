// Sets or adds to a boss variable (persisted with the boss; read by the
// `variable` condition).
// o: { name, value? , add? } — `value` sets, `add` adds (numbers)
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setVariable",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    if (typeof o.name !== "string" || !o.name) errors.push("`name` is required");
    if (o.value === undefined && typeof o.add !== "number") errors.push("needs `value` or a numeric `add`");
    return errors;
  },
  execute(ctx, _targets, o) {
    const vars = ctx.boss.vars;
    if (o.add !== undefined) vars[o.name] = (Number(vars[o.name]) || 0) + o.add;
    else vars[o.name] = o.value;
  },
};
