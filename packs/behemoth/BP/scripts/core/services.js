// Shared service container, filled once in main.js. Passed to modules through
// the skill context (ctx.services) so modules never import core singletons.

/**
 * @typedef {object} Services
 * @property {import("../adapter/Adapter.js").AdapterApi} adapter
 * @property {import("./Scheduler.js").Scheduler} scheduler
 * @property {import("./EventBus.js").EventBus} bus
 * @property {import("../registry/SkillManager.js").SkillManager} registry
 * @property {import("./BossManager.js").BossManager} bosses
 * @property {import("./SkillExecutor.js").SkillExecutor} executor
 * @property {typeof import("./Random.js").Random} random
 * @property {typeof import("./Logger.js").Log} log
 * @property {import("./Settings.js").Settings} settings
 * @property {import("./Registrar.js").Registrar} registrar
 */

export const services = /** @type {Services} */ ({});
