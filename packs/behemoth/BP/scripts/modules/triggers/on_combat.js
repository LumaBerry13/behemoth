// ~onCombat — the boss gets a target after having none (MythicMobs onCombat / onEnterCombat). @trigger = the target.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onCombat",
  subscribe(bus, fire) {
    bus.on("combat", fire);
  },
};
