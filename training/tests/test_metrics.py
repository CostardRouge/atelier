import numpy as np
import pytest

from atelier_training.metrics import delta_e76, delta_e2000, psnr, score, srgb_to_lab


def test_known_lab_values():
    lab = srgb_to_lab(np.array([[1.0, 1.0, 1.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.5, 0.5, 0.5]]))
    np.testing.assert_allclose(lab[0], [100.0, 0.0, 0.0], atol=0.05)
    np.testing.assert_allclose(lab[1], [0.0, 0.0, 0.0], atol=1e-6)
    np.testing.assert_allclose(lab[2], [53.24, 80.09, 67.20], atol=0.05)
    np.testing.assert_allclose(lab[3], [53.39, 0.0, 0.0], atol=0.05)


@pytest.mark.parametrize(
    "lab1, lab2, expected",
    [  # Sharma, Wu & Dalal (2005), test data pairs 1, 7, 17, 25
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
        ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
        ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
    ],
)
def test_ciede2000_against_the_reference_pairs(lab1, lab2, expected):
    assert abs(float(delta_e2000(np.array(lab1), np.array(lab2))) - expected) < 1e-3


def test_delta_e76_and_psnr():
    assert float(delta_e76(np.array([50.0, 0, 0]), np.array([50.0, 3, 4]))) == 5.0
    a = np.full((4, 4, 3), 0.5)
    assert psnr(a, a) == float("inf")
    assert abs(psnr(a, a + 0.1) - 20.0) < 1e-6


def test_score_is_zero_on_identical_pictures():
    img = np.random.default_rng(0).random((8, 8, 3))
    s = score(img, img)
    assert s["de76_mean"] == 0.0 and s["de2000_mean"] == 0.0 and s["psnr"] == float("inf")
