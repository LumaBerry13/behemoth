// Chooses which client-side idle or walk animation the boss loops when no
// action animation is playing (ModelEngine `defaultstate`). The animation must
// be listed in config.baseStates[type]; the RP base controller reads the
// bhm:idle_state / bhm:walk_state property.
// o: { type: "idle" | "walk", anim }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "baseState",
  defaultTargeter: "@self",
  validate(o, vctx) {
    if (o.type !== "idle" && o.type !== "walk") return ["`type` must be idle or walk"];
    const list = vctx.config.baseStates?.[o.type] ?? [];
    return list.includes(o.anim) ? [] : [`"${o.anim}" is not in config.baseStates.${o.type}`];
  },
  execute(ctx, _targets, o) {
    ctx.boss.setBaseState(o.type, o.anim);
  },
};
