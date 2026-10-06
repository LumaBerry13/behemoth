// Plays a sound at each target's location.
// o: { sound, volume?=1, pitch?=1 }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "sound",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.sound === "string" ? [] : ["`sound` id is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) a.playSound(ctx.boss.dimension, o.sound, a.locOf(t), o.volume ?? 1, o.pitch ?? 1);
  },
};
