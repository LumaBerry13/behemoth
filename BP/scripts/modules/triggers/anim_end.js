// ~animEnd:key — a non-looping animation started by `state` finished
// (from baked length, L2). No argument: any animation.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "animEnd",
  subscribe(bus, fire) {
    bus.on("animEnd", fire);
  },
  match(arg, event) {
    return arg === undefined || event.data.anim === arg;
  },
};
