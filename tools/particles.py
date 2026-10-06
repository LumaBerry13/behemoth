"""Behemoth particle library generator.

Writes the framework's shared particles into the framework resource pack
(no separate pack): packs/behemoth/RP/particles/bhm_*.particle.json and their
white textures in packs/behemoth/RP/textures/behemoth/particles/. Textures are
white so the colour set by the script tints them exactly.

Every particle reads optional Molang variables set by the framework
(modules/shared/particle_vars.js). The emitter fills in a default for each one
that was not given (`variable.x = variable.x ?? default;` in its creation
expression), so the particles also work from /particle and in Snowstorm:
    variable.color_r/_g/_b/_a   main colour, 0-1      (option color  "#RRGGBB[AA]")
    variable.color2_r/_g/_b/_a  end colour, 0-1       (option color2; default = color)
    variable.size     blocks: particle half-size, or radius for ring/telegraph (option size)
    variable.lifetime seconds                         (option lifetime, ticks)
    variable.speed    blocks/second (spark), degrees/second (swirl)   (option speed)
    variable.count    particles per spawn             (option amount)
    variable.rise     blocks/second upward (swirl, smoke)             (option rise)
    variable.radius   blocks: swirl radius            (option width)
Colours are plain numbers, not an RGBA struct: reading a member of a struct
variable that was never set breaks the expression (particles turned invisible).

Run: python tools/particles.py          (rewrites the files)
     python tools/particles.py --check  (exit 1 if the committed JSON is out of date)
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RP = ROOT / "packs" / "behemoth" / "RP"
PARTICLE_DIR = RP / "particles"
TEXTURE_DIR = RP / "textures" / "behemoth" / "particles"
TEX = "textures/behemoth/particles/"
SUFFIX = ".particle.json"

FADE = "(1 - variable.particle_age / variable.particle_lifetime)"
AGE = "(variable.particle_age / variable.particle_lifetime)"

# Defaults collected while a particle's components are built; effect() turns
# them into the emitter's creation expression.
_PENDING: dict[str, str] = {}


def _d(var: str, default: float) -> str:
    """A tunable variable with its default."""
    _PENDING.setdefault(var, _num(default))
    return f"variable.{var}"


def _num(v) -> str:
    return str(v) if isinstance(v, str) else f"{float(v):g}"


def color(default: tuple[float, float, float, float], alpha: str = FADE) -> list[str]:
    """Tint from variable.color_* (default colour when not given); alpha × `alpha`."""
    for ch, v in zip("rgba", default):
        _PENDING.setdefault(f"color_{ch}", _num(v))
    return ["variable.color_r", "variable.color_g", "variable.color_b", f"variable.color_a * {alpha}"]


def lerp_color(default: tuple[float, float, float, float]) -> list[str]:
    """variable.color_* → variable.color2_* over the particle's life (color2 defaults to color)."""
    color(default)
    for ch in "rgba":
        _PENDING.setdefault(f"color2_{ch}", f"variable.color_{ch}")
    out = [f"math.lerp(variable.color_{ch}, variable.color2_{ch}, {AGE})" for ch in "rgba"]
    out[3] = f"{out[3]} * {FADE}"
    return out


def billboard(tex_size: int, size: str, facing: str = "lookat_xyz") -> dict:
    return {"size": [size, size], "facing_camera_mode": facing,
            "uv": {"texture_width": tex_size, "texture_height": tex_size, "uv": [0, 0], "uv_size": [tex_size, tex_size]}}


def effect(ident: str, material: str, texture: str, components: dict) -> dict:
    init = " ".join(f"variable.{k} = variable.{k} ?? {v};" for k, v in _PENDING.items())
    _PENDING.clear()
    return {"format_version": "1.10.0",
            "particle_effect": {"description": {"identifier": ident,
                                                "basic_render_parameters": {"material": material, "texture": TEX + texture}},
                                "components": {"minecraft:emitter_initialization": {"creation_expression": init}, **components}}}


def instant(count_default: float) -> dict:
    return {"minecraft:emitter_rate_instant": {"num_particles": _d("count", count_default)},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05}}


def random_dir() -> list[str]:
    return ["math.random(-1, 1)", "math.random(-1, 1)", "math.random(-1, 1)"]


PARTICLES: dict[str, dict] = {
    # Coloured dust point (MythicMobs dust / reddust).
    "bhm:dust": effect("bhm:dust", "particles_blend", "dot", {
        **instant(1),
        "minecraft:emitter_shape_point": {"direction": random_dir()},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 1.0)},
        "minecraft:particle_initial_speed": 0.15,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0, 0], "linear_drag_coefficient": 2},
        "minecraft:particle_appearance_billboard": billboard(16, f"{_d('size', 0.08)} * (0.5 + 0.5 * {FADE})"),
        "minecraft:particle_appearance_tinting": {"color": color((1, 0.1, 0.1, 1))},
    }),
    # Dust that shifts from color to color2 (MythicMobs dust_color_transition).
    "bhm:dust_transition": effect("bhm:dust_transition", "particles_blend", "dot", {
        **instant(1),
        "minecraft:emitter_shape_point": {"direction": random_dir()},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 1.0)},
        "minecraft:particle_initial_speed": 0.15,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0, 0], "linear_drag_coefficient": 2},
        "minecraft:particle_appearance_billboard": billboard(16, f"{_d('size', 0.08)} * (0.5 + 0.5 * {FADE})"),
        "minecraft:particle_appearance_tinting": {"color": lerp_color((0, 1, 1, 1))},
    }),
    # Burst of bright sparks flying outwards and falling (hits, impacts).
    "bhm:spark": effect("bhm:spark", "particles_add", "spark", {
        **instant(8),
        "minecraft:emitter_shape_sphere": {"radius": 0.1, "direction": "outwards"},
        "minecraft:particle_lifetime_expression": {"max_lifetime": f"{_d('lifetime', 0.5)} * math.random(0.6, 1)"},
        "minecraft:particle_initial_speed": f"{_d('speed', 5)} * math.random(0.5, 1)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -9, 0], "linear_drag_coefficient": 3},
        "minecraft:particle_appearance_billboard": billboard(16, f"{_d('size', 0.06)} * {FADE}"),
        "minecraft:particle_appearance_tinting": {"color": color((1, 0.8, 0.3, 1))},
    }),
    # Soft puffs that rise and grow (dust clouds, magic smoke).
    "bhm:smoke": effect("bhm:smoke", "particles_blend", "smoke", {
        **instant(3),
        "minecraft:emitter_shape_sphere": {"radius": 0.3, "direction": "outwards"},
        "minecraft:particle_lifetime_expression": {"max_lifetime": f"{_d('lifetime', 1.5)} * math.random(0.7, 1)"},
        "minecraft:particle_initial_speed": 0.4,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, _d("rise", 1.0), 0], "linear_drag_coefficient": 1.5},
        "minecraft:particle_appearance_billboard": billboard(32, f"{_d('size', 0.3)} * (0.6 + 0.8 * {AGE})"),
        "minecraft:particle_appearance_lighting": {},
        "minecraft:particle_appearance_tinting": {"color": color((0.45, 0.45, 0.45, 0.8))},
    }),
    # Glowing orb (projectile cores, charge-ups, magic lights).
    "bhm:glow": effect("bhm:glow", "particles_add", "dot", {
        **instant(1),
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 0.6)},
        "minecraft:particle_appearance_billboard": billboard(16, f"{_d('size', 0.25)} * (0.85 + 0.15 * math.sin(variable.particle_age * 1440))"),
        "minecraft:particle_appearance_tinting": {"color": color((0.6, 0.9, 1, 1))},
    }),
    # Big short flash (explosions, teleports, casts).
    "bhm:flash": effect("bhm:flash", "particles_add", "flash", {
        **instant(1),
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 0.25)},
        "minecraft:particle_appearance_billboard": billboard(32, f"{_d('size', 1.5)} * (0.4 + 0.6 * {AGE})"),
        "minecraft:particle_appearance_tinting": {"color": color((1, 1, 0.9, 1))},
    }),
    # Flat ring on the ground that expands to `size` blocks (shockwaves).
    "bhm:ring": effect("bhm:ring", "particles_blend", "ring", {
        **instant(1),
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 0.6)},
        "minecraft:particle_appearance_billboard": billboard(64, f"{_d('size', 3)} * {AGE}", facing="emitter_transform_xz"),
        "minecraft:particle_appearance_tinting": {"color": color((1, 1, 1, 1))},
    }),
    # Flat filled warning circle of radius `size` that pulses for `lifetime` (attack telegraphs).
    "bhm:telegraph": effect("bhm:telegraph", "particles_blend", "disc", {
        **instant(1),
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 1.0)},
        "minecraft:particle_appearance_billboard": billboard(
            64, f"{_d('size', 3)} * math.min(1, variable.particle_age * 8)", facing="emitter_transform_xz"),
        "minecraft:particle_appearance_tinting": {
            "color": color((1, 0.2, 0.2, 1), alpha="(0.45 + 0.2 * math.sin(variable.particle_age * 720))")},
    }),
    # Particles spiralling upward around the spawn point (tornado / helix / summoning circles).
    "bhm:swirl": effect("bhm:swirl", "particles_add", "dot", {
        **instant(24),
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": _d("lifetime", 1.2)},
        "minecraft:particle_motion_parametric": {"relative_position": [
            f"math.cos(variable.particle_random_1 * 360 + variable.particle_age * {_d('speed', 360)}) * {_d('radius', 1.5)}",
            f"variable.particle_age * {_d('rise', 2)}",
            f"math.sin(variable.particle_random_1 * 360 + variable.particle_age * {_d('speed', 360)}) * {_d('radius', 1.5)}",
        ]},
        "minecraft:particle_appearance_billboard": billboard(16, f"{_d('size', 0.07)} * {FADE}"),
        "minecraft:particle_appearance_tinting": {"color": color((0.7, 0.5, 1, 1))},
    }),
}


# --------------------------------------------------------------------------- #
# Textures (white, alpha shapes)
# --------------------------------------------------------------------------- #

def _textures() -> dict[str, "object"]:
    from PIL import Image

    def make(size, alpha_fn):
        img = Image.new("RGBA", (size, size))
        px = img.load()
        c = (size - 1) / 2
        for y in range(size):
            for x in range(size):
                dx, dy = (x - c) / (size / 2), (y - c) / (size / 2)
                a = max(0.0, min(1.0, alpha_fn(min(1.0, math.hypot(dx, dy)), math.atan2(dy, dx), x, y)))
                px[x, y] = (255, 255, 255, int(round(a * 255)))
        return img

    rnd = random.Random(7)
    noise = [[rnd.random() for _ in range(32)] for _ in range(32)]
    return {
        "dot": make(16, lambda r, a, x, y: (1 - r) ** 1.5),
        "spark": make(16, lambda r, a, x, y: max((1 - r) ** 3, max(0.0, 1 - r * 1.2) * abs(math.cos(2 * a)) ** 12)),
        "smoke": make(32, lambda r, a, x, y: (1 - r) ** 1.2 * (0.65 + 0.35 * noise[y][x])),
        "flash": make(32, lambda r, a, x, y: (1 - r) ** 2.2),
        "ring": make(64, lambda r, a, x, y: max(0.0, 1 - abs(r - 0.88) / 0.08)),
        "disc": make(64, lambda r, a, x, y: (0.45 if r < 0.9 else 1.0) if r <= 0.97 else max(0.0, 1 - (r - 0.97) / 0.03)),
    }


def write(check: bool = False) -> int:
    PARTICLE_DIR.mkdir(parents=True, exist_ok=True)
    stale = []
    expected = {f"{ident.replace(':', '_')}{SUFFIX}" for ident in PARTICLES}
    for old in PARTICLE_DIR.glob("*.json"):
        if old.name not in expected:
            if check:
                stale.append(f"{old.name} (not generated)")
            else:
                old.unlink()
    for ident, data in PARTICLES.items():
        path = PARTICLE_DIR / f"{ident.replace(':', '_')}{SUFFIX}"
        text = json.dumps(data, indent=2) + "\n"
        if check:
            # Compare without line endings: git may check the files out with CRLF.
            if not path.exists() or path.read_text(encoding="utf-8").splitlines() != text.splitlines():
                stale.append(path.name)
        else:
            path.write_text(text, encoding="utf-8", newline="\n")
    if check:
        if stale:
            print(f"[particles] out of date: {', '.join(stale)} — run python tools/particles.py")
            return 1
        return 0
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, img in _textures().items():
        img.save(TEXTURE_DIR / f"{name}.png")
    print(f"[particles] {len(PARTICLES)} particles, textures in {TEXTURE_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(write(check="--check" in sys.argv))
