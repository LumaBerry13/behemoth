// Sets the rotation of entity targets (MythicMobs setrotation). With
// relative=true, yaw/pitch are added to the current rotation. Degrees; yaw
// grows clockwise seen from above (Minecraft). A boss turns toward its target
// every tick unless ai.faceTarget is false or its facing is locked
// (lockFacing), which would undo this.
// o: { yaw?, pitch?, relative?=false }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "setRotation",
  defaultTargeter: "@self",
  validate(o) {
    const errors = [];
    if (o.yaw === undefined && o.pitch === undefined) errors.push("needs `yaw` and/or `pitch`");
    for (const k of ["yaw", "pitch"]) if (o[k] !== undefined && typeof o[k] !== "number") errors.push(`\`${k}\` must be a number`);
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (!a.isEntity(t) || a.isPlayer(t)) continue;
      const r = a.getRotation(t);
      const yaw = o.yaw === undefined ? r.y : o.relative ? r.y + o.yaw : o.yaw;
      const pitch = o.pitch === undefined ? r.x : o.relative ? r.x + o.pitch : o.pitch;
      a.setRotation(t, pitch, yaw);
    }
  },
};
