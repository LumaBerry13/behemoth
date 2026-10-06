// Runs compiled skills (design doc §7):
// trigger → conditions → targeter → mechanic → children / delays.
// A run walks its steps iteratively; a mechanic returning N > 0 pauses the run
// for N ticks via the scheduler, under the run's cancel token. A line with
// `delay: N` runs N ticks later without pausing the sequence (MythicMobs
// per-mechanic delay); `repeat: N` runs it N more times, `repeatInterval`
// ticks apart, also without pausing. Lines without an explicit targeter use
// the targets inherited from a parent skill, else the mechanic's default
// targeter. Option strings with <placeholders> are resolved per execution.
import { Log } from "./Logger.js";
import { Random } from "./Random.js";
import { parseTargeter, coerce } from "./SkillParser.js";

/** @typedef {import("./Validator.js").CompiledSkill} CompiledSkill */
/** @typedef {import("./Validator.js").CompiledStep} CompiledStep */
/** @typedef {import("./Validator.js").CompiledCondition} CompiledCondition */
/** @typedef {import("./BossInstance.js").BossInstance} BossInstance */
/** @typedef {import("../types/config").SkillContext} SkillContext */
/** @typedef {import("../types/config").Target} Target */
/** @typedef {import("../types/config").TriggerEvent} TriggerEvent */
/** @typedef {{ skill: CompiledSkill, token: import("./Scheduler.js").CancelToken, done: boolean }} SkillRun */
/** @typedef {{ steps: CompiledStep[], i: number }} Frame */
/**
 * @typedef {object} CastOptions
 * @property {boolean} [force] skip cooldown / lock / chance / conditions
 * @property {Target[]} [inherited] targets passed from a parent skill
 * @property {Record<string, unknown>} [skillVars] skill-scope variables shared with the caller
 * @property {import("../types/config").Location} [origin] origin point for the Origin targeter (projectiles, ray traces)
 * @property {import("../types/config").ProjectileHandle} [projectile] the projectile running this skill (modifyProjectile)
 */

export class SkillExecutor {
  /** @param {import("./services.js").Services} services */
  constructor(services) {
    this.services = services;
    /** @type {Map<string, { module: import("../types/config").Targeter, options: Record<string, any> } | null>} */
    this.targeterCache = new Map();
  }

  /** Connect every registered trigger to the bus. */
  wireTriggers() {
    for (const trigger of this.services.registry.triggers.values()) {
      const key = trigger.name.toLowerCase();
      trigger.subscribe(this.services.bus, (event) => this.dispatch(key, trigger, event));
    }
  }

  /**
   * @param {string} key lowercase trigger name
   * @param {import("../types/config").Trigger} trigger
   * @param {TriggerEvent} event
   */
  dispatch(key, trigger, event) {
    const boss = event.boss;
    if (!boss || boss.destroyed) return;
    const list = boss.compiled.byTrigger.get(key);
    if (!list) return;
    for (const skill of list) {
      for (const t of skill.triggers) {
        if (t.name !== key) continue;
        if (trigger.match && !trigger.match(t.arg, event)) continue;
        this.cast(boss, skill, event);
        break;
      }
    }
  }

  /**
   * Cast by name (phase onEnter, `skill`/`randomSkill`/`aura`/`hitbox`, menu).
   * @param {BossInstance} boss @param {string} name @param {Partial<TriggerEvent>} [event]
   * @param {CastOptions | boolean} [opts] `true` is shorthand for { force: true }
   */
  castByName(boss, name, event = {}, opts = {}) {
    const skill = boss.compiled.skills.get(name);
    if (!skill) {
      Log.warn(`skill "${name}" not found on ${boss.config.id}`);
      return false;
    }
    return this.cast(boss, skill, { ...event, boss }, typeof opts === "boolean" ? { force: opts } : opts);
  }

  /**
   * @param {BossInstance} boss @param {Partial<TriggerEvent>} event @param {CastOptions} opts
   * @returns {SkillContext}
   */
  makeContext(boss, event, opts) {
    return {
      boss,
      caster: boss.entity,
      trigger: event.triggerEntity,
      targets: [],
      data: event.data,
      vars: boss.vars,
      skillVars: opts.skillVars ?? {},
      origin: opts.origin,
      projectile: opts.projectile,
      token: boss.token, // replaced by the run token in cast()
      services: this.services,
      inherited: opts.inherited,
    };
  }

  /**
   * @param {BossInstance} boss @param {CompiledSkill} skill
   * @param {Partial<TriggerEvent>} event @param {CastOptions} [opts]
   * @returns {boolean} true if the skill started
   */
  cast(boss, skill, event, opts = {}) {
    if (boss.destroyed) return false;
    const now = this.services.scheduler.tick;
    const ctx = this.makeContext(boss, event, opts);

    if (!opts.force) {
      if (!this.isReady(boss, skill, now)) return false;
      if (skill.chance < 1 && !Random.chance(skill.chance)) return false;
      const gate = this.gate(ctx, skill);
      if (gate.redirect) {
        this.castByName(boss, gate.redirect, event, { inherited: opts.inherited, skillVars: ctx.skillVars, origin: opts.origin, projectile: opts.projectile });
        return false;
      }
      if (!gate.ok) return false;
      if (gate.targets) ctx.inherited = gate.targets;
    }

    /** @type {SkillRun} */
    const run = { skill, token: boss.token.child(), done: false };
    ctx.token = run.token;
    if (skill.cooldown) boss.cooldowns.set(skill.name, now + skill.cooldown);
    if (skill.exclusive) {
      boss.castLock = run;
      boss.gcdUntil = Math.max(boss.gcdUntil, now + (boss.config.gcd ?? 0));
    }
    boss.runs.add(run);
    Log.debug(`${boss.config.id} casts "${skill.name}"`);
    this.runSteps(ctx, run, [{ steps: skill.steps, i: 0 }]);
    return true;
  }

  /**
   * Skill conditions (against the caster) and target conditions (MythicMobs
   * TargetConditions: against the inherited targets, else the current target;
   * targets that fail are dropped, none left = the skill does not run).
   * @param {SkillContext} ctx @param {CompiledSkill} skill
   * @returns {{ ok: boolean, redirect?: string, targets?: Target[] }}
   */
  gate(ctx, skill) {
    const self = this.evalConditions(ctx, skill.conditions);
    if (!self.ok || self.redirect) return self;
    if (!skill.targetConditions.length) return { ok: true };
    const candidates = ctx.inherited?.length ? ctx.inherited : [ctx.boss.getTarget()].filter((t) => t !== undefined);
    /** @type {Target[]} */
    const pass = [];
    /** @type {string | undefined} */
    let redirect;
    for (const t of candidates) {
      const r = this.evalConditions(ctx, skill.targetConditions, t);
      if (r.redirect) redirect ??= r.redirect;
      else if (r.ok) pass.push(t);
    }
    if (pass.length) return { ok: true, targets: pass };
    return redirect ? { ok: false, redirect } : { ok: false };
  }

  /**
   * Cooldown / cast-lock / GCD gate (no randomness, no conditions).
   * @param {BossInstance} boss @param {CompiledSkill} skill @param {number} now
   */
  isReady(boss, skill, now) {
    if ((boss.cooldowns.get(skill.name) ?? 0) > now) return false;
    // Exclusive skills respect the casting lock and the global cooldown.
    return !(skill.exclusive && (boss.isCastLocked(now) || boss.gcdUntil > now));
  }

  /**
   * Whether a named skill could start right now: ready and its conditions pass
   * (`chance` conditions roll here too). Used by randomSkill{mode=available}.
   * @param {BossInstance} boss @param {string} name @param {Partial<TriggerEvent>} [event] @param {Target[]} [inherited]
   */
  canCast(boss, name, event = {}, inherited) {
    const skill = boss.compiled.skills.get(name);
    if (!skill || boss.destroyed || !this.isReady(boss, skill, this.services.scheduler.tick)) return false;
    const gate = this.gate(this.makeContext(boss, event, { inherited }), skill);
    return gate.ok && !gate.redirect;
  }

  /**
   * @param {SkillContext} ctx @param {SkillRun} run @param {Frame[]} stack
   */
  runSteps(ctx, run, stack) {
    const boss = ctx.boss;
    const scheduler = this.services.scheduler;
    while (stack.length) {
      if (run.token.cancelled || boss.destroyed) return this.finish(boss, run);
      const frame = stack[stack.length - 1];
      if (frame.i >= frame.steps.length) {
        stack.pop();
        continue;
      }
      const step = frame.steps[frame.i++];
      if (step.chance < 1 && !Random.chance(step.chance)) continue;
      const gate = this.evalConditions(ctx, step.conditions);
      if (gate.redirect) {
        this.castByName(boss, gate.redirect, { triggerEntity: ctx.trigger, data: ctx.data },
          { inherited: ctx.inherited, skillVars: ctx.skillVars, origin: ctx.origin, projectile: ctx.projectile });
        continue;
      }
      if (!gate.ok) continue;
      if (step.children) {
        stack.push({ steps: step.children, i: 0 });
        continue;
      }
      if (!step.mechanic) continue;

      // Repeats never pause the sequence.
      for (let k = 1; k <= step.repeat; k++) {
        scheduler.after(step.delay + k * Math.max(1, step.repeatInterval), () => {
          if (!boss.destroyed) this.execStep(ctx, run, step);
        }, run.token);
      }

      if (step.delay > 0) {
        // Non-blocking: the sequence carries on; this line fires later.
        scheduler.after(step.delay, () => {
          if (!boss.destroyed) this.execStep(ctx, run, step);
        }, run.token);
        continue;
      }

      const delay = this.execStep(ctx, run, step);
      if (delay > 0) {
        scheduler.after(delay, () => this.runSteps(ctx, run, stack), run.token);
        return;
      }
    }
    this.finish(boss, run);
  }

  /**
   * Resolve targets and execute one mechanic line.
   * @param {SkillContext} ctx @param {SkillRun} run @param {CompiledStep} step
   * @returns {number} ticks to pause the sequence (0 = continue)
   */
  execStep(ctx, run, step) {
    const boss = ctx.boss;
    if (step.cooldown) {
      const now = this.services.scheduler.tick;
      if ((boss.lineCooldowns.get(step) ?? 0) > now) return 0;
      boss.lineCooldowns.set(step, now + step.cooldown);
    }
    /** @type {Target[]} */
    let targets = [];
    try {
      if (!step.explicitTargeter && ctx.inherited) targets = ctx.inherited.filter(isAlive);
      else if (step.targeter) targets = step.targeter.module.resolve(ctx, step.targeter.options);
    } catch (e) {
      Log.error(`targeter @${step.targeter?.name} failed in "${run.skill.name}":`, e);
      return 0;
    }
    // Like MythicMobs: an explicit targeter that finds nothing skips the mechanic.
    if (step.explicitTargeter && targets.length === 0) return 0;
    ctx.targets = targets;
    try {
      const options = step.dynamic ? this.resolveOptions(ctx, step, targets[0]) : step.options;
      const delay = step.mechanic.execute(ctx, targets, options);
      return typeof delay === "number" && delay > 0 ? delay : 0;
    } catch (e) {
      Log.error(`mechanic "${step.name}" failed in "${run.skill.name}":`, e);
      return 0;
    }
  }

  /**
   * Options with their <placeholders> resolved for this execution.
   * @param {SkillContext} ctx @param {CompiledStep} step @param {Target | undefined} target
   */
  resolveOptions(ctx, step, target) {
    const out = { ...step.options };
    for (const k of step.dynamic ?? []) out[k] = coerce(this.services.vars.format(ctx, String(step.options[k]), target));
    return out;
  }

  /**
   * Resolve a targeter given as a mechanic option (e.g. projectile `origin`).
   * Parsed once per distinct spec.
   * @param {SkillContext} ctx @param {import("../types/config").TargeterSpec} spec
   * @returns {Target[]}
   */
  resolveTargeter(ctx, spec) {
    const key = typeof spec === "string" ? spec : JSON.stringify(spec);
    let t = this.targeterCache.get(key);
    if (t === undefined) {
      const parsed = parseTargeter(spec);
      const module = "error" in parsed ? undefined : this.services.registry.targeter(parsed.name);
      t = module && !("error" in parsed) ? { module, options: parsed.options } : null;
      this.targeterCache.set(key, t);
    }
    if (!t) return [];
    try {
      return t.module.resolve(ctx, t.options);
    } catch (e) {
      Log.error(`targeter ${key} failed:`, e);
      return [];
    }
  }

  /**
   * @param {SkillContext} ctx @param {CompiledCondition[]} conditions
   * @param {Target} [target] defaults to the caster
   * @returns {{ ok: boolean, redirect?: string }} redirect = skill to cast instead (castInstead / orElseCast)
   */
  evalConditions(ctx, conditions, target = ctx.caster) {
    for (const c of conditions) {
      let ok;
      try {
        if ("fn" in c) ok = !!c.fn(ctx, target);
        else {
          ok = !!c.module.test(ctx, target, c.args);
          if (c.negate) ok = !ok;
        }
      } catch (e) {
        Log.error(`condition failed:`, e);
        ok = false;
      }
      if (c.action?.kind === "castInstead") {
        if (ok) return { ok: false, redirect: c.action.skill };
        continue;
      }
      if (!ok) return c.action?.kind === "orElseCast" ? { ok: false, redirect: c.action.skill } : { ok: false };
    }
    return { ok: true };
  }

  /**
   * @param {SkillContext} ctx @param {CompiledCondition[]} conditions
   * @param {Target} [target] defaults to the caster
   */
  checkConditions(ctx, conditions, target = ctx.caster) {
    const r = this.evalConditions(ctx, conditions, target);
    return r.ok && !r.redirect;
  }

  /** @param {BossInstance} boss @param {SkillRun} run */
  finish(boss, run) {
    if (run.done) return;
    run.done = true;
    boss.runs.delete(run);
    if (boss.castLock === run) boss.castLock = null;
  }

  /** Cancel a run and release its lock immediately. @param {BossInstance} boss @param {SkillRun} run */
  cancel(boss, run) {
    run.token.cancel();
    this.finish(boss, run);
  }
}

/** Locations are always usable; entities only while valid. @param {Target} t */
function isAlive(t) {
  return !("isValid" in t) || t.isValid;
}
