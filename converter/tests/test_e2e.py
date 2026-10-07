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
    for skill in ("ks_bolt", "ks_storm", "ks_dash", "ks_grab", "ks_pong", "mob_2_onInteract", "mob_3_onSignal",
                  "ks_mind", "ks_angry", "ks_angry_0_entitySkill", "ks_angry_1_onTick", "mob_6_onCombat", "mob_7_onLoad"):
        assert skill in r.stdout, skill
    spark = out / "BP" / "scripts" / "bosses" / "kitchen_spark.js"
    r = subprocess.run([node, str(ROOT / "tools" / "validate.mjs"), "--config", str(spark)],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout + r.stderr


def test_mapping_details(out):
    js = (out / "BP" / "scripts" / "bosses" / "kitchen.js").read_text(encoding="utf-8")
    assert 'm: "projectile"' in js and "speed: 0.8" in js          # 16 blocks/s → 0.8 blocks/tick
    assert '"@Ring{radius=5.0;points=4}"' in js
    assert '"@Cone{angle=90.0;r=8.0}"' in js
    assert '"varEquals{var=stage;val=1}"' in js
    assert '"playersNearby{r=20.0;min=1}"' in js
    assert 'tr: "onSignal:pong"' in js
    assert '"minecraft:heart_particle"' in js
    behavior = json.loads((out / "BP" / "entities" / "kitchen.json").read_text(encoding="utf-8"))
    assert behavior["minecraft:entity"]["components"]["minecraft:boss"]["name"] == "Kitchen Sink"


def test_archivist_style_mappings(out):
    js = (out / "BP" / "scripts" / "bosses" / "kitchen.js").read_text(encoding="utf-8")
    assert 'variables: { mood: "calm", power: 0 }' in js
    assert '"varEquals{var=caster.mood;val=angry} castInstead ks_angry"' in js
    assert '"fieldOfView{angle=90.0;rotation=0.0} orElseCast ks_turn"' in js and "targetIf:" in js
    assert 'eq: "min(10, x + <caster.var.power> + 1)"' in js
    assert 'pitch: "<random.float.0.9to1.2>"' in js and "cooldown: 40" in js
    assert 'tr: "onDamaged"' in js and "chance: 0.5" in js and '"healthPct<50"' in js
    assert 'bullet: "kitchen:spark"' in js and 'onTick: "ks_angry_1_onTick"' in js
    assert "repeat: 4" in js and "repeatInterval: 2" in js
    assert 'type: "kitchen:spark"' in js                       # summon of a mob converted in the same job
    assert '"@RandomLocationsNearCaster{amount=3;radius=6.0;minRadius=2.0;spacing=2.0}"' in js
    assert "{ amount: 6 }" in js                               # basedamage 1.5 × Damage 4
    assert '"!varEquals{var=caster.mood;val=calm}"' in js      # inline ?! condition
    spark = (out / "BP" / "scripts" / "bosses" / "kitchen_spark.js").read_text(encoding="utf-8")
    assert 'kind: "minion"' in spark and 'default: "frozen"' in spark and "invulnerable: true" in spark
    entity = json.loads((out / "BP" / "entities" / "kitchen_spark.json").read_text(encoding="utf-8"))
    comps = entity["minecraft:entity"]["components"]
    assert entity["minecraft:entity"]["description"]["identifier"] == "kitchen:spark"
    assert "minecraft:boss" not in comps and "bhm_minion" in comps["minecraft:type_family"]["family"]
    boss_entity = json.loads((out / "BP" / "entities" / "kitchen.json").read_text(encoding="utf-8"))
    assert "bhm:tint" in boss_entity["minecraft:entity"]["description"]["properties"]
    assert (out / "RP" / "render_controllers" / "kitchen.bhm.render_controllers.json").exists()
    assert 'm: "grab", o: { bone: "arm", duration: 25 }' in js        # MountModel held until DismountAll
    assert 'm: "partVisibility", o: { part: "arm", visible: false }' in js and 'parts: ["arm"]' in js
    assert '"damageCause{cause=entityAttack}"' in js
    assert '"fieldOfView{angle=45.0;rotation=0.0}", "lineOfSight"' in js  # (a && b) compound
    assert 'm: "cameraShake"' in js and 'm: "setAI", o: { mode: "frozen" }' in js
    assert 'skill: "ks_bleed"' in js and 'color: "#5A1A8C"' in js        # SudoSkill + crying_obsidian dust
    rc = json.loads((out / "RP" / "render_controllers" / "kitchen.bhm.render_controllers.json").read_text(encoding="utf-8"))
    vis = rc["render_controllers"]["controller.render.kitchen.bhm"]["part_visibility"]
    assert vis[0] == {"*": True} and "arm" in vis[1]
    assert "bhm:hidden_parts" in boss_entity["minecraft:entity"]["description"]["properties"]
    bar = out / "RP" / "textures" / "behemoth" / "bossbars" / "Kitchen Sink.png"
    assert bar.exists() and bar.read_bytes()[1:4] == b"PNG"    # no bossbar.png -> empty image
    assert not (out / "RP" / "textures" / "behemoth" / "bossbars" / "Spark.png").exists()  # minions have no bar
    # Steel Raider vocabulary
    assert '"!onBlock{blocks=air}"' in js and 'm: "potionClear"' in js
    assert 'sound: "mob.enderdragon.flap"' in js                             # Java sound name -> Bedrock
    assert 'm: "dropItem", o: { items: [{ item: "minecraft:diamond", amount: 1 }] }, t: "@Bone{bone=arm}"' in js
    assert '"@Cone{angle=110.0;r=4.5;rotation=-20.0}"' in js
    assert "magic: -1" in js                                                 # POISON has no Bedrock cause
    assert 'drops: [{ item: "minecraft:diamond", amount: [1, 3], chance: 0.5 }, { item: "minecraft:emerald", amount: 2 }]' in js
    index = (out / "BP" / "scripts" / "bosses" / "index.js").read_text(encoding="utf-8")
    assert "export default [kitchen, kitchen_spark]" in index
    lang = (out / "RP" / "texts" / "en_US.lang").read_text(encoding="utf-8")
    assert "entity.kitchen:spark.name=Spark" in lang


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


def test_runtime_version_matches_the_framework():
    import re
    main = (ROOT / "packs" / "behemoth" / "BP" / "scripts" / "main.js").read_text(encoding="utf-8")
    framework = json.loads((ROOT / "connector" / "framework.json").read_text(encoding="utf-8"))
    assert re.search(r'VERSION = "([^"]+)"', main).group(1) == framework["runtime_version"],         "bump connector/framework.json runtime_version together with main.js VERSION"


def test_demo_pack_ships_the_current_connector():
    demo = ROOT / "packs" / "behemoth_demo" / "BP" / "scripts" / "behemoth" / "connector.js"
    assert demo.read_text(encoding="utf-8") == (ROOT / "connector" / "connector.js").read_text(encoding="utf-8"), \
        "copy connector/connector.js into the demo pack"
