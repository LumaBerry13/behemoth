"""End to end: convert the made-up "kitchen sink" boss, then run the framework's
real JS validator on the generated config (needs Node on PATH)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from bhmconv.cli import convert

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "kitchen"


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    d = tmp_path_factory.mktemp("kitchen_build") / "pack"
    convert(FIXTURE / "kitchen.job.json", d)
    return d


def test_every_line_was_mapped(out):
    report = (out.parent / "kitchen.report.md").read_text(encoding="utf-8")
    assert "unsupported" not in report, report
    assert "dropped" not in report, report


def test_generated_config_passes_the_js_validator(out):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not on PATH")
    cfg = out / "BP" / "scripts" / "bosses" / "kitchen.js"
    r = subprocess.run([node, str(ROOT / "tools" / "validate.mjs"), "--config", str(cfg)],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout + r.stderr
    for skill in ("ks_bolt", "ks_storm", "ks_dash", "ks_grab", "ks_pong", "mob_2_onInteract", "mob_3_onSignal"):
        assert skill in r.stdout


def test_mapping_details(out):
    js = (out / "BP" / "scripts" / "bosses" / "kitchen.js").read_text(encoding="utf-8")
    assert 'm: "projectile"' in js and "speed: 0.8" in js          # 16 blocks/s → 0.8 blocks/tick
    assert '"@Ring{radius=5.0;points=4}"' in js
    assert '"@Cone{angle=90.0;r=8.0}"' in js
    assert '"variable{name=stage;eq=1}"' in js
    assert '"playersNearby{r=20.0;min=1}"' in js
    assert 'tr: "onSignal:pong"' in js
    assert '"minecraft:heart_particle"' in js
    behavior = json.loads((out / "BP" / "entities" / "kitchen.json").read_text(encoding="utf-8"))
    assert behavior["minecraft:entity"]["components"]["minecraft:boss"]["name"] == "Kitchen Sink"


def test_standalone_pack_layout(out):
    bp = json.loads((out / "BP" / "manifest.json").read_text(encoding="utf-8"))
    framework = json.loads((ROOT / "connector" / "framework.json").read_text(encoding="utf-8"))
    deps = [d.get("uuid") or d.get("module_name") for d in bp["dependencies"]]
    assert framework["bp_uuid"] in deps and "@minecraft/server" in deps
    assert bp["header"]["uuid"] == "00000000-0000-4000-8000-000000000001"
    assert (out / "BP" / "scripts" / "behemoth" / "connector.js").read_text(encoding="utf-8") ==         (ROOT / "connector" / "connector.js").read_text(encoding="utf-8")
    main = (out / "BP" / "scripts" / "main.js").read_text(encoding="utf-8")
    assert 'pack: "kitchen_sink"' in main
    anim = (out / "BP" / "scripts" / "generated" / "kitchen" / "walk.js").read_text(encoding="utf-8")
    assert "q: 1000" in anim  # compact tracks
    assert (out / "RP" / "texts" / "en_US.lang").exists() and (out / "RP" / "manifest.json").exists()


def test_refuses_to_overwrite_foreign_folder(tmp_path):
    (tmp_path / "pack").mkdir()
    (tmp_path / "pack" / "mine.txt").write_text("hands off")
    with pytest.raises(SystemExit):
        convert(FIXTURE / "kitchen.job.json", tmp_path / "pack")


def test_demo_pack_ships_the_current_connector():
    demo = ROOT / "packs" / "behemoth_demo" / "BP" / "scripts" / "behemoth" / "connector.js"
    assert demo.read_text(encoding="utf-8") == (ROOT / "connector" / "connector.js").read_text(encoding="utf-8"), \
        "copy connector/connector.js into the demo pack"
