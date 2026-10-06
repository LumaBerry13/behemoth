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
import randomSkill from "../modules/mechanics/random_skill.js";
import gcd from "../modules/mechanics/gcd.js";
import setSpeed from "../modules/mechanics/set_speed.js";
import baseState from "../modules/mechanics/base_state.js";
import lockFacing from "../modules/mechanics/lock_facing.js";
import addTag from "../modules/mechanics/add_tag.js";
import removeTag from "../modules/mechanics/remove_tag.js";
import aura from "../modules/mechanics/aura.js";
import hitbox from "../modules/mechanics/hitbox.js";
import throwMechanic from "../modules/mechanics/throw.js";
import shieldBreak from "../modules/mechanics/shield_break.js";
import potion from "../modules/mechanics/potion.js";
import propel from "../modules/mechanics/propel.js";
import cameraShake from "../modules/mechanics/camera_shake.js";
import heal from "../modules/mechanics/heal.js";
import percentDamage from "../modules/mechanics/percent_damage.js";
import ignite from "../modules/mechanics/ignite.js";
import lightning from "../modules/mechanics/lightning.js";
import lunge from "../modules/mechanics/lunge.js";
import velocityMechanic from "../modules/mechanics/velocity.js";
import pull from "../modules/mechanics/pull.js";
import knockback from "../modules/mechanics/knockback.js";
import teleport from "../modules/mechanics/teleport.js";
import teleportBehind from "../modules/mechanics/teleport_behind.js";
import projectile from "../modules/mechanics/projectile.js";
import particleSphere from "../modules/mechanics/particle_sphere.js";
import particleLine from "../modules/mechanics/particle_line.js";
import setProperty from "../modules/mechanics/set_property.js";
import title from "../modules/mechanics/title.js";
import actionBar from "../modules/mechanics/action_bar.js";
import tempBlocks from "../modules/mechanics/temp_blocks.js";
import setVariable from "../modules/mechanics/set_variable.js";
import signal from "../modules/mechanics/signal.js";
import variableMath from "../modules/mechanics/variable_math.js";
import setRotation from "../modules/mechanics/set_rotation.js";
import matchRotation from "../modules/mechanics/match_rotation.js";
import rayTraceTo from "../modules/mechanics/ray_trace_to.js";
import bossBar from "../modules/mechanics/boss_bar.js";
import removeMechanic from "../modules/mechanics/remove.js";
import stun from "../modules/mechanics/stun.js";
import tint from "../modules/mechanics/tint.js";
import modifyProjectile from "../modules/mechanics/modify_projectile.js";
import explosion from "../modules/mechanics/explosion.js";
import shoot from "../modules/mechanics/shoot.js";
import jump from "../modules/mechanics/jump.js";
import threatMechanic from "../modules/mechanics/threat.js";
import setHealth from "../modules/mechanics/set_health.js";
import swap from "../modules/mechanics/swap.js";
import forcePull from "../modules/mechanics/force_pull.js";
import command from "../modules/mechanics/command.js";
import suicide from "../modules/mechanics/suicide.js";

import self from "../modules/targeters/self.js";
import target from "../modules/targeters/target.js";
import trigger from "../modules/targeters/trigger.js";
import playersInRadius from "../modules/targeters/players_in_radius.js";
import entitiesInRadius from "../modules/targeters/entities_in_radius.js";
import nearestPlayer from "../modules/targeters/nearest_player.js";
import selfLocation from "../modules/targeters/self_location.js";
import targetLocation from "../modules/targeters/target_location.js";
import bone from "../modules/targeters/bone.js";
import forward from "../modules/targeters/forward.js";
import randomPlayer from "../modules/targeters/random_player.js";
import threatTable from "../modules/targeters/threat_table.js";
import cone from "../modules/targeters/cone.js";
import ringTargeter from "../modules/targeters/ring.js";
import origin from "../modules/targeters/origin.js";
import parent from "../modules/targeters/parent.js";
import randomLocationsNearCaster from "../modules/targeters/random_locations_near_caster.js";
import mobsInRadius from "../modules/targeters/mobs_in_radius.js";
import playersInRing from "../modules/targeters/players_in_ring.js";
import randomLocationsNearTarget from "../modules/targeters/random_locations_near_target.js";
import lineTargeter from "../modules/targeters/line.js";
import locationTargeter from "../modules/targeters/location.js";
import spawnTargeter from "../modules/targeters/spawn.js";

import healthPct from "../modules/conditions/health_pct.js";
import distanceCondition from "../modules/conditions/distance.js";
import chance from "../modules/conditions/chance.js";
import phaseCondition from "../modules/conditions/phase.js";
import hasTarget from "../modules/conditions/has_target.js";
import hasTag from "../modules/conditions/has_tag.js";
import offGcd from "../modules/conditions/off_gcd.js";
import moving from "../modules/conditions/moving.js";
import inBlock from "../modules/conditions/in_block.js";
import lineOfSight from "../modules/conditions/line_of_sight.js";
import variableCondition from "../modules/conditions/variable.js";
import height from "../modules/conditions/height.js";
import playersNearby from "../modules/conditions/players_nearby.js";
import fieldOfView from "../modules/conditions/field_of_view.js";
import inCombat from "../modules/conditions/in_combat.js";
import varEquals from "../modules/conditions/var_equals.js";
import variableIsSet from "../modules/conditions/variable_is_set.js";
import directionalVelocity from "../modules/conditions/directional_velocity.js";
import altitude from "../modules/conditions/altitude.js";
import onGround from "../modules/conditions/on_ground.js";
import isPlayer from "../modules/conditions/is_player.js";
import onFire from "../modules/conditions/on_fire.js";
import crouching from "../modules/conditions/crouching.js";
import sprinting from "../modules/conditions/sprinting.js";
import entityType from "../modules/conditions/entity_type.js";
import hasEffect from "../modules/conditions/has_effect.js";

import onSpawn from "../modules/triggers/on_spawn.js";
import onTimer from "../modules/triggers/on_timer.js";
import onDamaged from "../modules/triggers/on_damaged.js";
import onDeath from "../modules/triggers/on_death.js";
import onAttack from "../modules/triggers/on_attack.js";
import onPhase from "../modules/triggers/on_phase.js";
import animEnd from "../modules/triggers/anim_end.js";
import onMarker from "../modules/triggers/on_marker.js";
import onReset from "../modules/triggers/on_reset.js";
import onInteract from "../modules/triggers/on_interact.js";
import onSignal from "../modules/triggers/on_signal.js";
import onCombat from "../modules/triggers/on_combat.js";
import onDropCombat from "../modules/triggers/on_drop_combat.js";
import onChangeTarget from "../modules/triggers/on_change_target.js";
import onKillPlayer from "../modules/triggers/on_kill_player.js";
import onLoad from "../modules/triggers/on_load.js";

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
  sm.bind("randomSkill", randomSkill);
  sm.bind("gcd", gcd);
  sm.bind("setSpeed", setSpeed);
  sm.bind("baseState", baseState);
  sm.bind("lockFacing", lockFacing);
  sm.bind("addTag", addTag);
  sm.bind("removeTag", removeTag);
  sm.bind("aura", aura);
  sm.bind("hitbox", hitbox);
  sm.bind("throw", throwMechanic);
  sm.bind("shieldBreak", shieldBreak);
  sm.bind("potion", potion);
  sm.bind("propel", propel);
  sm.bind("cameraShake", cameraShake);
  sm.bind("heal", heal);
  sm.bind("percentDamage", percentDamage);
  sm.bind("ignite", ignite);
  sm.bind("lightning", lightning);
  sm.bind("lunge", lunge);
  sm.bind("velocity", velocityMechanic);
  sm.bind("pull", pull);
  sm.bind("knockback", knockback);
  sm.bind("teleport", teleport);
  sm.bind("teleportBehind", teleportBehind);
  sm.bind("projectile", projectile);
  sm.bind("particleSphere", particleSphere);
  sm.bind("particleLine", particleLine);
  sm.bind("setProperty", setProperty);
  sm.bind("title", title);
  sm.bind("actionBar", actionBar);
  sm.bind("tempBlocks", tempBlocks);
  sm.bind("setVariable", setVariable);
  sm.bind("signal", signal);
  sm.bind("variableMath", variableMath);
  sm.bind("setRotation", setRotation);
  sm.bind("matchRotation", matchRotation);
  sm.bind("rayTraceTo", rayTraceTo);
  sm.bind("bossBar", bossBar);
  sm.bind("remove", removeMechanic);
  sm.bind("stun", stun);
  sm.bind("tint", tint);
  sm.bind("modifyProjectile", modifyProjectile);
  sm.bind("explosion", explosion);
  sm.bind("shoot", shoot);
  sm.bind("jump", jump);
  sm.bind("threat", threatMechanic);
  sm.bind("setHealth", setHealth);
  sm.bind("swap", swap);
  sm.bind("forcePull", forcePull);
  sm.bind("command", command);
  sm.bind("suicide", suicide);

  sm.bindTargeter("self", self);
  sm.bindTargeter("target", target);
  sm.bindTargeter("trigger", trigger);
  sm.bindTargeter("PlayersInRadius", playersInRadius);
  sm.bindTargeter("EntitiesInRadius", entitiesInRadius);
  sm.bindTargeter("NearestPlayer", nearestPlayer);
  sm.bindTargeter("SelfLocation", selfLocation);
  sm.bindTargeter("TargetLocation", targetLocation);
  sm.bindTargeter("Bone", bone);
  sm.bindTargeter("Forward", forward);
  sm.bindTargeter("RandomPlayer", randomPlayer);
  sm.bindTargeter("ThreatTable", threatTable);
  sm.bindTargeter("Cone", cone);
  sm.bindTargeter("Ring", ringTargeter);
  sm.bindTargeter("Origin", origin);
  sm.bindTargeter("Parent", parent);
  sm.bindTargeter("RandomLocationsNearCaster", randomLocationsNearCaster);
  sm.bindTargeter("RLNC", randomLocationsNearCaster);
  sm.bindTargeter("MobsInRadius", mobsInRadius);
  sm.bindTargeter("PlayersInRing", playersInRing);
  sm.bindTargeter("RandomLocationsNearTarget", randomLocationsNearTarget);
  sm.bindTargeter("Line", lineTargeter);
  sm.bindTargeter("Location", locationTargeter);
  sm.bindTargeter("Spawn", spawnTargeter);

  sm.bindCondition("healthPct", healthPct);
  sm.bindCondition("distance", distanceCondition);
  sm.bindCondition("chance", chance);
  sm.bindCondition("phase", phaseCondition);
  sm.bindCondition("hasTarget", hasTarget);
  sm.bindCondition("hasTag", hasTag);
  sm.bindCondition("offGcd", offGcd);
  sm.bindCondition("moving", moving);
  sm.bindCondition("inBlock", inBlock);
  sm.bindCondition("lineOfSight", lineOfSight);
  sm.bindCondition("variable", variableCondition);
  sm.bindCondition("height", height);
  sm.bindCondition("playersNearby", playersNearby);
  sm.bindCondition("fieldOfView", fieldOfView);
  sm.bindCondition("inCombat", inCombat);
  sm.bindCondition("varEquals", varEquals);
  sm.bindCondition("variableIsSet", variableIsSet);
  sm.bindCondition("directionalVelocity", directionalVelocity);
  sm.bindCondition("altitude", altitude);
  sm.bindCondition("onGround", onGround);
  sm.bindCondition("isPlayer", isPlayer);
  sm.bindCondition("onFire", onFire);
  sm.bindCondition("crouching", crouching);
  sm.bindCondition("sprinting", sprinting);
  sm.bindCondition("entityType", entityType);
  sm.bindCondition("hasEffect", hasEffect);

  sm.bindTrigger("onSpawn", onSpawn);
  sm.bindTrigger("onTimer", onTimer);
  sm.bindTrigger("onDamaged", onDamaged);
  sm.bindTrigger("onDeath", onDeath);
  sm.bindTrigger("onAttack", onAttack);
  sm.bindTrigger("onPhase", onPhase);
  sm.bindTrigger("animEnd", animEnd);
  sm.bindTrigger("onMarker", onMarker);
  sm.bindTrigger("onReset", onReset);
  sm.bindTrigger("onInteract", onInteract);
  sm.bindTrigger("onSignal", onSignal);
  sm.bindTrigger("onCombat", onCombat);
  sm.bindTrigger("onDropCombat", onDropCombat);
  sm.bindTrigger("onChangeTarget", onChangeTarget);
  sm.bindTrigger("onKillPlayer", onKillPlayer);
  sm.bindTrigger("onLoad", onLoad);
}
