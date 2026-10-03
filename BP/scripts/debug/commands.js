// Debug commands (design doc §11). All require cheats and operator level.
//   /mb:spawn <boss>      spawn a boss at your position
//   /mb:skill <name>      force a skill on the nearest boss (ignores cooldown/conditions)
//   /mb:phase <id>        force a phase on the nearest boss
//   /mb:despawn           remove the nearest boss (no drops, no death skills)
//   /mb:debug [on]        toggle debug logs + action-bar overlay
//   /mb:bones [on]        toggle baked-bone particle markers
//   /mb:seed [seed]       seed the RNG for replayable fights (omit to unseed)
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "../core/Logger.js";
import { Random } from "../core/Random.js";
import { DebugState } from "./overlay.js";

const NEAREST_RANGE = 64;
const T = Adapter.commands.ParamType;

/**
 * @param {import("@minecraft/server").StartupEvent} startup
 * @param {import("../core/services.js").Services} services
 */
export function registerDebugCommands(startup, services) {
  const c = Adapter.commands;
  const bossIds = [...services.bosses.configs.keys()];

  /** @param {import("@minecraft/server").Player | undefined} p */
  const nearestBoss = (p) => (p ? services.bosses.nearest(p.dimension, p.location, NEAREST_RANGE) : undefined);

  if (bossIds.length) {
    c.registerEnum(startup, "mb:boss", bossIds);
    c.register(
      startup,
      { name: "mb:spawn", description: "Spawn a Mythic Bedrock boss", mandatory: [{ name: "mb:boss", type: T.Enum }] },
      (p, id) => {
        if (!p) return;
        const boss = services.bosses.spawn(id, p.dimension, p.location);
        return boss ? `§a[MB] spawned ${id}` : `§c[MB] could not spawn ${id}`;
      }
    );
  }

  c.register(
    startup,
    { name: "mb:skill", description: "Force a skill on the nearest boss", mandatory: [{ name: "skill", type: T.String }] },
    (p, name) => {
      const boss = nearestBoss(p);
      if (!boss) return "§c[MB] no boss within range";
      return services.executor.castByName(boss, name, { triggerEntity: p }, true)
        ? `§a[MB] cast ${name}`
        : `§c[MB] unknown skill ${name}`;
    }
  );

  c.register(
    startup,
    { name: "mb:phase", description: "Force a phase on the nearest boss", mandatory: [{ name: "id", type: T.Integer }] },
    (p, id) => {
      const boss = nearestBoss(p);
      if (!boss) return "§c[MB] no boss within range";
      boss.setPhase(id);
      return `§a[MB] phase → ${id}`;
    }
  );

  c.register(startup, { name: "mb:despawn", description: "Remove the nearest boss" }, (p) => {
    const boss = nearestBoss(p);
    if (!boss) return "§c[MB] no boss within range";
    services.bosses.despawn(boss);
    return "§a[MB] boss removed";
  });

  c.register(
    startup,
    { name: "mb:debug", description: "Toggle debug logs and overlay", optional: [{ name: "on", type: T.Boolean }] },
    (_p, on) => {
      DebugState.overlay = on ?? !DebugState.overlay;
      Log.setLevel(DebugState.overlay ? "debug" : "info");
      return `§a[MB] debug ${DebugState.overlay ? "on" : "off"}`;
    }
  );

  c.register(
    startup,
    { name: "mb:bones", description: "Toggle baked bone markers", optional: [{ name: "on", type: T.Boolean }] },
    (_p, on) => {
      DebugState.bones = on ?? !DebugState.bones;
      return `§a[MB] bone markers ${DebugState.bones ? "on" : "off"}`;
    }
  );

  c.register(
    startup,
    { name: "mb:seed", description: "Seed the framework RNG", optional: [{ name: "seed", type: T.Integer }] },
    (_p, seed) => {
      Random.setSeed(seed);
      return seed === undefined ? "§a[MB] RNG unseeded" : `§a[MB] RNG seed ${seed}`;
    }
  );
}
