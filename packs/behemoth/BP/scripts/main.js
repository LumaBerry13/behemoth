// Behemoth — entry point. Builds the services, binds modules, starts the
// scheduler and the boss-pack registrar, and registers /behemoth.
// The framework ships no bosses: boss packs register theirs over script events
// (core/Registrar.js) and are restored from the framework's cache after reloads.
import { Adapter } from "./adapter/Adapter.js";
import { services } from "./core/services.js";
import { Log } from "./core/Logger.js";
import { Random } from "./core/Random.js";
import { Scheduler } from "./core/Scheduler.js";
import { EventBus } from "./core/EventBus.js";
import { BossManager } from "./core/BossManager.js";
import { SkillExecutor } from "./core/SkillExecutor.js";
import { Validator } from "./core/Validator.js";
import { Settings } from "./core/Settings.js";
import { Registrar } from "./core/Registrar.js";
import { SkillManager, bindModules } from "./registry/SkillManager.js";
import { startDebugOverlay } from "./debug/overlay.js";
import { Menu } from "./ui/Menu.js";

export const VERSION = "0.2.0";

services.adapter = Adapter;
services.log = Log;
services.random = Random;
services.settings = new Settings();
services.scheduler = new Scheduler();
services.bus = new EventBus();
services.registry = new SkillManager();
services.bosses = new BossManager(services);
services.executor = new SkillExecutor(services);

try {
  bindModules(services.registry);
  services.registry.checkRequires();
  Log.info(`Behemoth ${VERSION}: ${services.registry.summary()}`);

  services.registrar = new Registrar(services, new Validator(services.registry), VERSION);
  // First-tick order matters: settings (log level), then the boss manager's
  // world scan, then the registrar restores cached boss packs.
  services.scheduler.after(1, () => services.settings.load());
  services.bosses.init();
  services.registrar.start();
  services.executor.wireTriggers();
  startDebugOverlay(services);
  services.scheduler.start();
} catch (e) {
  Log.error("startup failed:", e);
}

const menu = new Menu(services, VERSION);

Adapter.events.onStartup((startup) => {
  try {
    // One command: /behemoth (operators; works without cheats).
    Adapter.commands.register(startup, { name: "bhm:behemoth", description: "Open the Behemoth menu", cheats: false }, (player) => {
      if (!player) return "§c[Behemoth] run this as a player";
      menu.open(player).catch((e) => Log.error("menu failed:", e));
    });
  } catch (e) {
    Log.error("command registration failed:", e);
  }
});
