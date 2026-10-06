// Shows a title (and optional subtitle) to player targets.
// o: { title, subtitle?, fadeIn?=5, stay?=40, fadeOut?=10 } (ticks)
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "title",
  defaultTargeter: "@PlayersInRadius{r=32}",
  validate(o) {
    return typeof o.title === "string" ? [] : ["`title` is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) {
      if (a.isPlayer(t)) a.title(t, o.title, o.subtitle, { fadeIn: o.fadeIn, stay: o.stay, fadeOut: o.fadeOut });
    }
  },
};
