// Demo minion (kind "minion"): driven by Behemoth like a boss — skills, AI,
// persistence — but never listed or edited in the /behemoth menu. The test boss
// summons it in phase 2; minions are bound to their boss and removed when it
// dies, despawns or resets.

/** @type {import("../../../../behemoth/BP/scripts/types/config").BossConfig} */
export default {
  schemaVersion: 1,
  id: "bhm_demo:minion",
  kind: "minion",
  display: { name: "§7Test Minion" },
  stats: { health: 20, movementSpeed: 0.3 },
  ai: { default: "chase", targetRange: 24, stopDistance: 1.5 },
  threat: { enabled: true },
  skills: {
    // A small claw swipe in front of it.
    swipe: {
      tr: "onTimer:20",
      if: ["hasTarget", "distance<=2.5"],
      cooldown: 40,
      c: [
        { m: "particle", o: { particle: "minecraft:critical_hit_emitter", yOffset: 1 } },
        { m: "damage", o: { amount: 3 }, t: "@Cone{angle=90;r=2.5}" },
      ],
    },
    puff: {
      tr: "onDeath",
      m: "particle", o: { particle: "minecraft:large_explosion" }, t: "@SelfLocation",
    },
  },
};
