// ~onAttack — the boss melee-hit an entity (vanilla hit). @trigger = the victim.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onAttack",
  subscribe(bus, fire) {
    bus.on("attack", fire);
  },
};
