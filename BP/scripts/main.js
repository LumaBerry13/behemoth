// Mythic Bedrock — entry point: build services, bind modules and bosses,
// validate, then start the scheduler (design doc §4).
import { Adapter } from "./adapter/Adapter.js";
import { services } from "./core/services.js";
import { Log } from "./core/Logger.js";
import { Random } from "./core/Random.js";
import { Scheduler } from "./core/Scheduler.js";
import { EventBus } from "./core/EventBus.js";
import { BossManager } from "./core/BossManager.js";
import { SkillExecutor } from "./core/SkillExecutor.js";
import { Validator } from "./core/Validator.js";
import { SkillManager, bindModules } from "./registry/SkillManager.js";
import { bindBosses } from "./bosses/index.js";
import { registerDebugCommands } from "./debug/commands.js";
import { startDebugOverlay } from "./debug/overlay.js";

const VERSION = "0.1.0";

services.adapter = Adapter;
services.log = Log;
services.random = Random;
services.scheduler = new Scheduler();
services.bus = new EventBus();
services.registry = new SkillManager();
services.bosses = new BossManager(services);
services.executor = new SkillExecutor(services);

try {
  bindModules(services.registry);
  services.registry.checkRequires();
  Log.info(`Mythic Bedrock ${VERSION}: ${services.registry.summary()}`);

  bindBosses(services.bosses);
  services.bosses.init(new Validator(services.registry));
  services.executor.wireTriggers();
  startDebugOverlay(services);
  services.scheduler.start();
} catch (e) {
  Log.error("startup failed:", e);
}

Adapter.events.onStartup((startup) => {
  try {
    registerDebugCommands(startup, services);
  } catch (e) {
    Log.error("command registration failed:", e);
  }
});
