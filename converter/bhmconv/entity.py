"""Entity patching: Behemoth-ready stub (design doc §5) for the behavior entity,
and the base-layer controller for the client entity.

The owner's own components/groups/events are kept. Only the framework's
`bhm:` items are added, plus these documented changes:
  * minecraft:despawn removed, minecraft:persistent added (bosses never despawn)
  * minecraft:equipment removed (MythicMobs PreventRandomEquipment)
  * format_version raised to 1.21.0 (needed for entity properties); boolean
    damage_sensor `deals_damage` values become "yes"/"no"
"""

from __future__ import annotations

import copy
from typing import Any

STUB_FORMAT = "1.21.0"

STUB_GROUPS: dict[str, Any] = {
    "bhm:idle": {
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8},
        "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 16.0, "probability": 0.1},
        "minecraft:behavior.random_look_around": {"priority": 8},
    },
    "bhm:chase": {
        # Only players: otherwise a boss hit by another boss would chase it.
        "minecraft:behavior.hurt_by_target": {
            "priority": 1,
            "entity_types": {"filters": {"test": "is_family", "subject": "other", "value": "player"}},
        },
        "minecraft:behavior.nearest_attackable_target": {
            "priority": 2,
            "must_see": False,
            "reselect_targets": True,
            "within_radius": 32.0,
            "entity_types": [
                {"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 32}
            ],
        },
        # Pathfinding chase. Its melee damage is cancelled by the framework
        # (config ai.vanillaMelee=false, MythicMobs `CancelEvent ~onAttack`).
        "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.0, "track_target": True},
        "minecraft:attack": {"damage": 1},
        "minecraft:behavior.look_at_target": {"priority": 4},
    },
    "bhm:frozen": {"minecraft:movement": {"value": 0.0}},
    "bhm:invulnerable": {"minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]}},
    "bhm:despawn": {"minecraft:instant_despawn": {}},
}

STUB_EVENTS: dict[str, Any] = {
    "bhm:set_idle": {"remove": {"component_groups": ["bhm:chase", "bhm:frozen"]}, "add": {"component_groups": ["bhm:idle"]}},
    "bhm:set_chase": {"remove": {"component_groups": ["bhm:idle", "bhm:frozen"]}, "add": {"component_groups": ["bhm:chase"]}},
    "bhm:set_frozen": {"remove": {"component_groups": ["bhm:idle", "bhm:chase"]}, "add": {"component_groups": ["bhm:frozen"]}},
    "bhm:invuln_on": {"add": {"component_groups": ["bhm:invulnerable"]}},
    "bhm:invuln_off": {"remove": {"component_groups": ["bhm:invulnerable"]}},
    "bhm:despawn": {"add": {"component_groups": ["bhm:despawn"]}},
}


def _version_tuple(v: str) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


def _fix_deals_damage(node: Any) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "deals_damage" and isinstance(v, bool):
                node[k] = "yes" if v else "no"
            else:
                _fix_deals_damage(v)
    elif isinstance(node, list):
        for x in node:
            _fix_deals_damage(x)


def death_duration_ticks(behavior: dict, event: str) -> int | None:
    """Longest minecraft:timer in the groups the death event adds (custom death length)."""
    ent = behavior.get("minecraft:entity", {})
    added = ent.get("events", {}).get(event, {}).get("add", {}).get("component_groups", [])
    best = None
    for g in added:
        timer = ent.get("component_groups", {}).get(g, {}).get("minecraft:timer")
        if not timer:
            continue
        t = timer.get("time", 0)
        secs = max(float(x) for x in t) if isinstance(t, list) else float(t)
        best = max(best or 0, int(round(secs * 20)))
    return best


def find_death_event(behavior: dict) -> str | None:
    """Event fired by a damage_sensor trigger filtered on fatal damage (custom death)."""
    sensor = behavior.get("minecraft:entity", {}).get("components", {}).get("minecraft:damage_sensor")
    if not sensor:
        return None
    triggers = sensor.get("triggers", [])
    for t in triggers if isinstance(triggers, list) else [triggers]:
        on = t.get("on_damage", {})
        if "fatal" in repr(on.get("filters", "")) or t.get("cause") == "fatal":
            ev = on.get("event")
            if ev:
                return ev
    return None


def movement_speed(behavior: dict) -> float | None:
    v = behavior.get("minecraft:entity", {}).get("components", {}).get("minecraft:movement", {}).get("value")
    return float(v) if isinstance(v, (int, float)) else None


def patch_behavior(behavior: dict, idle_states: int, walk_states: int, boss_bar_range: int, notes: list[str],
                   boss_name: str = "") -> dict:
    out = copy.deepcopy(behavior)
    if _version_tuple(out.get("format_version", "0")) < _version_tuple(STUB_FORMAT):
        notes.append(f"behavior format_version {out.get('format_version')} → {STUB_FORMAT} (entity properties)")
        out["format_version"] = STUB_FORMAT
    _fix_deals_damage(out)

    ent = out["minecraft:entity"]
    desc = ent.setdefault("description", {})
    props = desc.setdefault("properties", {})
    props.update({
        "bhm:phase": {"type": "int", "range": [0, 15], "default": 1, "client_sync": True},
        "bhm:visibility": {"type": "int", "range": [0, 255], "default": 0, "client_sync": True},
        "bhm:anim_speed": {"type": "float", "range": [0.0, 10.0], "default": 1.0, "client_sync": True},
        "bhm:idle_state": {"type": "int", "range": [0, max(1, idle_states - 1)], "default": 0, "client_sync": True},
        "bhm:walk_state": {"type": "int", "range": [0, max(1, walk_states - 1)], "default": 0, "client_sync": True},
    })

    comps = ent.setdefault("components", {})
    for removed, why in (("minecraft:despawn", "bosses never despawn naturally"),
                         ("minecraft:equipment", "random equipment (MythicMobs PreventRandomEquipment)")):
        if removed in comps:
            del comps[removed]
            notes.append(f"removed {removed}: {why}")
    comps["minecraft:persistent"] = {}
    comps["minecraft:boss"] = {"should_darken_sky": False, "hud_range": boss_bar_range}
    if boss_name:
        comps["minecraft:boss"]["name"] = boss_name
    fam = comps.setdefault("minecraft:type_family", {"family": []}).setdefault("family", [])
    if "bhm_boss" not in fam:
        fam.append("bhm_boss")

    groups = ent.setdefault("component_groups", {})
    for name, g in STUB_GROUPS.items():
        if name in groups:
            notes.append(f"component group {name} already existed and was replaced")
        groups[name] = copy.deepcopy(g)

    events = ent.setdefault("events", {})
    for name, e in STUB_EVENTS.items():
        events[name] = copy.deepcopy(e)
    spawned = events.get("minecraft:entity_spawned") or {}
    add = spawned.setdefault("add", {}).setdefault("component_groups", [])
    if "bhm:idle" not in add:
        add.append("bhm:idle")
    events["minecraft:entity_spawned"] = spawned
    return out


def base_controller_id(boss: str) -> str:
    return f"controller.animation.{boss}.bhm_base"


def build_base_controller(boss: str, idle: list[str], walk: list[str]) -> dict:
    """Client controller: loops the selected idle/walk animation (bhm:idle_state / bhm:walk_state)."""
    moving = "q.modified_move_speed > 0.05"
    states: dict[str, Any] = {}

    def idle_state(i: int) -> str:
        return f"idle_{i}"

    def walk_state(i: int) -> str:
        return f"walk_{i}"

    for i, anim in enumerate(idle):
        tr = [{walk_state(j): f"{moving} && q.property('bhm:walk_state') == {j}"} for j in range(len(walk))]
        tr += [{idle_state(k): f"q.property('bhm:idle_state') == {k}"} for k in range(len(idle)) if k != i]
        states[idle_state(i)] = {"animations": [anim], "transitions": tr, "blend_transition": 0.2}
    for j, anim in enumerate(walk):
        tr = [{idle_state(k): f"!({moving}) && q.property('bhm:idle_state') == {k}"} for k in range(len(idle))]
        tr += [{walk_state(m): f"q.property('bhm:walk_state') == {m}"} for m in range(len(walk)) if m != j]
        states[walk_state(j)] = {"animations": [anim], "transitions": tr, "blend_transition": 0.2}

    return {
        "format_version": "1.10.0",
        "animation_controllers": {
            base_controller_id(boss): {"initial_state": idle_state(0) if idle else walk_state(0), "states": states}
        },
    }


def patch_client_entity(client: dict, boss: str, notes: list[str]) -> dict:
    out = copy.deepcopy(client)
    desc = out["minecraft:client_entity"]["description"]
    desc.setdefault("animations", {})["bhm_base"] = base_controller_id(boss)
    scripts = desc.setdefault("scripts", {})
    animate = scripts.setdefault("animate", [])
    if "bhm_base" not in animate:
        animate.insert(0, "bhm_base")
        notes.append("client entity: added base-layer controller `bhm_base` (first in scripts.animate)")
    return out
