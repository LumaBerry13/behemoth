// @PlayersInRing{min=4;max=10} — targetable players between two distances
// from the caster (MythicMobs @PlayersInRing).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "PlayersInRing",
  validate(o) {
    const min = o.min ?? 0;
    return typeof o.max === "number" && typeof min === "number" && min >= 0 && o.max > min ? [] : ["need 0 ≤ min < max"];
  },
  resolve(ctx, o) {
    const a = ctx.services.adapter;
    const l = ctx.boss.location;
    const min = o.min ?? 0;
    return a.getTargetablePlayers(ctx.boss.dimension, l, o.max)
      .filter((p) => Math.hypot(p.location.x - l.x, p.location.y - l.y, p.location.z - l.z) >= min);
  },
};
