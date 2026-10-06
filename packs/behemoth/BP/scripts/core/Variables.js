// Scoped skill variables and `<...>` placeholders (MythicMobs variables).
//
// Variable names may carry a scope prefix: "caster.x" (default when no prefix),
// "target.x", "trigger.x", "skill.x", "global.x".
//   caster  → the casting boss's vars (persisted with the boss)
//   target  → the target entity: a Behemoth entity's vars, else a per-entity
//             in-memory store (dropped when the entity goes away)
//   trigger → like target, for the entity that triggered the skill
//   skill   → shared by one skill run and the skills it calls
//   global  → world-wide, persisted in the world property "bhm:vars"
//
// Placeholders are resolved per execution in option strings, e.g.
//   "<caster.var.dw0>", "<caster.hp>", "<caster.mhp>", "<caster.php>",
//   "<caster.name>", "<caster.phase>", "<caster.l.x>", "<target.name>",
//   "<trigger.hp>", "<skill.var.n>", "<global.var.n>",
//   "<random.float.0.9to1.2>", "<random.int.1to5>", "<random.1to5>".
// Unknown placeholders are left as they are.
import { Adapter } from "../adapter/Adapter.js";
import { Random } from "./Random.js";
import { Log } from "./Logger.js";
import { TOKEN } from "./SkillParser.js";

/** @typedef {import("../types/config").SkillContext} SkillContext */
/** @typedef {import("../types/config").Target} Target */

const SCOPES = new Set(["caster", "target", "trigger", "skill", "global"]);
const GLOBAL_KEY = "bhm:vars";

/**
 * "caster.x" → { scope: "caster", key: "x" }; "x" → caster scope.
 * @param {string} name
 */
export function splitVar(name) {
  const i = name.indexOf(".");
  if (i > 0) {
    const scope = name.slice(0, i).toLowerCase();
    if (SCOPES.has(scope)) return { scope, key: name.slice(i + 1) };
  }
  return { scope: "caster", key: name };
}

/**
 * @param {unknown} value
 * @param {string | undefined} type "int" | "float" | "string" | "boolean" (MythicMobs INT/FLOAT/STRING/BOOLEAN)
 */
export function convertType(value, type) {
  switch ((type ?? "").toLowerCase()) {
    case "int":
    case "integer":
      return Math.trunc(Number(value) || 0);
    case "float":
    case "double":
    case "number":
      return Number(value) || 0;
    case "string":
      return String(value);
    case "boolean":
      return value === true || String(value).toLowerCase() === "true";
    default:
      return value;
  }
}

export class Variables {
  /** @param {import("./services.js").Services} services */
  constructor(services) {
    this.services = services;
    /** @type {Record<string, unknown>} */
    this.global = {};
    this.globalDirty = false;
    /** @type {Map<string, Record<string, unknown>>} entity id → vars (non-Behemoth entities) */
    this.entityVars = new Map();
    /** store object → key → expiry marker (variables with a duration) */
    this.expiries = new WeakMap();
  }

  /** Load global variables (first tick). */
  load() {
    try {
      const raw = Adapter.getWorldDynamic(GLOBAL_KEY);
      if (typeof raw === "string") this.global = JSON.parse(raw);
    } catch {
      this.global = {};
    }
  }

  /** Persist global variables if they changed; drop stores of entities that are gone. */
  flush() {
    if (this.globalDirty) {
      this.globalDirty = false;
      try {
        const keys = Object.keys(this.global);
        Adapter.setWorldDynamic(GLOBAL_KEY, keys.length ? JSON.stringify(this.global) : undefined);
      } catch (e) {
        Log.warn("could not save global variables:", e);
      }
    }
    for (const id of this.entityVars.keys()) if (!Adapter.getEntity(id)?.isValid) this.entityVars.delete(id);
  }

  /**
   * Variable store of an entity: a Behemoth entity's own vars, else a per-entity map.
   * @param {Target | undefined} t
   * @returns {Record<string, unknown> | undefined}
   */
  storeOf(t) {
    if (!t || !Adapter.isEntity(t)) return undefined;
    const inst = this.services.bosses.get(t.id);
    if (inst) return inst.vars;
    let s = this.entityVars.get(t.id);
    if (!s) this.entityVars.set(t.id, (s = {}));
    return s;
  }

  /**
   * @param {SkillContext} ctx @param {string} scope @param {Target} [target] explicit target for "target" scope
   * @returns {Record<string, unknown> | undefined}
   */
  store(ctx, scope, target) {
    switch (scope) {
      case "caster": return ctx.boss.vars;
      case "skill": return ctx.skillVars ?? (ctx.skillVars = {});
      case "global": return this.global;
      case "trigger": return this.storeOf(ctx.trigger);
      case "target": return this.storeOf(target ?? ctx.targets?.[0] ?? ctx.inherited?.[0] ?? ctx.boss.getTarget());
      default: return undefined;
    }
  }

  /** @param {SkillContext} ctx @param {string} name @param {Target} [target] */
  get(ctx, name, target) {
    const { scope, key } = splitVar(name);
    return this.store(ctx, scope, target)?.[key];
  }

  /** @param {SkillContext} ctx @param {string} name @param {Target} [target] */
  has(ctx, name, target) {
    const { scope, key } = splitVar(name);
    const s = this.store(ctx, scope, target);
    return !!s && Object.prototype.hasOwnProperty.call(s, key);
  }

  /**
   * Set a variable. With `durationTicks` it is removed again after that time
   * (unless set again meanwhile).
   * @param {SkillContext} ctx @param {string} name @param {unknown} value
   * @param {{ type?: string, durationTicks?: number, target?: Target }} [opts]
   */
  set(ctx, name, value, opts = {}) {
    const { scope, key } = splitVar(name);
    const s = this.store(ctx, scope, opts.target);
    if (!s) return false;
    s[key] = convertType(value, opts.type);
    if (scope === "global") this.globalDirty = true;
    let marks = this.expiries.get(s);
    if (opts.durationTicks && opts.durationTicks > 0) {
      if (!marks) this.expiries.set(s, (marks = new Map()));
      const mark = {};
      marks.set(key, mark);
      const token = scope === "caster" ? ctx.boss.token : undefined;
      this.services.scheduler.after(opts.durationTicks, () => {
        if (marks?.get(key) !== mark) return;
        marks.delete(key);
        delete s[key];
        if (scope === "global") this.globalDirty = true;
      }, token);
    } else marks?.delete(key);
    return true;
  }

  // -------------------------------------------------------------------------
  // Placeholders
  // -------------------------------------------------------------------------
  /**
   * Replace every `<...>` placeholder in a string.
   * @param {SkillContext} ctx @param {string} text @param {Target} [target]
   */
  format(ctx, text, target) {
    return text.replace(TOKEN, (whole, body) => {
      const v = this.placeholder(ctx, body, target);
      return v === undefined ? whole : String(v);
    });
  }

  /** @private @param {SkillContext} ctx @param {string} body @param {Target} [target] */
  placeholder(ctx, body, target) {
    const parts = body.split(".");
    const head = parts[0].toLowerCase();
    if (head === "random") return randomPlaceholder(parts.slice(1));
    if (head === "skill" || head === "global") {
      if (parts[1]?.toLowerCase() !== "var") return undefined;
      return this.store(ctx, head)?.[parts.slice(2).join(".")];
    }
    /** @type {Target | undefined} */
    let who;
    if (head === "caster") who = ctx.caster;
    else if (head === "target") who = target ?? ctx.targets?.[0] ?? ctx.inherited?.[0] ?? ctx.boss.getTarget();
    else if (head === "trigger") who = ctx.trigger;
    else return undefined;
    if (!who) return undefined;
    const field = parts[1]?.toLowerCase();
    if (field === "var") return this.storeOf(who)?.[parts.slice(2).join(".")] ?? (head === "caster" ? ctx.boss.vars[parts.slice(2).join(".")] : undefined);
    if (field === "l" || field === "location") {
      const l = Adapter.locOf(who);
      const axis = parts[2]?.toLowerCase();
      return axis === "x" ? round(l.x) : axis === "y" ? round(l.y) : axis === "z" ? round(l.z) : undefined;
    }
    if (!Adapter.isEntity(who)) return undefined;
    switch (field) {
      case "hp": return round(Adapter.getHealth(who).current);
      case "mhp": return round(Adapter.getHealth(who).max);
      case "php": {
        const h = Adapter.getHealth(who);
        return h.max > 0 ? round((h.current / h.max) * 100) : 0;
      }
      case "name": {
        const inst = this.services.bosses.get(who.id);
        return inst?.config.display?.name ?? (Adapter.isPlayer(who) ? who.name : who.nameTag || who.typeId);
      }
      case "uuid":
      case "id": return who.id;
      case "type": return who.typeId;
      case "phase": return this.services.bosses.get(who.id)?.phase;
      case "yaw": return round(Adapter.getYaw(who));
      default: return undefined;
    }
  }
}

/** "float.0.9to1.2" | "int.1to5" | "1to5" @param {string[]} parts */
function randomPlaceholder(parts) {
  let kind = "int";
  if (parts[0] === "float" || parts[0] === "int") kind = /** @type {string} */ (parts.shift());
  const m = /^(-?[\d.]+)to(-?[\d.]+)$/.exec(parts.join("."));
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return undefined;
  return kind === "float" ? round(lo + Random.next() * (hi - lo), 3) : Random.int(Math.ceil(lo), Math.floor(hi));
}

/** @param {number} n @param {number} [digits] */
function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
