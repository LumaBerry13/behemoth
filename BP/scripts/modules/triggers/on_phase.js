// ~onPhase:N — the boss entered phase N (no argument: any phase change).
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onPhase",
  validateArg(arg) {
    return arg === undefined || Number.isInteger(Number(arg)) ? [] : ["argument must be a phase id, e.g. onPhase:2"];
  },
  subscribe(bus, fire) {
    bus.on("phase", fire);
  },
  match(arg, event) {
    return arg === undefined || event.data.to === Number(arg);
  },
};
