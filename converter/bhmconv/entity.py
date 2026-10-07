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


TINT_PROPERTY = {"type": "int", "range": [0, 16777215], "default": 16777215, "client_sync": True}


def patch_behavior(behavior: dict, idle_states: int, walk_states: int, boss_bar_range: int, notes: list[str],
                   boss_name: str = "", kind: str = "boss", identifier: str | None = None, tint: bool = False,
                   parts: int = 0) -> dict:
    """kind "boss": boss bar + family bhm_boss; "minion": no boss bar, family bhm_minion.
    identifier renames the entity (several converted mobs sharing one model); tint adds bhm:tint;
    parts > 0 adds bhm:hidden_parts (bit mask of hideable parts, config.parts)."""
    out = copy.deepcopy(behavior)
    if _version_tuple(out.get("format_version", "0")) < _version_tuple(STUB_FORMAT):
        notes.append(f"behavior format_version {out.get('format_version')} → {STUB_FORMAT} (entity properties)")
        out["format_version"] = STUB_FORMAT
    _fix_deals_damage(out)

    ent = out["minecraft:entity"]
    desc = ent.setdefault("description", {})
    if identifier:
        desc["identifier"] = identifier
    props = desc.setdefault("properties", {})
    props.update({
        "bhm:phase": {"type": "int", "range": [0, 15], "default": 1, "client_sync": True},
        "bhm:visibility": {"type": "int", "range": [0, 255], "default": 0, "client_sync": True},
        "bhm:anim_speed": {"type": "float", "range": [0.0, 10.0], "default": 1.0, "client_sync": True},
        "bhm:idle_state": {"type": "int", "range": [0, max(1, idle_states - 1)], "default": 0, "client_sync": True},
        "bhm:walk_state": {"type": "int", "range": [0, max(1, walk_states - 1)], "default": 0, "client_sync": True},
    })
    if tint:
        props["bhm:tint"] = dict(TINT_PROPERTY)
    if parts:
        props["bhm:hidden_parts"] = {"type": "int", "range": [0, 2 ** parts - 1], "default": 0, "client_sync": True}

    comps = ent.setdefault("components", {})
    for removed, why in (("minecraft:despawn", "bosses never despawn naturally"),
                         ("minecraft:equipment", "random equipment (MythicMobs PreventRandomEquipment)")):
        if removed in comps:
            del comps[removed]
            notes.append(f"removed {removed}: {why}")
    comps["minecraft:persistent"] = {}
    if kind == "boss":
        comps["minecraft:boss"] = {"should_darken_sky": False, "hud_range": boss_bar_range}
        if boss_name:
            comps["minecraft:boss"]["name"] = boss_name
    elif "minecraft:boss" in comps:
        del comps["minecraft:boss"]
        notes.append("removed minecraft:boss: minions have no boss bar")
    fam = comps.setdefault("minecraft:type_family", {"family": []}).setdefault("family", [])
    family = "bhm_boss" if kind == "boss" else "bhm_minion"
    if family not in fam:
        fam.append(family)

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


def render_controller_id(boss: str) -> str:
    return f"controller.render.{boss}.bhm"


def build_render_controller(boss: str, tint: bool, parts: list[str]) -> dict:
    """Render controller for the framework's visual properties: bhm:tint (0xRRGGBB, white = none)
    as an overlay colour (L37) and bhm:hidden_parts (bit i hides parts[i]) as part_visibility."""
    rc: dict = {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}
    if tint:
        prop = "q.property('bhm:tint')"
        rc["overlay_color"] = {
            "r": f"math.floor({prop} / 65536) / 255",
            "g": f"math.mod(math.floor({prop} / 256), 256) / 255",
            "b": f"math.mod({prop}, 256) / 255",
            "a": f"{prop} == 16777215 ? 0.0 : 0.6",
        }
    if parts:
        mask = "q.property('bhm:hidden_parts')"
        rc["part_visibility"] = [{"*": True}] + [
            {bone: f"math.mod(math.floor({mask} / {2 ** i}), 2) < 1"} for i, bone in enumerate(parts)]
    return {"format_version": "1.8.0", "render_controllers": {render_controller_id(boss): rc}}


def patch_client_entity(client: dict, boss: str, notes: list[str], identifier: str | None = None, tint: bool = False,
                        parts: list[str] | None = None, always: list[str] | None = None,
                        sound_effects: dict[str, str] | None = None) -> dict:
    """Base-layer controller first in scripts.animate, plus: identifier override, the generated
    render controller (tint / hideable parts), always-on layer animations and sound effects."""
    out = copy.deepcopy(client)
    desc = out["minecraft:client_entity"]["description"]
    if identifier:
        desc["identifier"] = identifier
    if tint or parts:
        rcs = desc.get("render_controllers", [])
        if rcs == ["controller.render.default"]:
            desc["render_controllers"] = [render_controller_id(boss)]
            what = " + ".join(x for x in ("tint overlay" if tint else "", "part visibility" if parts else "") if x)
            notes.append(f"client entity: render controller → {render_controller_id(boss)} ({what})")
        else:
            notes.append(f"client entity: render controllers {rcs} are custom; add overlay_color / part_visibility from "
                         f"{render_controller_id(boss)} to them by hand")
    desc.setdefault("animations", {})["bhm_base"] = base_controller_id(boss)
    scripts = desc.setdefault("scripts", {})
    animate = scripts.setdefault("animate", [])
    if "bhm_base" not in animate:
        animate.insert(0, "bhm_base")
        notes.append("client entity: added base-layer controller `bhm_base` (first in scripts.animate)")
    for anim in always or []:
        if anim not in animate:
            animate.append(anim)
            notes.append(f"client entity: `{anim}` always plays as a layer (job always_animate)")
    if sound_effects:
        desc.setdefault("sound_effects", {}).update(sound_effects)
    return out


# --------------------------------------------------------------------------- #
# Folder mode: complete a bare (Blockbench) behavior file
# --------------------------------------------------------------------------- #

def geometry_size(geo: dict) -> tuple[float, float]:
    """Collision box (width, height) in blocks from the model's cubes: arms and antlers stick out,
    so width = 0.6 × the narrower horizontal extent and height = 0.75 × the top."""
    xs, ys, zs = [], [], []
    for g in geo.get("minecraft:geometry", []):
        for b in g.get("bones", []):
            for c in b.get("cubes", []):
                o, s = c.get("origin", [0, 0, 0]), c.get("size", [0, 0, 0])
                xs += [o[0], o[0] + s[0]]
                ys += [o[1], o[1] + s[1]]
                zs += [o[2], o[2] + s[2]]
    if not xs:
        return 0.6, 1.8
    width = min(max(xs) - min(xs), max(zs) - min(zs)) / 16 * 0.6
    height = max(ys) / 16 * 0.75
    return round(min(3.0, max(0.6, width)), 1), round(min(6.0, max(0.5, height)), 1)


def complete_behavior(behavior: dict, mob: dict, size: tuple[float, float], notes: list[str]) -> dict:
    """Add what a bare Blockbench behavior file lacks, from the MythicMobs mob: health, collision box,
    movement and pathfinding, follow range, knockback resistance, immunities (DamageModifiers 0).
    Existing components are kept; everything added is reported."""
    out = copy.deepcopy(behavior)
    comps = out["minecraft:entity"].setdefault("components", {})
    opts = mob.get("Options") or {}

    def add(name: str, value: Any, why: str) -> None:
        if name not in comps:
            comps[name] = value
            notes.append(f"behavior: added {name} ({why})")

    hp = float(mob.get("Health", 20) or 20)
    add("minecraft:health", {"value": hp, "max": hp}, "MythicMobs Health")
    add("minecraft:collision_box", {"width": size[0], "height": size[1]}, "from the model size")
    speed = float(opts.get("MovementSpeed", 0) or 0)
    add("minecraft:movement", {"value": speed if speed > 0 else 0.25}, "MythicMobs MovementSpeed" if speed > 0 else "default 0.25")
    add("minecraft:movement.basic", {}, "walking")
    add("minecraft:jump.static", {}, "walking")
    add("minecraft:navigation.walk", {"can_path_over_water": True, "avoid_damage_blocks": True}, "pathfinding")
    add("minecraft:physics", {}, "gravity and collision")
    add("minecraft:pushable", {"is_pushable": False, "is_pushable_by_piston": False}, "bosses are not pushed around")
    follow = float(opts.get("FollowRange", 32) or 32)
    add("minecraft:follow_range", {"value": follow, "max": follow}, "MythicMobs FollowRange")
    add("minecraft:knockback_resistance", {"value": float(opts.get("KnockbackResistance", 1) or 0)}, "MythicMobs KnockbackResistance")
    add("minecraft:breathable", {"total_supply": 15, "suffocate_time": 0, "breathes_water": True}, "no drowning")
    add("minecraft:nameable", {"always_show": False, "allow_name_tag_renaming": False}, "boss bar name")
    if "minecraft:behavior.random_stroll" in comps:
        del comps["minecraft:behavior.random_stroll"]
        notes.append("behavior: removed base random_stroll (the Behemoth idle group strolls; it would fight the chase AI)")
    causes = {"FALL": "fall", "SUFFOCATION": "suffocation", "FREEZE": "freezing", "DROWNING": "drowning",
              "FIRE": "fire", "FIRE_TICK": "fire_tick", "LAVA": "lava", "LIGHTNING": "lightning"}
    immune = []
    for raw in mob.get("DamageModifiers") or []:
        parts = str(raw).split()
        if len(parts) == 2 and parts[0].upper() in causes and float(parts[1]) == 0:
            immune.append(causes[parts[0].upper()])
    if immune:
        sensor = comps.setdefault("minecraft:damage_sensor", {"triggers": []})
        triggers = sensor.get("triggers")
        if isinstance(triggers, dict):
            triggers = [triggers]
        have = {t.get("cause") for t in triggers}
        new = [{"cause": c, "deals_damage": "no"} for c in immune if c not in have]
        sensor["triggers"] = new + triggers
        if new:
            notes.append(f"behavior: immune to {', '.join(t['cause'] for t in new)} (DamageModifiers 0)")
    return out


def add_scripted_death(behavior: dict, seconds: float, notes: list[str]) -> dict:
    """Fatal damage starts a timed death instead of killing the entity, so the death animation and
    death skills can play; the body despawns after `seconds`. The framework treats the event as death."""
    out = copy.deepcopy(behavior)
    ent = out["minecraft:entity"]
    groups = ent.setdefault("component_groups", {})
    groups["bhm:dying"] = {"minecraft:timer": {"looping": False, "time": round(seconds, 2),
                                               "time_down_event": {"event": "bhm:remove_body"}}}
    groups["bhm:body_removed"] = {"minecraft:instant_despawn": {}}
    events = ent.setdefault("events", {})
    events["bhm:start_death"] = {"add": {"component_groups": ["bhm:dying"]}}
    events["bhm:remove_body"] = {"add": {"component_groups": ["bhm:body_removed"]}}
    comps = ent.setdefault("components", {})
    sensor = comps.setdefault("minecraft:damage_sensor", {"triggers": []})
    triggers = sensor.get("triggers")
    if isinstance(triggers, dict):
        triggers = [triggers]
    triggers.append({"on_damage": {"filters": {"test": "has_damage", "value": "fatal"}, "event": "bhm:start_death"},
                     "deals_damage": "no"})
    sensor["triggers"] = triggers
    notes.append(f"behavior: scripted death (death animation + death skills play, body removed after {seconds:.1f} s)")
    return out
