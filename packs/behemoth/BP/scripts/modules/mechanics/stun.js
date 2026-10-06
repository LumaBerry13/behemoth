// Stuns entity targets for `duration` ticks (MythicMobs stun): Behemoth
// entities stop moving, turning and using their AI, then return to their
// previous state. Players and other mobs get maximum slowness for the
// duration. [VERIFY] slowness 255 roots players.
// o: { duration }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "stun",
  defaultTargeter: "@target",
  validate(o) {
    const d = o.duration ?? o.ticks;
    return Number.isInteger(d) && d > 0 ? [] : ["`duration` must be a positive integer (ticks)"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    const d = o.duration ?? o.ticks;
    for (const t of targets) {
      if (!a.isEntity(t)) continue;
      const inst = ctx.services.bosses.get(t.id);
      if (inst) inst.stun(d);
      else a.addEffect(t, "slowness", d, 255);
    }
  },
};
