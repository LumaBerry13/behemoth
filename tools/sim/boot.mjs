// Boots the headless world: the Behemoth framework plus boss packs, each
// loaded from its own main.js and connected over (stubbed) script events —
// the same path as in the game. Resolves once every pack is registered.
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { framework, bossPacks } from "../packs.mjs";

register("./loader.mjs", import.meta.url);

/**
 * @param {{ packs?: string[], maxTicks?: number }} [opts] packs: boss pack names to load (default: all)
 */
export async function boot(opts = {}) {
  const mc = await import("./mc_stub.mjs");
  const ui = await import("./ui_stub.mjs");
  await import(pathToFileURL(join(framework.bp, "scripts", "main.js")).href);
  const { services } = await import(pathToFileURL(join(framework.bp, "scripts", "core", "services.js")).href);
  const { Log } = await import(pathToFileURL(join(framework.bp, "scripts", "core", "Logger.js")).href);
  const wanted = bossPacks().filter((p) => !opts.packs || opts.packs.includes(p.name));
  for (const p of wanted) await import(pathToFileURL(join(p.bp, "scripts", "main.js")).href);

  // Startup event (command registration), then run until all packs are acknowledged.
  const commands = new Map();
  mc.system.beforeEvents.startup.fire({
    customCommandRegistry: {
      registerEnum() {},
      registerCommand(def, cb) { commands.set(def.name, cb); },
    },
  });
  const t0 = mc.system.currentTick;
  const max = opts.maxTicks ?? 60;
  while (mc.system.currentTick - t0 < max) {
    mc.tick(1);
    const acked = mc.log.filter(([, k, d]) => k === "scriptevent" && d.startsWith("bhm:ack")).length;
    if (acked >= wanted.length && mc.system.currentTick - t0 > 2) break;
  }
  return { mc, ui, services, Log, commands, packs: wanted, bootTicks: mc.system.currentTick - t0 };
}
