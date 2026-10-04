// ~onReset — the boss reset (no players nearby for ai.resetAfterNoPlayers, or it
// left ai.leashRange). Fires after health/phase/threat were restored and the boss
// was sent back to its spawn point.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onReset",
  subscribe(bus, fire) {
    bus.on("reset", fire);
  },
};
