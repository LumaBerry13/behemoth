// Startup config validation + compilation (design doc §4, §8).
// Turns a raw boss config into a CompiledBoss. Fatal config errors reject the
// boss; errors inside a skill disable only that skill.
import { Log } from "./Logger.js";
import { parseTargeter, parseCondition, parseTrigger } from "./SkillParser.js";

/** @typedef {import("../types/config").BossConfig} BossConfig */
/** @typedef {import("../types/config").SkillLine} SkillLine */
/** @typedef {import("../types/config").SkillDef} SkillDef */

/**
 * @typedef {{ fn: Function } | { module: import("../types/config").Condition, name: string, negate: boolean, args: import("../types/config").ConditionArgs }} CompiledCondition
 * @typedef {{ module: import("../types/config").Targeter, name: string, options: Record<string, any> }} CompiledTargeter
 * @typedef {{
 *   mechanic: import("../types/config").Mechanic | null,
 *   name: string,
 *   options: Record<string, any>,
 *   targeter: CompiledTargeter | null,
 *   explicitTargeter: boolean,
 *   delay: number,
 *   conditions: CompiledCondition[],
 *   chance: number,
 *   children: CompiledStep[] | null,
 * }} CompiledStep
 * @typedef {{
 *   name: string,
 *   triggers: { name: string, arg: string | undefined, module: import("../types/config").Trigger }[],
 *   conditions: CompiledCondition[],
 *   chance: number,
 *   cooldown: number,
 *   exclusive: boolean,
 *   interruptible: boolean,
 *   steps: CompiledStep[],
 * }} CompiledSkill
 * @typedef {{
 *   config: BossConfig,
 *   skills: Map<string, CompiledSkill>,
 *   byTrigger: Map<string, CompiledSkill[]>,
 * }} CompiledBoss
 */

const VALID_AI = ["idle", "chase", "frozen"];

export class Validator {
  /** @param {import("../registry/SkillManager.js").SkillManager} registry */
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * @param {BossConfig} config
   * @returns {CompiledBoss | undefined}
   */
  compile(config) {
    const label = config?.id ?? "<no id>";
    const fatal = [];
    if (!config || typeof config !== "object") fatal.push("config is not an object");
    else {
      if (config.schemaVersion !== 1) fatal.push(`unsupported schemaVersion ${config.schemaVersion} (expected 1)`);
      if (typeof config.id !== "string" || !config.id.includes(":")) fatal.push(`id must be a namespaced entity type id`);
      if (!config.skills || typeof config.skills !== "object") fatal.push("skills object is required");
      if (config.ai?.default && !VALID_AI.includes(config.ai.default)) fatal.push(`ai.default must be one of ${VALID_AI.join("/")}`);
      if (config.kind !== undefined && config.kind !== "boss" && config.kind !== "minion") fatal.push(`kind must be "boss" or "minion"`);
      for (const req of config.requires ?? []) {
        if (!this.registry.isUsable(req)) fatal.push(`requires mechanic "${req}" which is not registered or disabled`);
      }
    }
    if (fatal.length) {
      for (const e of fatal) Log.error(`boss ${label}: ${e}`);
      Log.error(`boss ${label} rejected`);
      return undefined;
    }

    /** @type {Map<string, CompiledSkill>} */
    const skills = new Map();
    for (const [name, def] of Object.entries(config.skills)) {
      const errors = [];
      const skill = this.compileSkill(config, name, def, errors);
      if (errors.length) {
        for (const e of errors) Log.warn(`boss ${label} skill "${name}": ${e}`);
        Log.warn(`boss ${label} skill "${name}" disabled`);
        continue;
      }
      skills.set(name, skill);
    }

    // Cross-references: phase onEnter and `skill` mechanic targets.
    for (const phase of config.phases ?? []) {
      for (const s of phase.onEnter ?? []) {
        if (!skills.has(s)) Log.warn(`boss ${label} phase ${phase.id}: onEnter skill "${s}" missing or disabled`);
      }
    }

    /** @type {Map<string, CompiledSkill[]>} */
    const byTrigger = new Map();
    for (const skill of skills.values()) {
      for (const t of skill.triggers) {
        let list = byTrigger.get(t.name);
        if (!list) byTrigger.set(t.name, (list = []));
        list.push(skill);
      }
    }

    Log.info(`boss ${label}: ${skills.size} skill(s) ready`);
    return { config, skills, byTrigger };
  }

  /**
   * @param {BossConfig} config @param {string} name @param {SkillDef} def @param {string[]} errors
   * @returns {CompiledSkill}
   */
  compileSkill(config, name, def, errors) {
    const triggers = [];
    const trs = def.tr === undefined ? [] : Array.isArray(def.tr) ? def.tr : [def.tr];
    for (const spec of trs) {
      const { name: tName, arg } = parseTrigger(spec);
      const module = this.registry.trigger(tName);
      if (!module) {
        errors.push(`unknown trigger "${tName}"`);
        continue;
      }
      for (const e of module.validateArg?.(arg) ?? []) errors.push(`trigger ${tName}: ${e}`);
      triggers.push({ name: module.name.toLowerCase(), arg, module });
    }

    const vctx = { config, skillName: name };
    /** @type {CompiledStep[]} */
    let steps;
    if (def.m) steps = [this.compileStep({ m: def.m, o: def.o, t: def.t, delay: def.delay }, vctx, errors, "")];
    else if (Array.isArray(def.c)) steps = def.c.map((line, i) => this.compileStep(line, vctx, errors, `c[${i}]`));
    else {
      errors.push("skill needs either `m` (single mechanic) or `c` (child lines)");
      steps = [];
    }

    return {
      name,
      triggers,
      conditions: this.compileConditions(def.if, errors, ""),
      chance: this.chance(def.chance, errors, ""),
      cooldown: this.ticks(def.cooldown, "cooldown", errors),
      exclusive: !!def.exclusive,
      interruptible: !!def.interruptible,
      steps,
    };
  }

  /**
   * @param {SkillLine} line @param {import("../types/config").ValidationContext} vctx
   * @param {string[]} errors @param {string} path
   * @returns {CompiledStep}
   */
  compileStep(line, vctx, errors, path) {
    const at = path ? `${path}: ` : "";
    /** @type {CompiledStep} */
    const step = {
      mechanic: null,
      name: line?.m ?? "<group>",
      options: line?.o ?? {},
      targeter: null,
      explicitTargeter: line?.t !== undefined,
      delay: this.ticks(line?.delay, `${at}delay`, errors),
      conditions: this.compileConditions(line?.if, errors, at),
      chance: this.chance(line?.chance, errors, at),
      children: null,
    };
    if (!line || typeof line !== "object") {
      errors.push(`${at}skill line must be an object`);
      return step;
    }
    if (line.m && line.c) errors.push(`${at}a line has either \`m\` or \`c\`, not both`);

    if (line.c) {
      if (step.delay) errors.push(`${at}\`delay\` is not supported on a group of child lines`);
      if (!Array.isArray(line.c)) errors.push(`${at}\`c\` must be an array`);
      else step.children = line.c.map((l, i) => this.compileStep(l, vctx, errors, `${path}.c[${i}]`));
      return step;
    }
    if (!line.m) {
      errors.push(`${at}missing mechanic \`m\``);
      return step;
    }

    const mech = this.registry.mechanic(line.m);
    if (!mech) {
      errors.push(`${at}unknown mechanic "${line.m}"`);
      return step;
    }
    if (!this.registry.isUsable(line.m)) {
      errors.push(`${at}mechanic "${line.m}" is disabled (missing requires)`);
      return step;
    }
    step.mechanic = mech;
    for (const e of mech.validate?.(step.options, vctx) ?? []) errors.push(`${at}${line.m}: ${e}`);

    const tSpec = line.t ?? mech.defaultTargeter ?? "@self";
    const parsed = parseTargeter(tSpec);
    if ("error" in parsed) errors.push(`${at}${parsed.error}`);
    else {
      const tm = this.registry.targeter(parsed.name);
      if (!tm) errors.push(`${at}unknown targeter "@${parsed.name}"`);
      else {
        for (const e of tm.validate?.(parsed.options) ?? []) errors.push(`${at}@${parsed.name}: ${e}`);
        step.targeter = { module: tm, name: parsed.name, options: parsed.options };
      }
    }
    return step;
  }

  /**
   * @param {import("../types/config").ConditionSpec[] | undefined} specs
   * @param {string[]} errors @param {string} at
   * @returns {CompiledCondition[]}
   */
  compileConditions(specs, errors, at) {
    if (specs === undefined) return [];
    if (!Array.isArray(specs)) {
      errors.push(`${at}\`if\` must be an array`);
      return [];
    }
    /** @type {CompiledCondition[]} */
    const out = [];
    for (const spec of specs) {
      if (typeof spec === "function") {
        out.push({ fn: spec });
        continue;
      }
      if (typeof spec !== "string") {
        errors.push(`${at}condition must be a string or function`);
        continue;
      }
      const parsed = parseCondition(spec);
      if ("error" in parsed) {
        errors.push(`${at}${parsed.error}`);
        continue;
      }
      const module = this.registry.condition(parsed.name);
      if (!module) {
        errors.push(`${at}unknown condition "${parsed.name}"`);
        continue;
      }
      for (const e of module.validate?.(parsed.args) ?? []) errors.push(`${at}condition ${parsed.name}: ${e}`);
      out.push({ module, name: parsed.name, negate: parsed.negate, args: parsed.args });
    }
    return out;
  }

  /** @param {unknown} v @param {string[]} errors @param {string} at */
  chance(v, errors, at) {
    if (v === undefined) return 1;
    if (typeof v !== "number" || v < 0 || v > 1) {
      errors.push(`${at}chance must be a number 0–1`);
      return 1;
    }
    return v;
  }

  /** @param {unknown} v @param {string} field @param {string[]} errors */
  ticks(v, field, errors) {
    if (v === undefined) return 0;
    if (typeof v !== "number" || v < 0 || !Number.isInteger(v)) {
      errors.push(`${field} must be a non-negative integer (ticks)`);
      return 0;
    }
    return v;
  }
}
