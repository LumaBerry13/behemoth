import pytest

from mbconv.keyframes import Unbakeable, parse_channel, sample


def test_constant_channel():
    frames = parse_channel([1, 2, 3])
    assert sample(frames, 0.0) == (1, 2, 3)
    assert sample(frames, 5.0) == (1, 2, 3)


def test_uniform_scale_number():
    assert sample(parse_channel(2, uniform_ok=True), 0.3) == (2, 2, 2)


def test_linear_interpolation_and_clamping():
    frames = parse_channel({"0.0": [0, 0, 0], "1.0": [10, 20, 30]})
    assert sample(frames, 0.5) == pytest.approx((5, 10, 15))
    assert sample(frames, -1) == (0, 0, 0)
    assert sample(frames, 2) == (10, 20, 30)


def test_pre_post_and_step():
    frames = parse_channel({
        "0.0": {"post": [0, 0, 0], "lerp_mode": "step"},
        "1.0": {"pre": [5, 5, 5], "post": [9, 9, 9]},
    })
    assert sample(frames, 0.5) == (0, 0, 0)  # step holds the previous value
    assert sample(frames, 1.0) == (9, 9, 9)  # at/after the last key: post


def test_catmullrom_passes_through_keys():
    frames = parse_channel({
        "0.0": {"post": [0, 0, 0], "lerp_mode": "catmullrom"},
        "1.0": {"post": [10, 0, 0], "lerp_mode": "catmullrom"},
        "2.0": {"post": [0, 0, 0], "lerp_mode": "catmullrom"},
    })
    assert sample(frames, 1.0)[0] == pytest.approx(10)
    # Smooth curve overshoots linear between 0 and 1 near the peak.
    assert sample(frames, 0.75)[0] > 7.5


def test_numeric_strings_ok_but_molang_unbakeable():
    assert sample(parse_channel(["1.5", "0", "0"]), 0) == (1.5, 0, 0)
    with pytest.raises(Unbakeable):
        parse_channel(["math.sin(q.life_time * 90)", 0, 0])
