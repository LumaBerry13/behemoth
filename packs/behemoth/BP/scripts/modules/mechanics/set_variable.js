// Sets or adds to a variable (MythicMobs setvar). `name` (or `var`) may carry a
// scope: caster.x (default), target.x (each entity target), trigger.x, skill.x,
// global.x. `type` converts the value (int/float/string/boolean); `duration`
// removes the variable again after that many ticks. Values may use
// <placeholders>, e.g. value="<caster.var.dwindle>".
// o: { name, value?, add?, type?, duration? }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setVariable",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    const name = o.name ?? o.var;
    if (typeof name !== "string" || !name) errors.push("`name` is required");
    const value = o.value ?? o.val;
    if (value === undefined && typeof o.add !== "number") errors.push("needs `value` or a numeric `add`");
    if (o.duration !== undefined && (!Number.isInteger(o.duration) || o.duration < 1)) errors.push("`duration` must be a positive integer (ticks)");
    return errors;
  },
  execute(ctx, targets, o) {
    const vars = ctx.services.vars;
    const name = String(o.name ?? o.var);
    const a = ctx.services.adapter;
    /** @param {import("../../types/config").Target} [t] */
    const setOne = (t) => {
      const value = o.add !== undefined ? (Number(vars.get(ctx, name, t)) || 0) + o.add : (o.value ?? o.val);
      vars.set(ctx, name, value, { type: o.type, durationTicks: o.duration, target: t });
    };
    if (/^target\./i.test(name)) {
      for (const t of targets) if (a.isEntity(t)) setOne(t);
    } else setOne();
  },
};
