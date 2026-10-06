// Sends a chat message to player targets.
// o: { text }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "message",
  defaultTargeter: "@PlayersInRadius{r=32}",
  validate(o) {
    return typeof o.text === "string" ? [] : ["`text` is required"];
  },
  execute(ctx, targets, o) {
    const a = ctx.services.adapter;
    for (const t of targets) if (a.isPlayer(t)) a.message(t, o.text);
  },
};
