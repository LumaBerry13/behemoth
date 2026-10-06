// ~onChangeTarget — the boss's target changed, including entering combat (MythicMobs onChangeTarget). @trigger = the new target.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onChangeTarget",
  subscribe(bus, fire) {
    bus.on("changeTarget", fire);
  },
};
