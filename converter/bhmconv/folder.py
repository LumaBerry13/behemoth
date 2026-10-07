"""Folder mode: turn a prepared boss folder into a conversion job (docs/converting.md).

    <Boss>/
      *.yml                 MythicMobs files (mobs and metaskills, any names, any number)
      <MOB_ID>/             one folder per mob to convert, named after its MythicMobs id
        *.json              behavior entity, client entity, geometry, animation file(s) — found by content
        *.png               the client entity's texture(s); optional bossbar.png
      sounds/               optional .ogg files (growl_1.ogg + growl_2.ogg = one sound "growl")
      pack_icon.png         optional
      behemoth.json         optional settings; the converter adds the pack's UUIDs here on the first run

Nothing in the folder is changed except behemoth.json (UUIDs are written once and must stay stable).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

import yaml

SKIP_DIRS = {"pack", "dist", "sounds", "output", ".git"}
SETTINGS = "behemoth.json"
MOB_KEYS = ("Type", "Display", "Health", "Options", "Damage", "Modules", "BossBar", "Faction")


def _load_json(p: Path) -> Any:
    text = re.sub(r"^\s*//.*$", "", p.read_text(encoding="utf-8-sig"), flags=re.M)
    return json.loads(text)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", s.lower()).strip("_") or "boss"


def read_yaml(folder: Path) -> tuple[dict, dict, str, list[str]]:
    """All MythicMobs YAML in the folder (not in mob folders): mobs, metaskills, raw text, file names."""
    mobs: dict = {}
    skills: dict = {}
    texts, names = [], []
    for f in sorted(list(folder.glob("*.yml")) + list(folder.glob("*.yaml"))):
        text = f.read_text(encoding="utf-8")
        data = yaml.safe_load(text) or {}
        if not isinstance(data, dict):
            continue
        texts.append(text)
        names.append(f.name)
        for key, value in data.items():
            if isinstance(value, dict) and any(k in value for k in MOB_KEYS):
                mobs[str(key)] = value
            else:
                skills[str(key)] = value
    return mobs, skills, "\n".join(texts), names


def scan_entity(folder: Path) -> dict:
    """Classify a mob folder's files by content."""
    found: dict[str, Any] = {"behavior": None, "client_entity": None, "geometry": None, "animations": [],
                             "animation_controllers": [], "pngs": [], "bossbar": None}
    for f in sorted(folder.rglob("*")):
        if not f.is_file():
            continue
        if f.suffix.lower() == ".png":
            if f.stem.lower() == "bossbar":
                found["bossbar"] = f
            else:
                found["pngs"].append(f)
            continue
        if f.suffix.lower() != ".json":
            continue
        try:
            data = _load_json(f)
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if "minecraft:entity" in data:
            found["behavior"] = f
        elif "minecraft:client_entity" in data:
            found["client_entity"] = f
        elif "minecraft:geometry" in data:
            found["geometry"] = f
        elif "animation_controllers" in data:
            found["animation_controllers"].append(f)
        elif "animations" in data:
            found["animations"].append(f)
    return found


def build_job(folder: Path) -> tuple[dict, Callable[[dict], None], list[str]]:
    """Returns the job, a function that saves the pack identity into behemoth.json, and problems
    that stop the conversion (empty list = fine)."""
    problems: list[str] = []
    settings_path = folder / SETTINGS
    settings: dict = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
    mobs, skills, text, yaml_names = read_yaml(folder)
    if not yaml_names:
        problems.append("no MythicMobs .yml files next to the mob folders")
    lower = {m.lower(): m for m in mobs}
    mob_settings: dict = {str(k).lower(): v for k, v in (settings.get("mobs") or {}).items()}

    specs = []
    for d in sorted(p for p in folder.iterdir() if p.is_dir() and p.name.lower() not in SKIP_DIRS):
        found = scan_entity(d)
        if not found["geometry"] and not found["client_entity"]:
            continue  # not a mob folder
        mob = lower.get(d.name.lower())
        if not mob:
            problems.append(f"folder '{d.name}' does not match a MythicMobs mob id (mobs in the YAML: {', '.join(sorted(mobs)) or 'none'})")
            continue
        before = len(problems)
        for key in ("behavior", "client_entity", "geometry"):
            if not found[key]:
                problems.append(f"{d.name}/: no {key.replace('_', ' ')} file found")
        if not found["animations"]:
            problems.append(f"{d.name}/: no animation file found")
        if len(problems) > before:
            continue
        client = _load_json(found["client_entity"])
        textures = {}
        for path in (client["minecraft:client_entity"]["description"].get("textures") or {}).values():
            stem = Path(path).name
            png = next((p for p in found["pngs"] if p.stem == stem), None)
            if png is None and len(found["pngs"]) == 1:
                png = found["pngs"][0]
            if png is None:
                problems.append(f"{d.name}/: texture '{path}' — put {stem}.png in the folder")
                continue
            textures[str(png.relative_to(folder)).replace("\\", "/")] = f"{path}.png"
        ms = mob_settings.get(mob.lower(), {})
        rel = lambda p: str(p.relative_to(folder)).replace("\\", "/")  # noqa: E731
        specs.append({
            "boss": _slug(d.name), "mob": mob, "auto": True, "link_all_animations": True,
            "behavior": rel(found["behavior"]), "client_entity": rel(found["client_entity"]),
            "geometry": rel(found["geometry"]), "animations": [rel(a) for a in found["animations"]],
            "animation_controllers": [rel(a) for a in found["animation_controllers"]], "textures": textures,
            **({"bossbar": rel(found["bossbar"])} if found["bossbar"] else {}),
            **{k: ms[k] for k in ("identifier", "bone_aliases", "blades", "always_animate", "tuning") if k in ms},
        })
    if not specs and not problems:
        problems.append("no mob folders found (a folder named after a MythicMobs mob id, holding its Bedrock files)")
    if problems:
        return {}, lambda j: None, problems

    # The boss: settings, else the mob nobody else summons, else the one with the most health.
    boss_id = settings.get("boss")
    if boss_id and not any(s["mob"].lower() == str(boss_id).lower() for s in specs):
        return {}, lambda j: None, [f"behemoth.json boss '{boss_id}' has no mob folder"]
    if not boss_id:
        ids = [s["mob"] for s in specs]
        summoned = {m for m in ids if re.search(r"summon\{[^}]*(?:type|t|mob|m)=" + re.escape(m) + r"[;}]", text, re.I)}
        candidates = [m for m in ids if m not in summoned] or ids
        boss_id = max(candidates, key=lambda m: float(mobs[m].get("Health", 0) or 0))
    main = next(s for s in specs if s["mob"].lower() == str(boss_id).lower())
    minions = [dict(s, kind="minion") for s in specs if s is not main]

    pack = dict(settings.get("pack") or {})
    pack.setdefault("name", str(mobs[main["mob"]].get("Display", main["mob"])).strip("'\""))
    pack.setdefault("id", _slug(pack["name"]))
    job = {
        "auto": True,
        "pack": pack,
        **{k: v for k, v in main.items()},
        "kind": "boss",
        "mobs_data": mobs,
        "skills_data": skills,
        "mobs_yaml": yaml_names,
        "skills_yaml": [],
        "yaml_text": text,
        "minions": minions,
        **({"pack_icon": "pack_icon.png"} if (folder / "pack_icon.png").exists() else {}),
        **({"sound_files": {"folder": "sounds", "auto": True, "dest": pack["id"]}} if (folder / "sounds").is_dir() else {}),
        **{k: settings[k] for k in ("tuning", "bullets", "particles", "mob_types", "sounds") if k in settings},
    }
    if "tuning" in main:
        job["tuning"] = {**job.get("tuning", {}), **main["tuning"]}

    def save(j: dict) -> None:
        settings["pack"] = j["pack"]
        settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8", newline="\n")

    return job, save, []
