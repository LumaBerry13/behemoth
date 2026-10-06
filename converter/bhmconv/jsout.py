"""Small JS literal writer for readable generated configs."""

from __future__ import annotations

import base64
import json
import re
import struct
from typing import Any

_IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")
INLINE_WIDTH = 110


def key(k: str) -> str:
    return k if _IDENT.match(k) else json.dumps(k)


def _num(v: float) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return repr(round(v, 4)) if isinstance(v, float) else str(v)


def inline(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return _num(v)
    if v is None:
        return "undefined"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(inline(x) for x in v) + "]"
    if isinstance(v, dict):
        if not v:
            return "{}"
        return "{ " + ", ".join(f"{key(k)}: {inline(x)}" for k, x in v.items()) + " }"
    if isinstance(v, Raw):
        return v.code
    raise TypeError(type(v))


class Raw:
    """Verbatim JS (e.g. an imported identifier)."""

    def __init__(self, code: str):
        self.code = code


def pretty(v: Any, indent: int = 0) -> str:
    if isinstance(v, Raw):
        return v.code
    one = inline(v)
    if len(one) + indent <= INLINE_WIDTH or not isinstance(v, (dict, list, tuple)):
        return one
    pad, inner = " " * indent, " " * (indent + 2)
    if isinstance(v, dict):
        items = [f"{inner}{key(k)}: {pretty(x, indent + 2)}," for k, x in v.items()]
        return "{\n" + "\n".join(items) + f"\n{pad}}}"
    items = [f"{inner}{pretty(x, indent + 2)}," for x in v]
    return "[\n" + "\n".join(items) + f"\n{pad}]"


TRACK_Q = 1000  # millimetre precision; int16 covers ±32.7 blocks


def track_compact(rows: list[list[float]]) -> str:
    """Baked track as base64 little-endian int16 triplets (decoded by the framework's
    TrackCodec). Falls back to the plain form if a value is out of int16 range."""
    flat = [round(c * TRACK_Q) for r in rows for c in r]
    if any(v < -32768 or v > 32767 for v in flat):
        return track(rows)
    data = base64.b64encode(struct.pack(f"<{len(flat)}h", *flat)).decode("ascii")
    return f'{{ q: {TRACK_Q}, n: {len(rows)}, d: "{data}" }}'


def track(rows: list[list[float]]) -> str:
    """Compact baked track: one [x,y,z] per tick."""
    return "[" + ",".join("[" + ",".join(_num(float(c)) for c in r) + "]" for r in rows) + "]"
