// @PlayersInRadius{r=10;limit=0} — survival/adventure players around the caster.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "PlayersInRadius",
  validate(o) {
    return typeof o.r === "number" && o.r > 0 ? [] : ["`r` (radius) must be a positive number"];
  },
  resolve(ctx, o) {
    const players = ctx.services.adapter.getTargetablePlayers(ctx.boss.dimension, ctx.boss.location, o.r);
    return o.limit > 0 ? players.slice(0, o.limit) : players;
  },
};
