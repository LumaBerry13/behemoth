// ~onLoad — a saved boss was loaded again (chunk load, /reload, world load) — not a fresh spawn (MythicMobs onLoad).
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onLoad",
  subscribe(bus, fire) {
    bus.on("load", fire);
  },
};
