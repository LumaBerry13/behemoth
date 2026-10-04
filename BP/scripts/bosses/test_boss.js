// Test boss exercising the MVP modules. Uses the vanilla zombie model
// (RP/entity/test_boss.entity.json) with two hand-made animations.
import anims from "../generated/test_boss/index.js";

/** @type {import("../types/config").BossConfig} */
export default {
  schemaVersion: 1,
  id: "mb:test_boss",
  display: { name: "§cTest Boss", bossBar: true },
  stats: { health: 300, knockbackResist: 1, scale: 1.5, movementSpeed: 0.25 },
  animations: anims,
  ai: { default: "chase", targetRange: 32, leashRange: 48, resetAfterNoPlayers: 600 },
  threat: { enabled: true },
  gcd: 20,
  phases: [
    { id: 1, untilHealthPct: 50 },
    { id: 2, onEnter: ["enrage"], properties: { "mb:visibility": 1 } },
  ],
  skills: {
    intro: {
      tr: "onSpawn",
      c: [
        { m: "message", o: { text: "§cThe Test Boss awakens!" }, t: "@PlayersInRadius{r=32}" },
        { m: "sound", o: { sound: "mob.wither.spawn", volume: 0.6 } },
      ],
    },

    // Ground slam: freeze, raise arms, hit on the animation marker.
    slam: {
      tr: "onTimer:20",
      if: ["hasTarget", "distance<=5"],
      cooldown: 100,
      exclusive: true,
      interruptible: true,
      c: [
        { m: "setAI", o: { mode: "frozen", ticks: 45 } },
        { m: "state", o: { anim: "slam", lock: true } },
        { m: "waitMarker", o: { marker: "slam_impact" } },
        { m: "damage", o: { amount: 8 }, t: "@EntitiesInRadius{r=4}" },
        { m: "particleRing", o: { particle: "minecraft:basic_flame_particle", radius: 4, points: 24 } },
        { m: "particle", o: { particle: "minecraft:huge_explosion_emitter" }, t: "@SelfLocation" },
        { m: "sound", o: { sound: "random.explode", volume: 0.8 } },
      ],
    },

    // Gap closer when the target is far away.
    leap: {
      tr: "onTimer:20",
      if: ["hasTarget", "distance>8", "distance<=24"],
      cooldown: 160,
      exclusive: true,
      c: [
        { m: "sound", o: { sound: "mob.ravager.roar", volume: 0.6 } },
        { m: "leap", o: { velocity: 1.6, height: 0.9 }, t: "@target" },
        { m: "delay", o: { ticks: 20 } },
        { m: "damage", o: { amount: 6 }, t: "@EntitiesInRadius{r=3}" },
        { m: "particleRing", o: { particle: "minecraft:basic_flame_particle", radius: 3, points: 16 } },
      ],
    },

    // Feedback when hit.
    hurt_spark: {
      tr: "onDamaged",
      chance: 0.3,
      cooldown: 10,
      m: "particle",
      o: { particle: "minecraft:critical_hit_emitter", yOffset: 1.5 },
      t: "@self",
    },

    // Phase 2 adds.
    summon_adds: {
      tr: "onTimer:100",
      if: ["phase==2"],
      cooldown: 300,
      c: [
        { m: "summon", o: { type: "minecraft:zombie", amount: 2, radius: 3, cap: 4 } },
        { m: "message", o: { text: "§7The Test Boss calls for help..." } },
      ],
    },

    // Runs on entering phase 2 (phases[1].onEnter).
    enrage: {
      c: [
        { m: "setAI", o: { mode: "frozen" } },
        { m: "invulnerable", o: { on: true } },
        { m: "state", o: { anim: "roar", lock: true } },
        { m: "message", o: { text: "§4The Test Boss is enraged!" } },
        { m: "sound", o: { sound: "mob.enderdragon.growl" } },
        { m: "delay", o: { ticks: 40 } },
        { m: "invulnerable", o: { on: false } },
        { m: "setAI", o: { mode: "chase" } },
      ],
    },

    death: {
      tr: "onDeath",
      c: [
        { m: "message", o: { text: "§aThe Test Boss has fallen." }, t: "@PlayersInRadius{r=48}" },
        { m: "particle", o: { particle: "minecraft:huge_explosion_emitter" }, t: "@SelfLocation" },
      ],
    },
  },
  drops: [{ item: "minecraft:diamond", amount: [2, 5], chance: 1 }],
  requires: ["state", "damage", "leap", "particle", "particleRing", "sound", "delay", "setAI", "summon", "message", "waitMarker", "invulnerable"],
};
