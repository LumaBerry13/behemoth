// Pauses the current skill sequence. Does not block other skills.
// o: { ticks }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "delay",
  defaultTargeter: "@self",
  validate(o) {
    return Number.isInteger(o.ticks) && o.ticks > 0 ? [] : ["`ticks` must be a positive integer"];
  },
  execute(_ctx, _targets, o) {
    return o.ticks;
  },
};
