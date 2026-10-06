"""Bedrock animation channel sampling.

A channel (rotation / position / scale) is one of:
  * a constant: ``[x, y, z]``, a number, or Molang strings
  * a dict ``{"<time>": keyframe}`` where keyframe is ``[x, y, z]`` or
    ``{"pre": [...], "post": [...], "lerp_mode": "linear"|"catmullrom"|"step"}``

Only numbers (and numeric strings) are baked. Any other Molang marks the
channel unbakeable; it then samples as the channel's neutral value.
"""

from __future__ import annotations

from dataclasses import dataclass

Vec3 = tuple[float, float, float]


class Unbakeable(Exception):
    """Raised when a value depends on runtime Molang."""


def _num(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError as e:
            raise Unbakeable(v) from e
    raise Unbakeable(repr(v))


def to_vec3(v, uniform_ok: bool = False) -> Vec3:
    """Normalise a channel value to (x, y, z). Scale may be a single number."""
    if isinstance(v, (int, float, str)) and uniform_ok:
        n = _num(v)
        return (n, n, n)
    if isinstance(v, (list, tuple)):
        if len(v) == 1 and uniform_ok:
            n = _num(v[0])
            return (n, n, n)
        if len(v) == 3:
            return (_num(v[0]), _num(v[1]), _num(v[2]))
    raise Unbakeable(repr(v))


@dataclass
class Keyframe:
    time: float
    pre: Vec3
    post: Vec3
    mode: str  # "linear" | "catmullrom" | "step"


def parse_channel(raw, uniform_ok: bool = False) -> list[Keyframe]:
    """Parse a channel into time-sorted keyframes (a constant becomes one keyframe)."""
    if not isinstance(raw, dict) or "pre" in raw or "post" in raw or "vector" in raw:
        v = to_vec3(_value_of(raw), uniform_ok)
        return [Keyframe(0.0, v, v, "linear")]
    frames: list[Keyframe] = []
    for t, kf in raw.items():
        time = float(t)
        if isinstance(kf, dict):
            post_raw = kf.get("post", kf.get("vector", kf.get("pre")))
            pre_raw = kf.get("pre", post_raw)
            mode = kf.get("lerp_mode", "linear")
            frames.append(Keyframe(time, to_vec3(pre_raw, uniform_ok), to_vec3(post_raw, uniform_ok), mode))
        else:
            v = to_vec3(kf, uniform_ok)
            frames.append(Keyframe(time, v, v, "linear"))
    frames.sort(key=lambda k: k.time)
    return frames


def _value_of(raw):
    if isinstance(raw, dict):
        return raw.get("post", raw.get("vector", raw.get("pre")))
    return raw


def _catmull(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2, t3 = t * t, t * t * t
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def sample(frames: list[Keyframe], time: float) -> Vec3:
    """Value of a channel at `time` (seconds)."""
    if not frames:
        return (0.0, 0.0, 0.0)
    if time <= frames[0].time:
        return frames[0].pre
    if time >= frames[-1].time:
        return frames[-1].post
    i = 0
    while frames[i + 1].time < time:
        i += 1
    a, b = frames[i], frames[i + 1]
    span = b.time - a.time
    u = 0.0 if span <= 0 else (time - a.time) / span
    if a.mode == "step":
        return a.post
    if a.mode == "catmullrom" or b.mode == "catmullrom":
        p0 = frames[i - 1].post if i > 0 else a.post
        p3 = frames[i + 2].pre if i + 2 < len(frames) else b.pre
        return tuple(_catmull(p0[k], a.post[k], b.pre[k], p3[k], u) for k in range(3))  # type: ignore[return-value]
    return tuple(a.post[k] + (b.pre[k] - a.post[k]) * u for k in range(3))  # type: ignore[return-value]


def channel_end(raw) -> float:
    """Time of the last keyframe of a channel (0 for constants)."""
    if isinstance(raw, dict) and not ({"pre", "post", "vector"} & raw.keys()):
        return max((float(t) for t in raw), default=0.0)
    return 0.0
