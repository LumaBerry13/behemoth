// One central tick loop for the whole framework (design doc §4, §11, L17).
// Every task carries a CancelToken; cancelling a boss's root token drops all
// of its pending work.
import { Adapter } from "../adapter/Adapter.js";
import { Log } from "./Logger.js";

export class CancelToken {
  /** @param {CancelToken} [parent] */
  constructor(parent) {
    this.parent = parent;
    this._cancelled = false;
  }
  get cancelled() {
    return this._cancelled || (this.parent?.cancelled ?? false);
  }
  cancel() {
    this._cancelled = true;
  }
  child() {
    return new CancelToken(this);
  }
}

/** @typedef {{ fn: () => void, token: CancelToken | undefined }} Task */

export class Scheduler {
  constructor() {
    /** Framework tick counter, advanced once per loop iteration. */
    this.tick = 0;
    /** @type {Map<number, Task[]>} */
    this.buckets = new Map();
    /** @type {Set<(tick: number) => void>} */
    this.tickHandlers = new Set();
    this.runId = /** @type {number | undefined} */ (undefined);
  }

  start() {
    if (this.runId !== undefined) return;
    this.runId = Adapter.runInterval(() => this.step(), 1);
  }

  /**
   * Run `fn` after `delayTicks` (≥ 1) unless `token` is cancelled first.
   * @param {number} delayTicks @param {() => void} fn @param {CancelToken} [token]
   */
  after(delayTicks, fn, token) {
    const at = this.tick + Math.max(1, Math.floor(delayTicks));
    let bucket = this.buckets.get(at);
    if (!bucket) this.buckets.set(at, (bucket = []));
    bucket.push({ fn, token });
  }

  /** Called every tick, in registration order. @param {(tick: number) => void} fn */
  onTick(fn) {
    this.tickHandlers.add(fn);
    return () => this.tickHandlers.delete(fn);
  }

  /** @private */
  step() {
    this.tick++;
    for (const h of this.tickHandlers) {
      try {
        h(this.tick);
      } catch (e) {
        Log.error("tick handler failed:", e);
      }
    }
    const bucket = this.buckets.get(this.tick);
    if (!bucket) return;
    this.buckets.delete(this.tick);
    for (const task of bucket) {
      if (task.token?.cancelled) continue;
      try {
        task.fn();
      } catch (e) {
        Log.error("scheduled task failed:", e);
      }
    }
  }
}
