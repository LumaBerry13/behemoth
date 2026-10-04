// Stops (or resumes) the boss turning toward its target (ModelEngine
// `lockmodel`), e.g. so a swing keeps its direction once committed.
// o: { on: boolean }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "lockFacing",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.on === "boolean" ? [] : ["`on` must be true or false"];
  },
  execute(ctx, _targets, o) {
    ctx.boss.facingLocked = o.on;
  },
};
