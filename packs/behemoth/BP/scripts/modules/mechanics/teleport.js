// Teleports the caster to the first target (MythicMobs `teleport`).
// o: { y?=0 } extra height
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "teleport",
  defaultTargeter: "@target",
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets[0];
    if (!t) return;
    const l = a.locOf(t);
    a.teleport(ctx.caster, { x: l.x, y: l.y + (o.y ?? 0), z: l.z });
  },
};
