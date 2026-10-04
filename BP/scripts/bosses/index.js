// Boss binding list — one import + one bind line per boss (design doc §8).
import testBoss from "./test_boss.js";
import { bindPrivateBosses } from "./private/index.js";

/** @param {import("../core/BossManager.js").BossManager} bosses */
export function bindBosses(bosses) {
  bosses.bind(testBoss);
  // Bosses converted from licensed packs. The committed file is an empty stub;
  // `npm run deploy` overlays the real one from private/build (never committed).
  bindPrivateBosses(bosses);
}
