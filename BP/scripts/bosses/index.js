// Boss binding list — one import + one bind line per boss (design doc §8).
import testBoss from "./test_boss.js";

/** @param {import("../core/BossManager.js").BossManager} bosses */
export function bindBosses(bosses) {
  bosses.bind(testBoss);
}
