// Teleports the caster to the first target (MythicMobs `teleport`). With setY the height is that
// absolute value instead (MythicMobs teleportY, e.g. t=@self to sink an effect mob out of sight).
// o: { y?=0 } extra height, { setY? } absolute height
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "teleport",
  defaultTargeter: "@target",
  validate(o) {
    if (o.setY !== undefined && typeof o.setY !== "number") return ["`setY` must be a number (absolute height)"];
    return [];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const t = targets[0];
    if (!t) return;
    const l = a.locOf(t);
    a.teleport(ctx.caster, { x: l.x, y: o.setY ?? l.y + (o.y ?? 0), z: l.z });
  },
};
