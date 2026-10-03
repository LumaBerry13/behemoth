// Runs another skill of this boss (meta-mechanic). Ignores that skill's
// cooldown and conditions; it runs as its own sequence.
// o: { skill }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "skill",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (typeof o.skill !== "string") return ["`skill` name is required"];
    if (o.skill === vctx.skillName) return ["a skill cannot call itself"];
    return vctx.config.skills[o.skill] ? [] : [`skill "${o.skill}" is not defined`];
  },
  execute(ctx, _targets, o) {
    ctx.services.executor.castByName(ctx.boss, o.skill, { triggerEntity: ctx.trigger, data: ctx.data }, true);
  },
};
