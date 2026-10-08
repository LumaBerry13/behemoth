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
    (f / "behemoth.json").write_text(json.dumps({"mobs": {
        "kitchen_spark": {"identifier": "kitchen:spark"},
        "kitchen_boss": {"bossbar_layout": {"width": 182, "y": -2}}}}))
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
    assert "export default [kitchen_boss, kitchen_spark, kitchen_puddle]" in index  # the boss is the mob nobody summons
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
    assert (rp / "textures" / "entity" / "kitchen.png").exists()


def test_custom_boss_bar_key_and_layout(folder):
    # A custom bar: the bar name is a key (HUD hides its text), the image is placed on the HUD canvas.
    bars = folder / "pack" / "RP" / "textures" / "behemoth" / "bossbars"
    assert not (bars / "Kitchen Sink.png").exists()
    bar = Image.open(bars / "bhmbar_test_kitchen.png")
    assert bar.size == (2048, 512)                                   # 512x128 GUI units at 4 px
    # 728x80 px art, 182 units wide -> 728x80 px on the canvas, centred at x 1024, y (64 - 2) * 4
    assert bar.getpixel((1024, 248))[3] == 128 and bar.getpixel((660, 208))[3] == 128
    assert bar.getpixel((659, 248))[3] == 0 and bar.getpixel((1024, 207))[3] == 0
    ent = json.loads((folder / "pack" / "BP" / "entities" / "kitchen_boss.json").read_text(encoding="utf-8"))
    assert ent["minecraft:entity"]["components"]["minecraft:boss"]["name"] == "bhmbar_test_kitchen"
    cfg = (folder / "pack" / "BP" / "scripts" / "bosses" / "kitchen_boss.js").read_text(encoding="utf-8")
    assert 'barKey: "bhmbar_test_kitchen"' in cfg and 'name: "Kitchen Sink"' in cfg
    report = (folder / "report.md").read_text(encoding="utf-8")
    assert "boss bar layout: 182 x 20 GUI units" in report and "cut off" not in report and "stretched" not in report


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


def test_settings_file_lists_every_entry(folder):
    data = json.loads((folder / "behemoth.json").read_text(encoding="utf-8"))
    for key in ("pack", "boss", "mobs", "tuning", "particles", "items", "sounds", "mob_types", "bullets"):
        assert key in data, key
    assert data["mobs"]["kitchen_spark"]["identifier"] == "kitchen:spark"           # user value kept
    assert data["mobs"]["kitchen_boss"]["bossbar_layout"]["width"] == 182          # user value kept
    assert data["mobs"]["kitchen_spark"]["blades"] == [] and "bossbar_layout" not in data["mobs"]["kitchen_spark"]
    assert data["tuning"]["stop_distance"] is None and data["tuning"]["trigger_overrides"] == {}
    layout = data["mobs"]["kitchen_boss"]["bossbar_layout"]
    assert layout["height"] == 20.0 and "scale" not in layout                      # filled from the image's shape
    assert data["mobs"]["kitchen_boss"]["collision_box"]["width"] > 0               # effective collision box shown
    assert main([str(folder)]) == 0                                                # the empty entries change nothing


def test_misplaced_settings_are_explained(tmp_path, capsys):
    f = make_folder(tmp_path)
    (f / "behemoth.json").write_text(json.dumps({"pack": {"items": {"X": "minecraft:shield"}}, "tunning": {}}))
    assert main([str(f)]) == 1
    out = capsys.readouterr().out
    assert "'items' is inside 'pack' but belongs at the top level" in out and "unknown entry 'tunning'" in out


def test_java_sounds_json_names_the_events(tmp_path):
    # A Java sounds.json in the mob folder says which file is which sound.
    f = make_folder(tmp_path)
    (f / "kitchen_boss" / "sounds.json").write_text(json.dumps({"ks.bellow": {"sounds": ["custom/kitchen/growl"]}}))
    assert main([str(f)]) == 0
    defs = json.loads((f / "pack" / "RP" / "sounds" / "sound_definitions.json").read_text(encoding="utf-8"))["sound_definitions"]
    assert defs["ks.bellow"]["sounds"][0]["name"].endswith("/growl") and "kitchen_sink.growl" not in defs


def test_invisible_effect_mob_without_folder_is_generated(folder):
    # kitchen_puddle: Invisible, no model folder, summoned by the boss → an empty invisible entity.
    bp, rp = folder / "pack" / "BP", folder / "pack" / "RP"
    ent = json.loads((bp / "entities" / "kitchen_puddle.json").read_text(encoding="utf-8"))
    assert ent["minecraft:entity"]["description"]["identifier"] == "test:kitchen_puddle"
    assert "minecraft:boss" not in ent["minecraft:entity"]["components"]
    cfg = (bp / "scripts" / "bosses" / "kitchen_puddle.js").read_text(encoding="utf-8")
    assert 'kind: "minion"' in cfg and 'default: "frozen"' in cfg
    assert 'm: "teleport", o: { setY: -15 }, t: "@self"' in cfg and 'm: "percentDamage"' in cfg
    assert (rp / "entity" / "kitchen_puddle.entity.json").exists()
    boss = (bp / "scripts" / "bosses" / "kitchen_boss.js").read_text(encoding="utf-8")
    assert 'type: "test:kitchen_puddle"' in boss                                     # the summon maps to it
    report = (folder / "report.md").read_text(encoding="utf-8")
    assert "generated an invisible effect entity" in report and "kitchen_puddle' skipped" not in report
