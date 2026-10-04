from mbconv.mythic import (
    Context,
    parse_condition_line,
    parse_skill_line,
    reachable_skills,
    translate_boss,
    translate_condition,
    translate_line,
)


def ctx(**kw):
    base = dict(anims={"idle", "walk", "slam"}, bones={"blade"}, mob_types={}, sounds={}, bone_aliases={})
    base.update(kw)
    return Context(**base)


def test_parse_full_line():
    sl = parse_skill_line("randomskill{s=a,b;delay=3} @target ~onTimer:40")
    assert sl.mechanic == "randomskill"
    assert sl.options == {"s": "a,b", "delay": 3}
    assert sl.targeter == ("target", {})
    assert sl.trigger == ("onTimer", "40")


def test_parse_delay_shorthand():
    assert parse_skill_line("delay 39").options == {"ticks": 39}


def test_condition_translation():
    c = ctx()
    assert translate_condition(parse_condition_line("targetwithin{d=20} true"), c, "x") == ["distance<=20"]
    assert translate_condition(parse_condition_line("hastag{t=foo} false"), c, "x") == ["!hasTag{tag=foo}"]
    assert translate_condition(parse_condition_line("distance{d=>2} true"), c, "x", True) == ["distance>2"]
    assert translate_condition(parse_condition_line("inblock{b=WATER,LAVA} false"), c, "x") == ["!inBlock{blocks=water|lava}"]
    assert translate_condition(parse_condition_line("offgcd"), c, "x") == ["offGcd"]
    assert translate_condition(parse_condition_line("weird{x=1}"), c, "x") == []
    assert any("unsupported condition" in n for n in c.notes)


def test_modelpart_becomes_bone_with_entity_space_offset():
    c = ctx()
    line = translate_line(parse_skill_line("totem{oH=hit;hr=1.5;vr=1.5;hnp=true} @modelpart{pid=blade;o=model;y=-2;z=-1}"), c, "x")
    assert line["m"] == "hitbox"
    # ModelEngine -Z forward → entity space +Z forward.
    assert line["t"] == "@Bone{bone=blade;y=-2.0;z=1.0}"
    assert c.used_bones == {"blade"}


def test_missing_bone_falls_back_and_alias_resolves():
    c = ctx(bone_aliases={"rocks": "blade"})
    assert translate_line(parse_skill_line("sound{s=x} @modelpart{pid=nope}"), c, "x")["t"] == "@SelfLocation"
    assert translate_line(parse_skill_line("sound{s=x} @modelpart{pid=rocks}"), c, "x")["t"] == "@Bone{bone=blade}"


def test_generic_delay_and_skipped_mechanics():
    c = ctx()
    assert translate_line(parse_skill_line("sound{s=a;v=3;delay=20} @self"), c, "x")["delay"] == 20
    assert translate_line(parse_skill_line("model{mid=x} @self"), c, "x") is None


def test_summon_mapping():
    c = ctx(mob_types={"rocks": {"type": "minecraft:pig", "lifetime": 100}})
    line = translate_line(parse_skill_line("summon{m=rocks;a=1;os=true}"), c, "x")
    assert line["o"] == {"type": "minecraft:pig", "amount": 1, "radius": 0.0, "onSurface": True, "lifetime": 100}


def test_reachability_excludes_unrelated_skills():
    skills = {
        "a": {"Skills": ["skill{s=b}"]},
        "b": {"Skills": ["aura{oT=c;duration=5}"]},
        "c": {"Skills": ["damage{a=1}"]},
        "other_mob_skill": {"Skills": ["damage{a=1}"]},
    }
    assert reachable_skills([parse_skill_line("skill{s=a} ~onSpawn")], skills) == ["a", "b", "c"]


def test_boss_cooldown_seconds_to_ticks_and_mob_lines():
    mob = {"Display": "'K'", "Health": 50, "Skills": ["skill{s=atk} @target ~onTimer:40"],
           "DamageModifiers": ["FALL 0", "PROJECTILE 0.5"]}
    out = translate_boss("k", mob, {"atk": {"Cooldown": 10, "Skills": ["damage{a=2}"]}}, ctx())
    assert out["skills"]["atk"]["cooldown"] == 200
    assert out["skills"]["mob_0_onTimer"] == {"tr": "onTimer:40", "m": "skill", "o": {"skill": "atk"}, "t": "@target"}
    assert out["damageModifiers"] == {"fall": 0.0, "projectile": 0.5}


def test_blade_totem_becomes_capsule_and_summon_lands_at_tip():
    c = ctx(blades={"blade"})
    hit = translate_line(parse_skill_line("totem{oH=hit;hr=1.5} @modelpart{pid=blade;o=model;y=-2;z=-1}"), c, "x")
    assert hit["t"] == "@Bone{bone=blade}" and hit["o"]["to"] == "blade_tip"
    summon = translate_line(parse_skill_line("sound{s=a} @modelpart{pid=blade;y=-1}"), c, "x")
    assert summon["t"] == "@Bone{bone=blade_tip}"
    assert {"blade", "blade_tip"} <= c.used_bones
