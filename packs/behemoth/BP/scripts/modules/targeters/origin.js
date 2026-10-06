// @Origin — the point a projectile / ray trace is at when it runs this skill
// (MythicMobs @origin); the caster's location otherwise.

/** @type {import("../../types/config").Targeter} */
export default {
  name: "Origin",
  resolve(ctx) {
    return [ctx.origin ?? ctx.services.adapter.location(ctx.boss.location)];
  },
};
