// Picks one skill at random and casts it (MythicMobs `randomskill`). Like
// MythicMobs, if the picked skill's cooldown/conditions block it, nothing runs
// this time. The picked skill inherits this line's targets.
// o: { skills: string[] }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "randomSkill",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (!Array.isArray(o.skills) || o.skills.length === 0) return ["`skills` must be a non-empty array of skill names"];
    return o.skills
      .filter((s) => !vctx.config.skills[s])
      .map((s) => `skill "${s}" is not defined`);
  },
  execute(ctx, targets, o) {
    const name = ctx.services.random.pick(o.skills);
    if (!name) return;
    ctx.services.executor.castByName(
      ctx.boss,
      name,
      { triggerEntity: ctx.trigger, data: ctx.data },
      { inherited: targets }
    );
  },
};
