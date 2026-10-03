// One live boss entity (design doc §4, §10). Holds phase, cooldowns, running
// skills, threat, current animation and variables. The entity is the source of
// truth across reloads: Persistence saves/restores the durable parts.
import { Adapter } from "../adapter/Adapter.js";
import { CancelToken } from "./Scheduler.js";
import { ThreatTable } from "./ThreatTable.js";
import { Log } from "./Logger.js";
import { rotateYaw } from "./vec.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Vector3} Vector3 */
/** @typedef {import("../types/config").AiMode} AiMode */
/** @typedef {import("../types/config").AnimationData} AnimationData */

const DEFAULT_TARGET_RANGE = 32;

export class BossInstance {
  /**
   * @param {Entity} entity
   * @param {import("./Validator.js").CompiledBoss} compiled
   * @param {import("./services.js").Services} services
   */
  constructor(entity, compiled, services) {
    this.entity = entity;
    this.id = entity.id;
    this.compiled = compiled;
    this.config = compiled.config;
    this.services = services;

    /** Root cancel token; every task of this boss descends from it. */
    this.token = new CancelToken();
    this.destroyed = false;
    this.dead = false;

    this.phase = this.config.phases?.[0]?.id ?? 1;
    /** @type {AiMode} */
    this.aiMode = this.config.ai?.default ?? "chase";
    this.aiSeq = 0;
    /** @type {Map<string, number>} skill name → framework tick when ready */
    this.cooldowns = new Map();
    this.gcdUntil = 0;
    /** @type {import("./SkillExecutor.js").SkillRun | null} */
    this.castLock = null;
    /** Casting lock held until this tick (e.g. `state` with lock: true). */
    this.lockUntil = 0;
    /** @type {Set<import("./SkillExecutor.js").SkillRun>} */
    this.runs = new Set();
    /** @type {Record<string, unknown>} */
    this.vars = {};
    this.threat = new ThreatTable();
    /** @type {Set<string>} ids of summoned entities */
    this.summons = new Set();

    this.age = 0;
    this.spawnPoint = Adapter.location(entity.location);
    this.lastLocation = Adapter.location(entity.location);
    this.dimensionId = entity.dimension.id;

    /** @type {{ key: string, data: AnimationData, startTick: number, seq: number } | null} */
    this.anim = null;
    this.animSeq = 0;

    /** Per-tick target cache. */
    this.targetCacheTick = -1;
    /** @type {Entity | undefined} */
    this.targetCache = undefined;
  }

  // -------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------
  get valid() {
    return !this.destroyed && this.entity.isValid;
  }

  get location() {
    return this.entity.isValid ? this.entity.location : this.lastLocation;
  }

  get dimension() {
    return this.entity.isValid ? this.entity.dimension : Adapter.getDimension(this.dimensionId);
  }

  get targetRange() {
    return this.config.ai?.targetRange ?? DEFAULT_TARGET_RANGE;
  }

  healthPct() {
    const h = Adapter.getHealth(this.entity);
    return h.max > 0 ? (h.current / h.max) * 100 : 0;
  }

  /** @param {number} now */
  isCastLocked(now) {
    return this.castLock !== null || now < this.lockUntil;
  }

  /**
   * Current target: highest threat, else nearest targetable player in range.
   * Cached for the current tick.
   */
  getTarget() {
    const now = this.services.scheduler.tick;
    if (this.targetCacheTick === now && (!this.targetCache || this.targetCache.isValid)) return this.targetCache;
    const dim = this.dimension;
    const loc = this.location;
    let t = this.config.threat?.enabled === false ? undefined : this.threat.top(dim, loc, this.targetRange);
    if (!t) {
      let best = Infinity;
      for (const p of Adapter.getTargetablePlayers(dim, loc, this.targetRange)) {
        const d = Math.hypot(p.location.x - loc.x, p.location.y - loc.y, p.location.z - loc.z);
        if (d < best) {
          best = d;
          t = p;
        }
      }
    }
    this.targetCacheTick = now;
    this.targetCache = t;
    return t;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  /** Called once per framework tick by BossManager. */
  tick() {
    this.age++;
    this.lastLocation = Adapter.location(this.entity.location);
    this.dimensionId = this.entity.dimension.id;
    this.faceTarget();
    this.services.bus.emit("tick", { boss: this, data: { age: this.age } });
  }

  /**
   * Turn body and head toward the current target every tick. Vanilla look
   * behaviours stop while frozen/casting and the chase AI only turns the body
   * while walking, so the framework owns facing (config ai.faceTarget, default on).
   */
  faceTarget() {
    if (this.config.ai?.faceTarget === false) return;
    const t = this.getTarget();
    if (t) Adapter.lookAt(this.entity, Adapter.getHeadLocation(t));
  }

  /** Apply the display name / boss bar text. */
  applyDisplay() {
    const name = this.config.display?.name;
    if (name) Adapter.setNameTag(this.entity, name);
  }

  /**
   * @param {AiMode} mode
   * @returns {number} change sequence number (lets timed reverts detect a newer change)
   */
  setAiMode(mode) {
    this.aiMode = mode;
    Adapter.triggerEvent(this.entity, `mb:set_${mode}`);
    return ++this.aiSeq;
  }

  /** @param {boolean} on */
  setInvulnerable(on) {
    Adapter.triggerEvent(this.entity, on ? "mb:invuln_on" : "mb:invuln_off");
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------
  /** Advance phases whose untilHealthPct threshold has been crossed. */
  checkHealthPhase() {
    const phases = this.config.phases;
    if (!phases?.length) return;
    const pct = this.healthPct();
    for (let guard = 0; guard < phases.length; guard++) {
      const idx = phases.findIndex((p) => p.id === this.phase);
      const cur = phases[idx];
      if (!cur || cur.untilHealthPct === undefined || pct > cur.untilHealthPct) return;
      const next = phases[idx + 1];
      if (!next) return;
      this.setPhase(next.id);
    }
  }

  /** @param {number} id */
  setPhase(id) {
    if (id === this.phase || this.destroyed) return;
    const from = this.phase;
    this.phase = id;
    const def = this.config.phases?.find((p) => p.id === id);
    Adapter.setProperty(this.entity, "mb:phase", id);
    for (const [k, v] of Object.entries(def?.properties ?? {})) Adapter.setProperty(this.entity, k, v);

    // Interruptible skills stop on phase change (design doc §7 execution rules).
    for (const run of [...this.runs]) {
      if (run.skill.interruptible) this.services.executor.cancel(this, run);
    }

    Log.debug(`${this.config.id} phase ${from} → ${id}`);
    this.services.bus.emit("phase", { boss: this, data: { from, to: id } });
    for (const name of def?.onEnter ?? []) this.services.executor.castByName(this, name, {}, true);
    this.services.bosses.save(this);
  }

  // -------------------------------------------------------------------------
  // Animation (design doc §6)
  // -------------------------------------------------------------------------
  /**
   * Play an animation from config.animations and schedule its marker / animEnd events.
   * @param {string} key key in config.animations
   * @param {{ controller?: string, blendOutTime?: number, nextState?: string, lock?: boolean }} [opts]
   * @returns {number} animation length in ticks (0 if unknown)
   */
  playAnim(key, opts = {}) {
    const data = this.config.animations?.[key];
    if (!data) {
      Log.warn(`${this.config.id}: unknown animation "${key}"`);
      return 0;
    }
    const scheduler = this.services.scheduler;
    const seq = ++this.animSeq;
    this.anim = { key, data, startTick: scheduler.tick, seq };
    Adapter.playAnimation(this.entity, data.name, {
      controller: opts.controller ?? "mb_action",
      blendOutTime: opts.blendOutTime,
      nextState: opts.nextState,
    });
    if (opts.lock) this.lockUntil = Math.max(this.lockUntil, scheduler.tick + data.length);

    const bus = this.services.bus;
    for (const [marker, at] of Object.entries(data.markers ?? {})) {
      scheduler.after(Math.max(1, at), () => {
        if (this.anim?.seq === seq) bus.emit("marker", { boss: this, data: { anim: key, marker } });
      }, this.token);
    }
    if (!data.loop && data.length > 0) {
      scheduler.after(data.length, () => {
        if (this.anim?.seq !== seq) return;
        this.anim = null;
        bus.emit("animEnd", { boss: this, data: { anim: key } });
      }, this.token);
    }
    return data.length;
  }

  /** Ticks since the current animation started, or -1. */
  animTick() {
    if (!this.anim) return -1;
    const t = this.services.scheduler.tick - this.anim.startTick;
    const len = this.anim.data.length;
    if (len <= 0) return t;
    return this.anim.data.loop ? t % len : Math.min(t, len - 1);
  }

  /**
   * World position of a baked bone at the current tick (design doc §6 runtime lookup).
   * @param {string} bone
   * @returns {Vector3 | undefined}
   */
  getBonePosition(bone) {
    const track = this.anim?.data.bones?.[bone];
    if (!track?.length) return undefined;
    const t = Math.max(0, Math.min(this.animTick(), track.length - 1));
    const [x, y, z] = track[t];
    const s = this.config.stats?.scale ?? 1;
    const r = rotateYaw({ x: x * s, y: y * s, z: z * s }, Adapter.getYaw(this.entity));
    const l = this.location;
    return { x: l.x + r.x, y: l.y + r.y, z: l.z + r.z };
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------
  /** Cancel every pending task and running skill. */
  cancelAll() {
    this.token.cancel();
    this.token = new CancelToken();
    this.runs.clear();
    this.castLock = null;
    this.lockUntil = 0;
  }

  destroy() {
    this.destroyed = true;
    this.token.cancel();
    this.runs.clear();
    this.castLock = null;
  }
}
