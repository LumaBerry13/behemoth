// Minimal in-memory stand-in for @minecraft/server, enough to run the framework
// headless (tools/sim/run.mjs). Not a game emulator: no physics, pathing or
// rendering — entities stay where they are unless a test moves them.

class Signal {
  constructor() { this.handlers = []; }
  subscribe(fn) { this.handlers.push(fn); return fn; }
  unsubscribe(fn) { this.handlers = this.handlers.filter((h) => h !== fn); }
  fire(ev) { for (const h of this.handlers) h(ev); return ev; }
}

export const GameMode = { Adventure: "Adventure", Creative: "Creative", Spectator: "Spectator", Survival: "Survival" };
export const EntityDamageCause = new Proxy({}, { get: (_t, k) => k });
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const CustomCommandParamType = new Proxy({}, { get: (_t, k) => k });
export const CustomCommandStatus = { Success: 0, Failure: 1 };

export class MolangVariableMap {
  setFloat() {} setColorRGB() {} setColorRGBA() {} setVector3() {} setSpeedAndDirection() {}
}
export class ItemStack {
  constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; }
}

export const log = []; // [tick, kind, detail]
const note = (kind, detail) => log.push([system.currentTick, kind, detail]);

let nextId = 1;
export class Entity {
  constructor(typeId, dimension, location, opts = {}) {
    this.id = String(nextId++);
    this.typeId = typeId;
    this.dimension = dimension;
    this.location = { ...location };
    this.isValid = true;
    this.nameTag = "";
    this.tags = new Set();
    this.props = {};
    this.dyn = {};
    this.rotation = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.health = { currentValue: opts.health ?? 20, effectiveMax: opts.health ?? 20 };
    this.health.setCurrentValue = (v) => { this.health.currentValue = v; return true; };
    this.movement = { defaultValue: opts.speed ?? 0.25, currentValue: opts.speed ?? 0.25 };
    this.movement.setCurrentValue = (v) => { this.movement.currentValue = v; return true; };
    this.height = opts.height ?? 1.8;
    this.living = opts.living ?? true;
    dimension.entities.push(this);
  }
  getComponent(id) {
    if (id === "minecraft:health") return this.living ? this.health : undefined;
    if (id === "minecraft:movement") return this.movement;
    return undefined;
  }
  hasComponent(id) { return !!this.getComponent(id); }
  triggerEvent(ev) { note("event", `${this.typeId} ${ev}`); world.afterEvents.dataDrivenEntityTrigger.fire({ entity: this, eventId: ev }); }
  setProperty(k, v) { this.props[k] = v; }
  getProperty(k) { return this.props[k]; }
  playAnimation(name, opts) { note("anim", `${name} (${opts?.controller ?? "-"})`); }
  getDynamicProperty(k) { return this.dyn[k]; }
  setDynamicProperty(k, v) { this.dyn[k] = v; }
  addTag(t) { this.tags.add(t); return true; }
  removeTag(t) { return this.tags.delete(t); }
  hasTag(t) { return this.tags.has(t); }
  getRotation() { return { ...this.rotation }; }
  setRotation(r) { this.rotation = { ...r }; }
  lookAt(loc) {
    const dx = loc.x - this.location.x, dz = loc.z - this.location.z;
    this.rotation.y = (Math.atan2(-dx, dz) * 180) / Math.PI;
  }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + this.height * 0.9, z: this.location.z }; }
  getVelocity() { return { ...this.velocity }; }
  clearVelocity() { this.velocity = { x: 0, y: 0, z: 0 }; }
  applyImpulse(v) { note("impulse", `${this.typeId} ${fmt(v)}`); }
  applyKnockback(h, vy) { note("knockback", `${this.typeId} ${fmt({ x: h.x, y: vy, z: h.z })}`); }
  addEffect(eff, ticks, o) { note("effect", `${this.typeId} ${eff} ${ticks}t amp${o?.amplifier ?? 0}`); }
  teleport(loc) { this.location = { ...loc }; }
  applyDamage(amount, opts) {
    if (!this.isValid || !this.living) return false;
    const before = world.beforeEvents.entityHurt.fire({
      hurtEntity: this, damage: amount, cancel: false,
      damageSource: { cause: opts?.cause ?? "none", damagingEntity: opts?.damagingEntity },
    });
    if (before.cancel) { note("hurt-cancel", `${this.typeId} ${opts?.cause}`); return false; }
    const dmg = before.damage;
    this.health.currentValue = Math.max(0, this.health.currentValue - dmg);
    note("hurt", `${this.typeId} -${round(dmg)} (${opts?.cause}) hp=${round(this.health.currentValue)}`);
    world.afterEvents.entityHurt.fire({
      hurtEntity: this, damage: dmg, damageSource: { cause: opts?.cause ?? "none", damagingEntity: opts?.damagingEntity },
    });
    if (this.health.currentValue <= 0) {
      if (this.onFatal) this.onFatal(this);
      else {
        world.afterEvents.entityDie.fire({ deadEntity: this, damageSource: { cause: opts?.cause, damagingEntity: opts?.damagingEntity } });
        this.remove();
      }
    }
    return true;
  }
  remove() { this.isValid = false; this.dimension.entities = this.dimension.entities.filter((e) => e !== this); }
  kill() { this.remove(); return true; }
}

export class Player extends Entity {
  constructor(name, dimension, location) {
    super("minecraft:player", dimension, location, { health: 20 });
    this.name = name;
    this.gameMode = GameMode.Survival;
    this.onScreenDisplay = { setActionBar() {}, setTitle() {} };
  }
  getGameMode() { return this.gameMode; }
  sendMessage(m) { note("chat", `${this.name}: ${m}`); }
  startItemCooldown(cat, t) { note("cooldown", `${this.name} ${cat} ${t}t`); }
  runCommand(cmd) { note("command", `${this.name}: ${cmd}`); return { successCount: 1 }; }
}

class Dimension {
  constructor(id) { this.id = id; this.entities = []; }
  getEntities(q = {}) {
    return this.entities.filter((e) => {
      if (!e.isValid) return false;
      if (q.type && e.typeId !== q.type) return false;
      if (q.excludeTags?.some((t) => e.tags.has(t))) return false;
      if (q.location && q.maxDistance !== undefined && dist(e.location, q.location) > q.maxDistance) return false;
      if (q.excludeGameModes && e instanceof Player && q.excludeGameModes.includes(e.gameMode)) return false;
      return true;
    });
  }
  getPlayers(q = {}) { return this.getEntities(q).filter((e) => e instanceof Player); }
  spawnEntity(typeId, loc) { note("spawn", `${typeId} @ ${fmt(loc)}`); const e = new Entity(typeId, this, loc); world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" }); return e; }
  spawnItem(item, loc) { note("drop", `${item.typeId} x${item.amount}`); }
  spawnParticle(name, loc) { note("particle", `${name} @ ${fmt(loc)}`); }
  playSound(id, loc, o) { note("sound", `${id} v${o?.volume} p${o?.pitch}`); }
  getBlock() { return { typeId: "minecraft:air" }; }
  getBlockBelow(loc) { return { location: { x: Math.floor(loc.x), y: 63, z: Math.floor(loc.z) } }; }
}

const dims = { overworld: new Dimension("overworld"), nether: new Dimension("nether"), the_end: new Dimension("the_end") };

export const world = {
  afterEvents: Object.fromEntries(
    ["worldLoad", "entitySpawn", "entityLoad", "entityHurt", "entityDie", "entityHitEntity", "playerInteractWithEntity", "dataDrivenEntityTrigger"]
      .map((n) => [n, new Signal()])
  ),
  beforeEvents: { entityHurt: new Signal(), entityRemove: new Signal() },
  getDimension: (id) => dims[id.replace("minecraft:", "")],
  getEntity: (id) => Object.values(dims).flatMap((d) => d.entities).find((e) => e.id === id),
  getAllPlayers: () => Object.values(dims).flatMap((d) => d.entities).filter((e) => e instanceof Player),
  sendMessage: (m) => note("broadcast", m),
};

const intervals = [];
const deferred = [];
export const system = {
  currentTick: 0,
  afterEvents: { scriptEventReceive: new Signal() },
  beforeEvents: { startup: new Signal() },
  runInterval(fn) { intervals.push(fn); return intervals.length; },
  run(fn) { deferred.push(fn); return 0; },
  runTimeout(fn) { deferred.push(fn); return 0; },
  runJob(gen) { for (const _ of gen); return 0; },
  clearRun() {},
};

/** Advance the simulation by n ticks. */
export function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    system.currentTick++;
    for (const fn of deferred.splice(0)) fn();
    for (const fn of intervals) fn();
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function round(n) { return Math.round(n * 100) / 100; }
function fmt(v) { return `(${round(v.x)}, ${round(v.y)}, ${round(v.z)})`; }
