// @NearestPlayer{r=32} — closest survival/adventure player.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "NearestPlayer",
  resolve(ctx, o) {
    const r = typeof o.r === "number" ? o.r : ctx.boss.targetRange;
    const loc = ctx.boss.location;
    let best;
    let bestD = Infinity;
    for (const p of ctx.services.adapter.getTargetablePlayers(ctx.boss.dimension, loc, r)) {
      const d = Math.hypot(p.location.x - loc.x, p.location.y - loc.y, p.location.z - loc.z);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best ? [best] : [];
  },
};
