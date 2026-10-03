// ~onDeath — the boss died. @trigger = the killer (if any). Use @SelfLocation
// for effects: the entity itself may already be gone.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onDeath",
  subscribe(bus, fire) {
    bus.on("death", fire);
  },
};
