"""MythicMobs YAML → Mythic Bedrock boss config (design doc §8, §12).

Parses MythicMobs skill-line syntax:
    mechanic{k=v;k2=v2} @targeter{k=v} ~trigger:arg
    delay 20
and condition lines:
    targetwithin{d=20} true
and translates them into Mythic Bedrock skill lines ({m, o, t, if, delay}).
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
    """Split on `sep` outside {} / [] and quotes."""
    out, depth, cur, quote = [], 0, [], None
    for ch in s:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        if ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x for x in (p.strip() for p in out) if x]


def parse_value(v: str) -> Any:
    v = v.strip().strip("\"'")
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
    m = re.match(r"^([^{\[]+)(?:[{\[](.*)[}\]])?$", token.strip())
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


def parse_skill_line(line: str) -> SkillLine:
    tokens = split_top(line.strip(), " ")
    if not tokens:
        raise ValueError("empty skill line")
    name, opts = parse_call(tokens[0])
    sl = SkillLine(raw=line.strip(), mechanic=name, options=opts)
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
        else:
            sl.extras.append(tok)
    return sl


@dataclass
class ConditionLine:
    raw: str
    name: str
    options: dict[str, Any]
    expect: bool = True


def parse_condition_line(line: str) -> ConditionLine:
    tokens = split_top(line.strip(), " ")
    name, opts = parse_call(tokens[0])
    expect = True
    for tok in tokens[1:]:
        if tok.lower() in ("true", "false"):
            expect = tok.lower() == "true"
    return ConditionLine(raw=line.strip(), name=name, options=opts, expect=expect)


# --------------------------------------------------------------------------- #
# Translation context
# --------------------------------------------------------------------------- #

MM_DAMAGE_CAUSES = {
    "SUFFOCATION": "suffocation", "FALL": "fall", "PROJECTILE": "projectile", "FIRE": "fire",
    "FIRE_TICK": "fireTick", "FREEZE": "freezing", "LAVA": "lava", "ENTITY_ATTACK": "entityAttack",
    "ENTITY_SWEEP_ATTACK": "entityAttack", "BLOCK_EXPLOSION": "blockExplosion",
    "ENTITY_EXPLOSION": "entityExplosion", "MAGIC": "magic", "LIGHTNING": "lightning",
    "DROWNING": "drowning", "WITHER": "wither", "CONTACT": "contact", "VOID": "void", "THORNS": "thorns",
    "STARVATION": "starve", "FALLING_BLOCK": "fallingBlock",
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
    "reddust": "minecraft:redstone_wire_dust_particle", "dust": "minecraft:redstone_wire_dust_particle",
    "portal": "minecraft:portal_directional", "cloud": "minecraft:evaporation_elephant_toothpaste_vapor_particle",
    "heart": "minecraft:heart_particle", "villager_happy": "minecraft:villager_happy",
    "happy_villager": "minecraft:villager_happy", "villager_angry": "minecraft:villager_angry",
    "angry_villager": "minecraft:villager_angry", "lava": "minecraft:lava_particle",
    "dripwater": "minecraft:water_drip_particle", "spell": "minecraft:mobspell_emitter",
    "witch": "minecraft:witchspell_emitter", "snowball": "minecraft:snowflake_particle",
    "end_rod": "minecraft:endrod", "totem": "minecraft:totem_particle", "sonic_boom": "minecraft:sonic_explosion",
    "sweep_attack": "minecraft:critical_hit_emitter", "block_crack": "minecraft:basic_smoke_particle",
}
DEFAULT_PARTICLE = "minecraft:basic_flame_particle"

# Mechanics that only drive ModelEngine / Java behaviour — no Bedrock equivalent needed.
SKIPPED_MECHANICS = {
    "model": "ModelEngine model attach — the Bedrock entity already uses the model",
    "bodyclamp": "ModelEngine body/head clamp — not available on Bedrock",
    "cancelevent": "cancels vanilla melee; the Bedrock stub has no vanilla attack behaviour",
}


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
    notes: list[str] = field(default_factory=list)
    used_mechanics: set[str] = field(default_factory=set)
    used_bones: set[str] = field(default_factory=set)
    base_states: dict[str, list[str]] = field(default_factory=lambda: {"idle": [], "walk": []})

    def note(self, where: str, msg: str) -> None:
        self.notes.append(f"{where}: {msg}")


def _opt(opts: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for k in keys:
        if k in opts:
            return opts[k]
    return default


def _ticks(v: Any) -> int:
    return int(round(float(v)))


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


# --------------------------------------------------------------------------- #
# Targeters
# --------------------------------------------------------------------------- #

SIMPLE_TARGETERS = {
    "self": "@self", "caster": "@self", "target": "@target", "t": "@target", "trigger": "@trigger",
    "selflocation": "@SelfLocation", "targetlocation": "@TargetLocation", "nearestplayer": "@NearestPlayer",
}
RADIUS_TARGETERS = {"playersinradius": "PlayersInRadius", "pir": "PlayersInRadius",
                    "entitiesinradius": "EntitiesInRadius", "eir": "EntitiesInRadius"}


def _fmt_opts(o: dict[str, Any]) -> str:
    parts = []
    for k, v in o.items():
        if isinstance(v, float):
            v = round(v, 3)
        parts.append(f"{k}={v}")
    return "{" + ";".join(parts) + "}" if parts else ""


def blade_tip(bone: str) -> str:
    return f"{bone}_tip"


def translate_targeter(t: tuple[str, dict[str, Any]] | None, ctx: Context, where: str, mech: str = "") -> str | None:
    if t is None:
        return None
    name, o = t[0].lower(), t[1]
    if name in SIMPLE_TARGETERS:
        return SIMPLE_TARGETERS[name]
    if name in RADIUS_TARGETERS:
        return f"@{RADIUS_TARGETERS[name]}{_fmt_opts({'r': _opt(o, 'r', 'radius', default=5)})}"
    if name == "modelpart":
        pid = str(_opt(o, "pid", "partid", default=""))
        bone = ctx.bone_aliases.get(pid, pid)
        if o.get("o", "model") not in ("model", "MODEL"):
            ctx.note(where, f"@modelpart offset mode '{o.get('o')}' treated as model (yaw) frame")
        # ModelEngine model frame: -Z forward, +X right → entity space: +Z forward, +X left.
        off = {"x": -float(_opt(o, "x", default=0)), "y": float(_opt(o, "y", default=0)),
               "z": -float(_opt(o, "z", default=0))}
        off = {k: v for k, v in off.items() if v != 0}
        if bone in ctx.bones:
            ctx.used_bones.add(bone)
            if pid != bone:
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
    if name == "cone":
        return f"@Cone{_fmt_opts({'angle': float(_opt(o, 'angle', 'a', default=60)), 'r': float(_opt(o, 'range', 'r', default=6))})}"
    if name == "ring":
        return f"@Ring{_fmt_opts({'radius': float(_opt(o, 'radius', 'r', default=5)), 'points': int(_opt(o, 'points', 'p', default=8))})}"
    if name == "forward":
        f = float(_opt(o, "f", "forward", default=1))
        y = float(_opt(o, "yo", "yoffset", "y", default=0))
        return f"@Forward{_fmt_opts({'f': f, **({'y': y} if y else {})})}"
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


def translate_condition(c: ConditionLine, ctx: Context, where: str, target_condition: bool = False) -> list[str]:
    n, o, expect = c.name.lower(), c.options, c.expect
    bang = "" if expect else "!"
    try:
        if n == "targetwithin":
            return _range_conditions("distance", f"<={_opt(o, 'd', 'distance', default=0)}", expect)
        if n == "distance":
            if not target_condition:
                ctx.note(where, "distance condition measured caster→target")
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
        if n in ("hastarget",):
            return [f"{bang}hasTarget"]
        if n in ("lineofsight", "los"):
            return [f"{bang}lineOfSight"]
        if n in ("height", "altitude"):
            if n == "altitude":
                ctx.note(where, "altitude (height above ground) approximated by Y coordinate (height)")
            return _range_conditions("height", _opt(o, "h", "height", "a", default=0), expect)
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
            return [f"{bang}variable{{name={_opt(o, 'var', 'variable', 'name')};eq={_opt(o, 'value', 'val', 'v')}}}"]
        if n in ("variableinrange", "varinrange"):
            lo, _, hi = str(_opt(o, "value", "val", "v", default="0to0")).partition("to")
            name_ = _opt(o, "var", "variable", "name")
            return [f"{bang}variable{{name={name_};ge={lo}}}", f"{bang}variable{{name={name_};le={hi or lo}}}"]
        if n in ("health", "healthpercent"):
            spec = str(_opt(o, "h", "health", "a", "amount", default="")).replace("%", "")
            return _range_conditions("healthPct", spec, expect)
    except ValueError as e:
        ctx.note(where, f"condition '{c.raw}' dropped: {e}")
        return []
    ctx.note(where, f"unsupported condition '{c.raw}' dropped")
    return []


# --------------------------------------------------------------------------- #
# Mechanics
# --------------------------------------------------------------------------- #


def translate_line(sl: SkillLine, ctx: Context, where: str) -> dict[str, Any] | None:
    n, o = sl.mechanic.lower(), sl.options
    if n in SKIPPED_MECHANICS:
        ctx.note(where, f"skipped `{sl.mechanic}` ({SKIPPED_MECHANICS[n]})")
        return None

    line: dict[str, Any] | None = None
    if n == "delay":
        line = {"m": "delay", "o": {"ticks": _ticks(_opt(o, "ticks", "t", default=1))}}
    elif n in ("skill", "metaskill", "meta", "$"):
        line = {"m": "skill", "o": {"skill": str(_opt(o, "s", "skill", "$", "meta", "m"))}}
    elif n == "randomskill":
        skills = [s.strip() for s in str(_opt(o, "s", "skills", "m", default="")).split(",") if s.strip()]
        line = {"m": "randomSkill", "o": {"skills": skills}}
    elif n == "gcd":
        line = {"m": "gcd", "o": {"ticks": _ticks(_opt(o, "ticks", "t", default=20))}}
    elif n == "setspeed":
        line = {"m": "setSpeed", "o": {"multiplier": float(_opt(o, "s", "speed", default=1))}}
    elif n == "state":
        anim = str(_opt(o, "s", "state", default=""))
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
    elif n == "addtag":
        line = {"m": "addTag", "o": {"tag": str(_opt(o, "t", "tag"))}}
    elif n == "removetag":
        line = {"m": "removeTag", "o": {"tag": str(_opt(o, "t", "tag"))}}
    elif n == "sound":
        mm = str(_opt(o, "s", "sound", default=""))
        snd = ctx.sounds.get(mm, mm)
        if mm in ctx.sounds:
            ctx.used_mechanics.add("__sound_mapped")
        line = {"m": "sound", "o": {"sound": snd, "volume": float(_opt(o, "v", "volume", default=1)),
                                     "pitch": float(_opt(o, "p", "pitch", default=1))}}
    elif n == "aura":
        on_tick = _opt(o, "ontick", "ot")
        if not on_tick:
            ctx.note(where, "aura without onTick dropped")
            return None
        for k in ("onstart", "os", "onend", "oe"):
            if k in o:
                ctx.note(where, f"aura option '{k}' not supported yet; ignored")
        line = {"m": "aura", "o": {"onTick": str(on_tick), "duration": _ticks(_opt(o, "duration", "d", "ms", default=20)),
                                    "interval": _ticks(_opt(o, "interval", "i", default=1))}}
    elif n == "totem":
        on_hit = _opt(o, "onhit", "oh")
        if not on_hit:
            ctx.note(where, "totem without onHit dropped")
            return None
        hopts: dict[str, Any] = {"onHit": str(on_hit), "hr": float(_opt(o, "hr", "hradius", "r", default=1)),
                                 "vr": float(_opt(o, "vr", "vradius", default=1))}
        if _opt(o, "hnp", "hitnonplayers") is True:
            hopts["hitNonPlayers"] = True
        if _opt(o, "hp", "hitplayers") is False:
            hopts["hitPlayers"] = False
        if "ti" in o:
            hopts["interval"] = _ticks(o["ti"])
            ctx.note(where, "totem `ti` read as the per-target re-hit interval (ticks) [VERIFY]")
        line = {"m": "hitbox", "o": hopts}
    elif n == "damage":
        line = {"m": "damage", "o": {"amount": float(_opt(o, "a", "amount", default=1))}}
    elif n == "throw":
        line = {"m": "throw", "o": {"velocity": float(_opt(o, "v", "velocity", default=1)),
                                     "velocityY": float(_opt(o, "vy", "velocityy", "yv", default=1))}}
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
        elif ":" in mob or mob.isupper():
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
        line = {"m": "propel", "o": {"velocity": float(_opt(o, "v", "velocity", default=1))}}
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
        line = {"m": "heal", "o": {"amount": float(_opt(o, "amount", "a", default=1))}}
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
        line = {"m": "lunge", "o": {"velocity": float(_opt(o, "velocity", "v", default=1)),
                                     "height": float(_opt(o, "velocityy", "vy", default=0.1))}}
    elif n == "velocity":
        mode = str(_opt(o, "mode", "m", default="SET")).upper()
        if mode == "MULTIPLY":
            ctx.note(where, "velocity mode MULTIPLY not supported; treated as ADD")
        line = {"m": "velocity", "o": {"x": float(_opt(o, "velocityx", "vx", "x", default=0)),
                                        "y": float(_opt(o, "velocityy", "vy", "y", default=0)),
                                        "z": float(_opt(o, "velocityz", "vz", "z", default=0)),
                                        **({"clear": True} if mode == "SET" else {})}}
    elif n == "pull":
        line = {"m": "pull", "o": {"velocity": float(_opt(o, "velocity", "v", default=1)) / 10}}
        ctx.note(where, "pull velocity ÷10 like throw [VERIFY by feel]")
    elif n in ("teleport", "tp"):
        line = {"m": "teleport", "o": {}}
    elif n in ("projectile", "missile"):
        on_hit = _opt(o, "onhit", "oh")
        if not on_hit:
            ctx.note(where, f"{n} without onHit dropped")
            return None
        if any(k in o for k in ("ontick", "ot", "onstart", "os")):
            ctx.note(where, f"{n} onTick/onStart visuals not converted; drawn with a particle trail instead")
        v = float(_opt(o, "velocity", "v", default=5))
        line = {"m": "projectile", "o": {
            "particle": _particle(ctx, _opt(o, "particle", "p", default="flame"), where),
            "onHit": str(on_hit),
            "speed": round(v / 20, 3),  # MythicMobs velocity is blocks/second [VERIFY]
            "range": float(_opt(o, "maxdistance", "md", default=40)),
            "radius": float(_opt(o, "hitradius", "hr", "horizontalradius", default=1)),
            **({"hitNonPlayers": True} if _opt(o, "hitnonplayers", "hnp") is True else {}),
            **({"onEnd": str(_opt(o, "onend", "oe"))} if _opt(o, "onend", "oe") else {}),
            **({"gravity": float(_opt(o, "gravity", "g")) / 20} if _opt(o, "gravity", "g") else {}),
        }}
    elif n in ("particle", "effect:particle", "e:p"):
        line = {"m": "particle", "o": {"particle": _particle(ctx, _opt(o, "particle", "p", default="flame"), where),
                                        "count": int(_opt(o, "amount", "a", default=1)),
                                        "spread": float(_opt(o, "hspread", "hs", "spread", default=0)),
                                        "yOffset": float(_opt(o, "yoffset", "y", default=0))}}
    elif n in ("particlering", "effect:particlering", "e:pr"):
        line = {"m": "particleRing", "o": {"particle": _particle(ctx, _opt(o, "particle", "p", default="flame"), where),
                                            "radius": float(_opt(o, "radius", "r", default=3)),
                                            "points": min(128, int(_opt(o, "points", "pt", "amount", "a", default=16)))}}
    elif n in ("particlesphere", "effect:particlesphere", "e:ps"):
        line = {"m": "particleSphere", "o": {"particle": _particle(ctx, _opt(o, "particle", "p", default="flame"), where),
                                              "radius": float(_opt(o, "radius", "r", default=2)),
                                              "points": min(200, int(_opt(o, "amount", "a", "points", default=40)))}}
    elif n in ("particleline", "effect:particleline", "e:pl"):
        line = {"m": "particleLine", "o": {"particle": _particle(ctx, _opt(o, "particle", "p", default="flame"), where),
                                            "density": round(1 / max(0.05, float(_opt(o, "distancebetween", "db", default=0.25))), 2)}}
    elif n in ("setvariable", "setvar"):
        line = {"m": "setVariable", "o": {"name": str(_opt(o, "variable", "var", "name")),
                                           "value": _opt(o, "value", "val", "v", default=0)}}
    elif n in ("variableadd", "varadd"):
        line = {"m": "setVariable", "o": {"name": str(_opt(o, "variable", "var", "name")),
                                           "add": float(_opt(o, "amount", "a", default=1))}}
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
    if "delay" in o and n != "delay":
        line["delay"] = _ticks(o["delay"])
    for k in ("repeat", "r", "repeatinterval", "ri"):
        if k in o and n not in ("summon", "aura"):
            ctx.note(where, f"generic option '{k}' ignored")
    for extra in sl.extras:
        ctx.note(where, f"skill-line extra '{extra}' ignored")
    return line


# --------------------------------------------------------------------------- #
# Whole boss
# --------------------------------------------------------------------------- #


def reachable_skills(mob_lines: list[SkillLine], skills: dict[str, dict]) -> list[str]:
    """Metaskills reachable from the mob's skill lines (keeps unrelated entities' skills out)."""
    order: list[str] = []
    seen: set[str] = set()

    def refs(sl: SkillLine) -> list[str]:
        n, o = sl.mechanic.lower(), sl.options
        names: list[str] = []
        if n in ("skill", "metaskill", "meta", "$"):
            names.append(str(_opt(o, "s", "skill", "$", "meta", "m")))
        elif n == "randomskill":
            names += [s.strip() for s in str(_opt(o, "s", "skills", "m", default="")).split(",")]
        elif n == "aura":
            names += [str(v) for k, v in o.items() if k in ("ontick", "ot", "onstart", "os", "onend", "oe")]
        elif n in ("totem", "projectile", "missile"):
            names += [str(v) for k, v in o.items() if k in ("onhit", "oh", "onstart", "os", "onend", "oe", "ontick", "ot")]
        return [x for x in names if x]

    stack = [r for sl in mob_lines for r in refs(sl)]
    while stack:
        name = stack.pop(0)
        if name in seen or name not in skills:
            continue
        seen.add(name)
        order.append(name)
        for raw in skills[name].get("Skills", []) or []:
            stack.extend(refs(parse_skill_line(str(raw))))
    return order


TRIGGER_MAP = {"onspawn": "onSpawn", "ontimer": "onTimer", "ondamaged": "onDamaged", "ondeath": "onDeath",
               "onattack": "onAttack", "oninteract": "onInteract", "onsignal": "onSignal", "onload": None,
               "oncombat": None}


def translate_boss(mob_id: str, mob: dict, skills: dict[str, dict], ctx: Context) -> dict[str, Any]:
    """Returns the config pieces: skills, damageModifiers, display, stats, ai, threat."""
    out_skills: dict[str, Any] = {}
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
        if tname is None or tname == "?":
            ctx.note(where, f"trigger ~{sl.trigger[0]} not supported; line dropped")
            continue
        line = translate_line(sl, ctx, where)
        if not line:
            continue
        tr = tname + (f":{sl.trigger[1]}" if sl.trigger[1] else "")
        key = f"mob_{i}_{tname}"
        out_skills[key] = {"tr": tr, **line}

    # Reachable metaskills.
    for name in reachable_skills(mob_lines, skills):
        spec = skills[name] or {}
        where = name
        lines = []
        for j, raw in enumerate(spec.get("Skills") or []):
            line = translate_line(parse_skill_line(str(raw)), ctx, f"{name}[{j}]")
            if line:
                lines.append(line)
        conds: list[str] = []
        for raw in spec.get("Conditions") or []:
            conds += translate_condition(parse_condition_line(str(raw)), ctx, where)
        for raw in spec.get("TargetConditions") or []:
            conds += translate_condition(parse_condition_line(str(raw)), ctx, where, target_condition=True)
        for k in ("TriggerConditions", "CasterConditions"):
            if spec.get(k):
                ctx.note(where, f"{k} not supported yet; dropped")
        sk: dict[str, Any] = {}
        if spec.get("Cooldown"):
            sk["cooldown"] = int(round(float(spec["Cooldown"]) * 20))  # MythicMobs cooldowns are seconds
        if conds:
            sk["if"] = conds
        sk["c"] = lines
        out_skills[name] = sk

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
        "display": str(mob.get("Display", mob_id)).strip("'\""),
        "health": float(mob.get("Health", 20)),
        "targetRange": float(opts.get("FollowRange", 32)),
        "threat": bool((mob.get("Modules") or {}).get("ThreatTable", False)),
        "bossBarRange": int((mob.get("BossBar") or {}).get("Range", 50)),
    }
