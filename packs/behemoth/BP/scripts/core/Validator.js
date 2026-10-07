// Startup config validation + compilation (design doc §4, §8).
// Turns a raw boss config into a CompiledBoss. Fatal config errors reject the
// boss; errors inside a skill disable only that skill.
import { Log } from "./Logger.js";
import { parseTargeter, parseCondition, parseTrigger, hasPlaceholder, sampleValue } from "./SkillParser.js";

/** @typedef {import("../types/config").BossConfig} BossConfig */
/** @typedef {import("../types/config").SkillLine} SkillLine */
/** @typedef {import("../types/config").SkillDef} SkillDef */

/**
 * @typedef {{ kind: "castInstead" | "orElseCast", skill: string }} ConditionAction
 * @typedef {{ fn: Function, action?: undefined } | { module: import("../types/config").Condition, name: string, negate: boolean, args: import("../types/config").ConditionArgs, action?: ConditionAction }} CompiledCondition
 * @typedef {{ module: import("../types/config").Targeter, name: string, options: Record<string, any> }} CompiledTargeter
 * @typedef {{
 *   mechanic: import("../types/config").Mechanic | null,
 *   name: string,
 *   options: Record<string, any>,
 *   dynamic: string[] | null,
 *   targeter: CompiledTargeter | null,
 *   explicitTargeter: boolean,
 *   delay: number,
 *   repeat: number,
 *   repeatInterval: number,
 *   cooldown: number,
 *   conditions: CompiledCondition[],
 *   chance: number,
 *   children: CompiledStep[] | null,
 * }} CompiledStep
 * @typedef {{
 *   name: string,
 *   triggers: { name: string, arg: string | undefined, module: import("../types/config").Trigger }[],
 *   conditions: CompiledCondition[],
 *   targetConditions: CompiledCondition[],
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
const VALID_LOOT = ["chest", "ground"];

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
      if (config.variables !== undefined && (typeof config.variables !== "object" || Array.isArray(config.variables))) fatal.push("variables must be an object of name → initial value");
      const hs = config.stats?.healthScaling;
      if (hs !== undefined && (typeof hs.perPlayer !== "number" || hs.perPlayer < 0)) fatal.push("stats.healthScaling.perPlayer must be a number ≥ 0");
      if (config.parts !== undefined && (!Array.isArray(config.parts) || config.parts.length > 16 || config.parts.some((p) => typeof p !== "string"))) {
        fatal.push("parts must be a list of at most 16 bone names");
      }
      if (config.loot?.mode !== undefined && !VALID_LOOT.includes(config.loot.mode)) fatal.push(`loot.mode must be one of ${VALID_LOOT.join("/")}`);
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

    /** @type {import("../types/config").ValidationContext} */
    const vctx = {
      config,
      skillName: name,
      checkTargeter: (spec) => this.checkTargeter(spec),
    };
    /** @type {CompiledStep[]} */
    let steps;
    if (def.m) {
      const { tr: _tr, if: _if, targetIf: _tif, chance: _ch, cooldown: _cd, exclusive: _ex, interruptible: _in, c: _c, ...line } = def;
      steps = [this.compileStep(line, vctx, errors, "")];
    } else if (Array.isArray(def.c)) steps = def.c.map((line, i) => this.compileStep(line, vctx, errors, `c[${i}]`));
    else {
      errors.push("skill needs either `m` (single mechanic) or `c` (child lines)");
      steps = [];
    }

    return {
      name,
      triggers,
      conditions: this.compileConditions(def.if, errors, "", config),
      targetConditions: this.compileConditions(def.targetIf, errors, "targetIf: ", config),
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
      dynamic: null,
      targeter: null,
      explicitTargeter: line?.t !== undefined,
      delay: this.ticks(line?.delay, `${at}delay`, errors),
      repeat: this.ticks(line?.repeat, `${at}repeat`, errors),
      repeatInterval: line?.repeatInterval === undefined ? 1 : this.ticks(line.repeatInterval, `${at}repeatInterval`, errors),
      cooldown: this.ticks(line?.cooldown, `${at}cooldown`, errors),
      conditions: this.compileConditions(line?.if, errors, at, vctx.config),
      chance: this.chance(line?.chance, errors, at),
      children: null,
    };
    if (!line || typeof line !== "object") {
      errors.push(`${at}skill line must be an object`);
      return step;
    }
    if (line.m && line.c) errors.push(`${at}a line has either \`m\` or \`c\`, not both`);

    if (line.c) {
      if (step.delay || step.repeat || step.cooldown) errors.push(`${at}\`delay\`, \`repeat\` and \`cooldown\` are not supported on a group of child lines`);
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

    // Options with <placeholders> are resolved per execution; validate a sample.
    const dynamic = Object.keys(step.options).filter((k) => hasPlaceholder(step.options[k]));
    let toValidate = step.options;
    if (dynamic.length) {
      step.dynamic = dynamic;
      toValidate = { ...step.options };
      for (const k of dynamic) toValidate[k] = sampleValue(step.options[k]);
    }
    for (const e of mech.validate?.(toValidate, vctx) ?? []) errors.push(`${at}${line.m}: ${e}`);

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
   * Validate a targeter given as a mechanic option (e.g. projectile `origin`).
   * @param {unknown} spec @returns {string[]}
   */
  checkTargeter(spec) {
    const parsed = parseTargeter(/** @type {any} */ (spec));
    if ("error" in parsed) return [parsed.error];
    const tm = this.registry.targeter(parsed.name);
    if (!tm) return [`unknown targeter "@${parsed.name}"`];
    return (tm.validate?.(parsed.options) ?? []).map((e) => `@${parsed.name}: ${e}`);
  }

  /**
   * @param {import("../types/config").ConditionSpec[] | undefined} specs
   * @param {string[]} errors @param {string} at @param {BossConfig} config
   * @returns {CompiledCondition[]}
   */
  compileConditions(specs, errors, at, config) {
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
      if (parsed.action && !config.skills?.[parsed.action.skill]) {
        errors.push(`${at}condition ${parsed.name}: ${parsed.action.kind} skill "${parsed.action.skill}" is not defined`);
      }
      out.push({ module, name: parsed.name, negate: parsed.negate, args: parsed.args, action: parsed.action });
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
