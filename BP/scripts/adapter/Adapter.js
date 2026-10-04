// The ONLY file that imports @minecraft/server (design doc §4, L18).
// Pinned API: @minecraft/server 2.10.0. All names below were checked against
// the 2.10.0 typings (node_modules/@minecraft/server/index.d.ts); anything
// confirmed only by in-game behaviour is marked [VERIFY].
import {
  world,
  system,
  Entity,
  Player,
  GameMode,
  ItemStack,
  MolangVariableMap,
  EntityDamageCause,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";

/** @typedef {import("@minecraft/server").Vector3} Vector3 */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {import("../types/config").Location} Location */
/** @typedef {import("../types/config").Target} Target */

const DIMENSION_IDS = ["overworld", "nether", "the_end"];
const EXCLUDED_GAME_MODES = [GameMode.Creative, GameMode.Spectator];

/** Particle budget (design doc §11). */
const PARTICLES_PER_TICK = 200;
const PARTICLE_VIEW_RANGE = 64;

/** True while the framework itself is applying damage (see applyDamage / isFrameworkDamage). */
let frameworkDamage = false;

let particleTick = -1;
let particlesThisTick = 0;

export const Adapter = {
  // -------------------------------------------------------------------------
  // System
  // -------------------------------------------------------------------------
  get currentTick() {
    return system.currentTick;
  },
  /** @param {() => void} fn @param {number} [ticks] */
  runInterval(fn, ticks = 1) {
    return system.runInterval(fn, ticks);
  },
  /** Defer to a context where world writes are allowed (L19). @param {() => void} fn */
  run(fn) {
    return system.run(fn);
  },
  /** @param {Generator<void, void, void>} gen */
  runJob(gen) {
    return system.runJob(gen);
  },

  // -------------------------------------------------------------------------
  // Events → plain callbacks (EventBus wraps these)
  // -------------------------------------------------------------------------
  events: {
    /** @param {(s: import("@minecraft/server").StartupEvent) => void} cb */
    onStartup(cb) {
      system.beforeEvents.startup.subscribe(cb);
    },
    /** @param {() => void} cb */
    onWorldLoad(cb) {
      world.afterEvents.worldLoad.subscribe(cb);
    },
    /** @param {(entity: Entity, cause: string) => void} cb */
    onEntitySpawn(cb) {
      world.afterEvents.entitySpawn.subscribe((e) => cb(e.entity, e.cause));
    },
    /** @param {(entity: Entity) => void} cb */
    onEntityLoad(cb) {
      world.afterEvents.entityLoad.subscribe((e) => cb(e.entity));
    },
    /** @param {(hurt: Entity, damager: Entity | undefined, damage: number, cause: string) => void} cb */
    onEntityHurt(cb) {
      world.afterEvents.entityHurt.subscribe((e) =>
        cb(e.hurtEntity, e.damageSource.damagingEntity, e.damage, e.damageSource.cause)
      );
    },
    /**
     * Before-event: the callback may cancel or rescale damage. It runs in a
     * restricted context, so it must not change the world (L19).
     * @param {(hurt: Entity, damage: number, cause: string, damager: Entity | undefined) => ({ cancel?: boolean, damage?: number } | void)} cb
     */
    onEntityHurtBefore(cb) {
      world.beforeEvents.entityHurt.subscribe((e) => {
        const r = cb(e.hurtEntity, e.damage, e.damageSource.cause, e.damageSource.damagingEntity);
        if (!r) return;
        if (r.cancel) e.cancel = true;
        else if (r.damage !== undefined) e.damage = r.damage;
      });
    },
    /** Entity JSON event fired (e.g. a custom death event). @param {(entity: Entity, eventId: string) => void} cb */
    onDataDrivenTrigger(cb) {
      world.afterEvents.dataDrivenEntityTrigger.subscribe((e) => cb(e.entity, e.eventId));
    },
    /** @param {(dead: Entity, killer: Entity | undefined, cause: string) => void} cb */
    onEntityDie(cb) {
      world.afterEvents.entityDie.subscribe((e) =>
        cb(e.deadEntity, e.damageSource.damagingEntity, e.damageSource.cause)
      );
    },
    /** @param {(attacker: Entity, victim: Entity) => void} cb */
    onEntityHitEntity(cb) {
      world.afterEvents.entityHitEntity.subscribe((e) => cb(e.damagingEntity, e.hitEntity));
    },
    /** Fires before removal while the entity is still readable. @param {(entity: Entity) => void} cb */
    onEntityRemoveBefore(cb) {
      world.beforeEvents.entityRemove.subscribe((e) => cb(e.removedEntity));
    },
    /** @param {(player: Player, target: Entity) => void} cb */
    onPlayerInteractWithEntity(cb) {
      world.afterEvents.playerInteractWithEntity.subscribe((e) => cb(e.player, e.target));
    },
    /** @param {(id: string, message: string, source: Entity | undefined) => void} cb */
    onScriptEvent(cb) {
      system.afterEvents.scriptEventReceive.subscribe((e) => cb(e.id, e.message, e.sourceEntity));
    },
  },

  // -------------------------------------------------------------------------
  // Custom commands (registered during startup)
  // -------------------------------------------------------------------------
  commands: {
    ParamType: CustomCommandParamType,
    /**
     * @param {import("@minecraft/server").StartupEvent} startup
     * @param {string} enumName
     * @param {string[]} values
     */
    registerEnum(startup, enumName, values) {
      startup.customCommandRegistry.registerEnum(enumName, values);
    },
    /**
     * Callbacks run in a restricted context; `handler` is deferred with system.run
     * so it may change the world. [VERIFY: restriction level of command callbacks]
     * @param {import("@minecraft/server").StartupEvent} startup
     * @param {{ name: string, description: string, mandatory?: {name: string, type: any}[], optional?: {name: string, type: any}[] }} def
     * @param {(player: Player | undefined, ...args: any[]) => string | void} handler
     */
    register(startup, def, handler) {
      startup.customCommandRegistry.registerCommand(
        {
          name: def.name,
          description: def.description,
          permissionLevel: CommandPermissionLevel.GameDirectors,
          cheatsRequired: true,
          mandatoryParameters: def.mandatory ?? [],
          optionalParameters: def.optional ?? [],
        },
        (origin, ...args) => {
          const src = origin.sourceEntity;
          const player = src instanceof Player ? src : undefined;
          system.run(() => {
            const msg = handler(player, ...args);
            if (msg && player?.isValid) player.sendMessage(msg);
          });
          return { status: CustomCommandStatus.Success };
        }
      );
    },
  },

  // -------------------------------------------------------------------------
  // Type helpers
  // -------------------------------------------------------------------------
  /** @param {unknown} t @returns {t is Entity} */
  isEntity(t) {
    return t instanceof Entity;
  },
  /** @param {unknown} t @returns {t is Player} */
  isPlayer(t) {
    return t instanceof Player;
  },
  /** @param {Entity | undefined} e */
  isValid(e) {
    return !!e && e.isValid;
  },
  /** @param {Vector3} v @returns {Location} */
  location(v) {
    return { x: v.x, y: v.y, z: v.z, isLocation: true };
  },
  /** @param {Target} t @returns {Vector3} */
  locOf(t) {
    return t instanceof Entity ? t.location : t;
  },

  // -------------------------------------------------------------------------
  // World / dimensions
  // -------------------------------------------------------------------------
  /** @param {string} id */
  getDimension(id) {
    return world.getDimension(id);
  },
  getAllDimensions() {
    return DIMENSION_IDS.map((id) => world.getDimension(id));
  },
  /** @param {string} id */
  getEntity(id) {
    return world.getEntity(id);
  },
  getAllPlayers() {
    return world.getAllPlayers();
  },
  /** World difficulty: "Peaceful" | "Easy" | "Normal" | "Hard". */
  getDifficulty() {
    return String(world.getDifficulty());
  },
  /** @param {string} msg */
  broadcast(msg) {
    world.sendMessage(msg);
  },

  /**
   * @param {Dimension} dim
   * @param {import("@minecraft/server").EntityQueryOptions} query
   */
  getEntities(dim, query) {
    return dim.getEntities(query);
  },

  /**
   * Players that can be targeted: survival/adventure, within range.
   * @param {Dimension} dim @param {Vector3} loc @param {number} range
   */
  getTargetablePlayers(dim, loc, range) {
    return dim.getPlayers({ location: loc, maxDistance: range, excludeGameModes: EXCLUDED_GAME_MODES });
  },

  /** @param {Entity} e */
  isTargetablePlayer(e) {
    if (!(e instanceof Player) || !e.isValid) return false;
    const gm = e.getGameMode();
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  },

  /**
   * @param {Dimension} dim @param {string} typeId @param {Vector3} loc
   * @returns {Entity | undefined}
   */
  spawnEntity(dim, typeId, loc) {
    try {
      return dim.spawnEntity(typeId, loc);
    } catch {
      return undefined; // unloaded chunk or invalid type
    }
  },

  /**
   * Spawns a batch of particles with view-range culling and a per-tick budget.
   * @param {Dimension} dim @param {string} particle @param {Vector3[]} locs
   * @param {Record<string, number | {red:number, green:number, blue:number, alpha?:number}>} [vars]
   * @returns {number} particles actually spawned
   */
  spawnParticles(dim, particle, locs, vars) {
    if (locs.length === 0) return 0;
    if (dim.getPlayers({ location: locs[0], maxDistance: PARTICLE_VIEW_RANGE }).length === 0) return 0;
    const tick = system.currentTick;
    if (tick !== particleTick) {
      particleTick = tick;
      particlesThisTick = 0;
    }
    let map;
    if (vars) {
      map = new MolangVariableMap();
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === "number") map.setFloat(k, v);
        else map.setColorRGBA(k, { red: v.red, green: v.green, blue: v.blue, alpha: v.alpha ?? 1 });
      }
    }
    let n = 0;
    for (const loc of locs) {
      if (particlesThisTick >= PARTICLES_PER_TICK) break;
      try {
        dim.spawnParticle(particle, loc, map);
        particlesThisTick++;
        n++;
      } catch {
        // chunk unloaded / unknown particle: skip silently
      }
    }
    return n;
  },

  /** @param {Dimension} dim @param {string} itemId @param {number} amount @param {Vector3} loc */
  spawnItem(dim, itemId, amount, loc) {
    try {
      dim.spawnItem(new ItemStack(itemId, amount), loc);
      return true;
    } catch {
      return false; // unknown item id or unloaded chunk
    }
  },

  /** Block type id at a location, or "" if unloaded. @param {Dimension} dim @param {Vector3} loc */
  getBlockTypeId(dim, loc) {
    try {
      return dim.getBlock(loc)?.typeId ?? "";
    } catch {
      return "";
    }
  },

  /**
   * Y of the first walkable surface at or below `loc` (for on-surface summons).
   * @param {Dimension} dim @param {Vector3} loc
   */
  surfaceY(dim, loc) {
    try {
      const block = dim.getBlockBelow({ x: loc.x, y: loc.y + 1, z: loc.z });
      return block ? block.location.y + 1 : loc.y;
    } catch {
      return loc.y;
    }
  },

  /** @param {Dimension} dim @param {string} sound @param {Vector3} loc @param {number} [volume] @param {number} [pitch] */
  playSound(dim, sound, loc, volume = 1, pitch = 1) {
    try {
      dim.playSound(sound, loc, { volume, pitch });
    } catch {
      /* unloaded chunk */
    }
  },

  // -------------------------------------------------------------------------
  // Entity operations — every call guards isValid
  // -------------------------------------------------------------------------
  /** @param {Entity} e */
  getHealth(e) {
    const h = e.isValid ? e.getComponent("minecraft:health") : undefined;
    return h ? { current: h.currentValue, max: h.effectiveMax } : { current: 0, max: 0 };
  },
  /** @param {Entity} e @param {number} value */
  setHealth(e, value) {
    const h = e.isValid ? e.getComponent("minecraft:health") : undefined;
    if (h) h.setCurrentValue(Math.max(0, Math.min(value, h.effectiveMax)));
  },

  /**
   * @param {Entity} target @param {number} amount
   * @param {Entity} [source] @param {string} [cause] an EntityDamageCause value
   */
  applyDamage(target, amount, source, cause = "entityAttack") {
    if (!target.isValid) return false;
    const c = /** @type {EntityDamageCause} */ (cause);
    frameworkDamage = true;
    try {
      return target.applyDamage(amount, source?.isValid ? { cause: c, damagingEntity: source } : { cause: c });
    } finally {
      frameworkDamage = false;
    }
  },
  /**
   * True inside applyDamage, i.e. the hurt before-event comes from a framework
   * mechanic rather than vanilla AI. Relies on the before-event firing
   * synchronously during Entity.applyDamage. [VERIFY in-game: framework hits still land]
   */
  isFrameworkDamage() {
    return frameworkDamage;
  },

  /**
   * Velocity change. Players need applyKnockback; mobs take applyImpulse.
   * @param {Entity} e @param {Vector3} v
   */
  push(e, v) {
    if (!e.isValid) return;
    if (e instanceof Player) {
      e.applyKnockback({ x: v.x, z: v.z }, v.y);
    } else {
      e.applyImpulse(v);
    }
  },
  /** @param {Entity} e */
  clearVelocity(e) {
    if (e.isValid) e.clearVelocity();
  },
  /** @param {Entity} e */
  getVelocity(e) {
    return e.isValid ? e.getVelocity() : { x: 0, y: 0, z: 0 };
  },
  /**
   * Set the movement attribute (blocks/tick-ish, as in minecraft:movement). L7.
   * @param {Entity} e @param {number} value
   */
  setMovement(e, value) {
    const m = e.isValid ? e.getComponent("minecraft:movement") : undefined;
    if (m) m.setCurrentValue(Math.max(0, value));
  },
  /** Movement attribute defaults, for diagnostics. @param {Entity} e */
  getMovement(e) {
    const m = e.isValid ? e.getComponent("minecraft:movement") : undefined;
    return m ? { current: m.currentValue, default: m.defaultValue } : undefined;
  },
  /**
   * Put the player's shield on cooldown (MythicMobs shieldbreak).
   * [VERIFY] "shield" is the cooldown category used by the vanilla shield.
   * @param {Player} p @param {number} ticks
   */
  shieldCooldown(p, ticks) {
    if (!p.isValid) return;
    try {
      p.startItemCooldown("shield", ticks);
    } catch {
      /* unknown category */
    }
  },
  /** @param {Entity} e @param {Vector3} loc @param {Vector3} [facing] */
  teleport(e, loc, facing) {
    if (e.isValid) e.teleport(loc, facing ? { facingLocation: facing } : undefined);
  },
  /**
   * Face a location: yaw turns the body, pitch tilts the head (mobs).
   * @param {Entity} e @param {Vector3} loc
   */
  lookAt(e, loc) {
    if (!e.isValid) return;
    try {
      e.lookAt(loc);
    } catch {
      // UnsupportedFunctionalityError for entity types without rotation
    }
  },
  /** @param {Entity} e */
  getHeadLocation(e) {
    return e.getHeadLocation();
  },
  /** @param {Entity} e */
  getYaw(e) {
    return e.isValid ? e.getRotation().y : 0;
  },
  /** @param {Entity} e @param {string} event */
  triggerEvent(e, event) {
    if (e.isValid) e.triggerEvent(event);
  },
  /** @param {Entity} e @param {string} id @param {number | boolean | string} value */
  setProperty(e, id, value) {
    if (!e.isValid) return false;
    try {
      e.setProperty(id, value);
      return true;
    } catch {
      return false; // property not defined on this entity type
    }
  },
  /** @param {Entity} e @param {string} id */
  getProperty(e, id) {
    if (!e.isValid) return undefined;
    try {
      return e.getProperty(id);
    } catch {
      return undefined;
    }
  },
  /**
   * @param {Entity} e @param {string} animation
   * @param {{ controller?: string, blendOutTime?: number, nextState?: string, stopExpression?: string }} [opts]
   */
  playAnimation(e, animation, opts = {}) {
    if (e.isValid) e.playAnimation(animation, opts);
  },
  /** @param {Entity} e @param {string} key */
  getDynamic(e, key) {
    return e.isValid ? e.getDynamicProperty(key) : undefined;
  },
  /** @param {Entity} e @param {string} key @param {string | number | boolean | undefined} value */
  setDynamic(e, key, value) {
    if (e.isValid) e.setDynamicProperty(key, value);
  },
  /** @param {Entity} e @param {string} name */
  setNameTag(e, name) {
    if (e.isValid && e.nameTag !== name) e.nameTag = name;
  },
  /** @param {Entity} e @param {string} tag */
  addTag(e, tag) {
    if (e.isValid) e.addTag(tag);
  },
  /** @param {Entity} e @param {string} tag */
  removeTag(e, tag) {
    if (e.isValid) e.removeTag(tag);
  },
  /** @param {Entity} e @param {string} tag */
  hasTag(e, tag) {
    return e.isValid && e.hasTag(tag);
  },
  /** @param {Entity} e @param {string} effect @param {number} ticks @param {number} [amplifier] */
  addEffect(e, effect, ticks, amplifier = 0) {
    if (e.isValid) e.addEffect(effect, ticks, { amplifier, showParticles: true });
  },
  /** @param {Entity} e */
  remove(e) {
    if (e.isValid) e.remove();
  },
  /** @param {Entity} e */
  hasHealth(e) {
    return e.isValid && e.hasComponent("minecraft:health");
  },

  // -------------------------------------------------------------------------
  // Player UI
  // -------------------------------------------------------------------------
  /** @param {Player} p @param {string} msg */
  message(p, msg) {
    if (p.isValid) p.sendMessage(msg);
  },
  /** @param {Player} p @param {string} title @param {string} [subtitle] */
  title(p, title, subtitle) {
    if (p.isValid) p.onScreenDisplay.setTitle(title, subtitle ? { subtitle, fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 } : undefined);
  },
  /**
   * Camera shake via the /camerashake command (no Script API equivalent).
   * Syntax: camerashake add <player> [intensity 0-4] [seconds] [positional|rotational]
   * @param {Player} p @param {number} intensity @param {number} seconds @param {"positional" | "rotational"} type
   */
  cameraShake(p, intensity, seconds, type = "positional") {
    if (!p.isValid) return;
    const i = Math.max(0, Math.min(4, intensity)).toFixed(2);
    try {
      p.runCommand(`camerashake add @s ${i} ${seconds.toFixed(2)} ${type}`);
    } catch {
      /* command unavailable */
    }
  },
  /** @param {Player} p @param {string} text */
  actionBar(p, text) {
    if (p.isValid) p.onScreenDisplay.setActionBar(text);
  },
};

/** @typedef {typeof Adapter} AdapterApi */
