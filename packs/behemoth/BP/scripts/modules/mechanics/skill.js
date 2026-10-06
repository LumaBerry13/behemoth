// Runs another skill of this boss (MythicMobs `skill` meta-mechanic). The
// called skill's own cooldown and conditions apply unless `force: true`.
// It runs as its own sequence; its lines without a targeter inherit this
// line's targets.
// o: { skill, force?=false }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "skill",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (typeof o.skill !== "string") return ["`skill` name is required"];
    if (o.skill === vctx.skillName) return ["a skill cannot call itself"];
    return vctx.config.skills[o.skill] ? [] : [`skill "${o.skill}" is not defined`];
  },
  execute(ctx, targets, o) {
    ctx.services.executor.castByName(
      ctx.boss,
      o.skill,
      { triggerEntity: ctx.trigger, data: ctx.data },
      { force: !!o.force, inherited: targets, skillVars: ctx.skillVars, origin: ctx.origin, projectile: ctx.projectile }
    );
  },
};
