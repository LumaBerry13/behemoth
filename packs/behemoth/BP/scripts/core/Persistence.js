// Saves boss state on the entity as one JSON dynamic property and restores it
// on load (design doc §10, L14). Cooldowns are stored as remaining ticks.
// [VERIFY] max dynamic property string length; state is kept small on purpose.
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "./Logger.js";

const KEY = "bhm:state";
const DEAD_KEY = "bhm:dead";
const VERSION = 1;

/**
 * @typedef {{
 *   v: number,
 *   phase: number,
 *   ai: import("../types/config").AiMode,
 *   spawn: { x: number, y: number, z: number },
 *   cd: Record<string, number>,
 *   vars: Record<string, unknown>,
 *   threat?: Record<string, number>,
 *   facing?: boolean,
 *   speed?: number,
 * }} SavedState
 */

export const Persistence = {
  /** @param {import("./BossInstance.js").BossInstance} boss @param {number} now framework tick */
  save(boss, now) {
    if (!boss.entity.isValid || boss.dead) return;
    /** @type {Record<string, number>} */
    const cd = {};
    for (const [name, readyAt] of boss.cooldowns) if (readyAt > now) cd[name] = readyAt - now;
    /** @type {SavedState} */
    const state = {
      v: VERSION,
      phase: boss.phase,
      ai: boss.aiMode,
      spawn: { x: boss.spawnPoint.x, y: boss.spawnPoint.y, z: boss.spawnPoint.z },
      cd,
      vars: boss.vars,
      threat: boss.config.threat?.enabled === false ? undefined : boss.threat.serialize(),
      facing: boss.facingLocked,
      speed: boss.speedMult,
    };
    try {
      Adapter.setDynamic(boss.entity, KEY, JSON.stringify(state));
    } catch (e) {
      Log.warn(`failed to persist ${boss.config.id}:`, e);
    }
  },

  /**
   * @param {import("@minecraft/server").Entity} entity
   * @returns {SavedState | undefined}
   */
  load(entity) {
    const raw = Adapter.getDynamic(entity, KEY);
    if (typeof raw !== "string") return undefined;
    try {
      const state = JSON.parse(raw);
      if (state?.v !== VERSION) return undefined;
      return state;
    } catch {
      Log.warn(`corrupt saved state on ${entity.typeId}; starting fresh`);
      return undefined;
    }
  },

  /**
   * @param {import("./BossInstance.js").BossInstance} boss @param {SavedState} state @param {number} now
   */
  apply(boss, state, now) {
    boss.phase = state.phase;
    boss.aiMode = state.ai ?? boss.aiMode;
    boss.spawnPoint = Adapter.location(state.spawn);
    for (const [name, remaining] of Object.entries(state.cd ?? {})) boss.cooldowns.set(name, now + remaining);
    boss.vars = state.vars ?? {};
    boss.threat.restore(state.threat);
    boss.facingLocked = !!state.facing;
    boss.speedMult = state.speed ?? 1;
  },

  /** Mark an entity whose death is still playing out, so it is never re-armed on reload. @param {import("@minecraft/server").Entity} entity */
  markDead(entity) {
    try {
      Adapter.setDynamic(entity, DEAD_KEY, true);
    } catch {
      /* entity already gone */
    }
  },

  /** @param {import("@minecraft/server").Entity} entity */
  isDead(entity) {
    return Adapter.getDynamic(entity, DEAD_KEY) === true;
  },
};
