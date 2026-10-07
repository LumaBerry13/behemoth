"""MythicMobs YAML → Behemoth boss config (design doc §8, §12).

Parses MythicMobs skill-line syntax:
    mechanic{k=v;k2=v2} @targeter{k=v} ~trigger:arg ?condition ?!condition 0.5 <50%
    delay 20
and condition lines:
    targetwithin{d=20} true
    varequals{var=caster.x;val=1} castinstead other_skill
and translates them into Behemoth skill lines ({m, o, t, if, delay, repeat, cooldown}).
Inline skill lists (oH=[ - damage{a=1} - throw{v=2} ]) become generated skills.
Anything without a Bedrock equivalent is skipped and reported, never guessed silently.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #


def split_top(s: str, sep: str) -> list[str]:
    """Split on `sep` outside {} / [] / () and quotes."""
    out, depth, cur, quote = [], 0, [], None
    for ch in s:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        if ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x for x in (p.strip() for p in out) if x]


def parse_value(v: str) -> Any:
    v = v.strip()
    if v.startswith("["):
        return v  # inline skill list, kept raw
    v = v.strip("\"'")
    low = v.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v


def parse_call(token: str) -> tuple[str, dict[str, Any]]:
    """'name{a=1;b=x}' → ('name', {'a': 1, 'b': 'x'}). Keys are lowercased."""
    m = re.match(r"^([^{\[]+)(?:[{\[](.*)[}\]])?$", token.strip(), re.S)
    if not m:
        return token.strip(), {}
    name, body = m.group(1).strip(), m.group(2)
    opts: dict[str, Any] = {}
    if body:
        for part in split_top(body, ";"):
            if "=" in part:
                k, v = part.split("=", 1)
                opts[k.strip().lower()] = parse_value(v)
            else:
                opts[part.strip().lower()] = True
    return name, opts


@dataclass
class SkillLine:
    raw: str
    mechanic: str
    options: dict[str, Any]
    targeter: tuple[str, dict[str, Any]] | None = None
    trigger: tuple[str, str | None] | None = None
    extras: list[str] = field(default_factory=list)
    conditions: list[tuple[str, bool]] = field(default_factory=list)  # inline ?cond / ?!cond (text, negated)
    chance: float | None = None
    health: str | None = None  # mob lines: "<75%" health modifier


def parse_skill_line(line: str) -> SkillLine:
    tokens = split_top(line.strip(), " ")
    if not tokens:
        raise ValueError("empty skill line")
    name, opts = parse_call(tokens[0])
    sl = SkillLine(raw=line.strip(), mechanic=MECHANIC_ALIASES.get(name.lower(), name), options=opts)
    rest = tokens[1:]
    if name.lower() == "delay" and rest and re.fullmatch(r"\d+", rest[0]):
        sl.options = {"ticks": int(rest[0])}
        rest = rest[1:]
    for tok in rest:
        if tok.startswith("@"):
            sl.targeter = parse_call(tok[1:])
        elif tok.startswith("~"):
            t = tok[1:]
            n, _, arg = t.partition(":")
            sl.trigger = (n, arg or None)
        elif tok.startswith("?"):
            body = tok[1:]
            if body.startswith("~"):
                sl.extras.append(tok)  # trigger conditions: reported
            elif body.startswith("!"):
                sl.conditions.append((body[1:], True))
            else:
                sl.conditions.append((body, False))
        elif re.fullmatch(r"\d*\.\d+|1|0", tok):
            sl.chance = float(tok)
        elif re.fullmatch(r"[<>]=?\d+(\.\d+)?%", tok):
            sl.health = tok
        else:
            sl.extras.append(tok)
    return sl


@dataclass
class ConditionLine:
    raw: str
    name: str
    options: dict[str, Any]
    expect: bool = True
    action: tuple[str, str] | None = None  # ("castInstead" | "orElseCast", skill)


def parse_condition_line(line: str) -> ConditionLine:
    tokens = split_top(line.strip(), " ")
    name, opts = parse_call(tokens[0])
    expect = True
    action = None
    rest = tokens[1:]
    i = 0
    while i < len(rest):
        tok = rest[i].lower()
        if tok in ("true", "false"):
            expect = tok == "true"
        elif tok in ("castinstead", "orelsecast") and i + 1 < len(rest):
            action = ("castInstead" if tok == "castinstead" else "orElseCast", rest[i + 1])
            i += 1
        i += 1
    return ConditionLine(raw=line.strip(), name=name, options=opts, expect=expect, action=action)


# --------------------------------------------------------------------------- #
# Translation context
# --------------------------------------------------------------------------- #

MM_DAMAGE_CAUSES = {
    "SUFFOCATION": "suffocation", "FALL": "fall", "PROJECTILE": "projectile", "FIRE": "fire",
    "FIRE_TICK": "fireTick", "FREEZE": "freezing", "LAVA": "lava", "ENTITY_ATTACK": "entityAttack",
    "ENTITY_SWEEP_ATTACK": "entityAttack", "BLOCK_EXPLOSION": "blockExplosion",
    "ENTITY_EXPLOSION": "entityExplosion", "MAGIC": "magic", "LIGHTNING": "lightning",
    "DROWNING": "drowning", "WITHER": "wither", "CONTACT": "contact", "VOID": "void", "THORNS": "thorns",
    "STARVATION": "starve", "FALLING_BLOCK": "fallingBlock", "HOT_FLOOR": "magma", "CAMPFIRE": "campfire",
    "FLY_INTO_WALL": "flyIntoWall", "SONIC_BOOM": "sonicBoom", "FREEZING": "freezing",
    # Bedrock has no poison cause: poison deals magic damage (so this also covers harming potions).
    "POISON": "magic",
}

MM_POTIONS = {
    "SLOW": "slowness", "SLOWNESS": "slowness", "SPEED": "speed", "FAST_DIGGING": "haste",
    "SLOW_DIGGING": "mining_fatigue", "INCREASE_DAMAGE": "strength", "STRENGTH": "strength",
    "HEAL": "instant_health", "HARM": "instant_damage", "JUMP": "jump_boost", "CONFUSION": "nausea",
    "NAUSEA": "nausea", "REGENERATION": "regeneration", "DAMAGE_RESISTANCE": "resistance",
    "FIRE_RESISTANCE": "fire_resistance", "WATER_BREATHING": "water_breathing",
    "INVISIBILITY": "invisibility", "BLINDNESS": "blindness", "NIGHT_VISION": "night_vision",
    "HUNGER": "hunger", "WEAKNESS": "weakness", "POISON": "poison", "WITHER": "wither",
    "HEALTH_BOOST": "health_boost", "ABSORPTION": "absorption", "SATURATION": "saturation",
    "LEVITATION": "levitation", "SLOW_FALLING": "slow_falling", "DARKNESS": "darkness",
}

# Java particle names → Bedrock particle ids (vanilla). Unknown names fall back to
# DEFAULT_PARTICLE and are reported; jobs can override with "particles".
MM_PARTICLES = {
    "flame": "minecraft:basic_flame_particle", "soul_fire_flame": "minecraft:blue_flame_particle",
    "smoke": "minecraft:basic_smoke_particle", "large_smoke": "minecraft:large_explosion",
    "explosion": "minecraft:large_explosion", "explosion_large": "minecraft:large_explosion",
    "explosion_huge": "minecraft:huge_explosion_emitter", "explosion_emitter": "minecraft:huge_explosion_emitter",
    "crit": "minecraft:critical_hit_emitter", "crit_magic": "minecraft:critical_hit_emitter",
    "reddust": "bhm:dust", "dust": "bhm:dust", "redstone": "bhm:dust", "dust_color_transition": "bhm:dust_transition",
    "portal": "minecraft:portal_directional", "cloud": "minecraft:evaporation_elephant_toothpaste_vapor_particle",
    "poof": "minecraft:evaporation_elephant_toothpaste_vapor_particle",
    "heart": "minecraft:heart_particle", "villager_happy": "minecraft:villager_happy",
    "happy_villager": "minecraft:villager_happy", "villager_angry": "minecraft:villager_angry",
    "angry_villager": "minecraft:villager_angry", "lava": "minecraft:lava_particle",
    "dripwater": "minecraft:water_drip_particle", "spell": "minecraft:mobspell_emitter",
    "witch": "minecraft:witchspell_emitter", "snowball": "minecraft:snowflake_particle",
    "end_rod": "minecraft:endrod", "totem": "minecraft:totem_particle", "sonic_boom": "minecraft:sonic_explosion",
    "sweep_attack": "minecraft:critical_hit_emitter", "block_crack": "bhm:dust", "block": "bhm:dust",
    "blockcrack": "bhm:dust", "blockdust": "bhm:dust", "block_dust": "bhm:dust", "falling_dust": "bhm:dust",
    "falling_obsidian_tear": "bhm:dust", "dripping_obsidian_tear": "bhm:dust", "ash": "bhm:dust", "white_ash": "bhm:dust",
    "sculk_soul": "bhm:glow", "soul": "bhm:glow",
    "flash": "bhm:flash", "glow": "bhm:glow", "electric_spark": "bhm:spark", "wax_on": "bhm:spark",
    "reverse_portal": "minecraft:portal_reverse_particle", "campfire_cosy_smoke": "minecraft:campfire_smoke_particle",
    "campfire_signal_smoke": "minecraft:campfire_tall_smoke_particle", "dragon_breath": "minecraft:dragon_breath_trail",
    "soul_fire": "minecraft:blue_flame_particle", "enchant": "minecraft:enchanting_table_particle",
    "enchantment_table": "minecraft:enchanting_table_particle", "note": "minecraft:note_particle",
    "squid_ink": "minecraft:ink_emitter", "nautilus": "minecraft:conduit_particle", "sneeze": "minecraft:sneeze",
}
DEFAULT_PARTICLE = "minecraft:basic_flame_particle"

# Java vanilla sound names → Bedrock sound events (common ones; behemoth.json "sounds" maps the rest).
JAVA_SOUNDS = {
    "entity.ender_dragon.flap": "mob.enderdragon.flap", "entity.ender_dragon.growl": "mob.enderdragon.growl",
    "entity.lightning_bolt.impact": "ambient.weather.lightning.impact", "entity.lightning_bolt.thunder": "ambient.weather.thunder",
    "entity.zombie.attack_iron_door": "mob.zombie.metal", "entity.zombie.break_wooden_door": "mob.zombie.woodbreak",
    "entity.generic.explode": "random.explode", "entity.wither.spawn": "mob.wither.spawn",
    "entity.wither.shoot": "mob.wither.shoot", "entity.wither.ambient": "mob.wither.ambient",
    "entity.blaze.shoot": "mob.blaze.shoot", "entity.ravager.roar": "mob.ravager.roar",
    "entity.warden.sonic_boom": "mob.warden.sonic_boom", "entity.evoker.cast_spell": "mob.evocation_illager.cast_spell",
    "entity.enderman.teleport": "mob.endermen.portal", "entity.arrow.shoot": "random.bow",
    "entity.item.break": "random.break", "entity.experience_orb.pickup": "random.orb",
    "entity.firework_rocket.blast": "firework.blast", "block.anvil.land": "random.anvil_land",
    "block.glass.break": "random.glass", "entity.iron_golem.attack": "mob.irongolem.throw",
}

# Java entity types → Bedrock ids for `shoot`.
MM_SHOOT_TYPES = {"ARROW": "minecraft:arrow", "SNOWBALL": "minecraft:snowball", "EGG": "minecraft:egg",
                  "SMALL_FIREBALL": "minecraft:small_fireball", "FIREBALL": "minecraft:fireball",
                  "WITHER_SKULL": "minecraft:wither_skull", "TRIDENT": "minecraft:thrown_trident",
                  "DRAGON_FIREBALL": "minecraft:dragon_fireball", "SHULKER_BULLET": "minecraft:shulker_bullet"}

# Java entity types a MythicMobs `summon{t=ZOMBIE}` may name (Bedrock uses the same ids). Any other
# all-caps name is a MythicMobs mob from a file not given to the converter, never a vanilla type.
VANILLA_MOBS = {
    "zombie", "husk", "drowned", "skeleton", "stray", "wither_skeleton", "bogged", "spider", "cave_spider", "creeper",
    "blaze", "vex", "silverfish", "endermite", "phantom", "wolf", "pig", "cow", "sheep", "chicken", "bat", "slime",
    "magma_cube", "ghast", "enderman", "piglin", "piglin_brute", "zombified_piglin", "evoker", "vindicator", "pillager",
    "ravager", "witch", "iron_golem", "snow_golem", "guardian", "elder_guardian", "shulker", "armor_stand",
    "lightning_bolt", "tnt", "fireball", "small_fireball", "arrow", "bee", "fox", "polar_bear", "hoglin", "zoglin",
    "strider", "warden", "allay", "breeze", "creaking", "goat", "frog", "llama", "horse", "rabbit", "cat", "parrot",
}

# Other spellings of a mechanic (MythicMobs accepts both).
MECHANIC_ALIASES = {"effect:sound": "sound", "e:sound": "sound", "e:s": "sound", "s": "sound",
                    "partvisibility": "partvis", "effect:partvisibility": "partvis",
                    "removepotion": "potionclear", "clearpotions": "potionclear", "dropitems": "dropitem"}

# Mechanics that only drive ModelEngine / Java behaviour — no Bedrock equivalent needed.
SKIPPED_MECHANICS = {
    "model": "ModelEngine model attach — the Bedrock entity already uses the model",
    "bodyclamp": "ModelEngine body/head clamp — not available on Bedrock",
    "cancelevent": "cancels vanilla melee; the Bedrock stub has no vanilla attack behaviour",
    "brightness": "ModelEngine brightness — set emissive textures in the RP instead (L37)",
    "effect:blockmask": "client-side block mask — no Bedrock equivalent",
    "blockmask": "client-side block mask — no Bedrock equivalent",
}

# Option keys that name a skill (or hold an inline skill list).
SKILL_KEYS = {"onhit": "onHit", "oh": "onHit", "ontick": "onTick", "ot": "onTick", "onstart": "onStart",
              "os": "onStart", "onend": "onEnd", "oe": "onEnd", "locationskill": "locationSkill",
              "ls": "locationSkill", "entityskill": "entitySkill", "es": "entitySkill"}


@dataclass
class Context:
    """Everything the translator needs to resolve names, plus the report."""

    anims: set[str]
    bones: set[str]
    mob_types: dict[str, dict[str, Any]]
    sounds: dict[str, str]
    bone_aliases: dict[str, str]
    blades: set[str] = field(default_factory=set)  # bones whose hits use a hilt->tip capsule
    particles: dict[str, str] = field(default_factory=dict)  # job overrides for MM particle names
    bullets: dict[str, str] = field(default_factory=dict)  # job: projectile bullet model/material → entity id
    items: dict[str, str] = field(default_factory=dict)  # job: MythicMobs item name → Bedrock item id (dropitem)
    base_damage: float = 1.0  # the mob's Damage (basedamage multiplies it)
    notes: list[str] = field(default_factory=list)
    used_mechanics: set[str] = field(default_factory=set)
    used_bones: set[str] = field(default_factory=set)
    uses_tint: bool = False
    mm_mobs: set[str] = field(default_factory=set)  # every mob id in the MythicMobs YAML (never vanilla entity types)
    always: set[str] = field(default_factory=set)  # job always_animate: looping layers played by the RP, not by skills
    parts: list[str] = field(default_factory=list)  # bones hidden/shown by partVisibility (config.parts)
    grab_durations: dict[str, int] = field(default_factory=dict)  # "<skill>[<line>]" → ticks a MountModel lasts
    base_states: dict[str, list[str]] = field(default_factory=lambda: {"idle": [], "walk": []})
    extra_skills: dict[str, Any] = field(default_factory=dict)  # generated from inline skill lists

    def note(self, where: str, msg: str) -> None:
        self.notes.append(f"{where}: {msg}")


def _opt(opts: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for k in keys:
        if k in opts:
            return opts[k]
    return default


def _ticks(v: Any) -> int:
    return int(round(float(v)))


def _num(v: Any) -> Any:
    """Number, or a string that still contains <placeholders> (resolved at run time)."""
    if isinstance(v, str) and "<" in v:
        return v
    return float(v)


def _txt(v: Any) -> str:
    """Option value as Behemoth text (Python True → "true")."""
    return str(v).lower() if isinstance(v, bool) else str(v)


def _var(name: Any) -> str:
    """MythicMobs variable name → Behemoth (world scope → global)."""
    n = str(name)
    return "global." + n[6:] if n.lower().startswith("world.") else n


def _particle(ctx: "Context", name: Any, where: str) -> str:
    n = str(name or "").lower().replace("minecraft:", "")
    if str(name) in ctx.particles:
        return ctx.particles[str(name)]
    if ":" in str(name):
        return str(name)
    if n in MM_PARTICLES:
        return MM_PARTICLES[n]
    ctx.note(where, f"particle '{name}' has no Bedrock mapping; using {DEFAULT_PARTICLE} (job \"particles\" can map it)")
    return DEFAULT_PARTICLE


def _mm_color(v: Any) -> str | None:
    """MythicMobs colour ("#00ffff", "00ffff" or "255,0,0") → "#RRGGBB"."""
    s = str(v).strip().strip("\"'")
    if re.fullmatch(r"#?[0-9a-fA-F]{6}", s):
        return "#" + s.lstrip("#").upper()
    parts = [x.strip() for x in s.split(",")]
    if len(parts) == 3 and all(x.isdigit() for x in parts):
        return "#" + "".join(f"{min(255, int(x)):02X}" for x in parts)
    return None


# Default colours for MythicMobs particles mapped to bhm:dust (block particles by material).
PARTICLE_COLORS = {"falling_obsidian_tear": "#8A2BE2", "dripping_obsidian_tear": "#8A2BE2", "ash": "#3A3A3A",
                   "white_ash": "#D8D8D8", "sculk_soul": "#2AD4E0"}
BLOCK_COLORS = {"crying_obsidian": "#5A1A8C", "obsidian": "#1A1028", "nether_wart": "#7A0E0E", "redstone_block": "#B00000",
                "netherrack": "#6E2B2B", "stone": "#7A7A7A", "dirt": "#6B4A2F", "grass_block": "#5E8F3A", "sand": "#D9C98F",
                "snow_block": "#F2F6F8", "ice": "#9CC3F0", "bone_block": "#E6E0C8", "soul_sand": "#4F3A2B", "blackstone": "#2A2329",
                "gold_block": "#F2D23C", "magma_block": "#C2451C", "slime_block": "#6FC25B", "wither_rose": "#20201C"}
MAX_PARTICLE_COUNT = 40


def _particle_opts(ctx: "Context", o: dict[str, Any], where: str) -> dict[str, Any]:
    """`particle` plus the framework particle library options (colour, size) when the
    MythicMobs particle maps to a bhm:* particle (dust, dust_color_transition, ...)."""
    mm_name = str(_opt(o, "particle", "p", default="flame")).lower().replace("minecraft:", "")
    pid = _particle(ctx, _opt(o, "particle", "p", default="flame"), where)
    out: dict[str, Any] = {"particle": pid}
    if not pid.startswith("bhm:"):
        return out
    material = str(_opt(o, "material", "m", "b", "block", default="")).lower().replace("minecraft:", "")
    if material and material in BLOCK_COLORS:
        out["color"] = BLOCK_COLORS[material]
    elif material:
        out["color"] = "#7A7A7A"
        ctx.note(where, f"block particle material '{material}' drawn as grey dust (add it to BLOCK_COLORS)")
    elif mm_name in PARTICLE_COLORS:
        out["color"] = PARTICLE_COLORS[mm_name]
    for key, mm in (("color", ("color", "color1", "c")), ("color2", ("color2", "tocolor", "c2"))):
        raw = _opt(o, *mm)
        if raw is None:
            continue
        col = _mm_color(raw)
        if col:
            out[key] = col
        else:
            ctx.note(where, f"particle colour '{raw}' could not be read; default colour used")
    if pid in ("bhm:dust", "bhm:dust_transition") and "color" not in out:
        out["color"] = "#FF0000"  # MythicMobs dust defaults to red
    size = _opt(o, "size", "s")
    if isinstance(size, (int, float)) and size > 0 and pid in ("bhm:dust", "bhm:dust_transition", "bhm:glow", "bhm:spark"):
        out["size"] = round(float(size) * 0.1, 3)  # MythicMobs dust size 1 ≈ 0.1 blocks [VERIFY by eye]
    return out


# ModelEngine bone name prefixes (head, mount seat, hitbox, ...): `@modelpart{pid=jaw}` names the
# part without them, the Bedrock geometry keeps them (h_jaw).
ME_PREFIXES = ("h_", "p_", "hi_", "b_", "g_", "l_", "s_", "ih_", "tag_", "seat_")


def resolve_bone(ctx: "Context", pid: str, where: str) -> str:
    """ModelEngine part id → Bedrock bone (job bone_aliases first, then ModelEngine prefixes)."""
    bone = ctx.bone_aliases.get(pid, pid)
    if bone in ctx.bones:
        return bone
    for pre in ME_PREFIXES:
        if pre + pid in ctx.bones:
            ctx.note(where, f"part '{pid}' is the bone '{pre + pid}' (ModelEngine prefix)")
            return pre + pid
    return bone


def _ident(where: str) -> str:
    return re.sub(r"\W+", "_", where).strip("_")


def inline_lines(value: str) -> list[str]:
    """'[ - a{x=1} - b @self ]' → ['a{x=1}', 'b @self']."""
    body = value.strip()
    if body.startswith("["):
        body = body[1:]
    if body.endswith("]"):
        body = body[:-1]
    return split_top(body, "-")


def _skill_ref(v: Any, ctx: "Context", where: str, key: str) -> str:
    """A skill-name option: plain names pass through; inline lists become generated skills."""
    s = str(v).strip()
    if not s.startswith("["):
        return s
    name = f"{_ident(where)}_{key}"
    base, n = name, 2
    while name in ctx.extra_skills:
        name, n = f"{base}_{n}", n + 1
    ctx.extra_skills[name] = {"c": []}  # reserve the name (nested lists)
    lines = []
    for j, raw in enumerate(inline_lines(s)):
        line = translate_line(parse_skill_line(raw), ctx, f"{name}[{j}]")
        if line:
            lines.append(line)
    ctx.extra_skills[name] = {"c": lines}
    return name


# --------------------------------------------------------------------------- #
# Targeters
# --------------------------------------------------------------------------- #

SIMPLE_TARGETERS = {
    "self": "@self", "caster": "@self", "target": "@target", "t": "@target", "trigger": "@trigger",
    "targetlocation": "@TargetLocation", "nearestplayer": "@NearestPlayer",
    "origin": "@Origin", "parent": "@Parent", "spawn": "@Spawn", "spawnlocation": "@Spawn",
}
RADIUS_TARGETERS = {"playersinradius": "PlayersInRadius", "pir": "PlayersInRadius",
                    "entitiesinradius": "EntitiesInRadius", "eir": "EntitiesInRadius",
                    "mobsinradius": "MobsInRadius", "mir": "MobsInRadius",
                    "livinginradius": "EntitiesInRadius", "lir": "EntitiesInRadius"}


def _fmt_opts(o: dict[str, Any]) -> str:
    parts = []
    for k, v in o.items():
        if isinstance(v, float):
            v = round(v, 3)
        parts.append(f"{k}={v}")
    return "{" + ";".join(parts) + "}" if parts else ""


def _bedrock_sound(snd: str, mm: str, ctx: "Context", where: str) -> str:
    """Java vanilla sound names → Bedrock events; reports pack sounds without a file and unknown Java names."""
    if snd in ctx.sounds.values():
        return snd
    plain = snd.removeprefix("minecraft:")
    if plain in JAVA_SOUNDS:
        ctx.note(where, f"Java sound '{mm}' → Bedrock '{JAVA_SOUNDS[plain]}' [VERIFY]")
        return JAVA_SOUNDS[plain]
    if ":" in snd and not snd.startswith("minecraft:"):
        last = re.split(r"[.:]", snd)[-1]
        ctx.note(where, f"sound '{mm}' was not found in sounds/ (expected {last}.ogg, or map it in behemoth.json "
                        f"\"sounds\") — it will be silent")
    elif plain.split(".", 1)[0] in ("entity", "item", "ui", "event", "music", "enchant", "particle"):
        ctx.note(where, f"sound '{mm}' is a Java sound name with no Bedrock mapping; put the Bedrock event in "
                        f"behemoth.json \"sounds\" — it will be silent")
    return snd


def bedrock_item(name: str, ctx: "Context", where: str, what: str) -> str | None:
    """A MythicMobs item name → Bedrock item id: behemoth.json "items" first, then vanilla names
    (DIAMOND, diamond, minecraft:diamond). Custom MythicMobs items without a mapping are reported."""
    item = ctx.items.get(name) or ctx.items.get(name.lower())
    if not item and (name.lower().startswith("minecraft:") or name.islower() or name.isupper()):
        item = name.lower() if ":" in name else f"minecraft:{name.lower()}"
    if not item:
        ctx.note(where, f"{what}: MythicMobs item '{name}' has no Bedrock item; put it in behemoth.json "
                        f"\"items\": {{\"{name}\": \"minecraft:...\"}} — skipped")
    return item


def translate_drops(mob: dict, ctx: "Context", where: str) -> list[dict[str, Any]]:
    """MythicMobs `Drops` lines ("<item> [amount|min-max] [chance]") → config drops (they go into
    the boss's loot chest). Experience, money and drop tables have no Bedrock loot equivalent."""
    out = []
    for raw in mob.get("Drops") or []:
        parts = str(raw).split()
        if not parts:
            continue
        name = parts[0]
        if name.lower() in ("exp", "experience", "xp", "money", "mcmmo-exp", "champions-exp", "heroes-exp", "skillapi-exp"):
            ctx.note(where, f"drop '{raw}' skipped (experience/money has no Bedrock loot item)")
            continue
        item = bedrock_item(name, ctx, where, "drop")
        if not item:
            continue
        drop: dict[str, Any] = {"item": item}
        if len(parts) > 1:
            lo, _, hi = parts[1].partition("-") if "to" not in parts[1] else parts[1].partition("to")
            try:
                drop["amount"] = [int(float(lo)), int(float(hi))] if hi else int(float(lo))
            except ValueError:
                ctx.note(where, f"drop '{raw}': amount '{parts[1]}' not understood; 1 used")
        if len(parts) > 2:
            try:
                drop["chance"] = float(parts[2])
            except ValueError:
                ctx.note(where, f"drop '{raw}': chance '{parts[2]}' not understood; always drops")
        out.append(drop)
    return out


def blade_tip(bone: str) -> str:
    return f"{bone}_tip"


def translate_targeter(t: tuple[str, dict[str, Any]] | None, ctx: Context, where: str, mech: str = "") -> str | None:
    if t is None:
        return None
    name, o = t[0].lower(), t[1]
    if name in ("selflocation", "casterlocation"):
        off = {k: float(_opt(o, k, k + "offset", default=0)) for k in ("x", "y", "z")}
        off = {k: v for k, v in off.items() if v != 0}
        return f"@SelfLocation{_fmt_opts(off)}"
    if name in SIMPLE_TARGETERS:
        return SIMPLE_TARGETERS[name]
    if name in RADIUS_TARGETERS:
        if name in ("mobsinradius", "mir") and _opt(o, "types", "type", "t"):
            ctx.note(where, f"@{t[0]} type filter '{_opt(o, 'types', 'type', 't')}' dropped (MythicMobs mob names)")
        return f"@{RADIUS_TARGETERS[name]}{_fmt_opts({'r': float(_opt(o, 'r', 'radius', default=5))})}"
    if name == "modelpart":
        pid = str(_opt(o, "pid", "partid", "p", "part", default=""))
        bone = resolve_bone(ctx, pid, where)
        if _opt(o, "em", "exactmatch") is False:
            ctx.note(where, f"@modelpart pid '{pid}' with em=false (all parts starting with it) uses only the "
                            f"part named exactly '{bone}' (map it with bone_aliases) [partial]")
        if str(o.get("o", o.get("offset", "model"))).lower() not in ("model", "local"):
            ctx.note(where, f"@modelpart offset mode '{o.get('o', o.get('offset'))}' treated as model (yaw) frame")
        # ModelEngine model frame: -Z forward, +X right → entity space: +Z forward, +X left.
        off = {"x": -float(_opt(o, "x", default=0)), "y": float(_opt(o, "y", default=0)),
               "z": -float(_opt(o, "z", default=0))}
        off = {k: v for k, v in off.items() if v != 0}
        if bone in ctx.bones:
            ctx.used_bones.add(bone)
            if pid in ctx.bone_aliases:
                ctx.note(where, f"@modelpart '{pid}' is not in the Bedrock geometry; using alias bone '{bone}'")
            if bone in ctx.blades:
                # The weapon geometry defines where it hits: totems become a hilt->tip
                # capsule, anything else (e.g. summons) lands at the tip.
                ctx.used_bones.add(blade_tip(bone))
                if off:
                    ctx.note(where, f"@modelpart offsets {off} dropped: '{bone}' is a blade (hits follow the blade)")
                return f"@Bone{_fmt_opts({'bone': bone if mech == 'totem' else blade_tip(bone)})}"
            return f"@Bone{_fmt_opts({'bone': bone, **off})}"
        ctx.note(where, f"@modelpart '{pid}' is not in the Bedrock geometry; using the boss position instead")
        return f"@SelfLocation{_fmt_opts(off)}"
    if name in ("threattable", "tt"):
        return "@ThreatTable"
    if name in ("randomthreattarget", "rtt"):
        ctx.note(where, "@RandomThreatTarget approximated as @RandomPlayer")
        return "@RandomPlayer"
    if name in ("cone", "livingincone", "entitiesincone", "lic", "eic"):
        co = {"angle": float(_opt(o, "angle", "a", default=60)), "r": float(_opt(o, "range", "r", default=6))}
        rot = float(_opt(o, "rotation", "rot", default=0))
        if rot:
            co["rotation"] = rot
            ctx.note(where, f"@{t[0]} rotation {rot:g}°: positive turns the cone to the boss's left, like fieldOfView [VERIFY]")
        return f"@Cone{_fmt_opts(co)}"
    if name == "ring":
        return f"@Ring{_fmt_opts({'radius': float(_opt(o, 'radius', 'r', default=5)), 'points': int(_opt(o, 'points', 'p', default=8))})}"
    if name == "forward":
        f = float(_opt(o, "f", "forward", default=1))
        y = float(_opt(o, "yo", "yoffset", "y", default=0))
        return f"@Forward{_fmt_opts({'f': f, **({'y': y} if y else {})})}"
    if name in ("randomlocationsnearcaster", "rlnc", "randomlocationsnearself", "rlns"):
        ro = {"amount": int(_opt(o, "amount", "a", default=1)), "radius": float(_opt(o, "radius", "r", default=5))}
        if _opt(o, "minradius", "minr") is not None:
            ro["minRadius"] = float(_opt(o, "minradius", "minr"))
        if _opt(o, "spacing", "s") is not None:
            ro["spacing"] = float(_opt(o, "spacing", "s"))
            ctx.note(where, f"@{t[0]} `s` read as the spacing between points [VERIFY]")
        return f"@RandomLocationsNearCaster{_fmt_opts(ro)}"
    if name in ("randomlocationsneartargets", "randomlocationsneartarget", "rlnt"):
        ro = {"amount": int(_opt(o, "amount", "a", default=1)), "radius": float(_opt(o, "radius", "r", default=5))}
        if _opt(o, "minradius", "minr") is not None:
            ro["minRadius"] = float(_opt(o, "minradius", "minr"))
        return f"@RandomLocationsNearTarget{_fmt_opts(ro)}"
    if name in ("playersinring", "pring"):
        return f"@PlayersInRing{_fmt_opts({'min': float(_opt(o, 'min', 'minradius', default=0)), 'max': float(_opt(o, 'max', 'maxradius', default=10))})}"
    if name == "line":
        return f"@Line{_fmt_opts({'spacing': float(_opt(o, 'spacing', 'r', 'radius', default=1))})}"
    if name in ("location", "l"):
        c = str(_opt(o, "coords", "c", "location", default="0,0,0")).split(",")
        if len(c) >= 3:
            return f"@Location{_fmt_opts({'x': float(c[0]), 'y': float(c[1]), 'z': float(c[2])})}"
    ctx.note(where, f"unsupported targeter @{t[0]}; mechanic default used")
    return None


# --------------------------------------------------------------------------- #
# Conditions
# --------------------------------------------------------------------------- #


def _range_conditions(name: str, spec: Any, expect: bool) -> list[str]:
    """MythicMobs ranges: '<5', '>2', '=3', '2to5', '5' (≤ for distance-like)."""
    s = str(spec).strip()
    inv = {"<": ">=", "<=": ">", ">": "<=", ">=": "<", "==": "!="}
    m = re.fullmatch(r"(-?[\d.]+)to(-?[\d.]+)", s)
    if m:
        lo, hi = m.groups()
        conds = [f"{name}>={lo}", f"{name}<={hi}"]
        if not expect:
            raise ValueError("negated ranges are not supported")
        return conds
    m = re.fullmatch(r"(<=|>=|<|>|=)?\s*(-?[\d.]+)", s)
    if not m:
        raise ValueError(f"cannot read range '{s}'")
    op, val = m.group(1) or "<=", m.group(2)
    op = "==" if op == "=" else op
    if not expect:
        op = inv[op]
    return [f"{name}{op}{val}"]


def _cond_core(c: ConditionLine, ctx: Context, where: str, target_condition: bool) -> list[str] | None:
    """Translated condition(s) without the action suffix; None = unsupported."""
    n, o, expect = c.name.lower(), c.options, c.expect
    bang = "" if expect else "!"
    if n == "targetwithin":
        return _range_conditions("distance", f"<={_opt(o, 'd', 'distance', default=0)}", expect)
    if n == "distance":
        return _range_conditions("distance", _opt(o, "d", "distance", default=0), expect)
    if n in ("hastag", "tag"):
        return [f"{bang}hasTag{{tag={_opt(o, 't', 'tag')}}}"]
    if n == "chance":
        p = float(_opt(o, "c", "chance", default=1))
        return [f"chance {p}"] if expect else [f"chance {round(1 - p, 4)}"]
    if n == "offgcd":
        return [f"{bang}offGcd"]
    if n == "moving":
        return [f"{bang}moving"]
    if n == "inblock":
        blocks = str(_opt(o, "b", "blocks", "m", "material", default="")).lower().replace(",", "|")
        return [f"{bang}inBlock{{blocks={blocks}}}"]
    if n == "hastarget":
        return [f"{bang}hasTarget"]
    if n in ("incombat",):
        return [f"{bang}inCombat"]
    if n in ("lineofsight", "los"):
        return [f"{bang}lineOfSight"]
    if n == "height":
        return _range_conditions("height", _opt(o, "h", "height", default=0), expect)
    if n == "altitude":
        return _range_conditions("altitude", _opt(o, "a", "altitude", "h", default=0), expect)
    if n in ("playerswithin", "playersinradius"):
        r = float(_opt(o, "d", "distance", "r", "radius", default=16))
        spec = str(_opt(o, "a", "amount", default=">0")).strip()
        m = re.fullmatch(r"(<=|>=|<|>|=)?\s*(\d+)", spec)
        rng = re.fullmatch(r"(\d+)to(\d+)", spec)
        if rng:
            return [f"{bang}playersNearby{{r={r};min={rng.group(1)};max={rng.group(2)}}}"]
        if not m:
            raise ValueError(f"cannot read amount '{spec}'")
        op, n_ = m.group(1) or ">=", int(m.group(2))
        lim = {">": f"min={n_ + 1}", ">=": f"min={n_}", "<": f"min=0;max={n_ - 1}", "<=": f"min=0;max={n_}", "=": f"min={n_};max={n_}"}[op]
        return [f"{bang}playersNearby{{r={r};{lim}}}"]
    if n in ("variableequals", "varequals"):
        return [f"{bang}varEquals{{var={_var(_opt(o, 'var', 'variable', 'name'))};val={_txt(_opt(o, 'value', 'val', 'v'))}}}"]
    if n in ("variableisset", "varisset", "isset"):
        return [f"{bang}variableIsSet{{var={_var(_opt(o, 'var', 'variable', 'name'))}}}"]
    if n in ("variableinrange", "varinrange"):
        lo, _, hi = str(_opt(o, "value", "val", "v", default="0to0")).partition("to")
        name_ = _var(_opt(o, "var", "variable", "name"))
        if not expect:
            raise ValueError("negated variable ranges are not supported")
        return [f"variable{{name={name_};ge={lo}}}", f"variable{{name={name_};le={hi or lo}}}"]
    if n in ("health", "healthpercent"):
        spec = str(_opt(o, "h", "health", "a", "amount", default="")).replace("%", "")
        return _range_conditions("healthPct", spec, expect)
    if n in ("fieldofview", "fov"):
        angle = float(_opt(o, "angle", "a", default=90))
        rot = float(_opt(o, "rotation", "r", default=0))
        if not target_condition:
            ctx.note(where, "fieldOfView as a caster condition checks the current target")
        return [f"{bang}fieldOfView{{angle={angle};rotation={rot}}}"]
    if n == "directionalvelocity":
        parts = {k: str(o[k]) for k in ("x", "y", "z") if k in o}
        if not parts:
            raise ValueError("no axis given")
        return [f"{bang}directionalVelocity{{{';'.join(f'{k}={v}' for k, v in parts.items())}}}"]
    if n == "onground":
        return [f"{bang}onGround"]
    if n == "onblock":
        blocks = str(_opt(o, "b", "blocks", "m", "material", "t", "type", default="")).lower().replace(",", "|")
        if not blocks:
            raise ValueError("no block given")
        return [f"{bang}onBlock{{blocks={blocks}}}"]
    if n == "damagecause":
        causes = [MM_DAMAGE_CAUSES.get(x.strip().upper()) for x in str(_opt(o, "cause", "c", default="")).split(",")]
        if not all(causes):
            raise ValueError("unknown damage cause")
        return [f"{bang}damageCause{{cause={'|'.join(causes)}}}"]
    if n in ("targetinlineofsight", "inlineofsight"):
        return [f"{bang}lineOfSight"]
    if n == "drivingmodel":
        ctx.note(where, "DrivingModel condition dropped (the grab is not a vehicle on Bedrock)")
        return []
    if n == "isplayer":
        return [f"{bang}isPlayer"]
    if n in ("burning", "onfire"):
        return [f"{bang}onFire"]
    if n in ("crouching", "sneaking"):
        return [f"{bang}crouching"]
    if n == "sprinting":
        return [f"{bang}sprinting"]
    if n in ("entitytype", "type"):
        types = [str(x).strip() for x in str(_opt(o, "types", "type", "t", default="")).split(",") if x.strip()]
        types = [x if ":" in x else "minecraft:" + x.lower() for x in types]
        return [f"{bang}entityType{{types={'|'.join(types)}}}"]
    if n in ("haspotioneffect", "haseffect"):
        t = str(_opt(o, "type", "t", default="")).upper()
        eff = MM_POTIONS.get(t)
        if not eff:
            raise ValueError(f"unknown potion type '{t}'")
        return [f"{bang}hasEffect{{effect={eff}}}"]
    return None


def translate_condition(c: ConditionLine, ctx: Context, where: str, target_condition: bool = False) -> list[str]:
    if c.name.startswith("("):
        m = re.fullmatch(r"\((.*)\)\s*(true|false)?\s*", c.raw.strip(), re.I)
        inner = m.group(1) if m else ""
        if not m or "||" in inner or (m.group(2) or "true").lower() == "false":
            ctx.note(where, f"compound condition '{c.raw}' (or / negated and) not supported; dropped")
            return []
        out: list[str] = []
        for part in inner.split("&&"):
            out += translate_condition(parse_condition_line(part.strip()), ctx, where, target_condition)
        return out
    try:
        out = _cond_core(c, ctx, where, target_condition)
    except ValueError as e:
        ctx.note(where, f"condition '{c.raw}' dropped: {e}")
        return []
    if out is None:
        ctx.note(where, f"unsupported condition '{c.raw}' dropped")
        return []
    if c.action and out:
        if len(out) > 1:
            ctx.note(where, f"condition '{c.raw}': {c.action[0]} applied to the last of its {len(out)} parts")
        out[-1] = f"{out[-1]} {c.action[0]} {c.action[1]}"
    return out


def _inline_conditions(sl: SkillLine, ctx: Context, where: str) -> list[str]:
    out: list[str] = []
    for text, negated in sl.conditions:
        cl = parse_condition_line(text)
        cl.expect = not negated
        out += translate_condition(cl, ctx, where)
    return out


# --------------------------------------------------------------------------- #
# Mechanics
# --------------------------------------------------------------------------- #


def _projectile(sl: SkillLine, ctx: Context, where: str, n: str) -> dict[str, Any] | None:
    o = sl.options
    po: dict[str, Any] = {}
    for k, key in SKILL_KEYS.items():
        if k in o and key in ("onHit", "onTick", "onStart", "onEnd"):
            po[key] = _skill_ref(o[k], ctx, where, key)
    v = float(_opt(o, "velocity", "v", default=5))
    po["speed"] = round(v / 20, 3)  # MythicMobs velocity is blocks/second [VERIFY]
    po["range"] = float(_opt(o, "maxdistance", "md", default=40))
    po["radius"] = float(_opt(o, "hitradius", "hr", "horizontalradius", default=1))
    if _opt(o, "verticalradius", "vr") is not None:
        po["verticalRadius"] = float(_opt(o, "verticalradius", "vr"))
    if _opt(o, "gravity", "g"):
        po["gravity"] = round(float(_opt(o, "gravity", "g")) / 20, 4)
    if _opt(o, "hitnonplayers", "hnp") is True:
        po["hitNonPlayers"] = True
    if _opt(o, "hitplayers", "hp") is False:
        po["hitPlayers"] = False
    if _opt(o, "hugsurface", "hs") is True:
        po["hugSurface"] = True
    if _opt(o, "stopatentity", "se") is False:
        po["stopAtEntity"] = False
    if _opt(o, "stopatblock", "sb") is False:
        po["stopAtBlock"] = False
    ti = _opt(o, "tickinterval", "ti", "interval", "i")
    if ti is not None and _ticks(ti) > 1:
        po["tickInterval"] = _ticks(ti)
    for mm, key in (("startyoffset", "startY"), ("syo", "startY"), ("startfoffset", "startForward"), ("sfo", "startForward"),
                    ("startsoffset", "startSide"), ("sso", "startSide"), ("targetyoffset", "targetY"), ("tyo", "targetY")):
        if mm in o and key not in po:
            val = float(o[mm])
            if abs(val) > 8:
                ctx.note(where, f"{n} {mm}={o[mm]} looks like a different unit; dropped [VERIFY]")
                continue
            po[key] = val
    if _opt(o, "fromorigin", "fo") is True and _opt(o, "origin") is not None:
        org = str(o["origin"]).lstrip("@")
        t = translate_targeter(parse_call(org), ctx, where)
        if t:
            po["origin"] = t
    if "sdir" in o or "startdirection" in o:
        ctx.note(where, f"{n} start direction (sdir) not supported; aims at the target")
    bullet_keys = [str(_opt(o, k)) for k in ("bulletmodel", "bulletmaterial", "bullettype") if _opt(o, k) is not None]
    mapped = next((ctx.bullets[k] for k in bullet_keys if k in ctx.bullets), None)
    if mapped:
        po["bullet"] = mapped
    elif bullet_keys:
        ctx.note(where, f"{n} bullet {bullet_keys} not mapped to an entity (job \"bullets\"); drawn as particles")
    if n == "missile":
        po["homing"] = 0.2
        ctx.note(where, "missile homing strength 0.2 per tick [VERIFY by feel]")
    if "bullet" not in po and "onTick" not in po:
        po["particle"] = _particle(ctx, _opt(o, "particle", "p", default="flame"), where)
    return {"m": "projectile", "o": po}


def translate_line(sl: SkillLine, ctx: Context, where: str) -> dict[str, Any] | None:
    n, o = sl.mechanic.lower(), sl.options
    if n in SKIPPED_MECHANICS:
        ctx.note(where, f"skipped `{sl.mechanic}` ({SKIPPED_MECHANICS[n]})")
        return None

    line: dict[str, Any] | None = None
    if n == "delay":
        line = {"m": "delay", "o": {"ticks": _ticks(_opt(o, "ticks", "t", default=1))}}
    elif n in ("skill", "metaskill", "meta", "$"):
        line = {"m": "skill", "o": {"skill": _skill_ref(_opt(o, "s", "skill", "$", "meta", "m"), ctx, where, "skill")}}
    elif n == "randomskill":
        skills = [s.strip() for s in str(_opt(o, "s", "skills", "m", default="")).split(",") if s.strip()]
        line = {"m": "randomSkill", "o": {"skills": skills}}
    elif n == "gcd":
        line = {"m": "gcd", "o": {"ticks": _ticks(_opt(o, "ticks", "t", default=20))}}
    elif n == "setspeed" and "repeat" in o:
        ctx.note(where, "setspeed repeat dropped (the speed stays set until changed)")
        o = {k: v for k, v in o.items() if k not in ("repeat", "repeati", "repeatinterval", "ri")}
        sl.options = o
        return translate_line(sl, ctx, where)
    elif n == "setspeed":
        line = {"m": "setSpeed", "o": {"multiplier": float(_opt(o, "s", "speed", default=1))}}
    elif n == "state":
        anim = str(_opt(o, "s", "state", default=""))
        if _opt(o, "r", "remove") is True:
            ctx.note(where, f"state remove '{anim}' dropped (animations end on their own)")
            return None
        if anim in ctx.always:
            ctx.note(where, f"state '{anim}' is an always-on layer (job always_animate); played by the RP instead")
            return None
        if anim not in ctx.anims:
            ctx.note(where, f"state '{anim}' has no matching animation; line dropped")
            return None
        line = {"m": "state", "o": {"anim": anim}}
    elif n == "defaultstate":
        typ = str(_opt(o, "t", "type", default="idle")).lower()
        anim = str(_opt(o, "s", "state", default=""))
        if typ not in ("idle", "walk") or anim not in ctx.anims:
            ctx.note(where, f"defaultstate {typ}={anim} not supported; line dropped")
            return None
        if anim not in ctx.base_states[typ]:
            ctx.base_states[typ].append(anim)
        line = {"m": "baseState", "o": {"type": typ, "anim": anim}}
    elif n == "lockmodel":
        line = {"m": "lockFacing", "o": {"on": bool(_opt(o, "l", "lock", default=True))}}
    elif n == "lockmodelhead":
        line = {"m": "lockFacing", "o": {"on": bool(_opt(o, "lockyaw", "ly", "l", default=True))}}
    elif n == "addtag":
        line = {"m": "addTag", "o": {"tag": str(_opt(o, "t", "tag"))}}
    elif n == "removetag":
        line = {"m": "removeTag", "o": {"tag": str(_opt(o, "t", "tag"))}}
    elif n == "sound":
        mm = str(_opt(o, "s", "sound", default=""))
        snd = ctx.sounds.get(mm, mm)
        if snd == mm and ":" in mm and ctx.sounds.get(mm.split(":", 1)[1]):
            snd = ctx.sounds[mm.split(":", 1)[1]]
        if mm in ctx.sounds:
            ctx.used_mechanics.add("__sound_mapped")
        snd = _bedrock_sound(snd, mm, ctx, where)
        line = {"m": "sound", "o": {"sound": snd, "volume": _num(_opt(o, "v", "volume", default=1)),
                                     "pitch": _num(_opt(o, "p", "pitch", default=1))}}
    elif n == "aura":
        on_tick = _opt(o, "ontick", "ot")
        if not on_tick:
            ctx.note(where, "aura without onTick dropped")
            return None
        for k in ("onstart", "os", "onend", "oe"):
            if k in o:
                ctx.note(where, f"aura option '{k}' not supported yet; ignored")
        line = {"m": "aura", "o": {"onTick": _skill_ref(on_tick, ctx, where, "onTick"),
                                    "duration": _ticks(_opt(o, "duration", "d", "ms", default=20)),
                                    "interval": _ticks(_opt(o, "interval", "i", default=1))}}
    elif n == "totem":
        on_hit = _opt(o, "onhit", "oh")
        if not on_hit:
            ctx.note(where, "totem without onHit dropped")
            return None
        hopts: dict[str, Any] = {"onHit": _skill_ref(on_hit, ctx, where, "onHit"),
                                 "hr": float(_opt(o, "hr", "hradius", "hs", "r", default=1)),
                                 "vr": float(_opt(o, "vr", "vradius", "vs", default=1))}
        if _opt(o, "hnp", "hitnonplayers") is True:
            hopts["hitNonPlayers"] = True
        if _opt(o, "hp", "hitplayers") is False:
            hopts["hitPlayers"] = False
        if _opt(o, "drawhitbox") is True:
            hopts["draw"] = True
        if "ti" in o:
            hopts["interval"] = _ticks(o["ti"])
            ctx.note(where, "totem `ti` read as the per-target re-hit interval (ticks) [VERIFY]")
        line = {"m": "hitbox", "o": hopts}
    elif n == "damage":
        line = {"m": "damage", "o": {"amount": _num(_opt(o, "a", "amount", default=1))}}
    elif n == "basedamage":
        mult = float(_opt(o, "m", "multiplier", default=1))
        line = {"m": "damage", "o": {"amount": round(ctx.base_damage * mult, 3)}}
        ctx.note(where, f"basedamage ×{mult} → damage {round(ctx.base_damage * mult, 3)} (mob Damage {ctx.base_damage})")
    elif n == "throw":
        line = {"m": "throw", "o": {"velocity": _num(_opt(o, "v", "velocity", default=1)),
                                     "velocityY": _num(_opt(o, "vy", "velocityy", "yv", default=1))}}
        if _opt(o, "fromorigin", "fo") is True:
            ctx.note(where, "throw fromOrigin dropped: thrown away from the caster")
    elif n == "shieldbreak":
        line = {"m": "shieldBreak", "o": {"ticks": _ticks(_opt(o, "duration", "d", default=100))}}
    elif n == "potion":
        t = str(_opt(o, "type", "t", default="")).upper()
        eff = MM_POTIONS.get(t)
        if not eff:
            ctx.note(where, f"unknown potion type '{t}'; line dropped")
            return None
        line = {"m": "potion", "o": {"effect": eff, "ticks": _ticks(_opt(o, "duration", "d", default=100)),
                                      "amplifier": int(_opt(o, "level", "l", "lvl", default=0))}}
    elif n == "summon":
        mob = str(_opt(o, "mob", "m", "type", "t", default=""))
        mapped = ctx.mob_types.get(mob)
        if mapped:
            etype, extra = mapped["type"], {k: v for k, v in mapped.items() if k != "type"}
            ctx.note(where, f"summon '{mob}' mapped to {etype}")
        elif mob in ctx.mm_mobs:
            ctx.note(where, f"summon of MythicMobs mob '{mob}' skipped (not converted in this job; add it to `minions` or map it in mob_types)")
            return None
        elif ":" in mob or mob.lower() in VANILLA_MOBS:
            etype, extra = ("minecraft:" + mob.lower()) if ":" not in mob else mob, {}
        else:
            ctx.note(where, f"summon '{mob}' has no mapping; line dropped")
            return None
        sopts: dict[str, Any] = {"type": etype, "amount": int(_opt(o, "a", "amount", default=1)),
                                 "radius": float(_opt(o, "r", "radius", default=0))}
        if _opt(o, "os", "onsurface") is True:
            sopts["onSurface"] = True
        sopts.update(extra)
        line = {"m": "summon", "o": sopts}
    elif n == "propel":
        line = {"m": "propel", "o": {"velocity": _num(_opt(o, "v", "velocity", default=1))}}
    elif n in ("message", "sendmessage"):
        line = {"m": "message", "o": {"text": str(_opt(o, "m", "msg", "message", default=""))}}
    elif n in ("actionmessage", "sendactionmessage", "actionbar"):
        line = {"m": "actionBar", "o": {"text": str(_opt(o, "m", "msg", "message", default=""))}}
    elif n in ("sendtitle", "title"):
        line = {"m": "title", "o": {"title": str(_opt(o, "title", "t", default="")),
                                     "subtitle": str(_opt(o, "subtitle", "st", default="")),
                                     "fadeIn": _ticks(_opt(o, "fadein", "fi", default=5)),
                                     "stay": _ticks(_opt(o, "stay", "s", default=40)),
                                     "fadeOut": _ticks(_opt(o, "fadeout", "fo", default=10))}}
    elif n == "heal":
        line = {"m": "heal", "o": {"amount": _num(_opt(o, "amount", "a", default=1))}}
    elif n == "healpercent":
        line = {"m": "heal", "o": {"percent": float(_opt(o, "multiplier", "m", "percent", "p", default=0.1))}}
    elif n == "percentdamage":
        line = {"m": "percentDamage", "o": {"percent": float(_opt(o, "percent", "p", default=0.1)),
                                            **({"current": True} if _opt(o, "currenthealth", "ch") is True else {})}}
    elif n == "ignite":
        line = {"m": "ignite", "o": {"ticks": _ticks(_opt(o, "ticks", "t", "duration", "d", default=60))}}
    elif n in ("lightning", "strikelightning"):
        line = {"m": "lightning", "o": {}}
    elif n == "lunge":
        line = {"m": "lunge", "o": {"velocity": _num(_opt(o, "velocity", "v", default=1)),
                                     "height": _num(_opt(o, "velocityy", "vy", default=0.1))}}
    elif n == "velocity":
        mode = str(_opt(o, "mode", "m", default="SET")).upper()
        if mode == "MULTIPLY":
            ctx.note(where, "velocity mode MULTIPLY not supported; treated as ADD")
        vo: dict[str, Any] = {"x": _num(_opt(o, "velocityx", "vx", "x", default=0)),
                              "y": _num(_opt(o, "velocityy", "vy", "y", default=0)),
                              "z": _num(_opt(o, "velocityz", "vz", "z", default=0))}
        if _opt(o, "relative", "r") is True:
            vo["relative"] = True
            # MythicMobs relative x = the caster's right; Behemoth relative +x = its left.
            vo["x"] = (f"-{vo['x']}" if not vo["x"].startswith("-") else vo["x"][1:]) if isinstance(vo["x"], str) else -vo["x"]
            ctx.note(where, "relative velocity: x mirrored (MythicMobs +x = right) [VERIFY]")
        if mode == "SET":
            vo["clear"] = True
        line = {"m": "velocity", "o": vo}
    elif n == "pull":
        line = {"m": "pull", "o": {"velocity": float(_opt(o, "velocity", "v", default=1)) / 10}}
        ctx.note(where, "pull velocity ÷10 like throw [VERIFY by feel]")
    elif n in ("teleport", "tp"):
        line = {"m": "teleport", "o": {}}
        if _opt(o, "spreadh", "sh", "spreadv", "sv") is not None:
            ctx.note(where, "teleport spread dropped (lands exactly on the target point)")
    elif n == "potionclear":
        line = {"m": "potionClear", "o": {}}
    elif n == "dropitem":
        raw_items = str(_opt(o, "items", "item", "i", default=""))
        drops = []
        for entry in [x.strip() for x in raw_items.split(",") if x.strip()]:
            name_, _, amount = entry.partition(":") if not entry.lower().startswith("minecraft:") else (entry, "", "")
            amount = amount or str(_opt(o, "amount", "a", default=1))
            item = bedrock_item(name_, ctx, where, "dropitem")
            if item:
                drops.append({"item": item, "amount": int(_num(amount.split("to")[-1]) or 1)})
        if not drops:
            return None
        line = {"m": "dropItem", "o": {"items": drops}}
    elif n == "partvis":
        part = str(_opt(o, "p", "part", "pid", default=""))
        bone = resolve_bone(ctx, part, where)
        if bone not in ctx.bones:
            ctx.note(where, f"partvis part '{part}' is not in the Bedrock geometry; line skipped")
            return None
        if bone not in ctx.parts:
            ctx.parts.append(bone)
        line = {"m": "partVisibility", "o": {"part": bone, "visible": bool(_opt(o, "v", "visible", "visibility", default=False))}}
    elif n == "mountmodel":
        seat = str(_opt(o, "p", "pbone", "part", default=""))
        bone = resolve_bone(ctx, seat, where)
        if bone not in ctx.bones:
            ctx.note(where, f"MountModel seat '{seat}' is not in the Bedrock geometry; line skipped")
            return None
        ctx.used_bones.add(bone)
        dur = ctx.grab_durations.get(where, 40)
        line = {"m": "grab", "o": {"bone": bone, "duration": dur}}
        ctx.note(where, f"MountModel → grab: the target is held at bone '{bone}' for {dur} ticks (Bedrock cannot seat players on bones)")
    elif n in ("dismountall", "dismountmodel"):
        ctx.note(where, f"skipped `{sl.mechanic}` (grab releases on its own)")
        return None
    elif n == "recoil":
        pitch = abs(float(_opt(o, "pitch", "p", default=0.2)))
        line = {"m": "cameraShake", "o": {"intensity": round(min(1.0, max(0.05, pitch)), 2), "seconds": 0.1, "type": "rotational"}}
    elif n == "runaitargetselector":
        target = str(_opt(o, "target", "t", default="")).lower()
        line = {"m": "setAI", "o": {"mode": "frozen" if target == "clear" else "chase"}}
        ctx.note(where, f"runAItargetselector {target} → setAI {line['o']['mode']}")
    elif n == "setai":
        line = {"m": "setAI", "o": {"mode": "chase" if _opt(o, "ai", "a", default=True) is not False else "frozen"}}
    elif n == "sudoskill":
        line = {"m": "skill", "o": {"skill": _skill_ref(_opt(o, "s", "skill"), ctx, where, "skill")}}
        ctx.note(where, "SudoSkill runs the skill as the boss (Bedrock entities cannot cast Behemoth skills)")
    elif n in ("projectile", "missile"):
        line = _projectile(sl, ctx, where, n)
    elif n in ("particle", "particles", "effect:particle", "effect:particles", "e:p"):
        count = int(_opt(o, "amount", "a", default=1))
        if count > MAX_PARTICLE_COUNT:
            ctx.note(where, f"particle amount {count} capped at {MAX_PARTICLE_COUNT} (per-tick particle budget)")
            count = MAX_PARTICLE_COUNT
        line = {"m": "particle", "o": {**_particle_opts(ctx, o, where),
                                        "count": count,
                                        "spread": float(_opt(o, "hspread", "hs", "spread", default=0)),
                                        "yOffset": float(_opt(o, "yoffset", "y", default=0))}}
    elif n in ("particlering", "effect:particlering", "e:pr"):
        line = {"m": "particleRing", "o": {**_particle_opts(ctx, o, where),
                                            "radius": float(_opt(o, "radius", "r", default=3)),
                                            "points": min(128, int(_opt(o, "points", "pt", "amount", "a", default=16)))}}
    elif n in ("particlesphere", "effect:particlesphere", "e:ps"):
        line = {"m": "particleSphere", "o": {**_particle_opts(ctx, o, where),
                                              "radius": float(_opt(o, "radius", "r", default=2)),
                                              "points": min(200, int(_opt(o, "amount", "a", "points", default=40)))}}
    elif n in ("particleline", "effect:particleline", "e:pl"):
        line = {"m": "particleLine", "o": {**_particle_opts(ctx, o, where),
                                            "density": round(1 / max(0.05, float(_opt(o, "distancebetween", "db", default=0.25))), 2)}}
    elif n in ("setvariable", "setvar"):
        so: dict[str, Any] = {"name": _var(_opt(o, "variable", "var", "name")), "value": _opt(o, "value", "val", "v", default=0)}
        typ = _opt(o, "type", "t")
        if typ is not None:
            so["type"] = str(typ).lower()
        if _opt(o, "duration", "d") is not None:
            so["duration"] = max(1, _ticks(_opt(o, "duration", "d")))
        line = {"m": "setVariable", "o": so}
    elif n in ("variableadd", "varadd"):
        line = {"m": "setVariable", "o": {"name": _var(_opt(o, "variable", "var", "name")),
                                           "add": float(_opt(o, "amount", "a", default=1))}}
    elif n in ("variablemath", "varmath"):
        line = {"m": "variableMath", "o": {"var": _var(_opt(o, "variable", "var", "name")),
                                            "eq": str(_opt(o, "equation", "eq", default="x"))}}
    elif n in ("setrotation",):
        ro: dict[str, Any] = {}
        if _opt(o, "yaw", "y") is not None:
            ro["yaw"] = float(_opt(o, "yaw", "y"))
        if _opt(o, "pitch", "p") is not None:
            ro["pitch"] = float(_opt(o, "pitch", "p"))
        if _opt(o, "relative", "r") is True:
            ro["relative"] = True
        line = {"m": "setRotation", "o": ro}
    elif n in ("matchrotation",):
        line = {"m": "matchRotation", "o": {}}
    elif n in ("raytraceto", "raytrace"):
        ro = {"maxDistance": float(_opt(o, "maxdistance", "md", default=32)), "width": float(_opt(o, "width", "w", default=1))}
        for k in ("locationskill", "ls", "entityskill", "es"):
            if k in o:
                key = SKILL_KEYS[k]
                ro[key] = _skill_ref(o[k], ctx, where, key)
        syo = _opt(o, "startyoffset", "syo")
        if syo is not None:
            if abs(float(syo)) <= 8:
                ro["startY"] = float(syo)
            else:
                ctx.note(where, f"raytrace syo={syo} looks like a different unit; dropped [VERIFY]")
        if "locationSkill" not in ro and "entitySkill" not in ro:
            ctx.note(where, "raytrace without a location/entity skill dropped")
            return None
        line = {"m": "rayTraceTo", "o": ro}
    elif n == "remove":
        line = {"m": "remove", "o": {}}
    elif n == "stun":
        line = {"m": "stun", "o": {"duration": max(1, _ticks(_opt(o, "duration", "d", default=20)))}}
        if any(k in o for k in ("f", "facing", "ai", "kb", "g", "gravity")):
            ctx.note(where, "stun options (facing/ai/knockback/gravity) folded into one full stun")
    elif n == "tint":
        color = str(_opt(o, "c", "color", default="#FFFFFF"))
        line = {"m": "tint", "o": {"color": color if color.startswith("#") else "#" + color}}
        ctx.uses_tint = True
    elif n in ("barcreate", "barset"):
        title = _opt(o, "display", "d", "name", default="")
        if n == "barset" and "display" not in o and "d" not in o:
            ctx.note(where, f"{n} without display dropped (bar colour/style/value are not available, L36)")
            return None
        line = {"m": "bossBar", "o": {"title": str(title)}}
        ctx.note(where, f"{n}: only the bar title is converted (colour/style/value not available, L36)")
    elif n in ("barremove",):
        line = {"m": "bossBar", "o": {"reset": True}}
    elif n in ("modifyprojectile",):
        line = {"m": "modifyProjectile", "o": {"trait": str(_opt(o, "trait", "t", default="velocity")).lower(),
                                                "action": str(_opt(o, "action", "a", default="set")).lower(),
                                                "value": float(_opt(o, "value", "v", default=1))}}
    elif n == "explosion":
        line = {"m": "explosion", "o": {"power": float(_opt(o, "yield", "y", "power", "p", default=3)),
                                         **({"breakBlocks": True} if _opt(o, "blockdamage", "bd") is True else {}),
                                         **({"fire": True} if _opt(o, "fire", "f") is True else {})}}
    elif n == "shoot":
        typ = str(_opt(o, "type", "t", default="ARROW")).upper()
        etype = MM_SHOOT_TYPES.get(typ)
        if not etype:
            ctx.note(where, f"shoot type '{typ}' has no Bedrock mapping; line dropped")
            return None
        line = {"m": "shoot", "o": {"type": etype, "velocity": round(float(_opt(o, "velocity", "v", default=5)) / 3, 3)}}
        ctx.note(where, "shoot velocity ÷3 → blocks/tick [VERIFY]; damage comes from the Bedrock projectile")
    elif n == "jump":
        line = {"m": "jump", "o": {"velocity": round(float(_opt(o, "velocity", "v", default=1)) * 0.5, 3)}}
    elif n in ("threat", "modifythreat"):
        mode = str(_opt(o, "mode", "m", default="add")).lower()
        line = {"m": "threat", "o": {"mode": "set" if mode in ("set",) else "add", "amount": float(_opt(o, "amount", "a", default=10))}}
    elif n == "taunt":
        line = {"m": "threat", "o": {"mode": "taunt"}}
    elif n in ("clearthreat", "threatclear"):
        line = {"m": "threat", "o": {"mode": "clear"}}
    elif n == "sethealth":
        line = {"m": "setHealth", "o": {"amount": float(_opt(o, "amount", "a", default=1))}}
    elif n == "swap":
        line = {"m": "swap", "o": {}}
    elif n == "forcepull":
        line = {"m": "forcePull", "o": {"spread": float(_opt(o, "spread", "s", default=1))}}
    elif n in ("command", "cmd"):
        line = {"m": "command", "o": {"command": str(_opt(o, "command", "c", "cmd", default=""))}}
        ctx.note(where, "command runs as the boss; check the command exists on Bedrock")
    elif n in ("suicide",):
        line = {"m": "suicide", "o": {}}
    elif n == "signal":
        sig = str(_opt(o, "signal", "s", default=""))
        if sl.targeter and sl.targeter[0].lower() not in ("self", "caster"):
            ctx.note(where, f"signal to @{sl.targeter[0]} sent to all bosses within 32 blocks")
            line = {"m": "signal", "o": {"signal": sig, "radius": 32}}
            sl.targeter = None
        else:
            line = {"m": "signal", "o": {"signal": sig}}
    else:
        ctx.note(where, f"unsupported mechanic `{sl.mechanic}`; line dropped ({sl.raw})")
        return None

    ctx.used_mechanics.add(line["m"])
    t = translate_targeter(sl.targeter, ctx, where, n)
    if t:
        line["t"] = t
        bone = re.match(r"@Bone\{bone=([^;}]+)", t)
        if n == "totem" and bone and bone.group(1) in ctx.blades:
            line["o"]["to"] = blade_tip(bone.group(1))
    # Generic MythicMobs line options.
    if "delay" in o and n != "delay":
        line["delay"] = _ticks(o["delay"])
    if "repeat" in o:
        line["repeat"] = max(0, _ticks(o["repeat"]))
        ri = _opt(o, "repeatinterval", "repeati", "ri")
        if ri is not None and _ticks(ri) != 1:
            line["repeatInterval"] = max(1, _ticks(ri))
    cd = _opt(o, "cooldown", "cd")
    if cd is not None and float(cd) > 0:
        line["cooldown"] = _ticks(float(cd) * 20)  # MythicMobs per-mechanic cooldowns are seconds
    conds = _inline_conditions(sl, ctx, where)
    if conds:
        line["if"] = conds
    if sl.chance is not None and sl.chance < 1:
        line["chance"] = sl.chance
    for extra in sl.extras:
        ctx.note(where, f"skill-line extra '{extra}' ignored")
    return line


# --------------------------------------------------------------------------- #
# Whole mob
# --------------------------------------------------------------------------- #


def _line_refs(sl: SkillLine) -> list[str]:
    """Metaskill names a line refers to (including inside inline skill lists)."""
    n, o = sl.mechanic.lower(), sl.options
    names: list[str] = []
    values: list[Any] = []
    if n in ("skill", "metaskill", "meta", "$", "sudoskill"):
        values.append(_opt(o, "s", "skill", "$", "meta", "m"))
    elif n == "randomskill":
        names += [s.strip() for s in str(_opt(o, "s", "skills", "m", default="")).split(",")]
    values += [v for k, v in o.items() if k in SKILL_KEYS]
    for v in values:
        s = str(v).strip()
        if s.startswith("["):
            for raw in inline_lines(s):
                names += _line_refs(parse_skill_line(raw))
        elif s:
            names.append(s)
    return [x for x in names if x]


def _condition_refs(spec: dict) -> list[str]:
    out = []
    for k in ("Conditions", "TargetConditions"):
        for raw in spec.get(k) or []:
            c = parse_condition_line(str(raw))
            if c.action:
                out.append(c.action[1])
    return out


def reachable_skills(mob_lines: list[SkillLine], skills: dict[str, dict]) -> list[str]:
    """Metaskills reachable from the mob's skill lines (keeps unrelated entities' skills out)."""
    order: list[str] = []
    seen: set[str] = set()
    stack = [r for sl in mob_lines for r in _line_refs(sl)]
    while stack:
        name = stack.pop(0)
        if name in seen or name not in skills:
            continue
        seen.add(name)
        order.append(name)
        spec = skills[name] or {}
        for raw in spec.get("Skills", []) or []:
            stack.extend(_line_refs(parse_skill_line(str(raw))))
        stack.extend(_condition_refs(spec))
    return order


TRIGGER_MAP = {"onspawn": "onSpawn", "ontimer": "onTimer", "ondamaged": "onDamaged", "ondeath": "onDeath",
               "onattack": "onAttack", "oninteract": "onInteract", "onsignal": "onSignal", "onload": "onLoad",
               "oncombat": "onCombat", "onentercombat": "onCombat", "ondropcombat": "onDropCombat",
               "onchangetarget": "onChangeTarget", "onplayerkill": "onKillPlayer", "onkillplayer": "onKillPlayer"}


def _mob_variables(mob: dict, ctx: Context, where: str) -> dict[str, Any]:
    """MythicMobs `Variables: {name: "float/0"}` → initial values."""
    out: dict[str, Any] = {}
    for k, raw in (mob.get("Variables") or {}).items():
        typ, _, val = str(raw).partition("/")
        if not val:
            typ, val = "string", typ
        typ = typ.lower()
        try:
            out[str(k)] = int(val) if typ == "int" else float(val) if typ in ("float", "double") else \
                (str(val).lower() == "true") if typ == "boolean" else str(val)
        except ValueError:
            ctx.note(where, f"variable {k}='{raw}' could not be read; skipped")
    return out


def _grab_durations(name: str, raw_lines: list, ctx: Context) -> None:
    """MountModel holds its target until DismountAll: sum the `delay N` lines in between."""
    parsed = [parse_skill_line(str(r)) for r in raw_lines]
    for i, sl in enumerate(parsed):
        if sl.mechanic.lower() != "mountmodel":
            continue
        total = 0
        for later in parsed[i + 1:]:
            n = later.mechanic.lower()
            if n in ("dismountall", "dismountmodel"):
                break
            if n == "delay":
                total += _ticks(later.options.get("ticks", 0))
        ctx.grab_durations[f"{name}[{i}]"] = max(1, total)


def translate_boss(mob_id: str, mob: dict, skills: dict[str, dict], ctx: Context) -> dict[str, Any]:
    """Returns the config pieces: skills, damageModifiers, display, stats, ai, threat, variables."""
    out_skills: dict[str, Any] = {}
    ctx.base_damage = float(mob.get("Damage", ctx.base_damage) or ctx.base_damage)
    mob_lines = [parse_skill_line(str(s)) for s in (mob.get("Skills") or [])]

    # Mob-level lines become triggered skills.
    for i, sl in enumerate(mob_lines):
        where = f"{mob_id}.Skills[{i}]"
        if sl.trigger is None:
            ctx.note(where, "mob skill line without a trigger dropped")
            continue
        tname = TRIGGER_MAP.get(sl.trigger[0].lower(), "?")
        if sl.mechanic.lower() in SKIPPED_MECHANICS:
            ctx.note(where, f"skipped `{sl.mechanic}` ({SKIPPED_MECHANICS[sl.mechanic.lower()]})")
            continue
        if tname == "?":
            ctx.note(where, f"trigger ~{sl.trigger[0]} not supported; line dropped")
            continue
        chance, health = sl.chance, sl.health
        sl.chance = None
        conds = _inline_conditions(sl, ctx, where)
        sl.conditions = []
        line = translate_line(sl, ctx, where)
        if not line:
            continue
        tr = tname + (f":{sl.trigger[1]}" if sl.trigger[1] else "")
        key = f"mob_{i}_{tname}"
        sk: dict[str, Any] = {"tr": tr, **line}
        if health:
            conds += _range_conditions("healthPct", health.replace("%", ""), True)
        if conds:
            sk["if"] = conds
        if chance is not None and chance < 1:
            sk["chance"] = chance
        out_skills[key] = sk

    # Reachable metaskills.
    for name in reachable_skills(mob_lines, skills):
        spec = skills[name] or {}
        where = name
        _grab_durations(name, spec.get("Skills") or [], ctx)
        lines = []
        for j, raw in enumerate(spec.get("Skills") or []):
            line = translate_line(parse_skill_line(str(raw)), ctx, f"{name}[{j}]")
            if line:
                lines.append(line)
        conds: list[str] = []
        for raw in spec.get("Conditions") or []:
            conds += translate_condition(parse_condition_line(str(raw)), ctx, where)
        tconds: list[str] = []
        for raw in spec.get("TargetConditions") or []:
            tconds += translate_condition(parse_condition_line(str(raw)), ctx, where, target_condition=True)
        for k in ("TriggerConditions", "CasterConditions"):
            if spec.get(k):
                ctx.note(where, f"{k} not supported yet; dropped")
        sk = {}
        if spec.get("Cooldown"):
            sk["cooldown"] = int(round(float(spec["Cooldown"]) * 20))  # MythicMobs cooldowns are seconds
        if conds:
            sk["if"] = conds
        if tconds:
            sk["targetIf"] = tconds
        sk["c"] = lines
        out_skills[name] = sk

    for name, sk in ctx.extra_skills.items():
        out_skills.setdefault(name, sk)

    mods: dict[str, float] = {}
    for raw in mob.get("DamageModifiers") or []:
        parts = str(raw).split()
        if len(parts) == 2 and parts[0].upper() in MM_DAMAGE_CAUSES:
            mods[MM_DAMAGE_CAUSES[parts[0].upper()]] = float(parts[1])
        else:
            ctx.note(mob_id, f"damage modifier '{raw}' not supported")

    opts = mob.get("Options") or {}
    return {
        "skills": out_skills,
        "damageModifiers": mods,
        "display": re.sub(r"&([0-9a-fk-or])", lambda m: "§" + m.group(1), str(mob.get("Display", mob_id)).strip("'\"")),  # & colour codes
        "health": float(mob.get("Health", 20)),
        "targetRange": float(opts.get("FollowRange", 32)),
        "threat": bool((mob.get("Modules") or {}).get("ThreatTable", False)),
        "bossBarRange": int((mob.get("BossBar") or {}).get("Range", 50)),
        "variables": _mob_variables(mob, ctx, mob_id),
        "noAI": bool(opts.get("NoAI", False)),
        "invincible": bool(opts.get("Invincible", False)),
        "drops": translate_drops(mob, ctx, f"{mob_id}.Drops"),
    }
