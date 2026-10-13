import numpy as np
import pytest

from atelier_training import lut
from atelier_training.synthetic import TRANSFORMS, make_picture


def test_identity_round_trip_is_exact(tmp_path):
    cube = lut.identity(17)
    path = lut.write_cube(cube, tmp_path / "id.cube")
    back = lut.read_cube(path)
    assert back.size == 17
    assert back.title == "Identity 17"
    np.testing.assert_allclose(back.table, cube.table, atol=1e-6)


def test_file_rows_are_red_fastest(tmp_path):
    text = lut.to_text(lut.identity(2)).splitlines()
    rows = [line for line in text if line[0].isdigit()]
    assert rows[:4] == ["0.000000 0.000000 0.000000", "1.000000 0.000000 0.000000",
                        "0.000000 1.000000 0.000000", "1.000000 1.000000 0.000000"]


def test_identity_apply_returns_the_image():
    img = make_picture(np.random.default_rng(0), 40, 30)
    np.testing.assert_allclose(lut.apply(lut.identity(9), img), img, atol=1e-5)


@pytest.mark.parametrize("name", list(TRANSFORMS))
def test_baked_transform_matches_the_function(name):
    img = make_picture(np.random.default_rng(1), 64, 48)
    cube = lut.from_function(TRANSFORMS[name], size=33)
    err = np.abs(lut.apply(cube, img) - np.clip(TRANSFORMS[name](img), 0, 1)).max()
    assert err < 0.01, f"{name}: {err}"


def test_domain_and_comments_survive(tmp_path):
    cube = lut.identity(3)
    cube.domain_max = (2.0, 2.0, 2.0)
    cube.comments.append("hello")
    back = lut.parse_cube(lut.to_text(cube))
    assert back.domain_max == (2.0, 2.0, 2.0)
    assert back.comments == ["hello"]


@pytest.mark.parametrize(
    "text",
    ["LUT_1D_SIZE 2\n0 0 0\n1 1 1\n", "0 0 0\n", "LUT_3D_SIZE 2\n0 0 0\n"],
)
def test_bad_files_are_refused(text):
    with pytest.raises(lut.CubeFormatError):
        lut.parse_cube(text)
