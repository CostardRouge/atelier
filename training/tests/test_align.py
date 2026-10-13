import numpy as np
import pytest

from atelier_training.align import MIN_SCORE, align_pair, apply_turn, find_alignment, rotate
from atelier_training.imaging import resize_to
from atelier_training.synthetic import apply_transform, make_picture


def picture(seed=4, w=240, h=160):
    return make_picture(np.random.default_rng(seed), w, h)


def test_the_whole_picture_aligns_to_itself():
    img = picture()
    a = find_alignment(img, apply_transform("contrast", img))
    assert a.turn == "none" and a.angle == 0.0 and a.score > 0.97
    assert abs(a.x0) <= 2 and abs(a.y0) <= 2 and abs(a.w - 240) <= 4 and abs(a.h - 160) <= 4


def test_a_cropped_resized_and_graded_edit_is_found():
    img = picture()
    crop = img[30:130, 60:200]  # 140 × 100
    edit = resize_to(apply_transform("warm", crop), 84, 60)  # downsized to 60 %
    cut, a = align_pair(img, edit)
    assert a.turn == "none" and a.score > 0.9
    assert abs(a.x0 - 60) <= 3 and abs(a.y0 - 30) <= 3 and abs(a.w - 140) <= 5 and abs(a.h - 100) <= 5
    assert abs(a.scale - 0.6) < 0.05
    # The cut, resized to the edit's size, is the edit's own pixels within a hair.
    back = resize_to(cut, 84, 60)
    assert np.abs(back - resize_to(crop, 84, 60)).mean() < 0.03


@pytest.mark.parametrize("turn", ["cw", "ccw", "half", "mirror"])
def test_a_turned_edit_is_found(turn):
    img = picture(seed=9)
    turned = apply_turn(img, turn)
    crop = turned[10:-10, 20:-20]
    cut, a = align_pair(img, apply_transform("faded", crop))
    assert a.turn == turn and a.score > 0.9
    assert np.abs(resize_to(cut, crop.shape[1], crop.shape[0]) - crop).mean() < 0.03


def test_a_straightened_edit_is_found_within_a_degree():
    img = picture(seed=5, w=260, h=180)
    straight = rotate(img, 3.0)
    crop = straight[30:150, 40:220]
    cut, a = align_pair(img, crop)
    assert abs(a.angle - 3.0) <= 1.0 and a.score > 0.85
    assert np.abs(resize_to(cut, crop.shape[1], crop.shape[0]) - crop).mean() < 0.05


def test_an_unrelated_picture_is_refused():
    a, b = picture(seed=1), picture(seed=2)
    assert find_alignment(a, b).score < MIN_SCORE
    with pytest.raises(ValueError, match="does not match"):
        align_pair(a, b)
