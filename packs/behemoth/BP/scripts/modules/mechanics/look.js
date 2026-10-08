// The caster turns to face its first target at once (MythicMobs `look`), e.g. between the dashes
// of a charge. Works while facing is locked (one turn, the lock stays). Entity targets are faced
// at head height. MythicMobs headOnly has no Bedrock equivalent: the body always turns.
// o: {}
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "look",
  defaultTargeter: "@target",
  validate() {
    return [];
  },
  execute(ctx, targets) {
    const a = ctx.services.adapter;
    const t = targets.find((x) => !a.isEntity(x) || x.id !== ctx.caster.id);
    if (!t) return;
    a.lookAt(ctx.caster, a.isEntity(t) ? a.getHeadLocation(t) : a.locOf(t));
  },
};
