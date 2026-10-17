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


def _client(textures, rcs=None):
    return {"minecraft:client_entity": {"description": {
        "identifier": "boss:t", "textures": textures,
        **({"render_controllers": rcs} if rcs else {})}}}


def test_texture_frames_get_an_animated_render_controller():
    from bhmconv.entity import plan_render_controller, texture_frames
    client = _client({"t2": "textures/t2", "t1": "textures/t1", "t3": "textures/t3"}, ["controller.render.default"])
    assert texture_frames(client) == ["t1", "t2", "t3"]
    notes = []
    rc = plan_render_controller(client, "t", notes, False, [], {}, fps=5)["render_controllers"]["controller.render.t.bhm"]
    assert rc["arrays"]["textures"]["Array.bhm_frames"] == ["Texture.t1", "Texture.t2", "Texture.t3"]
    assert rc["textures"] == ["Array.bhm_frames[math.mod(math.floor(q.life_time * 5), 3)]"]
    assert client["minecraft:client_entity"]["description"]["render_controllers"] == ["controller.render.t.bhm"]
    assert texture_frames(_client({"default": "a", "glow": "b"})) == []      # a normal texture set


def test_custom_render_controller_gets_tint_and_parts_merged():
    from bhmconv.entity import plan_render_controller
    own = {"arrays": {"textures": {"array.x": ["texture.x1", "texture.x2"]}}, "geometry": "Geometry.default",
           "textures": ["array.x[0]"], "materials": [{"*": "Material.default"}]}
    client = _client({"x1": "a", "x2": "b"}, ["controller.render.x"])
    notes = []
    rc = plan_render_controller(client, "t", notes, True, ["arm"], {"controller.render.x": own})["render_controllers"]["controller.render.t.bhm"]
    assert rc["textures"] == ["array.x[0]"] and "Array.bhm_frames" not in str(rc)   # its own textures kept
    assert "overlay_color" in rc and rc["part_visibility"][0] == {"*": True} and "arm" in rc["part_visibility"][1]
    assert own.get("overlay_color") is None                                        # the input is not changed
    # a custom controller whose file is not in the folder: left alone, reported
    client2 = _client({"default": "a"}, ["controller.render.elsewhere"])
    assert plan_render_controller(client2, "t", notes, True, [], {}) is None and "by hand" in notes[-1]


def test_markers_get_a_tiny_collision_box():
    from bhmconv.entity import MARKER_BOX, collision_size
    geo = {"minecraft:geometry": [{"bones": [{"cubes": [{"origin": [-32, 0, -32], "size": [64, 4, 64]}]}]}]}
    assert collision_size({"Options": {"Marker": True}}, geo, "minion") == MARKER_BOX
    assert collision_size({"Type": "ARMOR_STAND", "Options": {"Collidable": False}}, geo, "minion") == MARKER_BOX
    assert collision_size({"Type": "VINDICATOR", "Options": {"Collidable": False}}, geo, "minion")[0] == 2.0
    # a boss always stays hittable (Steel Raider: NoAI, Collidable false)
    assert collision_size({"Options": {"NoAI": True, "Collidable": False}}, geo, "boss")[0] == 2.0
    assert collision_size({}, geo)[0] == 2.0                                      # capped model size


def test_marker_rests_on_blocks_but_cannot_be_hit():
    from bhmconv.entity import MARKER_BOX, complete_behavior
    mob = {"Type": "ARMOR_STAND", "Options": {"Marker": True, "NoAI": True}}
    out = complete_behavior({"minecraft:entity": {"description": {"identifier": "fx:t"}, "components": {}}}, mob, MARKER_BOX, [])
    comps = out["minecraft:entity"]["components"]
    assert comps["minecraft:collision_box"] == {"width": 0.5, "height": 0.5}          # big enough for block collision
    assert comps["minecraft:custom_hit_test"]["hitboxes"][0]["width"] < 0.05          # players cannot hit it
