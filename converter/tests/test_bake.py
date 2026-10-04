"""Forward-kinematics checks on a tiny hand-made arm model.

Model (raw Bedrock pixels): shoulder pivot at y=24, hand pivot at y=8
(the arm hangs straight down, 1 block long). Expected positions are in the
runtime entity space: blocks, +Z forward, +X left.
"""

import pytest

from mbconv.bake import Skeleton, bake_animation, rest_position

GEO = {
    "format_version": "1.12.0",
    "minecraft:geometry": [{
        "description": {"identifier": "geometry.test_arm"},
        "bones": [
            {"name": "root", "pivot": [0, 0, 0]},
            {"name": "shoulder", "parent": "root", "pivot": [0, 24, 0]},
            {"name": "hand", "parent": "shoulder", "pivot": [0, 8, 0]},
        ],
    }],
}


def skel(rot=(0, 0, 0)):
    g = {**GEO, "minecraft:geometry": [{**GEO["minecraft:geometry"][0]}]}
    bones = [dict(b) for b in GEO["minecraft:geometry"][0]["bones"]]
    bones[1]["rotation"] = list(rot)
    g["minecraft:geometry"][0]["bones"] = bones
    return Skeleton.from_geo(g)


def test_rest_pose_is_pivot_in_blocks():
    assert rest_position(skel(), "hand") == [0, 0.5, 0]


def test_arm_rotated_minus_90_x_points_forward():
    # Bedrock convention: rotation x = -90 raises a hanging arm to point forward
    # (zombie arms). The hand ends up 1 block in front of the shoulder.
    assert rest_position(skel((-90, 0, 0)), "hand") == pytest.approx([0, 1.5, 1], abs=1e-3)


def test_animation_rotation_adds_to_rest_rotation():
    anim = {"animation_length": 0.05, "bones": {"shoulder": {"rotation": [-45, 0, 0]}}}
    res = bake_animation(skel((-45, 0, 0)), anim, ["hand"])
    assert res.tracks["hand"][0] == pytest.approx([0, 1.5, 1], abs=1e-3)


def test_position_channel_moves_children():
    anim = {"animation_length": 0.05, "bones": {"root": {"position": [0, 16, 0]}}}
    res = bake_animation(skel(), anim, ["hand"])
    assert res.tracks["hand"][0] == pytest.approx([0, 1.5, 0])


def test_length_and_loop():
    anim = {"animation_length": 2.0, "loop": True, "bones": {}}
    res = bake_animation(skel(), anim, ["hand"])
    assert res.length_ticks == 40 and res.loop is True
    assert len(res.tracks["hand"]) == 40
    hold = bake_animation(skel(), {"animation_length": 1, "loop": "hold_on_last_frame", "bones": {}}, ["hand"])
    assert hold.loop is False


def test_unbakeable_molang_is_reported():
    anim = {"animation_length": 0.1, "bones": {"shoulder": {"rotation": ["q.target_x_rotation", 0, 0]}}}
    res = bake_animation(skel(), anim, ["hand"])
    assert res.unbakeable == ["shoulder"]
