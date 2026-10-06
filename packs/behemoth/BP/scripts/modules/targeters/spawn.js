// @Spawn — where the boss was spawned (its reset / leash point).
/** @type {import("../../types/config").Targeter} */
export default {
  name: "Spawn",
  resolve(ctx) {
    return [ctx.services.adapter.location(ctx.boss.spawnPoint)];
  },
};
