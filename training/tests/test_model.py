import numpy as np
import pytest

torch = pytest.importorskip("torch")

from atelier_training import lut  # noqa: E402
from atelier_training.model.lut3d import (  # noqa: E402
    AdaptiveLUT,
    apply_lut,
    identity_lut,
    lut_to_table,
    monotonicity,
    smoothness,
)
from atelier_training.synthetic import TRANSFORMS, make_picture  # noqa: E402


def test_identity_lut_matches_the_numpy_lattice():
    np.testing.assert_allclose(lut_to_table(identity_lut(9)), lut.identity(9).table, atol=1e-7)


@pytest.mark.parametrize("name", ["warm", "teal-orange"])
def test_torch_apply_is_the_numpy_apply(name):
    cube = lut.from_function(TRANSFORMS[name], size=17)
    img = make_picture(np.random.default_rng(2), 40, 24)
    expected = lut.apply(cube, img)
    t = torch.from_numpy(np.ascontiguousarray(cube.table.transpose(3, 0, 1, 2)))  # (3, N, N, N)
    got = apply_lut(t, torch.from_numpy(img.transpose(2, 0, 1).copy()).unsqueeze(0))[0]
    np.testing.assert_allclose(got.permute(1, 2, 0).numpy(), expected, atol=2e-6)


def test_regularisers_are_zero_on_the_identity_and_positive_on_noise():
    luts = identity_lut(9).unsqueeze(0)
    assert float(monotonicity(luts)) == 0.0
    assert float(smoothness(luts)) > 0  # a ramp has steps, by construction
    noisy = luts + 0.3 * torch.randn_like(luts)
    assert float(monotonicity(noisy)) > 0
    assert float(smoothness(noisy)) > float(smoothness(luts))


def test_a_fresh_model_leaves_the_picture_as_it_came():
    torch.manual_seed(0)
    model = AdaptiveLUT(lut_size=9, basis=3, thumb=16, width=4).eval()
    img = torch.rand(2, 3, 20, 30)
    out, w = model(img)
    assert torch.allclose(out, img, atol=2e-3)
    assert torch.allclose(w[:, 0], torch.ones(2)) and float(w[:, 1:].abs().max()) < 0.1


def test_every_basis_learns_from_the_first_step():
    """Zero bases under zero weights are a saddle no gradient leaves: every run before 2026-10-15 trained
    basis 0 alone. Both factors must start off zero, so the first step reaches every basis and its weight."""
    torch.manual_seed(0)
    model = AdaptiveLUT(lut_size=9, basis=4, thumb=16, width=4)
    img, target = torch.rand(2, 3, 16, 16), torch.rand(2, 3, 16, 16)
    out, _ = model(img)
    ((out - target) ** 2).mean().backward()
    for k in range(1, 4):
        assert float(model.luts.grad[k].abs().sum()) > 0, k
        assert float(model.weights.head.weight.grad[k].abs().sum()) > 0, k


def test_the_model_is_small():
    params = sum(p.numel() for p in AdaptiveLUT().parameters())
    assert params < 700_000  # three 33³ LUTs (323 k) plus a ~300 k CNN
