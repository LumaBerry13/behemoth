// ~onMarker:name — the current animation reached a named timeline marker.
/** @type {import("../../types/config").Trigger} */
export default {
  name: "onMarker",
  validateArg(arg) {
    return arg ? [] : ["needs a marker name, e.g. onMarker:slam_impact"];
  },
  subscribe(bus, fire) {
    bus.on("marker", fire);
  },
  match(arg, event) {
    return event.data.marker === arg;
  },
};
