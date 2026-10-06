// ~onDropCombat — the boss has no target any more (MythicMobs onDropCombat).
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onDropCombat",
  subscribe(bus, fire) {
    bus.on("dropCombat", fire);
  },
};
