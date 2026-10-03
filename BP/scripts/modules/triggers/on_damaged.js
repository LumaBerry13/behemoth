// ~onDamaged — the boss took damage. @trigger = the damaging entity (if any).
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onDamaged",
  subscribe(bus, fire) {
    bus.on("damaged", fire);
  },
};
