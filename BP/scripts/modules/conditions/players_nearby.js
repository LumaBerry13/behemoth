// playersNearby{r=16;min=2;max=4} — number of survival/adventure players within
// r blocks is between min and max (inclusive; each bound optional, min defaults to 1).
/** @type {import("../../types/config").Condition} */
export default {
  name: "playersNearby",
  validate(args) {
    return typeof args.r === "number" && args.r > 0 ? [] : ["use the form playersNearby{r=16;min=2}"];
  },
  test(ctx, _target, args) {
    const n = ctx.services.adapter.getTargetablePlayers(ctx.boss.dimension, ctx.boss.location, Number(args.r)).length;
    const min = typeof args.min === "number" ? args.min : 1;
    const max = typeof args.max === "number" ? args.max : Infinity;
    return n >= min && n <= max;
  },
};
