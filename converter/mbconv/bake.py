"""Forward kinematics: bone pivot positions per tick (design doc §6, §9).

Coordinate conventions (the project's main risk; confirm with /mb:bones):

* Input: raw Bedrock geometry/animation JSON (pixels, degrees).
* Blockbench imports Bedrock data by negating pivot/position X and rotation
  X and Y, then uses three.js Euler order ZYX, with the model facing -Z.
  Conjugating that by the X reflection gives, in the RAW json frame:
      R = Rz(-rz) · Ry(ry) · Rx(-rx)      (right-handed, column vectors)
* The raw frame has the model facing -Z with its left side at +X. The runtime
  expects entity space: +Z forward, +X left, +Y up, in blocks. So the output
  is (x, y, -z) / 16.
* Bone transform: M_b = M_parent · T(anim_pos) · T(pivot) · R(rest + anim_rot)
  · S(anim_scale) · T(-pivot). A bone's position is M_b applied to its pivot,
  which equals M_parent · (pivot + anim_pos).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .keyframes import Keyframe, Unbakeable, channel_end, parse_channel, sample

Vec3 = tuple[float, float, float]
Mat = list[list[float]]  # 4x4 row-major

PX_PER_BLOCK = 16.0
TICKS_PER_SECOND = 20


# --------------------------------------------------------------------------- #
# 4x4 matrix helpers
# --------------------------------------------------------------------------- #
def identity() -> Mat:
    return [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]


def mul(a: Mat, b: Mat) -> Mat:
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def translate(v: Vec3) -> Mat:
    m = identity()
    m[0][3], m[1][3], m[2][3] = v
    return m


def scale(v: Vec3) -> Mat:
    m = identity()
    m[0][0], m[1][1], m[2][2] = v
    return m


def rot_x(deg: float) -> Mat:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]


def rot_y(deg: float) -> Mat:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]


def rot_z(deg: float) -> Mat:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def bedrock_rotation(r: Vec3) -> Mat:
    """Bedrock euler (degrees) as a matrix in the raw json frame."""
    rx, ry, rz = r
    return mul(rot_z(-rz), mul(rot_y(ry), rot_x(-rx)))


def apply(m: Mat, p: Vec3) -> Vec3:
    return (
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    )


def to_entity_space(p: Vec3) -> list[float]:
    """Raw json pixels → runtime entity space blocks (+Z forward), 3 decimals."""
    return [round(p[0] / PX_PER_BLOCK, 3), round(p[1] / PX_PER_BLOCK, 3), round(-p[2] / PX_PER_BLOCK, 3)]


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
@dataclass
class Bone:
    name: str
    parent: str | None
    pivot: Vec3
    rotation: Vec3
    cubes: list[tuple[Vec3, Vec3]] = field(default_factory=list)  # (origin, size) of unrotated cubes


@dataclass
class Skeleton:
    bones: dict[str, Bone]

    @classmethod
    def from_geo(cls, geo_json: dict, identifier: str | None = None) -> "Skeleton":
        geos = geo_json.get("minecraft:geometry", [])
        if identifier:
            geos = [g for g in geos if g.get("description", {}).get("identifier") == identifier] or geos
        if not geos:
            raise ValueError("no minecraft:geometry entry found")
        bones: dict[str, Bone] = {}
        for b in geos[0].get("bones", []):
            bones[b["name"]] = Bone(
                name=b["name"],
                parent=b.get("parent"),
                pivot=tuple(float(x) for x in b.get("pivot", (0, 0, 0))),  # type: ignore[arg-type]
                rotation=tuple(float(x) for x in b.get("rotation", (0, 0, 0))),  # type: ignore[arg-type]
                cubes=[
                    (tuple(float(x) for x in c["origin"]), tuple(float(x) for x in c["size"]))  # type: ignore[misc]
                    for c in b.get("cubes", [])
                    if "origin" in c and "size" in c and not c.get("rotation")
                ],
            )
        return cls(bones)

    def far_point(self, name: str) -> Vec3:
        """Corner of the bone's own cubes farthest from its pivot (a blade tip)."""
        piv = self.bones[name].pivot
        best, best_d = piv, -1.0
        for origin, size in self.bones[name].cubes:
            for dx in (0, size[0]):
                for dy in (0, size[1]):
                    for dz in (0, size[2]):
                        p = (origin[0] + dx, origin[1] + dy, origin[2] + dz)
                        d = math.dist(p, piv)
                        if d > best_d:
                            best, best_d = p, d
        return best

    def chain(self, name: str) -> list[Bone]:
        """Root → ... → bone."""
        out: list[Bone] = []
        cur: str | None = name
        seen: set[str] = set()
        while cur is not None:
            if cur in seen or cur not in self.bones:
                break
            seen.add(cur)
            out.append(self.bones[cur])
            cur = self.bones[cur].parent
        return list(reversed(out))


# --------------------------------------------------------------------------- #
# Animation baking
# --------------------------------------------------------------------------- #
@dataclass
class BoneChannels:
    rotation: list[Keyframe] | None = None
    position: list[Keyframe] | None = None
    scale: list[Keyframe] | None = None


@dataclass
class BakeResult:
    length_ticks: int
    loop: bool
    tracks: dict[str, list[list[float]]] = field(default_factory=dict)
    unbakeable: list[str] = field(default_factory=list)


def animation_length_seconds(anim: dict) -> float:
    if "animation_length" in anim:
        return float(anim["animation_length"])
    end = 0.0
    for chans in anim.get("bones", {}).values():
        for raw in chans.values():
            end = max(end, channel_end(raw))
    return end


def _parse_bone_channels(anim: dict, bone: str, unbakeable: set[str]) -> BoneChannels:
    chans = anim.get("bones", {}).get(bone)
    out = BoneChannels()
    if not chans:
        return out
    for key in ("rotation", "position", "scale"):
        if key not in chans:
            continue
        try:
            setattr(out, key, parse_channel(chans[key], uniform_ok=(key == "scale")))
        except Unbakeable:
            unbakeable.add(bone)
    return out


def bone_world_matrix(skel: Skeleton, bone: str, channels: dict[str, BoneChannels], time: float) -> Mat:
    """Full transform of `bone` at `time` (raw frame, pixels)."""
    m = identity()
    for b in skel.chain(bone):
        ch = channels.get(b.name, BoneChannels())
        rot = sample(ch.rotation, time) if ch.rotation else (0.0, 0.0, 0.0)
        pos = sample(ch.position, time) if ch.position else (0.0, 0.0, 0.0)
        scl = sample(ch.scale, time) if ch.scale else (1.0, 1.0, 1.0)
        total_rot = (b.rotation[0] + rot[0], b.rotation[1] + rot[1], b.rotation[2] + rot[2])
        neg_pivot = (-b.pivot[0], -b.pivot[1], -b.pivot[2])
        local = mul(
            translate(pos),
            mul(translate(b.pivot), mul(bedrock_rotation(total_rot), mul(scale(scl), translate(neg_pivot)))),
        )
        m = mul(m, local)
    return m


def bone_position(skel: Skeleton, bone: str, channels: dict[str, BoneChannels], time: float,
                  point: Vec3 | None = None) -> Vec3:
    """A point carried by `bone` (default: its pivot), in the raw frame (pixels)."""
    return apply(bone_world_matrix(skel, bone, channels, time), point or skel.bones[bone].pivot)


# A baked key is a bone name (its pivot) or a named point: key -> (bone, point in raw model pixels).
PointSpec = tuple[str, Vec3]


def _spec(skel: Skeleton, key: str, points: dict[str, PointSpec] | None) -> PointSpec:
    if points and key in points:
        return points[key]
    return key, skel.bones[key].pivot


def rest_position(skel: Skeleton, key: str, points: dict[str, PointSpec] | None = None) -> list[float]:
    bone, p = _spec(skel, key, points)
    return to_entity_space(bone_position(skel, bone, {}, 0.0, p))


def bake_animation(skel: Skeleton, anim: dict, bones: list[str],
                   points: dict[str, PointSpec] | None = None) -> BakeResult:
    """Sample each key (bone pivot, or named point carried by a bone) once per tick."""
    seconds = animation_length_seconds(anim)
    length = max(1, round(seconds * TICKS_PER_SECOND))
    loop_raw = anim.get("loop", False)
    result = BakeResult(length_ticks=length, loop=loop_raw is True)

    unbakeable: set[str] = set()
    specs = {key: _spec(skel, key, points) for key in bones}
    needed = {b.name for bone, _ in specs.values() for b in skel.chain(bone)}
    channels = {name: _parse_bone_channels(anim, name, unbakeable) for name in needed}

    for key, (bone, p) in specs.items():
        result.tracks[key] = [
            to_entity_space(bone_position(skel, bone, channels, i / TICKS_PER_SECOND, p)) for i in range(length)
        ]
    result.unbakeable = sorted(unbakeable)
    return result
