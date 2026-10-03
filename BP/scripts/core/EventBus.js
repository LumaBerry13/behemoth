// Framework event bus: Script API events are translated into framework events
// here, and skills/bosses can exchange custom signals (design doc §4).
import { Log } from "./Logger.js";

/**
 * Framework events emitted by BossManager / mechanics:
 *  "spawn"     { boss }                         fresh spawn only
 *  "tick"      { boss, data: { age } }          once per boss per tick
 *  "damaged"   { boss, triggerEntity, data: { damage, cause } }
 *  "attack"    { boss, triggerEntity }          boss hit an entity
 *  "death"     { boss, triggerEntity, data: { cause } }
 *  "interact"  { boss, triggerEntity }
 *  "phase"     { boss, data: { from, to } }
 *  "animEnd"   { boss, data: { anim } }
 *  "marker"    { boss, data: { anim, marker } }
 *  "signal"    { boss, triggerEntity, data: { signal } }
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this.handlers = new Map();
  }

  /** @param {string} name @param {(payload: any) => void} fn */
  on(name, fn) {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** @param {string} name @param {any} payload */
  emit(name, payload) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (e) {
        Log.error(`event "${name}" handler failed:`, e);
      }
    }
  }
}
