from mbconv.entity import build_base_controller, find_death_event, patch_behavior, patch_client_entity

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
    assert {"mb:idle", "mb:chase", "mb:frozen", "mb:invulnerable", "mb:despawn"} <= ent["component_groups"].keys()
    assert {"mb:set_idle", "mb:set_chase", "mb:set_frozen", "mb:invuln_on", "mb:invuln_off", "boss:die"} <= ent["events"].keys()
    assert ent["events"]["minecraft:entity_spawned"]["add"]["component_groups"] == ["mb:idle"]
    assert "minecraft:despawn" not in ent["components"] and "minecraft:persistent" in ent["components"]
    assert ent["components"]["minecraft:damage_sensor"]["triggers"]["deals_damage"] == "no"
    assert ent["components"]["minecraft:type_family"]["family"] == ["monster", "mb_boss"]
    assert ent["description"]["properties"]["mb:idle_state"]["range"] == [0, 1]
    assert BEHAVIOR["format_version"] == "1.16.0"  # input untouched


def test_base_controller_states():
    ctrl = build_base_controller("test", ["idle", "dormant"], ["walk"])["animation_controllers"]["controller.animation.test.mb_base"]
    assert ctrl["initial_state"] == "idle_0"
    assert set(ctrl["states"]) == {"idle_0", "idle_1", "walk_0"}
    assert ctrl["states"]["idle_1"]["animations"] == ["dormant"]


def test_client_entity_gets_base_controller_first():
    client = {"minecraft:client_entity": {"description": {"animations": {"d": "c.d"}, "scripts": {"animate": ["d"]}}}}
    out = patch_client_entity(client, "test", [])
    desc = out["minecraft:client_entity"]["description"]
    assert desc["scripts"]["animate"] == ["mb_base", "d"]
    assert desc["animations"]["mb_base"] == "controller.animation.test.mb_base"
