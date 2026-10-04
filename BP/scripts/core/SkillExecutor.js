// Runs compiled skills (design doc §7):
// trigger → conditions → targeter → mechanic → children / delays.
// A run walks its steps iteratively; a mechanic returning N > 0 pauses the run
// for N ticks via the scheduler, under the run's cancel token. A line with
// `delay: N` runs N ticks later without pausing the sequence (MythicMobs
// per-mechanic delay). Lines without an explicit targeter use the targets
// inherited from a parent skill, else the mechanic's default targeter.
import { Log } from "./Logger.js";
import { Random } from "./Random.js";

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
 */

export class SkillExecutor {
  /** @param {import("./services.js").Services} services */
  constructor(services) {
    this.services = services;
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
   * Cast by name (phase onEnter, `skill`/`randomSkill`/`aura`/`hitbox`, debug command).
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
   * @param {BossInstance} boss @param {CompiledSkill} skill
   * @param {Partial<TriggerEvent>} event @param {CastOptions} [opts]
   * @returns {boolean} true if the skill started
   */
  cast(boss, skill, event, opts = {}) {
    if (boss.destroyed) return false;
    const now = this.services.scheduler.tick;
    /** @type {SkillContext} */
    const ctx = {
      boss,
      caster: boss.entity,
      trigger: event.triggerEntity,
      targets: [],
      data: event.data,
      vars: boss.vars,
      token: boss.token, // replaced by the run token below
      services: this.services,
      inherited: opts.inherited,
    };

    if (!opts.force) {
      if ((boss.cooldowns.get(skill.name) ?? 0) > now) return false;
      // Exclusive skills respect the casting lock and the global cooldown.
      if (skill.exclusive && (boss.isCastLocked(now) || boss.gcdUntil > now)) return false;
      if (skill.chance < 1 && !Random.chance(skill.chance)) return false;
      if (!this.checkConditions(ctx, skill.conditions)) return false;
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
   * @param {SkillContext} ctx @param {SkillRun} run @param {Frame[]} stack
   */
  runSteps(ctx, run, stack) {
    const boss = ctx.boss;
    while (stack.length) {
      if (run.token.cancelled || boss.destroyed) return this.finish(boss, run);
      const frame = stack[stack.length - 1];
      if (frame.i >= frame.steps.length) {
        stack.pop();
        continue;
      }
      const step = frame.steps[frame.i++];
      if (step.chance < 1 && !Random.chance(step.chance)) continue;
      if (!this.checkConditions(ctx, step.conditions)) continue;
      if (step.children) {
        stack.push({ steps: step.children, i: 0 });
        continue;
      }
      if (!step.mechanic) continue;

      if (step.delay > 0) {
        // Non-blocking: the sequence carries on; this line fires later.
        this.services.scheduler.after(step.delay, () => {
          if (!boss.destroyed) this.execStep(ctx, run, step);
        }, run.token);
        continue;
      }

      const delay = this.execStep(ctx, run, step);
      if (delay > 0) {
        this.services.scheduler.after(delay, () => this.runSteps(ctx, run, stack), run.token);
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
      const delay = step.mechanic.execute(ctx, targets, step.options);
      return typeof delay === "number" && delay > 0 ? delay : 0;
    } catch (e) {
      Log.error(`mechanic "${step.name}" failed in "${run.skill.name}":`, e);
      return 0;
    }
  }

  /**
   * @param {SkillContext} ctx @param {CompiledCondition[]} conditions
   * @param {Target} [target] defaults to the caster
   */
  checkConditions(ctx, conditions, target = ctx.caster) {
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
      if (!ok) return false;
    }
    return true;
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
