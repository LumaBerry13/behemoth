// @RandomPlayer{r=16} — one random survival/adventure player in range.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "RandomPlayer",
  resolve(ctx, o) {
    const r = typeof o.r === "number" ? o.r : ctx.boss.targetRange;
    const p = ctx.services.random.pick(ctx.services.adapter.getTargetablePlayers(ctx.boss.dimension, ctx.boss.location, r));
    return p ? [p] : [];
  },
};
