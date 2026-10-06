// Picks one skill at random and casts it (MythicMobs `randomskill`). The picked
// skill inherits this line's targets.
//   mode "random" (default, MythicMobs): pick any; if its cooldown/conditions
//     block it, nothing runs this time.
//   mode "available": pick only among skills that can start right now, so a
//     ready attack is never wasted on one that is on cooldown.
// o: { skills: string[], mode?: "random" | "available" }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "randomSkill",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (!Array.isArray(o.skills) || o.skills.length === 0) return ["`skills` must be a non-empty array of skill names"];
    if (o.mode !== undefined && o.mode !== "random" && o.mode !== "available") return ["`mode` must be random or available"];
    return o.skills
      .filter((s) => !vctx.config.skills[s])
      .map((s) => `skill "${s}" is not defined`);
  },
  execute(ctx, targets, o) {
    const event = { triggerEntity: ctx.trigger, data: ctx.data };
    const pool = o.mode === "available"
      ? o.skills.filter((s) => ctx.services.executor.canCast(ctx.boss, s, event, targets))
      : o.skills;
    const name = ctx.services.random.pick(pool);
    if (!name) return;
    ctx.services.executor.castByName(
      ctx.boss,
      name,
      { triggerEntity: ctx.trigger, data: ctx.data },
      { inherited: targets, skillVars: ctx.skillVars, origin: ctx.origin, projectile: ctx.projectile }
    );
  },
};
