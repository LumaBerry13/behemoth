// Module registries (design doc §4 "Plug-and-play rules").
// Names are case-insensitive, like MythicMobs. One shared singleton per name.
import { Log } from "../core/Logger.js";

/** @typedef {import("../types/config").Mechanic} Mechanic */
/** @typedef {import("../types/config").Targeter} Targeter */
/** @typedef {import("../types/config").Condition} Condition */
/** @typedef {import("../types/config").Trigger} Trigger */

/** Accepts a module object or a class (instantiated once). @param {any} m */
const instantiate = (m) => (typeof m === "function" ? new m() : m);

export class SkillManager {
  constructor() {
    /** @type {Map<string, Mechanic>} */ this.mechanics = new Map();
    /** @type {Map<string, Targeter>} */ this.targeters = new Map();
    /** @type {Map<string, Condition>} */ this.conditions = new Map();
    /** @type {Map<string, Trigger>} */ this.triggers = new Map();
    /** Mechanics disabled because a `requires` entry is missing. @type {Set<string>} */
    this.disabled = new Set();
  }

  /** @param {string} name @param {Mechanic | (new () => Mechanic)} module */
  bind(name, module) {
    this.put(this.mechanics, "mechanic", name, module);
  }
  /** @param {string} name @param {Targeter | (new () => Targeter)} module */
  bindTargeter(name, module) {
    this.put(this.targeters, "targeter", name, module);
  }
  /** @param {string} name @param {Condition | (new () => Condition)} module */
  bindCondition(name, module) {
    this.put(this.conditions, "condition", name, module);
  }
  /** @param {string} name @param {Trigger | (new () => Trigger)} module */
  bindTrigger(name, module) {
    this.put(this.triggers, "trigger", name, module);
  }

  /** @private */
  put(map, kind, name, module) {
    const key = name.toLowerCase();
    if (map.has(key)) Log.warn(`${kind} "${name}" bound twice; the later binding wins`);
    map.set(key, instantiate(module));
  }

  /** @param {string} name */ mechanic(name) { return this.mechanics.get(name.toLowerCase()); }
  /** @param {string} name */ targeter(name) { return this.targeters.get(name.toLowerCase()); }
  /** @param {string} name */ condition(name) { return this.conditions.get(name.toLowerCase()); }
  /** @param {string} name */ trigger(name) { return this.triggers.get(name.toLowerCase()); }

  /** Check every mechanic's `requires`; disable those with missing deps. */
  checkRequires() {
    for (const [key, m] of this.mechanics) {
      const missing = (m.requires ?? []).filter((r) => !this.mechanics.has(r.toLowerCase()));
      if (missing.length) {
        this.disabled.add(key);
        Log.warn(`mechanic "${key}" disabled: missing required module(s) ${missing.join(", ")}`);
      }
    }
  }

  /** @param {string} name */
  isUsable(name) {
    const key = name.toLowerCase();
    return this.mechanics.has(key) && !this.disabled.has(key);
  }

  summary() {
    return `${this.mechanics.size} mechanics, ${this.targeters.size} targeters, ${this.conditions.size} conditions, ${this.triggers.size} triggers`;
  }
}

// ---------------------------------------------------------------------------
// Module binding list — one import + one bind line per module (design doc §8).
// To add a module: create its file under modules/ and add two lines here.
// ---------------------------------------------------------------------------
import state from "../modules/mechanics/state.js";
import damage from "../modules/mechanics/damage.js";
import leap from "../modules/mechanics/leap.js";
import particle from "../modules/mechanics/particle.js";
import particleRing from "../modules/mechanics/particle_ring.js";
import sound from "../modules/mechanics/sound.js";
import delay from "../modules/mechanics/delay.js";
import setAI from "../modules/mechanics/set_ai.js";
import summon from "../modules/mechanics/summon.js";
import phaseMechanic from "../modules/mechanics/phase.js";
import message from "../modules/mechanics/message.js";
import waitMarker from "../modules/mechanics/wait_marker.js";
import skillMechanic from "../modules/mechanics/skill.js";
import invulnerable from "../modules/mechanics/invulnerable.js";

import self from "../modules/targeters/self.js";
import target from "../modules/targeters/target.js";
import trigger from "../modules/targeters/trigger.js";
import playersInRadius from "../modules/targeters/players_in_radius.js";
import entitiesInRadius from "../modules/targeters/entities_in_radius.js";
import nearestPlayer from "../modules/targeters/nearest_player.js";
import selfLocation from "../modules/targeters/self_location.js";
import targetLocation from "../modules/targeters/target_location.js";

import healthPct from "../modules/conditions/health_pct.js";
import distanceCondition from "../modules/conditions/distance.js";
import chance from "../modules/conditions/chance.js";
import phaseCondition from "../modules/conditions/phase.js";
import hasTarget from "../modules/conditions/has_target.js";
import hasTag from "../modules/conditions/has_tag.js";

import onSpawn from "../modules/triggers/on_spawn.js";
import onTimer from "../modules/triggers/on_timer.js";
import onDamaged from "../modules/triggers/on_damaged.js";
import onDeath from "../modules/triggers/on_death.js";
import onAttack from "../modules/triggers/on_attack.js";
import onPhase from "../modules/triggers/on_phase.js";
import animEnd from "../modules/triggers/anim_end.js";
import onMarker from "../modules/triggers/on_marker.js";

/** @param {SkillManager} sm */
export function bindModules(sm) {
  sm.bind("state", state);
  sm.bind("damage", damage);
  sm.bind("leap", leap);
  sm.bind("particle", particle);
  sm.bind("particleRing", particleRing);
  sm.bind("sound", sound);
  sm.bind("delay", delay);
  sm.bind("setAI", setAI);
  sm.bind("summon", summon);
  sm.bind("phase", phaseMechanic);
  sm.bind("message", message);
  sm.bind("waitMarker", waitMarker);
  sm.bind("skill", skillMechanic);
  sm.bind("invulnerable", invulnerable);

  sm.bindTargeter("self", self);
  sm.bindTargeter("target", target);
  sm.bindTargeter("trigger", trigger);
  sm.bindTargeter("PlayersInRadius", playersInRadius);
  sm.bindTargeter("EntitiesInRadius", entitiesInRadius);
  sm.bindTargeter("NearestPlayer", nearestPlayer);
  sm.bindTargeter("SelfLocation", selfLocation);
  sm.bindTargeter("TargetLocation", targetLocation);

  sm.bindCondition("healthPct", healthPct);
  sm.bindCondition("distance", distanceCondition);
  sm.bindCondition("chance", chance);
  sm.bindCondition("phase", phaseCondition);
  sm.bindCondition("hasTarget", hasTarget);
  sm.bindCondition("hasTag", hasTag);

  sm.bindTrigger("onSpawn", onSpawn);
  sm.bindTrigger("onTimer", onTimer);
  sm.bindTrigger("onDamaged", onDamaged);
  sm.bindTrigger("onDeath", onDeath);
  sm.bindTrigger("onAttack", onAttack);
  sm.bindTrigger("onPhase", onPhase);
  sm.bindTrigger("animEnd", animEnd);
  sm.bindTrigger("onMarker", onMarker);
}
