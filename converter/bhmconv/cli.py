"""Command line: python converter/convert.py --job private/<Boss>/<boss>.job.json [--out DIR]

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
  "bullets": { "<bulletModel | bulletMaterial>": "<entity id>" },  # projectile models flown by the framework
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
    "extra_lines": { "<metaskill>": [ { "m": "cameraShake", "o": {}, "delay": 20 } ] }
                                           # added at the START of that skill; time them with `delay`
  }
}

Paths are relative to the job file. Output goes to --out (default private/build)
as BP/ and RP/ overlays that `npm run deploy` copies over the public packs.
"""

from __future__ import annotations

import argparse
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
from .bake import Skeleton, bake_animation, rest_position
from .entity import (
    build_base_controller, build_tint_controller, death_duration_ticks, find_death_event, movement_speed, patch_behavior,
    patch_client_entity,
)
from .jsout import Raw, inline, pretty, track_compact
from .mythic import Context, translate_boss


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


def _pack_identity(job: dict, job_path: Path, display: str, notes: list[str]) -> dict:
    """Pack name/id/version + stable UUIDs (generated once, saved back to the job file)."""
    pack = job.setdefault("pack", {})
    pack.setdefault("name", display)
    pack.setdefault("id", re.sub(r"[^a-z0-9_]", "_", job["boss"].lower()))
    pack.setdefault("version", [1, 0, 0])
    uuids = pack.setdefault("uuids", {})
    missing = [k for k in ("bp", "bp_data", "bp_script", "rp", "rp_module") if k not in uuids]
    for k in missing:
        uuids[k] = str(uuid.uuid4())
    if missing:
        job_path.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8", newline="\n")
        notes.append(f"generated pack UUIDs ({', '.join(missing)}) and saved them in {job_path.name} — keep them stable")
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
               "bone_aliases", "blades", "identifier")


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


def convert(job_path: Path, out: Path | None = None) -> Path:
    job = json.loads(job_path.read_text(encoding="utf-8"))
    src = job_path.parent
    notes: list[str] = []
    out = out or (src / "pack")
    if out.exists():
        if not (out / MARKER).exists() and any(out.iterdir()):
            raise SystemExit(f"{out} exists and was not created by the converter; refusing to overwrite it")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / MARKER).write_text("generated by bhmconv; this folder is rebuilt on every conversion\n", encoding="utf-8")

    mobs: dict = {}
    for f in job.get("mobs_yaml", []):
        mobs.update(yaml.safe_load((src / f).read_text(encoding="utf-8")) or {})
    skills: dict = {}
    for f in job.get("skills_yaml", []):
        skills.update(yaml.safe_load((src / f).read_text(encoding="utf-8")) or {})

    specs = _entity_specs(job)
    for spec in specs:
        if spec["mob"] not in mobs:
            raise SystemExit(f"mob '{spec['mob']}' not found in {job.get('mobs_yaml')}")
    # Summons of mobs converted in this job map to their entities automatically.
    mob_types = {sp["mob"]: {"type": _entity_id(sp, src)} for sp in specs[1:]}
    mob_types.update(job.get("mob_types", {}))

    built = [build_entity(spec, job, src, out, mobs, skills, mob_types) for spec in specs]
    main = built[0]
    for b in built:
        notes += [f"[{b['boss']}] {n}" for n in b["notes"]] if len(built) > 1 else b["notes"]

    scripts = out / "BP" / "scripts"
    idents = [_ident(b["boss"]) for b in built]
    _write(scripts / "bosses" / "index.js",
           "// GENERATED by bhmconv — every boss and minion in this pack.\n"
           + "".join(f'import {i} from "./{b["boss"]}.js";\n' for i, b in zip(idents, built))
           + f"\nexport default [{', '.join(idents)}];\n")
    pack = _pack_identity(job, job_path, main["display"], notes)
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
    rp = out / "RP"
    _write(rp / "texts" / "en_US.lang", "".join(
        f"entity.{b['entity_id']}.name={b['display']}\nitem.spawn_egg.entity.{b['entity_id']}.name=Spawn {b['display']}\n"
        for b in built))
    _write(rp / "texts" / "languages.json", '["en_US"]\n')

    # ---------------- report ----------------
    report = out.parent / f"{job['boss']}.report.md"
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
    lines += ["## Notes, skips and approximations", "", *[f"- {n}" for n in notes], ""]
    _write(report, "\n".join(lines))
    return report


def build_entity(spec: dict, job: dict, src: Path, out: Path, mobs: dict, skills: dict, mob_types: dict) -> dict:
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
    action_anims = {k: v for k, v in client_anims.items() if v in all_anims}
    skel = Skeleton.from_geo(geo, client["minecraft:client_entity"]["description"].get("geometry", {}).get("default"))

    # ---------------- YAML → config ----------------
    ctx = Context(
        anims=set(action_anims),
        bones=set(skel.bones),
        mob_types=mob_types,
        sounds=job.get("sounds", {}),
        bone_aliases=spec.get("bone_aliases", {}),
        blades=set(spec.get("blades", [])),
        particles=job.get("particles", {}),
        bullets=job.get("bullets", {}),
    )
    ctx.base_states["idle"].append("idle") if "idle" in action_anims else None
    ctx.base_states["walk"].append("walk") if "walk" in action_anims else None
    tb = translate_boss(spec["mob"], mobs[spec["mob"]], skills, ctx)
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
               f"// GENERATED by bhmconv {__version__} from {anim_names} — do not edit.\n"
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
        ai = {"default": "frozen" if tb["noAI"] else "chase", "targetRange": tb["targetRange"], "vanillaMelee": False,
              **({"faceTarget": False} if tb["noAI"] else {}),
              **({"stopDistance": tuning["stop_distance"]} if "stop_distance" in tuning else {})}
        if tb["noAI"]:
            notes.append("NoAI → ai.default frozen, faceTarget false (effect entity)")
    config = {
        "schemaVersion": 1,
        "id": entity_id,
        "kind": kind,
        "display": {"name": tb["display"], **({"bossBar": True} if kind == "boss" else {})},
        "stats": {"health": tb["health"], "scale": 1,
                  **({"movementSpeed": movement_speed(behavior)} if movement_speed(behavior) else {}),
                  **({"damageMultiplier": tuning["damage_multiplier"]} if "damage_multiplier" in tuning else {}),
                  **({"ignoreDifficulty": True} if tuning.get("ignore_difficulty") else {})},
        **({"invulnerable": True} if tb["invincible"] else {}),
        **({"variables": tb["variables"]} if tb["variables"] else {}),
        "animations": Raw("anims"),
        "restPose": Raw("rest"),
        "baseStates": ctx.base_states,
        "ai": ai,
        "threat": {"enabled": tb["threat"]},
        **({"death": death_cfg} if death_cfg else {}),
        **({"damageModifiers": tb["damageModifiers"]} if tb["damageModifiers"] else {}),
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
    bp_entity = patch_behavior(behavior, len(idle), len(walk), tb["bossBarRange"], notes, tb["display"],
                               kind=kind, identifier=ident_override, tint=ctx.uses_tint)
    _write(out / "BP" / "entities" / f"{boss}.json", json.dumps(bp_entity, indent=2))
    rp = out / "RP"
    _write(rp / "entity" / f"{boss}.entity.json",
           json.dumps(patch_client_entity(client, boss, notes, identifier=ident_override, tint=ctx.uses_tint), indent=2))
    if ctx.uses_tint:
        _write(rp / "render_controllers" / f"{boss}.bhm_tint.render_controllers.json", json.dumps(build_tint_controller(boss), indent=2))
    _write(rp / "animation_controllers" / f"{boss}.bhm_base.animation_controller.json",
           json.dumps(build_base_controller(boss, idle, walk), indent=2))
    shutil.copyfile(src / spec["geometry"], _mk(rp / "models" / "entity" / Path(spec["geometry"]).name))
    for f in anim_names:
        shutil.copyfile(src / f, _mk(rp / "animations" / Path(f).name))
    for f in spec.get("animation_controllers", []):
        shutil.copyfile(src / f, _mk(rp / "animation_controllers" / Path(f).name))
    for f, dest in spec.get("textures", {}).items():
        shutil.copyfile(src / f, _mk(rp / dest))

    return {"boss": boss, "kind": kind, "entity_id": entity_id, "display": tb["display"], "notes": notes,
            "requires": requires, "skill_count": len(tb["skills"]), "anim_count": len(action_anims),
            "bones": bake_bones, "idle": idle, "walk": walk}


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
    ap.add_argument("--job", required=True, type=Path, help="job JSON describing the boss sources")
    ap.add_argument("--out", type=Path, default=None, help="output pack folder (default: <job folder>/pack)")
    args = ap.parse_args(argv)
    report = convert(args.job, args.out)
    print(f"[bhmconv] done -> {args.out or args.job.parent / 'pack'}  (report: {report})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
