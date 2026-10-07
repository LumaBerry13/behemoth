"""Folder mode end to end: a prepared boss folder (docs/converting.md) built from the made-up
kitchen fixture becomes a finished BP + RP, an .mcaddon and a report, with nothing else to write."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from bhmconv.cli import main

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).resolve().parent / "fixtures" / "kitchen"


def make_folder(base: Path) -> Path:
    f = base / "Kitchen"
    f.mkdir()
    for y in ("mobs.yml", "skills.yml"):
        shutil.copy(FIX / y, f / y)
    for mob in ("kitchen_boss", "kitchen_spark"):
        d = f / mob
        d.mkdir()
        for name in ("behavior.json", "entity.json", "geo.json", "animation.json"):
            shutil.copy(FIX / name, d / name)
        Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(d / "kitchen.png")
    Image.new("RGBA", (728, 80), (255, 255, 255, 128)).save(f / "kitchen_boss" / "bossbar.png")
    (f / "sounds").mkdir()
    for n in ("roar_1.ogg", "roar_2.ogg", "growl.ogg"):
        (f / "sounds" / n).write_bytes(b"OggS")
    (f / "behemoth.json").write_text(json.dumps({"mobs": {"kitchen_spark": {"identifier": "kitchen:spark"}}}))
    return f


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    f = make_folder(tmp_path_factory.mktemp("folder_mode"))
    assert main([str(f)]) == 0
    return f


def test_finished_pack_and_addon(folder):
    for side in ("BP", "RP"):
        assert (folder / "pack" / side / "manifest.json").exists()
    assert list((folder / "dist").glob("*.mcaddon"))
    report = (folder / "report.md").read_text(encoding="utf-8")
    assert "## Needs you" in report and "## Approximated on Bedrock" in report and "## Info" in report


def test_boss_minions_and_settings(folder):
    index = (folder / "pack" / "BP" / "scripts" / "bosses" / "index.js").read_text(encoding="utf-8")
    assert "export default [kitchen_boss, kitchen_spark]" in index      # the boss is the mob nobody summons
    spark = (folder / "pack" / "BP" / "scripts" / "bosses" / "kitchen_spark.js").read_text(encoding="utf-8")
    assert 'id: "kitchen:spark"' in spark and 'kind: "minion"' in spark  # identifier from behemoth.json


def test_uuids_saved_once_and_kept(folder):
    first = json.loads((folder / "behemoth.json").read_text())["pack"]["uuids"]
    assert main([str(folder)]) == 0
    assert json.loads((folder / "behemoth.json").read_text())["pack"]["uuids"] == first


def test_bare_behavior_is_completed(folder):
    ent = json.loads((folder / "pack" / "BP" / "entities" / "kitchen_boss.json").read_text(encoding="utf-8"))
    comps = ent["minecraft:entity"]["components"]
    assert comps["minecraft:health"]["max"] == 150 and "minecraft:collision_box" in comps
    assert any(t.get("cause") == "fall" for t in comps["minecraft:damage_sensor"]["triggers"])


def test_sounds_bossbar_and_textures(folder):
    rp = folder / "pack" / "RP"
    defs = json.loads((rp / "sounds" / "sound_definitions.json").read_text(encoding="utf-8"))["sound_definitions"]
    assert len(defs["kitchen_sink.roar"]["sounds"]) == 2 and "kitchen_sink.growl" in defs
    assert (rp / "textures" / "behemoth" / "bossbars" / "Kitchen Sink.png").exists()
    assert (rp / "textures" / "entity" / "kitchen.png").exists()


def test_configs_pass_the_js_validator(folder):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not on PATH")
    for cfg in (folder / "pack" / "BP" / "scripts" / "bosses").glob("kitchen_*.js"):
        r = subprocess.run([node, str(ROOT / "tools" / "validate.mjs"), "--config", str(cfg)],
                           capture_output=True, text=True, encoding="utf-8")
        assert r.returncode == 0, r.stdout + r.stderr


def test_unprepared_folder_is_explained(tmp_path, capsys):
    f = make_folder(tmp_path)
    (f / "kitchen_spark").rename(f / "spark")              # folder name no longer matches a mob id
    assert main([str(f)]) == 1
    assert "does not match a MythicMobs mob id" in capsys.readouterr().out


def test_check_lists_unsupported(tmp_path, capsys):
    f = make_folder(tmp_path)
    with open(f / "skills.yml", "a", encoding="utf-8") as h:
        h.write("\nks_weird:\n  Skills:\n  - frobnicate{a=1} @self\n")
    text = (f / "mobs.yml").read_text(encoding="utf-8").replace(
        "  - skill{s=ks_opener} @self ~onSpawn", "  - skill{s=ks_opener} @self ~onSpawn\n  - skill{s=ks_weird} @self ~onSpawn", 1)
    (f / "mobs.yml").write_text(text, encoding="utf-8")
    assert main([str(f), "--check"]) == 2
    assert "frobnicate" in capsys.readouterr().out
