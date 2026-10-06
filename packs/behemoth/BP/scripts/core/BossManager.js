// Binds boss configs to entity types, owns live BossInstances, and translates
// Script API events into framework events (design doc §4, §10).
import { Adapter } from "../adapter/Adapter.js";
import { BossInstance } from "./BossInstance.js";
import { Persistence } from "./Persistence.js";
import { Log } from "./Logger.js";
import { Random } from "./Random.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("./Validator.js").CompiledBoss} CompiledBoss */

const SAVE_INTERVAL_TICKS = 100;
/** How long a dead boss keeps running its onDeath skills before teardown. */
const DEATH_LINGER_TICKS = 100;

export class BossManager {
  /** @param {import("./services.js").Services} services */
  constructor(services) {
    this.services = services;
    /** @type {Map<string, CompiledBoss>} entity type id → compiled config */
    this.configs = new Map();
    /** @type {Map<string, BossInstance>} entity id → instance */
    this.instances = new Map();
    /** True once the world is loaded and the first scan ran. */
    this.started = false;
    /** @type {Map<string, number>} summoned entity id → framework tick to remove it */
    this.temporaries = new Map();
    /**
     * Temporary blocks placed by skills, restored to air when due. Persisted in a
     * world dynamic property so a reload never leaves them behind.
     * @type {{ dim: string, x: number, y: number, z: number, type: string, until: number }[]}
     */
    this.tempBlocks = [];
  }

  /**
   * Bind a validated boss config (from a boss pack, via the Registrar) and take
   * over entities of that type already in loaded chunks. Re-registering a type
   * (pack updated) restarts its live bosses from their saved state.
   * @param {CompiledBoss} compiled
   */
  register(compiled) {
    const id = compiled.config.id;
    if (this.configs.has(id)) {
      for (const boss of this.all().filter((b) => b.config.id === id)) {
        Persistence.save(boss, this.services.scheduler.tick);
        boss.destroy();
        this.instances.delete(boss.id);
      }
    }
    this.configs.set(id, compiled);
    if (this.started) this.scanType(id);
  }

  /** Stop driving a boss type (its pack dropped it). @param {string} typeId */
  unregister(typeId) {
    this.configs.delete(typeId);
    for (const boss of this.all().filter((b) => b.config.id === typeId)) {
      boss.destroy();
      this.instances.delete(boss.id);
    }
  }

  /** Subscribe to events and start ticking. Bosses are registered later by boss packs. */
  init() {
    this.subscribe();
    this.services.scheduler.onTick((tick) => this.tickAll(tick));
    // Bosses already loaded when scripts (re)load never fire entityLoad.
    this.services.scheduler.after(1, () => {
      this.started = true;
      this.restoreSavedBlocks();
      this.scanLoaded();
    });
  }

  /** @private */
  subscribe() {
    const ev = Adapter.events;
    const bus = this.services.bus;

    ev.onEntitySpawn((entity) => this.attach(entity));
    ev.onEntityLoad((entity) => this.attach(entity));

    // Runs in a before-event: no world writes here.
    ev.onEntityHurtBefore((hurt, damage, cause, damager) => {
      const boss = this.instances.get(hurt.id);
      const attacker = damager ? this.instances.get(damager.id) : undefined;
      // Vanilla melee from a boss is cancelled (MythicMobs `CancelEvent ~onAttack`):
      // the chase AI uses melee_attack only for pathfinding; damage comes from skills.
      if (attacker && !Adapter.isFrameworkDamage() && attacker.config.ai?.vanillaMelee !== true && cause === "entityAttack") {
        return { cancel: true };
      }
      // Bosses never hurt each other (one shared faction) unless ai.friendlyFire.
      if (attacker && boss && attacker !== boss && attacker.config.ai?.friendlyFire !== true) return { cancel: true };
      if (boss?.invulnerable && !boss.dead) return { cancel: true };
      // MythicMobs DamageModifiers on the boss itself.
      const mod = boss?.config.damageModifiers?.[cause];
      if (mod === undefined || boss.dead) return;
      if (mod > 0) return { damage: damage * mod };
      if (mod < 0) {
        const heal = damage * -mod;
        Adapter.run(() => Adapter.setHealth(hurt, Adapter.getHealth(hurt).current + heal));
      }
      return { cancel: true };
    });

    ev.onEntityHurt((hurt, damager, damage, cause) => {
      const boss = this.instances.get(hurt.id);
      if (!boss || boss.dead) return;
      if (damager) boss.lastAttacker = damager;
      if (damager && Adapter.isPlayer(damager)) boss.threat.add(damager, damage);
      bus.emit("damaged", { boss, triggerEntity: damager, data: { damage, cause } });
      boss.checkHealthPhase();
    });

    ev.onEntityHitEntity((attacker, victim) => {
      const boss = this.instances.get(attacker.id);
      if (boss && !boss.dead) bus.emit("attack", { boss, triggerEntity: victim });
    });

    ev.onEntityDie((dead, killer, cause) => {
      const boss = this.instances.get(dead.id);
      if (boss) this.handleDeath(boss, killer, cause);
      // Players leave every threat table when they die.
      if (Adapter.isPlayer(dead)) for (const b of this.instances.values()) b.threat.drop(dead.id);
    });

    // Custom death driven by the entity JSON (fatal damage_sensor → death animation → despawn).
    ev.onDataDrivenTrigger((entity, eventId) => {
      const boss = this.instances.get(entity.id);
      if (boss && boss.config.death?.event === eventId) this.handleDeath(boss, boss.lastAttacker, "custom");
    });

    ev.onPlayerInteractWithEntity((player, target) => {
      const boss = this.instances.get(target.id);
      if (boss && !boss.dead) bus.emit("interact", { boss, triggerEntity: player });
    });
  }

  /** @param {string} typeId */
  isBossType(typeId) {
    return this.configs.has(typeId);
  }

  /**
   * Create (or rebuild) the instance for a boss entity. Fresh spawns fire onSpawn;
   * entities with persisted state resume silently.
   * @param {Entity} entity
   */
  attach(entity) {
    if (!entity.isValid || this.instances.has(entity.id)) return this.instances.get(entity.id);
    const compiled = this.configs.get(entity.typeId);
    if (!compiled) return undefined;
    if (Persistence.isDead(entity)) {
      // Reloaded while its death animation was playing: never re-arm, make sure it goes away.
      this.trackTemporary(entity, 40);
      return undefined;
    }

    const boss = new BossInstance(entity, compiled, this.services);
    const now = this.services.scheduler.tick;
    const saved = Persistence.load(entity);
    this.instances.set(entity.id, boss);

    if (saved) {
      Persistence.apply(boss, saved, now);
      Adapter.setProperty(entity, "bhm:phase", boss.phase);
      // Running skills are not persisted, so undo any temporary state they set
      // (frozen AI, invulnerability) instead of resuming stuck in it.
      boss.setAiMode(compiled.config.ai?.default ?? "chase");
      boss.setSpeed(boss.speedMult);
      boss.applyDisplay();
      Log.debug(`resumed ${entity.typeId} (${entity.id}) in phase ${boss.phase}`);
      return boss;
    }

    const h = Adapter.getHealth(entity);
    const want = compiled.config.stats?.health;
    if (want !== undefined && h.max !== want) {
      Log.warn(`${entity.typeId}: entity JSON max health ${h.max} differs from config stats.health ${want}`);
    }
    const first = compiled.config.phases?.[0];
    Adapter.setProperty(entity, "bhm:phase", boss.phase);
    for (const [k, v] of Object.entries(first?.properties ?? {})) Adapter.setProperty(entity, k, v);
    boss.setAiMode(boss.aiMode);
    boss.applyDisplay();
    this.save(boss);
    Log.debug(`spawned ${entity.typeId} (${entity.id})`);
    this.services.bus.emit("spawn", { boss });
    return boss;
  }

  /** @private @param {string} typeId */
  scanType(typeId) {
    for (const dim of Adapter.getAllDimensions()) {
      for (const e of Adapter.getEntities(dim, { type: typeId })) this.attach(e);
    }
  }

  /** @private */
  scanLoaded() {
    for (const dim of Adapter.getAllDimensions()) {
      for (const typeId of this.configs.keys()) {
        for (const e of Adapter.getEntities(dim, { type: typeId })) this.attach(e);
      }
    }
    if (this.instances.size) Log.info(`resumed ${this.instances.size} loaded boss(es)`);
  }

  /** @private @param {number} tick */
  tickAll(tick) {
    if (tick % 10 === 0) {
      this.sweepTemporaries(tick);
      this.sweepBlocks(tick);
    }
    for (const [id, boss] of this.instances) {
      if (!boss.entity.isValid) {
        // Unloaded (chunk) or removed: drop the in-memory instance. It is
        // rebuilt from persisted state on the next entityLoad.
        boss.destroy();
        this.instances.delete(id);
        continue;
      }
      boss.tick();
      if (boss.age % SAVE_INTERVAL_TICKS === 0) Persistence.save(boss, tick);
    }
  }

  /** @param {BossInstance} boss */
  save(boss) {
    Persistence.save(boss, this.services.scheduler.tick);
  }

  /**
   * @param {BossInstance} boss @param {Entity | undefined} killer @param {string} cause
   */
  handleDeath(boss, killer, cause) {
    if (boss.dead) return;
    boss.dead = true;
    boss.cancelAll();
    this.instances.delete(boss.id);
    if (boss.entity.isValid) {
      // Custom-death bosses stay in the world while their death animation plays:
      // stop AI and movement, and make sure a reload never re-arms them.
      Persistence.markDead(boss.entity);
      boss.facingLocked = true;
      boss.setSpeed(0);
      boss.setAiMode("frozen");
      // Backstop: if the entity JSON's own despawn never happens, remove the body.
      if (boss.config.death?.event) this.trackTemporary(boss.entity, boss.config.death.removeAfter ?? 400);
    }
    this.services.bus.emit("death", { boss, triggerEntity: killer, data: { cause } });
    this.spawnDrops(boss);
    this.services.scheduler.after(DEATH_LINGER_TICKS, () => boss.destroy());
    Log.debug(`${boss.config.id} died (${cause})`);
  }

  /** @private @param {BossInstance} boss */
  spawnDrops(boss) {
    const dim = boss.dimension;
    const loc = boss.location;
    for (const d of boss.config.drops ?? []) {
      if (!Random.chance(d.chance ?? 1)) continue;
      const amount = Array.isArray(d.amount) ? Random.int(d.amount[0], d.amount[1]) : (d.amount ?? 1);
      if (amount > 0 && !Adapter.spawnItem(dim, d.item, amount, loc)) Log.warn(`drop "${d.item}" failed to spawn`);
    }
  }

  /**
   * Remove a summoned entity after `ticks` (framework-wide, survives the boss's death).
   * @param {Entity} entity @param {number} ticks
   */
  trackTemporary(entity, ticks) {
    this.temporaries.set(entity.id, this.services.scheduler.tick + ticks);
  }

  /** @private @param {number} tick */
  sweepTemporaries(tick) {
    for (const [id, until] of this.temporaries) {
      if (until > tick) continue;
      this.temporaries.delete(id);
      const e = Adapter.getEntity(id);
      if (e) Adapter.remove(e);
    }
  }

  /**
   * Place temporary blocks (air only) that turn back to air after `ticks`.
   * Respects the mobGriefing game rule unless `force`.
   * @param {import("@minecraft/server").Dimension} dim
   * @param {import("@minecraft/server").Vector3[]} locs @param {string} type @param {number} ticks @param {boolean} [force]
   * @returns {number} blocks placed
   */
  placeTempBlocks(dim, locs, type, ticks, force = false) {
    if (!force && !Adapter.mobGriefing()) return 0;
    const until = this.services.scheduler.tick + ticks;
    let n = 0;
    for (const l of locs) {
      const p = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
      if (!Adapter.placeIfAir(dim, p, type)) continue;
      this.tempBlocks.push({ dim: dim.id, ...p, type, until });
      n++;
    }
    if (n) this.saveBlocks();
    return n;
  }

  /** @private @param {number} tick */
  sweepBlocks(tick) {
    if (!this.tempBlocks.length) return;
    const keep = [];
    for (const b of this.tempBlocks) {
      if (b.until > tick) keep.push(b);
      else Adapter.clearIfType(Adapter.getDimension(b.dim), b, b.type);
    }
    if (keep.length !== this.tempBlocks.length) {
      this.tempBlocks = keep;
      this.saveBlocks();
    }
  }

  /** @private */
  saveBlocks() {
    // Ticks are relative to this session's scheduler, so persist remaining ticks.
    const now = this.services.scheduler.tick;
    const data = this.tempBlocks.map((b) => ({ ...b, until: b.until - now }));
    Adapter.setWorldDynamic("bhm:tempblocks", data.length ? JSON.stringify(data) : undefined);
  }

  /** @private Restore blocks left by a previous session (reload / crash). */
  restoreSavedBlocks() {
    const raw = Adapter.getWorldDynamic("bhm:tempblocks");
    if (typeof raw !== "string") return;
    try {
      for (const b of JSON.parse(raw)) Adapter.clearIfType(Adapter.getDimension(b.dim), b, b.type);
    } catch {
      /* corrupt: drop it */
    }
    Adapter.setWorldDynamic("bhm:tempblocks", undefined);
  }

  /**
   * Send a framework signal to bosses (onSignal trigger).
   * @param {BossInstance[]} bosses @param {string} signal @param {import("@minecraft/server").Entity | undefined} from
   */
  signal(bosses, signal, from) {
    for (const boss of bosses) this.services.bus.emit("signal", { boss, triggerEntity: from, data: { signal } });
  }

  /** Remove a boss without drops or death skills. @param {BossInstance} boss */
  despawn(boss) {
    boss.destroy();
    this.instances.delete(boss.id);
    Adapter.triggerEvent(boss.entity, "bhm:despawn");
  }

  /**
   * @param {string} typeId @param {import("@minecraft/server").Dimension} dim @param {import("@minecraft/server").Vector3} loc
   */
  spawn(typeId, dim, loc) {
    const e = Adapter.spawnEntity(dim, typeId, loc);
    return e ? this.attach(e) : undefined;
  }

  /** @param {string} entityId */
  get(entityId) {
    return this.instances.get(entityId);
  }

  all() {
    return [...this.instances.values()];
  }

  /**
   * Nearest live boss to a location in the same dimension.
   * @param {import("@minecraft/server").Dimension} dim @param {import("@minecraft/server").Vector3} loc @param {number} range
   */
  nearest(dim, loc, range) {
    let best;
    let bestD = range;
    for (const b of this.instances.values()) {
      if (b.dead || b.dimension.id !== dim.id) continue;
      const l = b.location;
      const d = Math.hypot(l.x - loc.x, l.y - loc.y, l.z - loc.z);
      if (d <= bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }
}
