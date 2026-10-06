from bhmconv.entity import build_base_controller, find_death_event, patch_behavior, patch_client_entity

BEHAVIOR = {
    "format_version": "1.16.0",
    "minecraft:entity": {
        "description": {"identifier": "boss:test"},
        "components": {
            "minecraft:despawn": {"despawn_from_distance": {}},
            "minecraft:type_family": {"family": ["monster"]},
            "minecraft:damage_sensor": {"triggers": {
                "on_damage": {"filters": {"all_of": [{"test": "has_damage", "value": "fatal"}]}, "event": "boss:die"},
                "deals_damage": False, "cause": "fatal",
            }},
        },
        "events": {"minecraft:entity_spawned": {}, "boss:die": {}},
    },
}


def test_death_event_detected():
    assert find_death_event(BEHAVIOR) == "boss:die"


def test_patch_adds_stub_and_keeps_owner_parts():
    notes = []
    out = patch_behavior(BEHAVIOR, 2, 1, 50, notes)
    ent = out["minecraft:entity"]
    assert out["format_version"] == "1.21.0"
    assert {"bhm:idle", "bhm:chase", "bhm:frozen", "bhm:invulnerable", "bhm:despawn"} <= ent["component_groups"].keys()
    assert {"bhm:set_idle", "bhm:set_chase", "bhm:set_frozen", "bhm:invuln_on", "bhm:invuln_off", "boss:die"} <= ent["events"].keys()
    assert ent["events"]["minecraft:entity_spawned"]["add"]["component_groups"] == ["bhm:idle"]
    assert "minecraft:despawn" not in ent["components"] and "minecraft:persistent" in ent["components"]
    assert ent["components"]["minecraft:damage_sensor"]["triggers"]["deals_damage"] == "no"
    assert ent["components"]["minecraft:type_family"]["family"] == ["monster", "bhm_boss"]
    assert ent["description"]["properties"]["bhm:idle_state"]["range"] == [0, 1]
    assert BEHAVIOR["format_version"] == "1.16.0"  # input untouched


def test_base_controller_states():
    ctrl = build_base_controller("test", ["idle", "dormant"], ["walk"])["animation_controllers"]["controller.animation.test.bhm_base"]
    assert ctrl["initial_state"] == "idle_0"
    assert set(ctrl["states"]) == {"idle_0", "idle_1", "walk_0"}
    assert ctrl["states"]["idle_1"]["animations"] == ["dormant"]


def test_client_entity_gets_base_controller_first():
    client = {"minecraft:client_entity": {"description": {"animations": {"d": "c.d"}, "scripts": {"animate": ["d"]}}}}
    out = patch_client_entity(client, "test", [])
    desc = out["minecraft:client_entity"]["description"]
    assert desc["scripts"]["animate"] == ["bhm_base", "d"]
    assert desc["animations"]["bhm_base"] == "controller.animation.test.bhm_base"
