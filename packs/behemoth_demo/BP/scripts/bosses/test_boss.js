// Test boss exercising the MVP modules. Uses the vanilla zombie model
// (RP/entity/test_boss.entity.json) with two hand-made animations.
import anims from "../generated/test_boss/index.js";

/** @type {import("../../../../behemoth/BP/scripts/types/config").BossConfig} */
export default {
  schemaVersion: 1,
  id: "bhm_demo:test_boss",
  display: { name: "§cTest Boss", bossBar: true },
  stats: { health: 300, knockbackResist: 1, scale: 1.5, movementSpeed: 0.25, healthScaling: { perPlayer: 0.5, max: 4 } },
  // Caster variables and their starting values (MythicMobs mob Variables).
  variables: { combo: 0, mode: "angry" },
  animations: anims,
  ai: { default: "chase", targetRange: 32, leashRange: 48, resetAfterNoPlayers: 600 },
  threat: { enabled: true },
  gcd: 20,
  phases: [
    { id: 1, untilHealthPct: 50 },
    { id: 2, onEnter: ["enrage"], properties: { "bhm:visibility": 1 } },
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
        { m: "summon", o: { type: "bhm_demo:minion", amount: 2, radius: 3, cap: 4 } },
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

    // -----------------------------------------------------------------------
    // Module showcase: no triggers, run with /bhm:skill demo_<name> in-game.
    // Also exercised headless by `npm run sim:scenarios -- bhm_demo:test_boss`.
    // -----------------------------------------------------------------------
    demo_projectile: {
      m: "projectile",
      o: { particle: "minecraft:basic_flame_particle", onHit: "demo_projectile_hit", speed: 0.9, range: 30 },
      t: "@target",
    },
    demo_projectile_hit: {
      c: [
        { m: "damage", o: { amount: 4 } },
        { m: "ignite", o: { ticks: 40 } },
        { m: "particle", o: { particle: "minecraft:large_explosion" } },
      ],
    },
    demo_pull: { c: [{ m: "pull", o: { velocity: 1.0 }, t: "@PlayersInRadius{r=12}" }, { m: "particleLine", o: { particle: "minecraft:basic_flame_particle" } }] },
    demo_knockback: { m: "knockback", o: { velocity: 1.2, height: 0.4 }, t: "@Cone{angle=90;r=6}" },
    demo_heal: { c: [{ m: "heal", o: { percent: 0.25 } }, { m: "particleSphere", o: { particle: "minecraft:villager_happy", radius: 1.5 } }] },
    demo_percent: { m: "percentDamage", o: { percent: 0.25 }, t: "@ThreatTable{limit=1}" },
    demo_lightning: { m: "lightning", t: "@Ring{radius=6;points=6}" },
    demo_lunge: { m: "lunge", o: { velocity: 1.4 }, t: "@RandomPlayer{r=16}" },
    demo_velocity: { m: "velocity", o: { y: 0.8, z: 0.6, relative: true } },
    demo_teleport: { m: "teleportBehind", o: { distance: 2 }, t: "@target" },
    demo_blocks: { m: "tempBlocks", o: { block: "minecraft:cobweb", radius: 2, ticks: 80 }, t: "@TargetLocation" },
    demo_title: { c: [{ m: "title", o: { title: "§4Test Boss", subtitle: "module showcase" } }, { m: "actionBar", o: { text: "§7action bar" } }] },
    demo_property: { m: "setProperty", o: { property: "bhm:visibility", value: 2 } },
    demo_counter: {
      c: [
        { m: "setVariable", o: { name: "presses", add: 1 } },
        { m: "message", o: { text: "§aThird press!" }, if: ["variable{name=presses;ge=3}"] },
        { m: "signal", o: { signal: "ping", radius: 32 } },
      ],
    },
    on_ping: { tr: "onSignal:ping", m: "actionBar", o: { text: "§bsignal received" }, t: "@PlayersInRadius{r=32}" },
    // Variables, scopes and <placeholders>.
    demo_vars: {
      c: [
        { m: "setVariable", o: { name: "combo", add: 1, type: "int" } },
        { m: "variableMath", o: { var: "caster.power", eq: "max(0, x * 2 + <caster.var.combo>)" } },
        { m: "setVariable", o: { name: "skill.roll", value: "<random.int.1to6>", type: "int" } },
        { m: "setVariable", o: { name: "caster.temp", value: "on", type: "string", duration: 20 } },
        { m: "setVariable", o: { name: "global.demo_runs", add: 1 } },
        {
          m: "message",
          o: { text: "§7combo §f<caster.var.combo>§7, power §f<caster.var.power>§7, roll §f<skill.var.roll>§7, hp §f<caster.hp>/<caster.mhp>" },
          t: "@PlayersInRadius{r=32}",
        },
      ],
    },
    // castInstead / orElseCast and target conditions (MythicMobs TargetConditions).
    demo_instead: {
      if: ["varEquals{var=caster.mode;val=calm} castInstead demo_calm"],
      m: "actionBar", o: { text: "§cThe Test Boss is angry" }, t: "@PlayersInRadius{r=32}",
    },
    demo_calm: { m: "actionBar", o: { text: "§aThe Test Boss is calm" }, t: "@PlayersInRadius{r=32}" },
    demo_fov: {
      targetIf: ["fieldOfView{angle=90;rotation=0} orElseCast demo_turn_around"],
      m: "actionBar", o: { text: "§aYou are in front of the Test Boss" },
    },
    demo_turn_around: { m: "setRotation", o: { yaw: 180, relative: true }, t: "@self" },
    // repeat / repeatInterval and a per-line cooldown.
    demo_combo: {
      c: [
        { m: "particle", o: { particle: "minecraft:critical_hit_emitter", yOffset: 1 }, repeat: 4, repeatInterval: 5 },
        { m: "sound", o: { sound: "random.orb", pitch: "<random.float.0.9to1.2>" }, cooldown: 40 },
      ],
    },
    // Condition showcase: each line runs only if its condition holds.
    demo_checks: {
      c: [
        { m: "actionBar", o: { text: "§7in combat" }, t: "@PlayersInRadius{r=32}", if: ["inCombat"] },
        { m: "actionBar", o: { text: "§7temp is set" }, t: "@PlayersInRadius{r=32}", if: ["variableIsSet{var=caster.temp}"] },
        { m: "actionBar", o: { text: "§7on the ground" }, t: "@PlayersInRadius{r=32}", if: ["altitude<1", "directionalVelocity{y=>-0.1}"] },
      ],
    },
    // A beam: damages players along it, sparks where it ends.
    demo_ray: {
      m: "rayTraceTo",
      o: { maxDistance: 24, width: 1, particle: "minecraft:blue_flame_particle", entitySkill: "demo_ray_hit", locationSkill: "demo_ray_end" },
      t: "@target",
    },
    demo_ray_hit: { c: [{ m: "damage", o: { amount: 2 } }, { m: "throw", o: { velocity: 6, velocityY: 3 } }] },
    demo_ray_end: { m: "particle", o: { particle: "minecraft:large_explosion" }, t: "@Origin" },
    // An entity projectile (an arrow model) that speeds up, sparks and leaves a marker where it lands.
    demo_bullet: {
      m: "projectile",
      o: {
        bullet: "bhm_demo:bullet", speed: 0.5, gravity: 0.01, range: 32, tickInterval: 2,
        onTick: "demo_bullet_tick", onHit: "demo_projectile_hit", onEnd: "demo_bullet_end",
      },
      t: "@target",
    },
    demo_bullet_tick: {
      c: [
        { m: "modifyProjectile", o: { trait: "velocity", action: "multiply", value: 1.05 } },
        { m: "particle", o: { particle: "minecraft:basic_crit_particle" }, t: "@Origin" },
      ],
    },
    demo_bullet_end: { m: "summon", o: { type: "bhm_demo:marker", radius: 0, lifetime: 60, facing: "caster" } },
    // Effects raining down at random spots around the boss.
    demo_rain: { m: "skill", o: { skill: "demo_rain_drop" }, t: "@RandomLocationsNearCaster{amount=4;radius=8;minRadius=3;spacing=2}" },
    demo_rain_drop: {
      c: [
        { m: "summon", o: { type: "bhm_demo:marker", radius: 0, cap: 12, facing: "caster" } },
        { m: "particle", o: { particle: "minecraft:huge_explosion_emitter" }, delay: 20 },
      ],
    },
    demo_stun: { c: [{ m: "stun", o: { duration: 40 }, t: "@self" }, { m: "message", o: { text: "§7The Test Boss is stunned." }, t: "@PlayersInRadius{r=32}" }] },
    demo_bar: {
      c: [
        { m: "bossBar", o: { title: "<caster.name> §7(<caster.php>%)" } },
        { m: "bossBar", o: { reset: true }, delay: 60 },
      ],
    },
    // Common MythicMobs vocabulary.
    demo_explosion: { m: "explosion", o: { power: 2 }, t: "@TargetLocation" },
    demo_shoot: { m: "shoot", o: { type: "minecraft:arrow", velocity: 1.6, spread: 0.4 }, t: "@target", repeat: 2, repeatInterval: 5 },
    demo_missile: {
      m: "projectile",
      o: { particle: "minecraft:blue_flame_particle", speed: 0.4, homing: 0.25, range: 40, onHit: "demo_projectile_hit" },
      t: "@target",
    },
    demo_jump: { m: "jump", o: { velocity: 0.9 } },
    demo_taunt: { m: "threat", o: { mode: "taunt" }, t: "@trigger" },
    demo_line: { m: "particle", o: { particle: "minecraft:basic_flame_particle" }, t: "@Line{spacing=1}" },
    demo_ring_players: { m: "actionBar", o: { text: "§7You are 3–12 blocks away" }, t: "@PlayersInRing{min=3;max=12}" },
    demo_near_target: { m: "lightning", t: "@RandomLocationsNearTarget{amount=2;radius=3;minRadius=1}" },
    demo_spawn_point: { m: "particle", o: { particle: "minecraft:totem_particle", count: 5 }, t: "@Spawn" },
    demo_force_pull: { m: "forcePull", o: { spread: 1 }, t: "@PlayersInRadius{r=12}" },
    demo_swap: { m: "swap", t: "@target" },
    demo_command: { m: "command", o: { command: "say <caster.name> has <caster.php>% health" } },
    demo_half_health: { m: "setHealth", o: { amount: 0.5, percent: true } },
    demo_target_checks: {
      targetIf: ["isPlayer", "onGround", "!onFire", "!crouching", "!sprinting", "entityType{types=minecraft:player}", "!hasEffect{effect=slowness}"],
      m: "actionBar", o: { text: "§7Target checks passed" },
    },
    on_combat: { tr: "onCombat", m: "actionBar", o: { text: "§cThe Test Boss notices you" }, t: "@trigger" },
    on_kill_player: { tr: "onKillPlayer", m: "message", o: { text: "§c<trigger.name> was defeated by <caster.name>" }, t: "@PlayersInRadius{r=48}" },
    on_load: { tr: "onLoad", m: "particle", o: { particle: "minecraft:totem_particle", count: 3 } },
    on_interact: { tr: "onInteract", if: ["lineOfSight", "height>=-64", "playersNearby{r=16;min=1}"], m: "message", o: { text: "§7The Test Boss ignores you." }, t: "@trigger" },
  },
  drops: [{ item: "minecraft:diamond", amount: [2, 5], chance: 1 }],
  requires: ["state", "damage", "leap", "particle", "particleRing", "sound", "delay", "setAI", "summon", "message", "waitMarker", "invulnerable"],
};
