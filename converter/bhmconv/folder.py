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


# behemoth.json: every editable entry, in file order (docs/converting.md section 7). Empty values
# ("", null, {}, []) mean "not set"; the converter writes all of them so the file shows what can be set.
PACK_KEYS = ("name", "id", "version", "uuids")
MOB_TEMPLATE: dict[str, Any] = {"identifier": "", "bone_aliases": {}, "blades": [], "always_animate": [], "tuning": {}}
BOSSBAR_TEMPLATE: dict[str, Any] = {"width": None, "scale": None, "x": 0, "y": 0}
TUNING_TEMPLATE: dict[str, Any] = {
    "damage_multiplier": None, "ignore_difficulty": False, "stop_distance": None, "leash_range": None,
    "reset_after_no_players": None, "randomskill_mode": "", "trigger_overrides": {}, "option_overrides": {},
    "extra_lines": {}, "extra_lines_enabled": True,
}
TEMPLATE: dict[str, Any] = {"pack": {}, "boss": "", "mobs": {}, "tuning": TUNING_TEMPLATE, "particles": {},
                            "items": {}, "sounds": {}, "mob_types": {}, "bullets": {}}
HELP = ("Behemoth converter settings: see docs/converting.md section 7. Empty values (empty text, null, {}, []) "
        "are ignored. Never change pack.uuids.")


def _empty(v: Any) -> bool:
    return v is None or v == "" or v == {} or v == []


def _drop_empty(d: dict) -> dict:
    """Settings without empty values, recursively through objects (lists are kept as they are)."""
    out = {}
    for k, v in d.items():
        if k == "_help":
            continue
        if isinstance(v, dict):
            v = _drop_empty(v)
        if not _empty(v):
            out[k] = v
    return out


def _copy(v: Any) -> Any:
    return json.loads(json.dumps(v))


def with_template(settings: dict, mob_ids: list[str], boss: str) -> dict:
    """The user's settings (kept as they are) plus every missing editable entry, empty."""
    out: dict = {"_help": HELP}
    for key, default in TEMPLATE.items():
        value = settings.get(key, _copy(default))
        if key == "tuning" and isinstance(value, dict):
            value = {**_copy(TUNING_TEMPLATE), **value}
        if key == "mobs" and isinstance(value, dict):
            value = dict(value)
            for mob in mob_ids:
                have = next((k for k in value if k.lower() == mob.lower()), mob)
                entry = {**_copy(MOB_TEMPLATE), **(value.get(have) or {})}
                if mob == boss:
                    entry["bossbar_layout"] = {**_copy(BOSSBAR_TEMPLATE), **(entry.get("bossbar_layout") or {})}
                value[have] = entry
        out[key] = value
    return out


def check_settings(settings: dict) -> list[str]:
    """Entries in the wrong place or misspelled (they would be ignored silently otherwise)."""
    problems = []
    for key in settings:
        if key not in TEMPLATE and key != "_help":
            problems.append(f"behemoth.json: unknown entry '{key}' (entries: {', '.join(TEMPLATE)})")
    for key in settings.get("pack") or {}:
        if key not in PACK_KEYS:
            where = "at the top level" if key in TEMPLATE else "nowhere (unknown entry)"
            problems.append(f"behemoth.json: '{key}' is inside 'pack' but belongs {where}")
    for mob, ms in (settings.get("mobs") or {}).items():
        for key in ms or {}:
            if key not in MOB_TEMPLATE and key != "bossbar_layout":
                problems.append(f"behemoth.json: mobs.{mob} has an unknown entry '{key}' "
                                f"(entries: {', '.join([*MOB_TEMPLATE, 'bossbar_layout'])})")
    for key in settings.get("tuning") or {}:
        if key not in TUNING_TEMPLATE:
            problems.append(f"behemoth.json: tuning has an unknown entry '{key}' (entries: {', '.join(TUNING_TEMPLATE)})")
    return problems


def build_job(folder: Path) -> tuple[dict, Callable[[dict], None], list[str]]:
    """Returns the job, a function that saves the pack identity into behemoth.json, and problems
    that stop the conversion (empty list = fine)."""
    settings_path = folder / SETTINGS
    raw_settings: dict = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
    problems: list[str] = check_settings(raw_settings)
    settings = _drop_empty(raw_settings)
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
            **{k: ms[k] for k in ("identifier", "bone_aliases", "blades", "always_animate", "tuning", "bossbar_layout") if k in ms},
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
    # Colour codes (&5, §5) belong to the in-game name, not to the pack name or id.
    pack.setdefault("name", re.sub(r"[&§][0-9a-fk-or]", "", str(mobs[main["mob"]].get("Display", main["mob"]))).strip("'\" "))
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
        **{k: settings[k] for k in ("tuning", "bullets", "particles", "mob_types", "sounds", "items") if k in settings},
    }
    if "tuning" in main:
        job["tuning"] = {**job.get("tuning", {}), **main["tuning"]}

    def save(j: dict) -> None:
        out = with_template(raw_settings, [sp["mob"] for sp in specs], main["mob"])
        out["pack"] = {**(out.get("pack") or {}), **j["pack"]}
        settings_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8", newline="\n")

    return job, save, []
