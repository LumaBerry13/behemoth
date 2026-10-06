"""The framework particle library (packs/behemoth/RP/particles) matches its
generator (tools/particles.py), and every particle's texture exists."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RP = ROOT / "packs" / "behemoth" / "RP"


def test_generated_files_are_current():
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "particles.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_particles_are_valid_and_textured():
    files = sorted((RP / "particles").glob("*.json"))
    assert len(files) >= 9
    ids = set()
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        desc = data["particle_effect"]["description"]
        ident = desc["identifier"]
        assert ident.startswith("bhm:") and f.stem == ident.replace(":", "_")
        assert ident not in ids
        ids.add(ident)
        tex = desc["basic_render_parameters"]["texture"]
        assert (RP / (tex + ".png")).exists(), tex
        assert desc["basic_render_parameters"]["material"] in ("particles_alpha", "particles_blend", "particles_add")
