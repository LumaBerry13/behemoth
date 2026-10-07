// Holds entity targets at a bone of the caster for `duration` ticks
// (ModelEngine MountModel on a seat bone, e.g. a hand that grabs a player).
// Bedrock cannot seat a player on a bone, so the target is teleported to the
// bone's baked position every tick and its velocity cleared; it is released
// when the time is up or the caster dies. The bone must have a baked track
// (the converter bakes the bones it maps). offsetY moves the held entity
// relative to the bone (negative = lower, e.g. -1 so the bone is at chest height).
// o: { bone, duration, offsetY?=-1 }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "grab",
  defaultTargeter: "@target",
  validate(o) {
    const errors = [];
    if (typeof o.bone !== "string" || !o.bone) errors.push("`bone` is required");
    if (!Number.isInteger(o.duration) || o.duration < 1) errors.push("`duration` must be a positive integer (ticks)");
    if (o.offsetY !== undefined && typeof o.offsetY !== "number") errors.push("`offsetY` must be a number");
    return errors;
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const { scheduler } = ctx.services;
    const boss = ctx.boss;
    const token = boss.token;
    const dy = o.offsetY ?? -1;
    for (const t of targets) {
      if (!a.isEntity(t) || t.id === ctx.caster.id) continue;
      let left = o.duration;
      const hold = () => {
        if (boss.destroyed || boss.dead || !t.isValid || left-- <= 0) return;
        const p = boss.getBonePosition(o.bone) ?? boss.location;
        a.teleport(t, { x: p.x, y: p.y + dy, z: p.z });
        a.clearVelocity(t);
        scheduler.after(1, hold, token);
      };
      hold();
    }
  },
};
