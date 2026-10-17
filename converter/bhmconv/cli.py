"""Command line:
    python converter/convert.py private/<Boss>             folder mode (docs/converting.md): finished
                                                            pack/BP + pack/RP, dist/<Pack>.mcaddon, report.md
    python converter/convert.py private/<Boss> --check     only list what the YAML uses that is not supported
    python converter/convert.py --job private/<Boss>/<boss>.job.json [--out DIR]   job mode (below)

Builds a complete, standalone Behemoth boss pack (default: <job folder>/pack/{BP,RP})
that registers its bosses with the Behemoth framework through the connector.
The job file (kept next to the licensed sources, git-ignored) names the input
files and the per-boss mappings:

{
  "pack": { "name": "Dark Knight", "id": "dark_knight", "version": [1, 0, 0] },
                                               # uuids are generated once and saved here
  "boss": "dark_knight",                       # output name (file/identifier stem)
  "mob": "bl_dark_knight",                     # MythicMobs mob id to convert
  "mobs_yaml": ["bl_dark_knight(Mobs).yml"],
  "skills_yaml": ["bl_dark_knight(Skills).yml"],
  "behavior": "dark_knight.behavior.json",
  "client_entity": "dark_knight.entity.json",
  "geometry": "dark_knight.geo.json",
  "animations": ["dark_knight.animation.json"],
  "animation_controllers": ["dark_knight.animation_controller.json"],
  "textures": { "dark_knight.png": "textures/entity/dark_knight.png" },
  "mob_types": { "<mm mob>": { "type": "minecraft:pig", "lifetime": 100 } },
  "sounds": { "<mm sound>": "<bedrock sound event>" },
  "bone_aliases": { "<modelengine part>": "<bedrock bone>" },
  "blades": ["<bone>"],  # weapon bones: hits use a hilt->tip capsule, summons land at the tip
  "particles": { "<java particle>": "<bedrock particle id>" },
  "items": { "<MythicMobs item>": "<bedrock item id>" },
  "bullets": { "<bulletModel | bulletMaterial>": "<entity id>" },  # projectile models flown by the framework
  "pack_icon": "icon.png",      # copied into both packs
  "link_all_animations": true,  # also register animations the client entity does not list (Blockbench exports)
  "always_animate": ["passive"],  # looping layer animations the RP always plays (ModelEngine priority layers)
  "sound_files": { "folder": "sounds", "event_prefix": "littleroom.boss", "mm_namespace": "littleroom_boss" },
                         # .ogg files → RP sounds + sound_definitions.json; growl_1.ogg, growl_2.ogg → event
                         # "<event_prefix>.growl"; MythicMobs "<mm_namespace>:<event>" sounds map to them
  "minions": [           # other mobs of this pack converted alongside (minions, effect entities)
    { "boss": "candle", "mob": "<mm mob>", "behavior": "...", "client_entity": "...", "geometry": "...",
      "animations": [], "textures": {}, "identifier": "optional:override" }   # summons of it map automatically
  ],
  "tuning": {            # Bedrock-side adjustments on top of the YAML (all optional)
    "stop_distance": 2.5,                  # ai.stopDistance
    "leash_range": 48,                     # ai.leashRange (default 48)
    "reset_after_no_players": 600,         # ai.resetAfterNoPlayers, ticks (default 600)
    "damage_multiplier": 1.0,              # stats.damageMultiplier
    "ignore_difficulty": false,            # stats.ignoreDifficulty
    "randomskill_mode": "available",       # mode for every randomSkill line
    "trigger_overrides": { "<metaskill>": "onTimer:10" },   # mob lines calling it
    "extra_lines_enabled": true,           # false keeps extra_lines in the job but doesn't apply them
    "extra_lines": { "<metaskill>": [ { "m": "cameraShake", "o": {}, "delay": 20 } ] },
                                           # added at the START of that skill; time them with `delay`
    "option_overrides": { "<metaskill>": { "<mechanic>": { "<option>": 0 } } }
                                           # change options of that mechanic's lines in that skill
  }
}

Paths are relative to the job file. Output goes to --out (default private/build)
as BP/ and RP/ overlays that `npm run deploy` copies over the public packs.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import sys
from pathlib import Path

import uuid

import yaml

from . import __version__

REPO = Path(__file__).resolve().parents[2]
CONNECTOR = REPO / "connector" / "connector.js"
FRAMEWORK = json.loads((REPO / "connector" / "framework.json").read_text(encoding="utf-8"))
MARKER = ".bhmconv-output"


def _png_1x1_transparent() -> bytes:
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + chunk(b"IEND", b""))


# Empty boss bar image for bosses without bossbar.png (framework HUD, L45).
EMPTY_PNG = _png_1x1_transparent()

# Boss bar names starting with this are keys: the framework HUD hides their text (packs/behemoth/RP/ui/hud_screen.json).
BAR_KEY_PREFIX = "bhmbar_"
# The HUD's boss bar canvas in GUI units (vanilla bar at x 165-347, y 60-65) and the pixels per unit we draw at.
BAR_CANVAS = (512, 128)
BAR_PX = 4
# Where bossbar.png goes at scale 1, x 0, y 0: a 256x64 area centred on the bar (docs/bossbar_template.png).
BAR_DEFAULT_WIDTH = 256
BAR_DEFAULT_CENTRE = (256, 64)


def _plain(text: str) -> str:
    """Text without colour codes: boss bar names (the bar image is picked by them) and lang names."""
    return re.sub(r"§[0-9a-fk-or]?", "", text)


def place_boss_bar(source: Path, dest: Path, layout: dict) -> list[str]:
    """Draws bossbar.png onto the HUD's 512x128 canvas (2048x512 px). layout {width, height, x, y}
    (behemoth.json mobs.<MOB>.bossbar_layout) in GUI units (the vanilla bar is 182 wide): width alone
    keeps the image's shape, height alone too, both stretch it; "scale" (1 = 256 wide) also works.
    x/y move it (+x right, +y down) from centred on the template area. Returns report notes."""
    from PIL import Image  # converter/requirements.txt

    art = Image.open(source).convert("RGBA")
    aspect = art.height / art.width
    if layout.get("width"):
        width = float(layout["width"])
    elif layout.get("height"):
        width = float(layout["height"]) / aspect
    else:
        width = BAR_DEFAULT_WIDTH * float(layout.get("scale") or 1)
    height = float(layout["height"]) if layout.get("height") else width * aspect
    dx, dy = float(layout.get("x") or 0), float(layout.get("y") or 0)
    w = max(1, round(width * BAR_PX))
    h = max(1, round(height * BAR_PX))
    canvas = Image.new("RGBA", (BAR_CANVAS[0] * BAR_PX, BAR_CANVAS[1] * BAR_PX), (0, 0, 0, 0))
    cx, cy = (BAR_DEFAULT_CENTRE[0] + dx) * BAR_PX, (BAR_DEFAULT_CENTRE[1] + dy) * BAR_PX
    left, top = round(cx - w / 2), round(cy - h / 2)
    # Pixel art stays crisp when enlarged; smooth filtering when shrunk.
    sized = art.resize((w, h), Image.NEAREST if w >= art.width else Image.LANCZOS)
    # alpha_composite needs a non-negative destination: crop what sticks out on the left/top.
    canvas.alpha_composite(sized, (max(0, left), max(0, top)), (max(0, -left), max(0, -top)))
    canvas.save(dest)
    notes = []
    if layout:
        notes.append(f"boss bar layout: {round(width, 1):g} x {round(height, 1):g} GUI units, x {dx:g}, y {dy:g}")
        if abs(height - width * aspect) > max(1.0, 0.03 * height):
            notes.append(f"boss bar image stretched: {width:g} x {height:g} differs from its shape "
                         f"(keep it: height {width * aspect:.1f} for width {width:g}) [approximate]")
    if left < 0 or top < 0 or left + w > canvas.width or top + h > canvas.height:
        notes.append(f"boss bar image is cut off at the canvas edge ({BAR_CANVAS[0]}x{BAR_CANVAS[1]} GUI units): "
                     "make bossbar_layout smaller or move it")
    return notes


from .bake import Skeleton, bake_animation, rest_position
from .entity import (
    MAX_COLLISION_WIDTH, collision_size, plan_render_controller,
    add_scripted_death, build_base_controller, build_render_controller, complete_behavior, death_duration_ticks,
    find_death_event, geometry_size, movement_speed, patch_behavior, patch_client_entity, render_controller_id,
)
from .jsout import Raw, inline, pretty, track_compact
from .mythic import Context, parse_skill_line, translate_boss
import zipfile


def _load_json(p: Path) -> dict:
    # Bedrock JSON sometimes has comments; strip // lines conservatively.
    text = p.read_text(encoding="utf-8-sig")
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    return json.loads(text)


def _write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")


def _ident(name: str) -> str:
    s = re.sub(r"\W", "_", name)
    return ("_" + s) if s[0].isdigit() else s


def _pack_identity(job: dict, save, display: str, notes: list[str]) -> dict:
    """Pack name/id/version + stable UUIDs (generated once, saved back by `save(job)`)."""
    pack = job.setdefault("pack", {})
    pack.setdefault("name", re.sub(r"§[0-9a-fk-or]", "", display))
    pack.setdefault("id", re.sub(r"[^a-z0-9_]", "_", job["boss"].lower()))
    pack.setdefault("version", [1, 0, 0])
    uuids = pack.setdefault("uuids", {})
    missing = [k for k in ("bp", "bp_data", "bp_script", "rp", "rp_module") if k not in uuids]
    for k in missing:
        uuids[k] = str(uuid.uuid4())
    if missing or job.get("auto"):  # folder mode: also refreshes behemoth.json's list of editable entries
        save(job)
    if missing:
        notes.append(f"generated pack UUIDs ({', '.join(missing)}) and saved them — keep them stable")
    return pack


def _manifests(pack: dict, display: str) -> tuple[dict, dict]:
    v, u = pack["version"], pack["uuids"]
    engine = FRAMEWORK["min_engine_version"]
    bp = {
        "format_version": 2,
        "header": {"name": pack["name"], "description": f"{display} — boss pack for the Behemoth framework (required).",
                   "uuid": u["bp"], "version": v, "min_engine_version": engine},
        "modules": [{"type": "data", "uuid": u["bp_data"], "version": v},
                    {"type": "script", "language": "javascript", "uuid": u["bp_script"], "entry": "scripts/main.js", "version": v}],
        "dependencies": [{"module_name": "@minecraft/server", "version": FRAMEWORK["server_module"]},
                         {"uuid": FRAMEWORK["bp_uuid"], "version": FRAMEWORK["version"]},
                         {"uuid": u["rp"], "version": v}],
    }
    rp = {
        "format_version": 2,
        "header": {"name": f"{pack['name']} Resources", "description": f"{display} — boss pack for the Behemoth framework.",
                   "uuid": u["rp"], "version": v, "min_engine_version": engine},
        "modules": [{"type": "resources", "uuid": u["rp_module"], "version": v}],
        "dependencies": [{"uuid": u["bp"], "version": v}],
    }
    return bp, rp


ENTITY_KEYS = ("behavior", "client_entity", "geometry", "animations", "animation_controllers", "textures",
               "bone_aliases", "blades", "identifier", "auto", "bossbar", "bossbar_layout", "link_all_animations",
               "always_animate", "collision_box", "render_controllers", "texture_fps")


def _entity_specs(job: dict) -> list[dict]:
    """The main boss (top-level job keys) plus job["minions"] (same keys, kind "minion")."""
    main = {"boss": job["boss"], "mob": job["mob"], "kind": "boss", **{k: job[k] for k in ENTITY_KEYS if k in job}}
    specs = [main]
    for m in job.get("minions", []):
        spec = {"kind": "minion", **m}
        for k in ("boss", "mob", "behavior", "client_entity", "geometry"):
            if k not in spec:
                raise SystemExit(f"minion {m.get('mob', '?')}: '{k}' is required")
        specs.append(spec)
    return specs


def _entity_id(spec: dict, src: Path) -> str:
    return spec.get("identifier") or _load_json(src / spec["behavior"])["minecraft:entity"]["description"]["identifier"]


def convert(job_path: Path | None = None, out: Path | None = None, *, job: dict | None = None,
            src: Path | None = None, save=None, report_path: Path | None = None) -> Path:
    """Job mode: convert(job_path). Folder mode passes the job built by folder.build_job()."""
    if job is None:
        job = json.loads(job_path.read_text(encoding="utf-8"))
        src = job_path.parent
        save = lambda j: job_path.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8", newline="\n")  # noqa: E731
    notes: list[str] = []
    out = out or (src / "pack")
    if out.exists():
        if not (out / MARKER).exists() and any(out.iterdir()):
            raise SystemExit(f"{out} exists and was not created by the converter; refusing to overwrite it")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / MARKER).write_text("generated by bhmconv; this folder is rebuilt on every conversion\n", encoding="utf-8")

    mobs: dict = dict(job.get("mobs_data") or {})
    skills: dict = dict(job.get("skills_data") or {})
    if not mobs:
        for f in job.get("mobs_yaml", []):
            mobs.update(yaml.safe_load((src / f).read_text(encoding="utf-8")) or {})
        for f in job.get("skills_yaml", []):
            skills.update(yaml.safe_load((src / f).read_text(encoding="utf-8")) or {})

    specs = _entity_specs(job)
    for spec in specs:
        if spec["mob"] not in mobs:
            raise SystemExit(f"mob '{spec['mob']}' not found in {job.get('mobs_yaml')}")
    # Summons of mobs converted in this job map to their entities automatically.
    mob_types = {sp["mob"]: {"type": _entity_id(sp, src)} for sp in specs[1:]}
    mob_types.update(job.get("mob_types", {}))

    sounds = build_sounds(job, src, out, notes)
    built = [build_entity(spec, job, src, out, mobs, skills, mob_types, sounds) for spec in specs]
    for b in job.get("bullet_entities", []):
        notes.append(build_bullet(b, src, out))
    main = built[0]
    for b in built:
        notes += [f"[{b['boss']}] {n}" for n in b["notes"]] if len(built) > 1 else b["notes"]

    scripts = out / "BP" / "scripts"
    idents = [_ident(b["boss"]) for b in built]
    _write(scripts / "bosses" / "index.js",
           "// GENERATED by bhmconv — every boss and minion in this pack.\n"
           + "".join(f'import {i} from "./{b["boss"]}.js";\n' for i, b in zip(idents, built))
           + f"\nexport default [{', '.join(idents)}];\n")
    pack = _pack_identity(job, save, main["display"], notes)
    # The script runtime version (main.js VERSION), not the manifest version boss packs depend on.
    fw_min = FRAMEWORK.get("runtime_version") or ".".join(str(x) for x in FRAMEWORK["version"])
    _write(scripts / "main.js",
           f"// GENERATED by bhmconv — hands this pack's bosses to the Behemoth framework.\n"
           f'import {{ connect }} from "./behemoth/connector.js";\nimport bosses from "./bosses/index.js";\n\n'
           f'connect({{ pack: {json.dumps(pack["id"])}, version: {json.dumps(".".join(str(x) for x in pack["version"]))}, '
           f'minFramework: {json.dumps(fw_min)}, bosses }});\n')
    shutil.copyfile(CONNECTOR, _mk(scripts / "behemoth" / "connector.js"))
    bp_manifest, rp_manifest = _manifests(pack, main["display"])
    _write(out / "BP" / "manifest.json", json.dumps(bp_manifest, indent=2) + "\n")
    _write(out / "RP" / "manifest.json", json.dumps(rp_manifest, indent=2) + "\n")
    if job.get("pack_icon"):
        for side in ("BP", "RP"):
            shutil.copyfile(src / job["pack_icon"], _mk(out / side / "pack_icon.png"))
    rp = out / "RP"
    _write(rp / "texts" / "en_US.lang", "".join(
        f"entity.{b['entity_id']}.name={_plain(b['display'])}\nitem.spawn_egg.entity.{b['entity_id']}.name=Spawn {_plain(b['display'])}\n"
        for b in built))
    _write(rp / "texts" / "languages.json", '["en_US"]\n')

    # ---------------- report ----------------
    report = report_path or out.parent / f"{job['boss']}.report.md"
    lines = [
        f"# Conversion report: {job['boss']}",
        "",
        f"- Converter {__version__}  ·  pack `{pack['id']}` {pack['version']}",
        f"- Output: `{out}` (BP + RP, needs the Behemoth framework {fw_min}+)",
        "",
    ]
    for b in built:
        lines += [
            f"## {b['boss']} (`{b['entity_id']}`, {b['kind']})",
            "",
            f"- Skills: {b['skill_count']}  ·  mechanics used: {', '.join(b['requires'])}",
            f"- Animations: {b['anim_count']}  ·  baked bones: {', '.join(b['bones']) or '(none)'}",
            f"- Base states: idle={b['idle']} walk={b['walk']}",
            "",
        ]
    groups = classify_notes(notes)
    for title, items in (("Needs you", groups["needs"]), ("Approximated on Bedrock", groups["approx"]),
                         ("Info", groups["info"])):
        lines += [f"## {title} ({len(items)})", "", *([f"- {n}" for n in items] or ["- nothing"]), ""]
    _write(report, "\n".join(lines))
    if job.get("auto"):
        build_mcaddon(out, src / "dist", pack)
    return report


NEEDS = ("unsupported", "has no mapping", "not in the bedrock geometry", "skipped (not converted", "could not be read",
         "not supported", "no matching animation", "was not found", "put ", "will be silent", "not defined in the yaml", "does not match", "is cut off")
APPROX = ("[verify]", "approximat", "dropped", "capped", "→ grab", "mirrored", "÷", "folded", "cannot", "only the bar title",
          "drawn as", "skipped `")


def classify_notes(notes: list[str]) -> dict[str, list[str]]:
    """Report sections: things the user must act on, Bedrock approximations, and plain info."""
    out: dict[str, list[str]] = {"needs": [], "approx": [], "info": []}
    for n in notes:
        low = n.lower()
        if any(k in low for k in NEEDS):
            out["needs"].append(n)
        elif any(k in low for k in APPROX):
            out["approx"].append(n)
        else:
            out["info"].append(n)
    return out


def build_mcaddon(out: Path, dist: Path, pack: dict) -> Path:
    """<Boss>/dist/<Pack>-<version>.mcaddon: the BP and RP ready to double-click into Minecraft."""
    name = re.sub(r"[^A-Za-z0-9]+", "", pack["name"]) or "BossPack"
    target = dist / f"{name}-{'.'.join(str(x) for x in pack['version'])}.mcaddon"
    dist.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for side in ("BP", "RP"):
            for f in sorted((out / side).rglob("*")):
                if f.is_file():
                    z.write(f, f"{name}_{side}/{f.relative_to(out / side).as_posix()}")
    return target


def build_sounds(job: dict, src: Path, out: Path, notes: list[str]) -> dict[str, str]:
    """Job `sound_files`: copy the .ogg files into the RP and write sound_definitions.json. Files that
    differ only by a trailing _N are variants of one event. Returns MythicMobs sound id → Bedrock event."""
    sf = job.get("sound_files")
    if not sf:
        return {}
    folder = src / sf["folder"]
    prefix = sf.get("event_prefix") or job["pack"].get("id", job["boss"])
    ns = sf.get("mm_namespace")
    # Folder mode: name each sound after the MythicMobs sound id that ends with its file name
    # ("ns:littleroom.wendigo.growl" + growl_1.ogg → event "littleroom.wendigo.growl").
    used = set(re.findall(r"sound\{[^}]*?\b(?:s|sound)=([A-Za-z0-9_.:\-]+)", job.get("yaml_text", ""))) if sf.get("auto") else set()
    dest = f"sounds/{sf.get('dest', job['boss'])}"
    groups: dict[str, list[Path]] = {}
    # growl_1/growl_2 are random variants of one sound, unless the YAML plays growl_1 by its own name.
    used_last = {re.split(r"[.:]", u)[-1].lower() for u in used}
    for f in sorted(folder.glob("*.ogg")):
        stem = f.stem if f.stem.lower() in used_last else re.sub(r"_\d+$", "", f.stem)
        bare = re.sub(r"_?\d+$", "", f.stem)
        if stem.lower() not in used_last and bare.lower() in used_last:
            stem = bare  # foley1.ogg … foley5.ogg are variants of a YAML sound "foley"
        groups.setdefault(stem, []).append(f)
    defs, mapping = {}, {}
    # A Java resource pack's sounds.json in the folder says exactly which files make each sound
    # ("sr.air_jump" → air_attack_jump.ogg): those events win over guessing from file names.
    if sf.get("auto"):
        by_stem = {f.stem.lower(): f for files in groups.values() for f in files}
        for ns_, event, stems in _java_sound_events(src):
            files = [by_stem[s] for s in stems if s in by_stem]
            if not files:
                continue
            for f in files:
                shutil.copyfile(f, _mk(out / "RP" / dest / f.name))
            name = _sound_event(event, ns_)
            defs[name] = {"category": "hostile", "max_distance": 48.0,
                          "sounds": [{"name": f"{dest}/{f.stem}", "load_on_low_memory": True} for f in files]}
            mapping[event] = mapping[name] = name
            if ns_:
                mapping[f"{ns_}:{event}"] = name
            for f in files:
                for stem in list(groups):
                    groups[stem] = [g for g in groups[stem] if g != f]
        if defs:
            notes.append(f"sounds: {len(defs)} event(s) named by the resource pack's sounds.json")
        groups = {k: v for k, v in groups.items() if v}
    for stem, files in groups.items():
        event = f"{prefix}.{stem}"
        mm_ids = [u for u in used if re.split(r"[.:]", u)[-1].lower() == stem.lower()]
        if mm_ids:
            first = mm_ids[0]
            event = _sound_event(first.split(":", 1)[-1], first.split(":", 1)[0] if ":" in first else "")
            for u in mm_ids:
                mapping[u] = event
                mapping[u.split(":", 1)[-1]] = event
        for f in files:
            shutil.copyfile(f, _mk(out / "RP" / dest / f.name))
        defs[event] = {"category": "hostile", "max_distance": 48.0,
                       "sounds": [{"name": f"{dest}/{f.stem}", "load_on_low_memory": True} for f in files]}
        mapping[event] = event
        if ns:
            mapping[f"{ns}:{event}"] = event
    _write(out / "RP" / "sounds" / "sound_definitions.json",
           json.dumps({"format_version": "1.14.0", "sound_definitions": defs}, indent=2))
    notes.append(f"sounds: {len({s['name'] for d in defs.values() for s in d['sounds']})} files → {len(defs)} events "
                 f"({', '.join(sorted(defs))})")
    return mapping


def _sound_event(event: str, namespace: str) -> str:
    """Bedrock sound event names are global across packs: a bare name ("hurt") gets the MythicMobs
    namespace ("littleroom_thearchivist.hurt"); dotted names ("sr.spawn") stay as they are."""
    if "." in event or not namespace or namespace == "minecraft":
        return event
    return f"{namespace}.{event}"


def _java_sound_events(src: Path) -> list[tuple[str, str, list[str]]]:
    """(namespace, event, [file stems]) from Java-format sounds.json files in the folder: next to the
    YAML, in a mob folder (MY_BOSS/sounds.json) or in sounds/. The namespace is known only for a
    resource pack layout (assets/<namespace>/sounds.json); MythicMobs ids match without it too.
    Generated output folders are skipped."""
    found = []
    for f in sorted(src.rglob("sounds.json")):
        rel = f.relative_to(src).parts
        if rel[0] in ("pack", "dist"):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        ns = rel[-2] if len(rel) >= 3 and rel[-3] == "assets" else ""
        for event, spec in data.items():
            if not isinstance(spec, dict) or not isinstance(spec.get("sounds"), list):
                continue
            names = [x if isinstance(x, str) else str(x.get("name", "")) for x in spec["sounds"]]
            # "littleroom_thearchivist:candle_step1" → namespace + file stem
            spaces = [n.split(":", 1)[0] for n in names if ":" in n]
            stems = [Path(n.split(":", 1)[-1]).name.lower() for n in names]
            found.append((ns or (spaces[0] if spaces else ""), str(event), [x for x in stems if x]))
    return found


def script_hooks(anim_files: list[dict], skills: dict) -> dict[str, list[tuple[int, str]]]:
    """ModelEngine keyframe scripts (timeline "mm:SKILL;") that do more than play a sound:
    full animation id → [(tick, skill)]. The converter runs them from the skills playing it."""
    hooks: dict[str, list[tuple[int, str]]] = {}
    for f in anim_files:
        for anim_id, anim in (f.get("animations") or {}).items():
            for time, value in (anim.get("timeline") or {}).items() if isinstance(anim.get("timeline"), dict) else []:
                for entry in value if isinstance(value, list) else [value]:
                    for part in (x.strip() for x in str(entry).split(";")):
                        if not part.lower().startswith("mm:"):
                            continue
                        name = part[3:].strip()
                        lines = [parse_skill_line(str(r)) for r in (skills.get(name) or {}).get("Skills") or []]
                        if name in skills and not (lines and all(sl.mechanic.lower() == "sound" for sl in lines)):
                            hooks.setdefault(anim_id, []).append((round(float(time) * 20), name))
    return hooks


def _animation_hooks(anim_file: dict, skills: dict, ctx: Context, notes: list[str], tag: str) -> dict[str, str]:
    """ModelEngine script keyframes (timeline "mm:SKILL;") cannot run on Bedrock. Skills made only of
    sounds become animation sound_effects (client side); everything else is removed and reported.
    Returns effect name → sound event for the client entity's sound_effects."""
    effects: dict[str, str] = {}
    for anim_id, anim in anim_file.get("animations", {}).items():
        tl = anim.get("timeline")
        if not isinstance(tl, dict):
            continue
        for time, value in list(tl.items()):
            entries = value if isinstance(value, list) else [value]
            kept = []
            for entry in entries:
                parts = [x.strip() for x in str(entry).split(";") if x.strip()]
                rest = []
                for part in parts:
                    if not part.lower().startswith("mm:"):
                        rest.append(part)
                        continue
                    name = part[3:].strip()
                    lines = [parse_skill_line(str(r)) for r in (skills.get(name) or {}).get("Skills") or []]
                    if lines and all(sl.mechanic.lower() == "sound" for sl in lines):
                        mm = str(lines[0].options.get("s", lines[0].options.get("sound", "")))
                        event = ctx.sounds.get(mm) or ctx.sounds.get(mm.split(":", 1)[-1]) or mm.split(":", 1)[-1]
                        key = name.lower()
                        effects[key] = event
                        anim.setdefault("sound_effects", {})[time] = {"effect": key}
                    elif name in ctx.hook_skills:
                        notes.append(f"{tag}: {anim_id} keyframe script mm:{name} at {time}s runs from the skills that "
                                     f"play the animation (server side, timed from when they start it)")
                    else:
                        notes.append(f"{tag}: {anim_id} keyframe script mm:{name} at {time}s dropped (the skill is not defined)")
                if rest:
                    kept.append("; ".join(rest) + ";")
            if kept:
                tl[time] = kept if isinstance(value, list) else kept[0]
            else:
                del tl[time]
        if not tl:
            anim.pop("timeline", None)
    if effects:
        notes.append(f"{tag}: keyframe sounds {', '.join(sorted(effects))} play from the animations (client side)")
    return effects


def build_bullet(spec: dict, src: Path, out: Path) -> str:
    """A projectile's model (behemoth.json "bullets": {"<bulletModel>": "<FOLDER>"}): an entity the
    framework moves every tick. No AI, no gravity, no collision, cannot be hurt; its looping
    animations always play. Returns a report note."""
    ident, slug = spec["identifier"], _ident(spec["folder"].lower())
    beh = _load_json(src / spec["behavior"]) if spec.get("behavior") else {
        "format_version": "1.21.0", "minecraft:entity": {"description": {}, "components": {}}}
    ent = beh["minecraft:entity"]
    ent["description"].update({"identifier": ident, "is_spawnable": False, "is_summonable": True})
    comps = {k: v for k, v in (ent.get("components") or {}).items()
             if not k.startswith(("minecraft:behavior.", "minecraft:navigation", "minecraft:movement", "minecraft:jump"))}
    comps.update({
        "minecraft:physics": {"has_gravity": False, "has_collision": False},
        "minecraft:collision_box": {"width": 0.1, "height": 0.1},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": False}]},
        "minecraft:health": {"value": 1, "max": 1},
        "minecraft:type_family": {"family": ["bhm_bullet", "inanimate"]},
    })
    ent["components"] = comps
    ent.pop("component_groups", None)
    ent.pop("events", None)
    _write(out / "BP" / "entities" / f"{slug}.json", json.dumps(beh, indent=2))
    client = _load_json(src / spec["client_entity"])
    desc = client["minecraft:client_entity"]["description"]
    desc["identifier"] = ident
    anims = desc.setdefault("animations", {})
    animate = desc.setdefault("scripts", {}).setdefault("animate", [])
    for f in spec.get("animations", []):
        data = _load_json(src / f)
        for full, a in (data.get("animations") or {}).items():
            key = full.rsplit(".", 1)[-1]
            anims.setdefault(key, full)
            if a.get("loop") and key not in animate:
                animate.append(key)
        _write(out / "RP" / "animations" / Path(f).name, json.dumps(data, indent=2))
    _write(out / "RP" / "entity" / f"{slug}.entity.json", json.dumps(client, indent=2))
    shutil.copyfile(src / spec["geometry"], _mk(out / "RP" / "models" / "entity" / Path(spec["geometry"]).name))
    for f, dest in spec.get("textures", {}).items():
        shutil.copyfile(src / f, _mk(out / "RP" / dest))
    return f"bullet model {spec['folder']}/ → entity {ident} (projectile bulletModel {spec['key']})"


def build_entity(spec: dict, job: dict, src: Path, out: Path, mobs: dict, skills: dict, mob_types: dict,
                 sounds: dict[str, str] | None = None) -> dict:
    """Convert one MythicMobs mob + its Bedrock entity files into config, generated data and entity files."""
    boss = spec["boss"]
    kind = spec.get("kind", "boss")
    notes: list[str] = []
    behavior = _load_json(src / spec["behavior"])
    client = _load_json(src / spec["client_entity"])
    geo = _load_json(src / spec["geometry"])
    anim_names = spec.get("animations", [])
    anim_files = [_load_json(src / f) for f in anim_names]
    entity_id = spec.get("identifier") or behavior["minecraft:entity"]["description"]["identifier"]
    client_anims: dict[str, str] = client["minecraft:client_entity"]["description"].get("animations", {})
    all_anims = {}
    for f in anim_files:
        all_anims.update(f.get("animations", {}))
    if spec.get("link_all_animations", job.get("link_all_animations")):
        linked = set(client_anims.values())
        for full in all_anims:
            if full in linked:
                continue
            key = full.rsplit(".", 1)[-1]
            while key in client_anims:
                key += "_"
            client_anims[key] = full
            notes.append(f"client entity: linked animation `{key}` ({full})")
        client["minecraft:client_entity"]["description"]["animations"] = client_anims
    action_anims = {k: v for k, v in client_anims.items() if v in all_anims}
    always = list(spec.get("always_animate", job.get("always_animate", []) if kind == "boss" else []))
    if spec.get("auto") and "always_animate" not in spec:
        always = _detect_always(mobs[spec["mob"]], job.get("yaml_text", ""), action_anims, all_anims, notes)
    for a in always:
        if a not in action_anims:
            raise SystemExit(f"always_animate: '{a}' is not an animation of {spec['boss']}")
    skel = Skeleton.from_geo(geo, client["minecraft:client_entity"]["description"].get("geometry", {}).get("default"))

    # ---------------- YAML → config ----------------
    ctx = Context(
        anims=set(action_anims),
        bones=set(skel.bones),
        mob_types=mob_types,
        sounds={**(sounds or {}), **job.get("sounds", {})},
        bone_aliases=spec.get("bone_aliases", {}),
        blades=set(spec.get("blades", [])),
        particles=job.get("particles", {}),
        items=job.get("items", {}),
        bullets=job.get("bullets", {}),
        mm_mobs=set(mobs),
    )
    ctx.always = set(always)
    ctx.looping = {k for k, v in action_anims.items() if all_anims.get(v, {}).get("loop") is True}
    by_full = script_hooks(anim_files, skills)
    ctx.anim_hooks = {k: sorted(by_full[v]) for k, v in action_anims.items() if v in by_full}
    ctx.hook_skills = {name for hooks in ctx.anim_hooks.values() for _, name in hooks}
    own_box = behavior["minecraft:entity"].get("components", {}).get("minecraft:collision_box") or {}
    auto_box = collision_size(mobs[spec["mob"]], geo, kind)
    box = {**{"width": auto_box[0], "height": auto_box[1]}, **own_box,
           **{k: v for k, v in (spec.get("collision_box") or {}).items() if v}}
    ctx.collision = (float(box["width"]), float(box["height"]))
    ctx.base_states["idle"].append("idle") if "idle" in action_anims else None
    ctx.base_states["walk"].append("walk") if "walk" in action_anims else None
    tb = translate_boss(spec["mob"], mobs[spec["mob"]], skills, ctx)
    if spec.get("auto"):
        is_effect = kind == "minion" and (tb["noAI"] or bool(spec.get("effect")))
        always += [a for a in _auto_skills(tb["skills"], action_anims, ctx, notes, is_effect) if a not in always]
    notes += ctx.notes
    tuning = spec.get("tuning", job.get("tuning", {}) if kind == "boss" else {})
    apply_tuning(tb["skills"], tuning, ctx, notes)
    if kind == "boss":
        for mm, be in job.get("sounds", {}).items():
            notes.append(f"sound '{mm}' → '{be}' (placeholder until the boss's own sounds are added)")

    # ---------------- bake ----------------
    bake_bones = sorted(ctx.used_bones)
    points = {}
    for blade in sorted(ctx.blades):
        if blade in skel.bones:
            tip = skel.far_point(blade)
            points[f"{blade}_tip"] = (blade, tip)
            notes.append(f"blade '{blade}': tip at model point {tuple(round(v, 2) for v in tip)} px")
    gen_dir = out / "BP" / "scripts" / "generated" / boss
    index_imports, index_entries = [], []
    for key_name, full in sorted(action_anims.items()):
        res = bake_animation(skel, all_anims[full], bake_bones, points)
        if res.unbakeable:
            notes.append(f"animation {key_name}: unbakeable (runtime Molang) bones {res.unbakeable}")
        ident = _ident(key_name)
        bones_js = ",\n".join(f"    {json.dumps(b)}: {track_compact(t)}" for b, t in res.tracks.items())
        _write(gen_dir / f"{ident}.js",
               f"// GENERATED by bhmconv {__version__} from {[Path(f).name for f in anim_names]} — do not edit.\n"
               f"// Bone tracks are compact (base64 int16, decoded by the framework).\n"
               f"export default {{\n"
               f"  name: {json.dumps(full)},\n"
               f"  length: {res.length_ticks},\n"
               f"  loop: {'true' if res.loop else 'false'},\n"
               f"  hitFrames: [],\n"
               f"  markers: {{}},\n"
               f"  bones: {{\n{bones_js}\n  }},\n"
               f"  unbakeable: {inline(res.unbakeable)},\n"
               f"}};\n")
        index_imports.append(f'import {ident} from "./{ident}.js";')
        index_entries.append(f"  {json.dumps(key_name)}: {ident},")
    rest = {b: rest_position(skel, b, points) for b in bake_bones}
    _write(gen_dir / "index.js",
           f"// GENERATED by bhmconv {__version__} — animation data for {entity_id}.\n"
           + "\n".join(index_imports)
           + "\n\nexport default {\n" + "\n".join(index_entries) + "\n};\n\n"
           + "/** Bone pivots in the rest pose (entity space, blocks). */\n"
           + f"export const rest = {inline(rest)};\n")

    # ---------------- config ----------------
    if spec.get("auto"):
        behavior = complete_behavior(behavior, mobs[spec["mob"]], collision_size(mobs[spec["mob"]], geo, kind), notes)
        if not find_death_event(behavior) and "death" in action_anims:
            length = float(all_anims[action_anims["death"]].get("animation_length", 2) or 2)
            behavior = add_scripted_death(behavior, max(2.0, length + 1.5), notes)
    box ={k: v for k, v in (spec.get("collision_box") or {}).items() if k in ("width", "height") and v}
    if box:
        comps = behavior["minecraft:entity"].setdefault("components", {})
        comps["minecraft:collision_box"] = {**comps.get("minecraft:collision_box", {"width": 0.6, "height": 1.8}), **box}
        notes.append(f"collision box {comps['minecraft:collision_box']} (behemoth.json collision_box)")
    width = behavior["minecraft:entity"].get("components", {}).get("minecraft:collision_box", {}).get("width", 0)
    if width > MAX_COLLISION_WIDTH:
        notes.append(f"collision box {width} wide: Bedrock mobs wider than {MAX_COLLISION_WIDTH} may not walk "
                     f"(walk animation, no movement); set mobs.{spec['mob']}.collision_box.width in behemoth.json [VERIFY]")
    death_event = find_death_event(behavior)
    death_cfg = None
    if death_event:
        dur = death_duration_ticks(behavior, death_event)
        death_cfg = {"event": death_event, "removeAfter": (dur or 360) + 40}
        notes.append(f"custom death: entity event '{death_event}' is treated as the death; "
                     f"body removed after {death_cfg['removeAfter']} ticks if the entity hasn't despawned itself")
    requires = sorted(m for m in ctx.used_mechanics if not m.startswith("__"))
    if kind == "boss":
        ai = {"default": "chase", "targetRange": tb["targetRange"], "vanillaMelee": False,
              "leashRange": tuning.get("leash_range", 48),
              "resetAfterNoPlayers": tuning.get("reset_after_no_players", 600),
              **({"stopDistance": tuning["stop_distance"]} if "stop_distance" in tuning else {})}
    else:
        frozen = tb["noAI"] or spec.get("effect")
        ai = {"default": "frozen" if frozen else "chase", "targetRange": tb["targetRange"], "vanillaMelee": False,
              **({"faceTarget": False} if frozen else {}),
              **({"stopDistance": tuning["stop_distance"]} if "stop_distance" in tuning else {})}
        if tb["noAI"]:
            notes.append("NoAI → ai.default frozen, faceTarget false (effect entity)")
        elif spec.get("effect"):
            notes.append("no model folder: generated an invisible effect entity (empty model); ai.default frozen")
            model = re.search(r"model\{(?:[^}]*?;)?(?:mid|m|model)=([A-Za-z0-9_.-]+)", yaml.safe_dump(mobs[spec["mob"]].get("Skills") or []))
            if model:
                notes.append(f"it has the ModelEngine model '{model.group(1)}': put its Bedrock files in a folder named "
                             f"{spec['mob']} to see it (it is invisible now) — put the model in")
    # Boss bar (framework HUD, L45): the HUD draws textures/behemoth/bossbars/<bar name>.png on every bar.
    # With a custom bossbar.png the bar name is a key (bhmbar_...) and the HUD hides the bar text; else
    # the bar shows the plain name (the game strips colour codes) and gets an empty image.
    bar_key = BAR_KEY_PREFIX + re.sub(r"[^a-z0-9_]", "_", entity_id.lower()) if kind == "boss" and spec.get("bossbar") else ""
    bar_name = bar_key or _plain(tb["display"])
    # Bedrock-side difficulty: more health, and a cap on what one hit can take (bosses: 10% by default).
    hp_mult = float(tuning.get("health_multiplier") or 1)
    if hp_mult != 1:
        tb["health"] = round(tb["health"] * hp_mult, 1)
        behavior["minecraft:entity"].setdefault("components", {})["minecraft:health"] = {"value": tb["health"], "max": tb["health"]}
        notes.append(f"tuning: health ×{hp_mult:g} → {tb['health']:g}")
    max_hit = tuning.get("max_hit_percent")
    if max_hit is not None:
        notes.append(f"tuning: one hit takes at most {float(max_hit):g}% of max health" if float(max_hit) > 0
                     else "tuning: no per-hit damage cap")
    config = {
        "schemaVersion": 1,
        "id": entity_id,
        "kind": kind,
        "display": {"name": tb["display"], **({"bossBar": True} if kind == "boss" else {}),
                    **({"barKey": bar_key} if bar_key else {})},
        "stats": {"health": tb["health"], "scale": 1,
                  **({"movementSpeed": movement_speed(behavior)} if movement_speed(behavior) else {}),
                  **({"damageMultiplier": tuning["damage_multiplier"]} if "damage_multiplier" in tuning else {}),
                  **({"ignoreDifficulty": True} if tuning.get("ignore_difficulty") else {}),
                  **({"maxHitPercent": round(min(100.0, float(max_hit)) / 100, 4)} if max_hit is not None else {})},
        **({"invulnerable": True} if tb["invincible"] else {}),
        # NoAI minions and generated invisible ones are effect entities (telegraphs, cracks): own summon caps.
        **({"effect": True} if kind == "minion" and (tb["noAI"] or spec.get("effect")) else {}),
        **({"variables": tb["variables"]} if tb["variables"] else {}),
        **({"parts": ctx.parts} if ctx.parts else {}),
        "animations": Raw("anims"),
        "restPose": Raw("rest"),
        "baseStates": ctx.base_states,
        "ai": ai,
        "threat": {"enabled": tb["threat"]},
        **({"death": death_cfg} if death_cfg else {}),
        **({"damageModifiers": tb["damageModifiers"]} if tb["damageModifiers"] else {}),
        **({"drops": tb["drops"]} if tb.get("drops") else {}),
        "skills": tb["skills"],
        "requires": requires,
    }
    _write(out / "BP" / "scripts" / "bosses" / f"{boss}.js",
           f"// GENERATED by bhmconv {__version__} from {job['mobs_yaml'] + job['skills_yaml']} (mob '{spec['mob']}').\n"
           f"// Converted from a licensed pack: keep it private. See the conversion report.\n"
           f'import anims, {{ rest }} from "../generated/{boss}/index.js";\n\n'
           f"export default {pretty(config)};\n")

    # ---------------- entities ----------------
    idle, walk = ctx.base_states["idle"], ctx.base_states["walk"]
    ident_override = spec.get("identifier")
    bp_entity = patch_behavior(behavior, len(idle), len(walk), tb["bossBarRange"], notes, bar_key or _plain(tb["display"]),
                               kind=kind, identifier=ident_override, tint=ctx.uses_tint, parts=len(ctx.parts))
    _write(out / "BP" / "entities" / f"{boss}.json", json.dumps(bp_entity, indent=2))
    rp = out / "RP"
    sound_effects: dict[str, str] = {}
    for f, data in zip(anim_names, anim_files):
        sound_effects.update(_animation_hooks(data, skills, ctx, notes, Path(f).name))
        _write(rp / "animations" / Path(f).name, json.dumps(data, indent=2))
    # Render controllers from the mob folder are copied; the entity's own one is extended (tint, hidden
    # parts) or, with the default one, generated (plus animated texture frames: name1..nameN).
    custom_rcs: dict[str, dict] = {}
    for f in spec.get("render_controllers", []):
        data = _load_json(src / f)
        custom_rcs.update(data.get("render_controllers") or {})
        _write(rp / "render_controllers" / Path(f).name, json.dumps(data, indent=2))
    client = copy.deepcopy(client)
    rc_file = plan_render_controller(client, boss, notes, ctx.uses_tint, ctx.parts, custom_rcs, spec.get("texture_fps"))
    if rc_file:
        _write(rp / "render_controllers" / f"{boss}.bhm.render_controllers.json", json.dumps(rc_file, indent=2))
    _write(rp / "entity" / f"{boss}.entity.json",
           json.dumps(patch_client_entity(client, boss, notes, identifier=ident_override, tint=ctx.uses_tint,
                                          parts=ctx.parts, always=always, sound_effects=sound_effects), indent=2))
    _write(rp / "animation_controllers" / f"{boss}.bhm_base.animation_controller.json",
           json.dumps(build_base_controller(boss, idle, walk), indent=2))
    shutil.copyfile(src / spec["geometry"], _mk(rp / "models" / "entity" / Path(spec["geometry"]).name))
    for f in spec.get("animation_controllers", []):
        shutil.copyfile(src / f, _mk(rp / "animation_controllers" / Path(f).name))
    for f, dest in spec.get("textures", {}).items():
        shutil.copyfile(src / f, _mk(rp / dest))
    if kind == "boss":
        bar_file = _mk(rp / "textures" / "behemoth" / "bossbars" / f"{bar_name}.png")
        if spec.get("bossbar"):
            notes.extend(place_boss_bar(src / spec["bossbar"], bar_file, spec.get("bossbar_layout") or {}))
            notes.append(f"custom boss bar: {spec['bossbar']} (bar key '{bar_name}', the bar shows no name text)")
        else:
            bar_file.write_bytes(EMPTY_PNG)

    return {"boss": boss, "kind": kind, "entity_id": entity_id, "display": tb["display"], "notes": notes,
            "requires": requires, "skill_count": len(tb["skills"]), "anim_count": len(action_anims),
            "bones": bake_bones, "idle": idle, "walk": walk}


def _detect_always(mob: dict, yaml_text: str, action_anims: dict, all_anims: dict, notes: list[str]) -> list[str]:
    """ModelEngine priority layers: a looping animation the mob starts on spawn/load with `state` and
    never removes plays all the time (e.g. `passive`)."""
    found = []
    for raw in mob.get("Skills") or []:
        sl = parse_skill_line(str(raw))
        if sl.mechanic.lower() != "state" or not sl.trigger or sl.trigger[0].lower() not in ("onspawn", "onload"):
            continue
        anim = str(sl.options.get("s", sl.options.get("state", "")))
        full = action_anims.get(anim)
        if not full or anim in ("idle", "walk", "run") or anim in found:
            continue
        if not all_anims.get(full, {}).get("loop"):
            continue
        removed = re.search(r"state\{[^}]*\bs=" + re.escape(anim) + r"\b[^}]*\br=true", yaml_text, re.I) or \
            re.search(r"state\{[^}]*\br=true[^}]*\bs=" + re.escape(anim) + r"\b", yaml_text, re.I)
        if not removed:
            found.append(anim)
    if found:
        notes.append(f"always-on layer animation(s) {found}: started on spawn and never stopped (ModelEngine layers)")
    return found


def _auto_skills(skills: dict, action_anims: dict, ctx: Context, notes: list[str], effect: bool = False) -> list[str]:
    """What ModelEngine/MythicMobs do implicitly: play `spawn` on spawn and `death` on death, and keep
    a propel that runs every few ticks flat (its default hop would otherwise lift the mob).
    Returns animations the client plays by itself (an effect entity's `spawn`)."""
    played = {line.get("o", {}).get("anim") for sk in skills.values() for line in [sk] + list(sk.get("c", []))
              if line.get("m") == "state"}
    client: list[str] = []
    for anim, trig in (("spawn", "onSpawn"), ("death", "onDeath")):
        if anim in action_anims and anim not in played:
            if anim == "spawn" and effect:
                # Short-lived effect entities: the client starts it the moment the entity appears (a
                # server-side play in the spawn tick sometimes reached the client before the entity).
                client.append(anim)
                notes.append("plays `spawn` client side as soon as it appears (effect entity)")
                continue
            # Two ticks after spawning, so the client has the entity before the animation is sent.
            skills[f"bhm_{anim}_animation"] = {"tr": trig, "m": "state", "o": {"anim": anim},
                                               **({"delay": 2} if anim == "spawn" else {})}
            ctx.used_mechanics.add("state")
            notes.append(f"plays `{anim}` on {trig[2:].lower()} (ModelEngine does this automatically)")
    fast = set()
    for sk in skills.values():
        tr = str(sk.get("tr", ""))
        m = re.fullmatch(r"onTimer:(\d+)", tr)
        if m and int(m.group(1)) <= 5 and sk.get("m") == "skill":
            fast.add(sk.get("o", {}).get("skill"))
    for name in fast:
        sk = skills.get(name) or {}
        for line in [sk] + list(sk.get("c", [])):
            if line.get("m") == "propel" and "height" not in line.get("o", {}):
                line["o"]["height"] = 0
                notes.append(f"{name}: propel runs every few ticks, kept flat (height 0)")
    return client


def apply_tuning(skills: dict, tuning: dict, ctx: Context, notes: list[str]) -> None:
    """Job-file adjustments that are not in the MythicMobs YAML (reported, never silent)."""
    mode = tuning.get("randomskill_mode")
    for name, sk in skills.items():
        for line in [sk] + list(sk.get("c", [])):
            if mode and line.get("m") == "randomSkill":
                line["o"]["mode"] = mode
                notes.append(f"tuning: {name} randomSkill mode={mode}")
    for target, tr in tuning.get("trigger_overrides", {}).items():
        hit = [k for k, sk in skills.items() if k.startswith("mob_") and sk.get("o", {}).get("skill") == target]
        for k in hit:
            notes.append(f"tuning: {k} trigger {skills[k]['tr']} -> {tr}")
            skills[k]["tr"] = tr
        if not hit:
            notes.append(f"tuning: trigger override for '{target}' matched no mob skill line")
    for target, by_mech in tuning.get("option_overrides", {}).items():
        sk = skills.get(target)
        if not sk:
            notes.append(f"tuning: option overrides for unknown skill '{target}' ignored")
            continue
        for line in [sk] + list(sk.get("c", [])):
            if line.get("m") in by_mech:
                line.setdefault("o", {}).update(by_mech[line["m"]])
                notes.append(f"tuning: {target} {line['m']} options {by_mech[line['m']]}")
    if tuning.get("extra_lines_enabled", True) is False:
        if tuning.get("extra_lines"):
            notes.append(f"tuning: extra_lines disabled (extra_lines_enabled=false); {len(tuning['extra_lines'])} skill(s) left unchanged")
        return
    for target, lines in tuning.get("extra_lines", {}).items():
        if target not in skills:
            notes.append(f"tuning: extra lines for unknown skill '{target}' ignored")
            continue
        sk = skills[target]
        if "c" not in sk:
            sk["c"] = [{k: sk.pop(k) for k in ("m", "o", "t", "delay") if k in sk}]
        sk["c"] = list(lines) + sk["c"]
        for line in lines:
            ctx.used_mechanics.add(line["m"])
        notes.append(f"tuning: {len(lines)} extra line(s) added to {target}: {', '.join(l['m'] for l in lines)}")


def _mk(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="bhmconv", description="Behemoth boss converter")
    ap.add_argument("folder", nargs="?", type=Path, help="prepared boss folder (docs/converting.md)")
    ap.add_argument("--check", action="store_true", help="only report what the YAML uses that is not supported")
    ap.add_argument("--job", type=Path, help="job JSON describing the boss sources (job mode)")
    ap.add_argument("--out", type=Path, default=None, help="output pack folder (default: <folder>/pack)")
    args = ap.parse_args(argv)
    if args.job:
        report = convert(args.job, args.out)
        print(f"[bhmconv] done -> {args.out or args.job.parent / 'pack'}  (report: {report})")
        return 0
    if not args.folder:
        ap.error("give a boss folder or --job")
    from .folder import build_job
    folder = args.folder.resolve()
    job, save, problems = build_job(folder)
    if problems:
        print("[bhmconv] the folder is not ready:")
        for p in problems:
            print(f"  - {p}")
        print("  see docs/converting.md")
        return 1
    if args.check:
        job["_src"] = str(folder)
        return check(job)
    out = args.out or folder / "pack"
    report = convert(out=out, job=job, src=folder, save=save, report_path=folder / "report.md")
    text = report.read_text(encoding="utf-8")
    needs = re.search(r"## Needs you \((\d+)\)", text)
    print(f"[bhmconv] done -> {out / 'BP'} and {out / 'RP'}, {folder / 'dist'}  (report: {report})")
    if needs and needs.group(1) != "0":
        print(f"[bhmconv] {needs.group(1)} item(s) need you: see the report's 'Needs you' section")
    return 0


def check(job: dict) -> int:
    """Translate everything without writing files and list only what is not supported."""
    from .mythic import translate_boss as tb_
    mobs, skills = job["mobs_data"], job["skills_data"]
    problems: list[str] = []
    for spec in [job] + job.get("minions", []):
        anims = set()
        for f in spec.get("animations", []):
            anims |= {k.rsplit(".", 1)[-1] for k in (_load_json(Path(job["_src"]) / f).get("animations") or {})}
        ctx = Context(anims=anims, bones=set(), mob_types={}, sounds={}, bone_aliases={}, mm_mobs=set(mobs))
        tb_(spec["mob"], mobs[spec["mob"]], skills, ctx)
        problems += [f"[{spec['mob']}] {n}" for n in ctx.notes
                     if any(k in n.lower() for k in ("unsupported", "not supported", "has no mapping"))]
    if problems:
        print(f"[bhmconv] {len(problems)} thing(s) the framework does not support yet:")
        for p in problems:
            print(f"  - {p}")
        return 2
    print("[bhmconv] every mechanic, condition, targeter and trigger in the YAML is supported")
    return 0


if __name__ == "__main__":
    sys.exit(main())
