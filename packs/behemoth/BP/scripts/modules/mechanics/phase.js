// Forces a phase change (runs that phase's onEnter skills).
// o: { id }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "phase",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (!Number.isInteger(o.id)) return ["`id` must be an integer phase id"];
    if (!vctx.config.phases?.some((p) => p.id === o.id)) return [`phase ${o.id} is not defined in config.phases`];
    return [];
  },
  execute(ctx, _targets, o) {
    ctx.boss.setPhase(o.id);
  },
};
