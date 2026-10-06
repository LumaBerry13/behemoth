// Sets the text of the caster's boss bar (MythicMobs barCreate/barSet, as far
// as Bedrock allows): the bar shows the entity's name, so `title` becomes its
// name tag (colour codes and <placeholders> work). Bedrock has no script API
// for a second bar, bar colour, style or value; the bar always shows health.
// reset=true restores display.name. [VERIFY] the boss bar follows name tag changes live.
// o: { title?, reset?=false }

/** @type {import("../../types/config").Mechanic} */
export default {
  name: "bossBar",
  defaultTargeter: "@self",
  validate(o) {
    if (o.title === undefined && !o.reset) return ["needs `title` or reset=true"];
    return [];
  },
  execute(ctx, _targets, o) {
    if (o.reset) ctx.boss.applyDisplay();
    else ctx.services.adapter.setNameTag(ctx.caster, String(o.title));
  },
};
