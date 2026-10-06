"""The framework particle library (packs/behemoth/RP/particles) matches its
generator (tools/particles.py), and every particle is valid and textured."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RP = ROOT / "packs" / "behemoth" / "RP"
BUILTIN = {"particle_age", "particle_lifetime", "particle_random_1", "particle_random_2",
           "particle_random_3", "particle_random_4", "emitter_age", "emitter_lifetime"}


def test_generated_files_are_current():
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "particles.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_particles_are_valid_and_textured():
    files = sorted((RP / "particles").glob("*.json"))
    assert len(files) >= 9
    assert all(f.name.endswith(".particle.json") for f in files)
    ids = set()
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        desc = data["particle_effect"]["description"]
        ident = desc["identifier"]
        assert ident.startswith("bhm:") and f.name == ident.replace(":", "_") + ".particle.json"
        assert ident not in ids
        ids.add(ident)
        tex = desc["basic_render_parameters"]["texture"]
        assert (RP / (tex + ".png")).exists(), tex
        assert desc["basic_render_parameters"]["material"] in ("particles_alpha", "particles_blend", "particles_add")
        text = json.dumps(data)
        # Every custom variable a particle reads gets a default in the emitter's creation
        # expression, so the particle also works from /particle and in Snowstorm.
        init = data["particle_effect"]["components"]["minecraft:emitter_initialization"]["creation_expression"]
        used = set(re.findall(r"variable\.(\w+)", text)) - BUILTIN
        defaulted = set(re.findall(r"variable\.(\w+) = variable\.\1 \?\?", init))
        assert used <= defaulted, (ident, used - defaulted)
        # No struct member access (an unset RGBA struct made every particle invisible).
        assert not re.search(r"variable\.\w+\.[rgba]\b", text), ident
