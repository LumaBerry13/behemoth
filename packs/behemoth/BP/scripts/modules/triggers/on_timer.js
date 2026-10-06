// ~onTimer:N — every N ticks of the boss's life.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onTimer",
  validateArg(arg) {
    const n = Number(arg);
    return Number.isInteger(n) && n > 0 ? [] : ["needs an interval in ticks, e.g. onTimer:100"];
  },
  subscribe(bus, fire) {
    bus.on("tick", fire);
  },
  match(arg, event) {
    return event.data.age % Number(arg) === 0;
  },
};
