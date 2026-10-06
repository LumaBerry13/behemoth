from bhmconv.mythic import (
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


def test_tuning_overrides_and_extra_lines():
    from bhmconv.cli import apply_tuning

    skills = {
        "mob_0_onTimer": {"tr": "onTimer:40", "m": "skill", "o": {"skill": "pick"}, "t": "@target"},
        "pick": {"c": [{"m": "randomSkill", "o": {"skills": ["a"]}}]},
        "a": {"m": "damage", "o": {"amount": 1}},
    }
    notes = []
    apply_tuning(skills, {
        "randomskill_mode": "available",
        "trigger_overrides": {"pick": "onTimer:10"},
        "extra_lines": {"a": [{"m": "cameraShake", "o": {}}]},
    }, ctx(), notes)
    assert skills["mob_0_onTimer"]["tr"] == "onTimer:10"
    assert skills["pick"]["c"][0]["o"]["mode"] == "available"
    assert [l["m"] for l in skills["a"]["c"]] == ["cameraShake", "damage"]  # single-line skill became a sequence
    assert len(notes) == 3


def test_extra_lines_can_be_disabled():
    from bhmconv.cli import apply_tuning

    skills = {"a": {"m": "damage", "o": {"amount": 1}}}
    notes = []
    apply_tuning(skills, {"extra_lines_enabled": False, "extra_lines": {"a": [{"m": "cameraShake", "o": {}}]}}, ctx(), notes)
    assert skills["a"] == {"m": "damage", "o": {"amount": 1}}
    assert "disabled" in notes[0]


def test_inline_conditions_chance_and_health_on_a_line():
    sl = parse_skill_line("skill{s=a} @self ~onDamaged ?!varequals{var=x;val=1} 0.25 <75%")
    assert sl.conditions == [("varequals{var=x;val=1}", True)]
    assert sl.chance == 0.25 and sl.health == "<75%"


def test_condition_actions():
    c = ctx()
    cl = parse_condition_line("varequals{var=caster.attacking;val=true} castinstead slow")
    assert cl.action == ("castInstead", "slow")
    assert translate_condition(cl, c, "x") == ["varEquals{var=caster.attacking;val=true} castInstead slow"]
    cl = parse_condition_line("distance{d=>10} orelsecast away")
    assert translate_condition(cl, c, "x", True) == ["distance>10 orElseCast away"]


def test_inline_skill_lists_become_generated_skills():
    c = ctx()
    line = translate_line(parse_skill_line("totem{oH=[ - damage{a=5} - throw{v=4;vy=10} ];hr=3} @self"), c, "boss_skill[2]")
    name = line["o"]["onHit"]
    assert name == "boss_skill_2_onHit"
    assert [l["m"] for l in c.extra_skills[name]["c"]] == ["damage", "throw"]


def test_line_repeat_cooldown_and_placeholders():
    c = ctx()
    line = translate_line(parse_skill_line('sound{s=x;p="<random.float.0.9to1.2>";cd=4;repeat=3;repeati=5} @self'), c, "x")
    assert line["o"]["pitch"] == "<random.float.0.9to1.2>"
    assert line["cooldown"] == 80 and line["repeat"] == 3 and line["repeatInterval"] == 5


def test_world_scope_and_mob_variables():
    c = ctx()
    line = translate_line(parse_skill_line("setvar{var=world.count;val=1;type=INTEGER;duration=20}"), c, "x")
    assert line["o"] == {"name": "global.count", "value": 1, "type": "integer", "duration": 20}
    out = translate_boss("m", {"Variables": {"a": "int/3", "b": "float/0.5", "c": "string/hi"}, "Skills": []}, {}, c)
    assert out["variables"] == {"a": 3, "b": 0.5, "c": "hi"}


def test_reachability_follows_inline_lists_and_condition_actions():
    skills = {
        "a": {"Conditions": ["offgcd castinstead b"], "Skills": ["totem{oH=[ - skill{s=c} ]}"]},
        "b": {"Skills": ["damage{a=1}"]},
        "c": {"Skills": ["damage{a=1}"]},
    }
    assert set(reachable_skills([parse_skill_line("skill{s=a} ~onSpawn")], skills)) == {"a", "b", "c"}


def test_coloured_dust_maps_to_the_particle_library():
    c = ctx()
    line = translate_line(parse_skill_line(
        "particle{p=dust_color_transition;color=#00ffff;color2=#0066cc;size=1;a=2;hs=.15} @self"), c, "x")
    assert line["o"]["particle"] == "bhm:dust_transition"
    assert line["o"]["color"] == "#00FFFF" and line["o"]["color2"] == "#0066CC" and line["o"]["size"] == 0.1
    line = translate_line(parse_skill_line("particle{p=reddust;color=255,128,0}"), c, "x")
    assert line["o"]["particle"] == "bhm:dust" and line["o"]["color"] == "#FF8000"
    line = translate_line(parse_skill_line("particle{p=reddust}"), c, "x")
    assert line["o"]["color"] == "#FF0000"
    line = translate_line(parse_skill_line("particle{p=flame;color=#ffffff}"), c, "x")
    assert "color" not in line["o"]  # vanilla particles take no colour
