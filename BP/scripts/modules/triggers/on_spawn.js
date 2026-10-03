// ~onSpawn — fresh spawn only (not when a saved boss reloads).
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onSpawn",
  subscribe(bus, fire) {
    bus.on("spawn", fire);
  },
};
