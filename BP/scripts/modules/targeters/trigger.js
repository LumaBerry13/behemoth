// @trigger — the entity that caused the trigger (attacker for onDamaged, killer for onDeath...).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "trigger",
  resolve(ctx) {
    return ctx.trigger?.isValid ? [ctx.trigger] : [];
  },
};
