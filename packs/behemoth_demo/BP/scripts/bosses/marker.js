// Demo effect entity (kind "minion"): what a boss summons as a telegraph,
// ground effect or slash (MythicMobs armor-stand FX mobs). No AI; it turns the
// way its boss faces (@Parent), flashes a tint, hurts players standing on it
// after 20 ticks and removes itself after 40. Never listed in the menu.

/** @type {import("../../../../behemoth/BP/scripts/types/config").BossConfig} */
export default {
  schemaVersion: 1,
  id: "bhm_demo:marker",
  kind: "minion",
  display: { name: "§7Marker" },
  ai: { default: "frozen", faceTarget: false },
  threat: { enabled: false },
  skills: {
    life: {
      tr: "onSpawn",
      c: [
        { m: "matchRotation", t: "@Parent" },
        { m: "tint", o: { color: "#FF6969" } },
        { m: "tint", o: { color: "#FFFFFF" }, delay: 10 },
        { m: "particleRing", o: { particle: "minecraft:basic_flame_particle", radius: 1.5, points: 12 }, delay: 15 },
        { m: "damage", o: { amount: 3 }, t: "@PlayersInRadius{r=1.5}", delay: 20 },
        { m: "remove", delay: 40 },
      ],
    },
  },
};
