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
/** Items with a stack size other than 64 (enough for the tests). */
const STACK = { "minecraft:diamond_sword": 1, "minecraft:ender_pearl": 16, "minecraft:snowball": 16 };
export class ItemStack {
  constructor(typeId, amount = 1) {
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(typeId) || typeId.includes("unknown")) throw new Error(`invalid item ${typeId}`);
    this.typeId = typeId; this.amount = amount; this.maxAmount = STACK[typeId] ?? 64;
  }
}
/** Chest-like container: `size` slots, stacks merge up to maxAmount. */
export class Container {
  constructor(size = 27) { this.size = size; this.slots = []; }
  addItem(stack) {
    let left = stack.amount;
    for (const s of this.slots) {
      if (s.typeId !== stack.typeId || s.amount >= s.maxAmount) continue;
      const k = Math.min(left, s.maxAmount - s.amount); s.amount += k; left -= k;
      if (!left) return undefined;
    }
    while (left > 0 && this.slots.length < this.size) {
      const k = Math.min(left, stack.maxAmount); this.slots.push(new ItemStack(stack.typeId, k)); left -= k;
    }
    return left > 0 ? new ItemStack(stack.typeId, left) : undefined;
  }
  get emptySlotsCount() { return this.size - this.slots.length; }
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
    this.isOnGround = true;
    this.isSneaking = false;
    this.isSprinting = false;
    this.effects = new Map();
    this.burning = false;
    dimension.entities.push(this);
  }
  getComponent(id) {
    if (id === "minecraft:health") return this.living ? this.health : undefined;
    if (id === "minecraft:movement") return this.movement;
    if (id === "minecraft:onfire") return this.burning ? { onFireTicksRemaining: 20 } : undefined;
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
  setOnFire(sec) { note("fire", `${this.typeId} ${sec}s`); this.burning = true; return true; }
  addEffect(eff, ticks, o) { note("effect", `${this.typeId} ${eff} ${ticks}t amp${o?.amplifier ?? 0}`); this.effects.set(eff, { duration: ticks }); }
  getEffect(eff) { return this.effects.get(eff); }
  runCommand(cmd) { note("command", `${this.typeId}: ${cmd}`); return { successCount: 1 }; }
  teleport(loc) { note("teleport", `${this.typeId} → ${fmt(loc)}`); this.location = { ...loc }; }
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
    this.onScreenDisplay = {
      setActionBar: (t) => note("actionbar", `${name}: ${t}`),
      setTitle: (t) => note("title", `${name}: ${t}`),
    };
  }
  getGameMode() { return this.gameMode; }
  sendMessage(m) { note("chat", `${this.name}: ${m}`); }
  startItemCooldown(cat, t) { note("cooldown", `${this.name} ${cat} ${t}t`); }
  runCommand(cmd) { note("command", `${this.name}: ${cmd}`); return { successCount: 1 }; }
}

class Dimension {
  constructor(id) { this.id = `minecraft:${id}`; this.entities = []; this.blocks = new Map(); this.containers = new Map(); }
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
  spawnEntity(typeId, loc) {
    if (typeId === "minecraft:lightning_bolt") { note("lightning", fmt(loc)); return new Entity(typeId, this, loc, { living: false }); } note("spawn", `${typeId} @ ${fmt(loc)}`); const e = new Entity(typeId, this, loc);
    // Like the game: after-events fire once the current script has finished.
    deferred.push(() => { if (e.isValid) world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" }); });
    return e; }
  spawnItem(item, loc) { note("drop", `${item.typeId} x${item.amount}`); }
  spawnParticle(name, loc) { note("particle", `${name} @ ${fmt(loc)}`); }
  playSound(id, loc, o) { note("sound", `${id} v${o?.volume} p${o?.pitch}`); }
  getBlock(loc) {
    const key = `${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
    const dim = this;
    const typeId = dim.blocks.get(key) ?? (Math.floor(loc.y) < 64 ? "minecraft:grass_block" : "minecraft:air");
    return {
      typeId, isAir: typeId === "minecraft:air", isLiquid: typeId.includes("water") || typeId.includes("lava"),
      location: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) },
      setType(t) {
        note("block", `${key} ${typeId} → ${t}`); dim.blocks.set(key, t);
        if (t === "minecraft:chest") dim.containers.set(key, new Container(27)); else dim.containers.delete(key);
      },
      getComponent(id) { return id === "minecraft:inventory" && dim.containers.has(key) ? { container: dim.containers.get(key) } : undefined; },
    };
  }
  /** Ray against the stub world: solid = anything not air (the ground is y < 64). */
  getBlockFromRay(from, dir, o = {}) {
    const max = o.maxDistance ?? 64;
    for (let s = 0; s <= max; s += 0.05) {
      const p = { x: from.x + dir.x * s, y: from.y + dir.y * s, z: from.z + dir.z * s };
      const b = this.getBlock(p);
      if (!b.isAir && !b.isLiquid) return { block: b, face: "Up", faceLocation: { x: p.x - b.location.x, y: p.y - b.location.y, z: p.z - b.location.z } };
    }
    return undefined;
  }
  /** Explosion: fires the before-event, then turns the remaining blocks to air. */
  createExplosion(loc, radius, o = {}) {
    note("explosion", `${fmt(loc)} r${radius}${o.breaksBlocks ? " breaks" : ""}${o.source ? ` by ${o.source.typeId}` : ""}`);
    if (!o.breaksBlocks && o.source) return true; // a skill explosion: no block damage modelled
    const blocks = [];
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) for (let z = -radius; z <= radius; z++) {
      if (Math.hypot(x, y, z) <= radius) blocks.push(this.getBlock({ x: loc.x + x, y: loc.y + y, z: loc.z + z }));
    }
    let impacted = blocks;
    world.beforeEvents.explosion.fire({ dimension: this, getImpactedBlocks: () => impacted, setImpactedBlocks: (b) => { impacted = b; } });
    for (const b of impacted) if (!b.isAir) b.setType("minecraft:air");
    return true;
  }
  getBlockBelow(loc) { return { location: { x: Math.floor(loc.x), y: 63, z: Math.floor(loc.z) } }; }
}

const dims = { overworld: new Dimension("overworld"), nether: new Dimension("nether"), the_end: new Dimension("the_end") };

export const world = {
  afterEvents: Object.fromEntries(
    ["worldLoad", "entitySpawn", "entityLoad", "entityHurt", "entityDie", "entityHitEntity", "playerInteractWithEntity", "dataDrivenEntityTrigger"]
      .map((n) => [n, new Signal()])
  ),
  beforeEvents: { entityHurt: new Signal(), entityRemove: new Signal(), explosion: new Signal() },
  difficulty: "Normal",
  gameRules: { mobGriefing: true },
  dyn: {},
  getDynamicProperty(k) { return this.dyn[k]; },
  setDynamicProperty(k, v) { if (v === undefined) delete this.dyn[k]; else this.dyn[k] = v; },
  getDifficulty() { return this.difficulty; },
  getDimension: (id) => dims[id.replace("minecraft:", "")],
  getEntity: (id) => Object.values(dims).flatMap((d) => d.entities).find((e) => e.id === id),
  getAllPlayers: () => Object.values(dims).flatMap((d) => d.entities).filter((e) => e instanceof Player),
  sendMessage: (m) => note("broadcast", m),
};

const intervals = [];
const deferred = [];
/** tick → callbacks */
const timeouts = new Map();
/** Script events queued for delivery on the next tick (conservative model). */
let outbox = [];

/** Engine message-size limit modelled by the sim ([VERIFY] real value; see /behemoth → Diagnostics). */
export const sim = { scriptEventLimit: Number(process.env.BHM_SIM_MSG_LIMIT ?? 2048), scriptEventsSent: 0, scriptEventChars: 0,
  /** Entity types treated as not installed (a removed pack). */
  missingTypes: new Set() };

export const EntityTypes = {
  get: (id) => (sim.missingTypes.has(id) ? undefined : { id }),
  getAll: () => [],
};

export const system = {
  currentTick: 0,
  afterEvents: { scriptEventReceive: new Signal() },
  beforeEvents: { startup: new Signal(), shutdown: new Signal() },
  runInterval(fn) { intervals.push(fn); return intervals.length; },
  run(fn) { deferred.push(fn); return 0; },
  runTimeout(fn, delay = 1) {
    const at = system.currentTick + Math.max(1, delay);
    if (!timeouts.has(at)) timeouts.set(at, []);
    timeouts.get(at).push(fn);
    return 0;
  },
  runJob(gen) { for (const _ of gen); return 0; },
  clearRun() {},
  waitTicks(n) { return new Promise((res) => system.runTimeout(res, n)); },
  sendScriptEvent(id, message) {
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(id)) throw new Error(`NamespaceNameError: ${id}`);
    if (message.length > sim.scriptEventLimit) throw new Error(`message too long (${message.length} > ${sim.scriptEventLimit})`);
    sim.scriptEventsSent++;
    sim.scriptEventChars += message.length;
    note("scriptevent", `${id} ${message.length} chars`);
    outbox.push({ id, message });
  },
};

/** Advance the simulation by n ticks. */
export function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    system.currentTick++;
    const mail = outbox;
    outbox = [];
    for (const m of mail) {
      system.afterEvents.scriptEventReceive.fire({ id: m.id, message: m.message, sourceType: "Server" });
    }
    for (const fn of deferred.splice(0)) fn();
    for (const fn of timeouts.get(system.currentTick) ?? []) fn();
    timeouts.delete(system.currentTick);
    for (const fn of intervals) fn();
  }
}

/** Let pending promise callbacks (async menu code) run. */
export const flush = () => new Promise((r) => setImmediate(r));

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function round(n) { return Math.round(n * 100) / 100; }
function fmt(v) { return `(${round(v.x)}, ${round(v.y)}, ${round(v.z)})`; }
