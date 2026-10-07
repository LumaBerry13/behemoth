// Hides or shows model parts of the caster (ModelEngine `partvis`: vanishing,
// dissolving on death). The parts must be listed in config.parts (at most 16);
// their state goes to the int entity property bhm:hidden_parts (bit i = parts[i]
// hidden), which the entity's render controller turns into part_visibility
// (the converter generates both). Hiding a bone hides its children too.
// o: { part: "torso" | ["left_leg", "right_leg"], visible?=false }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "partVisibility",
  defaultTargeter: "@self",
  validate(o, vctx) {
    const parts = Array.isArray(o.part) ? o.part : [o.part];
    if (!parts.length || parts.some((p) => typeof p !== "string" || !p)) return ["`part` must be a bone name or a list of them"];
    const known = vctx.config.parts ?? [];
    const missing = parts.filter((p) => !known.includes(p));
    return missing.length ? [`part(s) ${missing.join(", ")} not listed in config.parts`] : [];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const parts = Array.isArray(o.part) ? o.part : [o.part];
    for (const t of targets) {
      const inst = a.isEntity(t) ? ctx.services.bosses.get(t.id) : undefined;
      if (inst) for (const p of parts) inst.setPartVisible(p, !!o.visible);
    }
  },
};
