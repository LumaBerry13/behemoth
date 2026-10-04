// ~onSignal:name — the boss received that signal (signal mechanic). No
// argument: any signal. @trigger = the sender.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onSignal",
  subscribe(bus, fire) {
    bus.on("signal", fire);
  },
  match(arg, event) {
    return arg === undefined || event.data.signal === arg;
  },
};
