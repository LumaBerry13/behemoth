// @self — the caster.
/** @type {import("../../types/config").Targeter} */
export default {
  name: "self",
  resolve(ctx) {
    return ctx.caster.isValid ? [ctx.caster] : [];
  },
};
