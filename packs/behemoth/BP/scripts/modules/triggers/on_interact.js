// ~onInteract — a player interacted with (right-clicked / tapped) the boss.
// @trigger = that player.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onInteract",
  subscribe(bus, fire) {
    bus.on("interact", fire);
  },
};
