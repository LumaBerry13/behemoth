/**
 * Behemoth — boss config schema and module contracts (schemaVersion 1).
 * Design doc §8. Durations are in ticks everywhere.
 */
import type { Entity, Vector3 } from "@minecraft/server";

// ---------------------------------------------------------------------------
// Generated animation data (converter output, design doc §6)
// ---------------------------------------------------------------------------

export interface AnimationData {
  /** Full RP animation identifier, e.g. "animation.darkknight.attack_slam". */
  name: string;
  /** Length in ticks. */
  length: number;
  loop: boolean;
  hitFrames?: number[];
  /** Named timeline markers → tick. */
  markers?: Record<string, number>;
  /** Baked bone tracks: one [x, y, z] (model space, blocks) per tick. */
  /** Baked bone pivots: one [x, y, z] per tick (entity space, blocks; +Z forward, +X left, +Y up). */
  bones?: Record<string, [number, number, number][]>;
  unbakeable?: string[];
}

// ---------------------------------------------------------------------------
// Boss config
// ---------------------------------------------------------------------------

export type AiMode = "idle" | "chase" | "frozen";

/** "@Name{k=v;k2=v2}" or an object form. */
export type TargeterSpec = string | ({ name: string } & Record<string, unknown>);

/** "name", "!name", "name<=4", "name{k=v}", or an inline custom condition. */
export type ConditionSpec = string | ((ctx: SkillContext, target: Entity | Location) => boolean);

/** "onTimer:100", "~onDamaged", ... */
export type TriggerSpec = string;

export interface SkillLine {
  /** Mechanic name. Omit to make this line a group of children `c`. */
  m?: string;
  /** Mechanic options. */
  o?: Record<string, unknown>;
  /** Targeter. Defaults to the mechanic's defaultTargeter, else @self. */
  t?: TargeterSpec;
  /** Conditions (ANDed), checked against the caster. */
  if?: ConditionSpec[];
  /** 0–1 probability of this line running. */
  chance?: number;
  /** Child lines run in order (delays pause the sequence). */
  c?: SkillLine[];
  /**
   * Run this line N ticks later WITHOUT pausing the sequence
   * (MythicMobs per-mechanic `delay=` option).
   */
  delay?: number;
  /** Run this line N more times, `repeatInterval` ticks apart, without pausing (MythicMobs repeat/repeatInterval). */
  repeat?: number;
  /** Ticks between repeats (default 1). */
  repeatInterval?: number;
  /**
   * On a child line: the line is skipped while on cooldown (ticks; MythicMobs per-mechanic `cd=`).
   * On a skill: the skill's cooldown.
   */
  cooldown?: number;
}

export interface SkillDef extends SkillLine {
  tr?: TriggerSpec | TriggerSpec[];
  /**
   * Target conditions (MythicMobs TargetConditions): tested against each target the
   * skill is called with (else the boss's current target); failing targets are dropped,
   * and the skill does not run when none is left.
   * Conditions in `if` and `targetIf` may end in " castInstead <skill>" (cast that skill
   * instead when the condition passes) or " orElseCast <skill>" (when it fails).
   */
  targetIf?: ConditionSpec[];
  /** Takes the casting lock; blocked while another exclusive skill holds it. */
  exclusive?: boolean;
  /** Cancelled when the boss changes phase. */
  interruptible?: boolean;
}

export interface PhaseDef {
  id: number;
  /** Leave this phase when health % drops to or below this value. */
  untilHealthPct?: number;
  /** Skill names run on entering the phase. */
  onEnter?: string[];
  /** Entity properties set on entering the phase. */
  properties?: Record<string, number | boolean | string>;
}

export interface BossConfig {
  schemaVersion: 1;
  /** Entity type ID this config controls. */
  id: string;
  /**
   * "boss" (default): listed in the /behemoth menu, boss bar, editable.
   * "minion": driven by the framework (skills, AI) but not listed or edited in the menu;
   * typically summoned by a boss and bound to it.
   */
  kind?: "boss" | "minion";
  display?: { name?: string; bossBar?: boolean };
  stats?: {
    health?: number;
    armor?: number;
    knockbackResist?: number;
    scale?: number;
    /** minecraft:movement value from the entity JSON; setSpeed multiplies this. */
    movementSpeed?: number;
    /** Multiplies every `damage` mechanic amount (default 1). */
    damageMultiplier?: number;
    /** Players take the configured damage on Easy/Normal/Hard alike (default false: vanilla difficulty scaling). */
    ignoreDifficulty?: boolean;
    /**
     * Scale effective health by player count (D7): health × (1 + perPlayer × (players − 1)),
     * counting targetable players within `radius` (default ai.targetRange), at most `max` (default 10).
     * Set on spawn and reset; rises when more players join the fight.
     */
    healthScaling?: { perPlayer: number; radius?: number; max?: number };
  };
  /** Initial caster-scope variables (MythicMobs mob `Variables`). */
  variables?: Record<string, number | string | boolean>;
  /** Keep this entity on Peaceful difficulty (default false: removed, D6). */
  allowPeaceful?: boolean;
  /** Where drops go (D7): "chest" (default) = a loot chest where the boss died, protected from explosions; "ground" = item entities. */
  loot?: { mode?: "chest" | "ground" };
  animations?: Record<string, AnimationData>;
  /** Baked bone/point positions in the model's rest pose (converter output), used when no baked animation plays. */
  restPose?: Record<string, [number, number, number]>;
  ai?: {
    default?: AiMode;
    /** Reset when farther than this from the spawn point (blocks). Off when unset. */
    leashRange?: number;
    /** Reset after this many ticks with no targetable player within targetRange. Off when unset. */
    resetAfterNoPlayers?: number;
    targetRange?: number;
    /** Turn toward the current target every tick (default true). */
    faceTarget?: boolean;
    /** Let the vanilla melee_attack behaviour deal damage (default false: chase only). */
    vanillaMelee?: boolean;
    /** Stop walking when the target is within this many blocks (horizontal). Off when unset. */
    stopDistance?: number;
    /** Let this boss's skills/melee damage other framework bosses (default false). */
    friendlyFire?: boolean;
  };
  threat?: { enabled?: boolean };
  phases?: PhaseDef[];
  skills: Record<string, SkillDef>;
  drops?: { item: string; amount?: number | [number, number]; chance?: number }[];
  /** Mechanic names this boss relies on; checked at startup. */
  requires?: string[];
  /** Global cooldown applied after any exclusive skill, in ticks. */
  gcd?: number;
  /**
   * Incoming damage multipliers by Bedrock damage cause (MythicMobs DamageModifiers).
   * 0 = immune, 0.25 = 75% reduction, negative = heals by that fraction.
   */
  damageModifiers?: Record<string, number>;
  /**
   * Custom death handled by the entity JSON (e.g. a fatal damage_sensor that
   * plays a death animation then despawns). The framework treats this entity
   * event as the boss's death.
   */
  death?: {
    event?: string;
    /** Ticks after the death event to remove the body if the entity JSON hasn't (default 400). */
    removeAfter?: number;
  };
  /**
   * Client base-layer animations, selectable at runtime via the `baseState`
   * mechanic. Index in each list = value of entity property bhm:idle_state / bhm:walk_state.
   */
  baseStates?: { idle?: string[]; walk?: string[] };
}

// ---------------------------------------------------------------------------
// Runtime / module contracts (design doc §8)
// ---------------------------------------------------------------------------

export interface Location extends Vector3 {
  readonly isLocation: true;
}

export type Target = Entity | Location;

/** A flying projectile, as seen by modifyProjectile (projectile mechanic). */
export interface ProjectileHandle {
  pos: Vector3;
  vel: Vector3;
  /** Blocks per tick. Change it with setSpeed (keeps the direction). */
  speed: number;
  gravity: number;
  /** Velocity multiplier per tick. */
  inertia: number;
  radius: number;
  verticalRadius: number;
  range: number;
  travelled: number;
  ticks: number;
  ended: boolean;
  setSpeed(v: number): void;
}

export interface SkillContext {
  boss: import("../core/BossInstance.js").BossInstance;
  caster: Entity;
  trigger: Entity | undefined;
  targets: Target[];
  data: unknown;
  /** Targets passed down by a parent skill (`skill`/`randomSkill`/`aura`/`hitbox`). */
  inherited: Target[] | undefined;
  vars: Record<string, unknown>;
  /** Skill-scope variables, shared with the skills this run calls. */
  skillVars: Record<string, unknown>;
  /** Where a projectile / ray trace is when it runs this skill (@Origin). */
  origin?: Location;
  /** The projectile running this skill (modifyProjectile). */
  projectile?: ProjectileHandle;
  token: import("../core/Scheduler.js").CancelToken;
  services: import("../core/services.js").Services;
}

export interface ValidationContext {
  config: BossConfig;
  skillName: string;
  /** Validate a targeter given as a mechanic option (e.g. projectile `origin`). */
  checkTargeter(spec: unknown): string[];
}

export interface Mechanic {
  name: string;
  requires?: string[];
  defaultTargeter?: string;
  validate?(options: Record<string, any>, vctx: ValidationContext): string[];
  /** Return a number > 0 to pause the sequence for that many ticks. */
  execute(ctx: SkillContext, targets: Target[], options: Record<string, any>): void | number;
}

export interface Targeter {
  name: string;
  validate?(options: Record<string, any>): string[];
  resolve(ctx: SkillContext, options: Record<string, any>): Target[];
}

export interface ConditionArgs {
  op?: "<" | "<=" | ">" | ">=" | "==" | "!=";
  value?: string | number | boolean;
  [key: string]: unknown;
}

export interface Condition {
  name: string;
  validate?(args: ConditionArgs): string[];
  test(ctx: SkillContext, target: Target, args: ConditionArgs): boolean;
}

export interface TriggerEvent {
  boss: import("../core/BossInstance.js").BossInstance;
  triggerEntity?: Entity;
  data?: any;
}

export interface Trigger {
  name: string;
  /** Validates the ":arg" part of "onTimer:100". */
  validateArg?(arg: string | undefined): string[];
  /** Subscribe to bus events; call fire(event) to run this trigger's skills. */
  subscribe(bus: import("../core/EventBus.js").EventBus, fire: (event: TriggerEvent) => void): void;
  /** Per-skill filter using the ":arg" part. Default: always true. */
  match?(arg: string | undefined, event: TriggerEvent): boolean;
}
