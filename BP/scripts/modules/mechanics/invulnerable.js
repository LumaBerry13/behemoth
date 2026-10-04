// Makes the boss ignore all damage (script-level, see BossInstance.setInvulnerable).
// o: { on: boolean }
/** @type {import("../../types/config").Mechanic} */
export default {
  name: "invulnerable",
  defaultTargeter: "@self",
  validate(o) {
    return typeof o.on === "boolean" ? [] : ["`on` must be true or false"];
  },
  execute(ctx, _targets, o) {
    ctx.boss.setInvulnerable(o.on);
  },
};
