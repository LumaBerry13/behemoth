// Shows action-bar text to player targets.
// o: { text }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "actionBar",
  defaultTargeter: "@PlayersInRadius{r=32}",
  validate(o) {
    return typeof o.text === "string" ? [] : ["`text` is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isPlayer(t)) a.actionBar(t, o.text);
  },
};
