// One live boss entity (design doc §4, §10). Holds phase, cooldowns, running
// skills, threat, current animation and variables. The entity is the source of
// truth across reloads: Persistence saves/restores the durable parts.
import { Adapter } from "../adapter/Adapter.js";
import { CancelToken } from "./Scheduler.js";
import { ThreatTable } from "./ThreatTable.js";
import { Log } from "./Logger.js";
import { rotateYaw, distance } from "./vec.js";

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
    /** @type {Record<string, unknown>} caster-scope variables (initial values: config.variables) */
    this.vars = { ...(this.config.variables ?? {}) };
    /** @type {Map<object, number>} compiled skill line → framework tick when it may run again (line `cooldown`) */
    this.lineCooldowns = new Map();
    /** Effective health multiplier from stats.healthScaling (incoming damage is divided by it). */
    this.healthScale = 1;
    /** Players counted for the current health scale. */
    this.scaledFor = 1;
    /** Framework tick when a `stun` ends (0 = not stunned). */
    this.stunUntil = 0;
    /** @type {{ ai: AiMode, speed: number, facing: boolean } | undefined} state restored when the stun ends */
    this.stunPrev = undefined;
    this.threat = new ThreatTable();
    /** @type {Set<string>} ids of summoned entities */
    this.summons = new Set();
    /** @type {Set<string>} summons removed when this boss dies, despawns or resets (summon{bind}) */
    this.boundSummons = new Set();
    /** While true the boss does not turn toward its target (MythicMobs lockmodel). */
    this.facingLocked = false;
    /** Movement speed multiplier applied to the entity's base movement. */
    this.speedMult = 1;
    /** True while the boss holds position because its target is within ai.stopDistance. */
    this.holding = false;
    /** Script-level invulnerability (all incoming damage cancelled). */
    this.invulnerable = !!this.config.invulnerable;
    /** Ticks without any targetable player in range (for ai.resetAfterNoPlayers). */
    this.noPlayerTicks = 0;
    /** @type {Map<string, Map<string, number>>} hitbox key → entity id → tick it can be hit again */
    this.hitCooldowns = new Map();
    /** @type {Entity | undefined} last entity that damaged the boss */
    this.lastAttacker = undefined;
    /** Target id seen last tick (onCombat / onDropCombat / onChangeTarget). @type {string | undefined} */
    this.combatTargetId = undefined;

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
    if (this.stunUntil && this.services.scheduler.tick >= this.stunUntil) this.endStun();
    this.trackCombat();
    this.faceTarget();
    this.updateHold();
    if (this.age % 20 === 0) this.checkReset();
    if (this.age % 100 === 0) this.updateHealthScale(false);
    this.services.bus.emit("tick", { boss: this, data: { age: this.age } });
  }

  /** Fire combat / dropCombat / changeTarget when the current target changes. */
  trackCombat() {
    const t = this.getTarget();
    const id = t?.id;
    if (id === this.combatTargetId) return;
    const before = this.combatTargetId;
    this.combatTargetId = id;
    const bus = this.services.bus;
    if (!before && t) bus.emit("combat", { boss: this, triggerEntity: t });
    if (before && !t) bus.emit("dropCombat", { boss: this });
    if (t) bus.emit("changeTarget", { boss: this, triggerEntity: t, data: { previous: before } });
  }

  /**
   * Stop walking once the target is within ai.stopDistance (vanilla melee
   * chase would otherwise push into the player); resume past +0.75 blocks.
   * Skill speed boosts (multiplier > 1, e.g. lunges) are never held back.
   */
  updateHold() {
    const stop = this.config.ai?.stopDistance;
    if (!stop) return;
    const t = this.getTarget();
    let hold = false;
    if (t && this.speedMult <= 1) {
      const a = this.location;
      const b = t.location;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      hold = this.holding ? d <= stop + 0.75 : d <= stop;
    }
    if (hold !== this.holding) {
      this.holding = hold;
      this.applySpeed();
    }
  }

  /**
   * Turn body and head toward the current target every tick. Vanilla look
   * behaviours stop while frozen/casting and the chase AI only turns the body
   * while walking, so the framework owns facing (config ai.faceTarget, default on).
   */
  faceTarget() {
    if (this.facingLocked || this.config.ai?.faceTarget === false) return;
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
    Adapter.triggerEvent(this.entity, `bhm:set_${mode}`);
    return ++this.aiSeq;
  }

  /**
   * Script-level invulnerability: BossManager cancels every incoming hit in the
   * entityHurt before-event. (The stub's bhm:invulnerable component group is no
   * longer used: removing a group that defines minecraft:damage_sensor also
   * removes the entity's own sensor, e.g. a custom-death sensor.)
   * @param {boolean} on
   */
  setInvulnerable(on) {
    this.invulnerable = on;
  }

  /**
   * stats.healthScaling (D7): effective health = health × (1 + perPlayer × (players − 1)),
   * counting targetable players within `radius` (default targetRange), capped at `max`.
   * Implemented by dividing incoming damage, so the boss bar shows the true fraction.
   * Recomputed from scratch on spawn and reset; during a fight it only goes up.
   * @param {boolean} fresh
   */
  updateHealthScale(fresh) {
    const hs = this.config.stats?.healthScaling;
    if (!hs || this.dead) return;
    const n = Math.max(1, Adapter.getTargetablePlayers(this.dimension, this.location, hs.radius ?? this.targetRange).length);
    const m = Math.max(1, Math.min(hs.max ?? 10, 1 + hs.perPlayer * (n - 1)));
    if (!fresh && m <= this.healthScale) return;
    if (m !== this.healthScale) Log.debug(`${this.config.id}: health scale ×${m.toFixed(2)} (${n} player(s))`);
    this.healthScale = m;
    this.scaledFor = n;
  }

  /**
   * Stun (MythicMobs `stun`): frozen AI, no movement, no turning, for `ticks`.
   * Re-stunning extends it; the previous state comes back when it ends.
   * @param {number} ticks
   */
  stun(ticks) {
    if (!this.stunUntil) {
      this.stunPrev = { ai: this.aiMode, speed: this.speedMult, facing: this.facingLocked };
      this.setAiMode("frozen");
      this.setSpeed(0);
      this.facingLocked = true;
    }
    this.stunUntil = Math.max(this.stunUntil, this.services.scheduler.tick + ticks);
  }

  endStun() {
    const prev = this.stunPrev;
    this.stunUntil = 0;
    this.stunPrev = undefined;
    if (!prev) return;
    this.setAiMode(prev.ai);
    this.setSpeed(prev.speed);
    this.facingLocked = prev.facing;
  }

  // -------------------------------------------------------------------------
  // Reset / leash (design doc §10)
  // -------------------------------------------------------------------------
  /** Called every 20 ticks. */
  checkReset() {
    const ai = this.config.ai ?? {};
    const loc = this.location;
    if (ai.leashRange && distance(loc, this.spawnPoint) > ai.leashRange) {
      this.reset("left its leash range");
      return;
    }
    if (!ai.resetAfterNoPlayers) return;
    const anyone = Adapter.getTargetablePlayers(this.dimension, loc, this.targetRange).length > 0;
    this.noPlayerTicks = anyone ? 0 : this.noPlayerTicks + 20;
    if (this.noPlayerTicks >= ai.resetAfterNoPlayers && this.needsReset()) this.reset("no players nearby");
  }

  /** Anything to undo? Avoids resetting an untouched boss every interval. */
  needsReset() {
    const firstPhase = this.config.phases?.[0]?.id ?? 1;
    return this.healthPct() < 100 || this.phase !== firstPhase || this.threat.threat.size > 0
      || distance(this.location, this.spawnPoint) > 3;
  }

  /**
   * Return to the start of the fight: cancel skills, full health, first phase,
   * clear threat and cooldowns, back to the spawn point. Fires the `reset`
   * event (onReset trigger). Tags and variables are kept.
   * @param {string} reason
   */
  reset(reason) {
    this.services.bosses.releaseSummons(this);
    this.cancelAll();
    this.noPlayerTicks = 0;
    const h = Adapter.getHealth(this.entity);
    Adapter.setHealth(this.entity, h.max);
    const first = this.config.phases?.[0];
    this.phase = first?.id ?? 1;
    Adapter.setProperty(this.entity, "bhm:phase", this.phase);
    for (const [k, v] of Object.entries(first?.properties ?? {})) Adapter.setProperty(this.entity, k, v);
    this.threat.clear();
    this.cooldowns.clear();
    this.lineCooldowns.clear();
    this.hitCooldowns.clear();
    this.stunUntil = 0;
    this.stunPrev = undefined;
    this.updateHealthScale(true);
    this.gcdUntil = 0;
    this.invulnerable = !!this.config.invulnerable;
    this.facingLocked = false;
    this.setSpeed(1);
    this.setAiMode(this.config.ai?.default ?? "chase");
    Adapter.clearVelocity(this.entity);
    Adapter.teleport(this.entity, this.spawnPoint);
    Log.info(`${this.config.id} reset (${reason})`);
    this.services.bus.emit("reset", { boss: this, data: { reason } });
    this.services.bosses.save(this);
  }

  /** Movement speed as a multiple of the entity's base speed (0 = rooted). @param {number} mult */
  setSpeed(mult) {
    this.speedMult = mult;
    if (mult > 1) this.holding = false;
    this.applySpeed();
  }

  applySpeed() {
    Adapter.setMovement(this.entity, this.holding ? 0 : this.baseSpeed * this.speedMult);
  }

  /**
   * Base walk speed: config.stats.movementSpeed (the entity JSON minecraft:movement
   * value), else the attribute's default.
   */
  get baseSpeed() {
    return this.config.stats?.movementSpeed ?? Adapter.getMovement(this.entity)?.default ?? 0.25;
  }

  /**
   * Select the client base-layer animation (idle or walk) by animation key,
   * using config.baseStates and the bhm:idle_state / bhm:walk_state properties.
   * @param {"idle" | "walk"} type @param {string} anim
   * @returns {boolean} false if the animation is not in config.baseStates[type]
   */
  setBaseState(type, anim) {
    const idx = this.config.baseStates?.[type]?.indexOf(anim) ?? -1;
    if (idx < 0) return false;
    Adapter.setProperty(this.entity, `bhm:${type}_state`, idx);
    return true;
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
    Adapter.setProperty(this.entity, "bhm:phase", id);
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
      controller: opts.controller ?? "bhm_action",
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
   * World position of a baked bone pivot at the current tick (design doc §6
   * runtime lookup). Falls back to the rest pose when the current animation has
   * no track for it (e.g. idle/walk, which play client-side).
   * @param {string} bone
   * @returns {Vector3 | undefined}
   */
  getBonePosition(bone) {
    const track = this.anim?.data.bones?.[bone];
    /** @type {[number, number, number] | undefined} */
    let p;
    if (track?.length) p = track[Math.max(0, Math.min(this.animTick(), track.length - 1))];
    else p = this.config.restPose?.[bone]; // no (baked) action animation playing
    if (!p) return undefined;
    const [x, y, z] = p;
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
