"""The image-adaptive 3D LUT (Zeng et al., TPAMI 2020).

A small CNN looks at a THUMBNAIL of the picture and answers a few numbers: the
weights of ``basis`` learned 3D LUTs. Their weighted sum is the LUT of THIS
picture, applied trilinearly to the full-size pixels — exactly what Atelier
does with a ``.cube`` (``lut.py``'s ``apply`` is the numpy twin of
``apply_lut``, and the tests hold them equal). So the model is tiny (the CNN
is ~250 k parameters at width 16; the LUTs ~1.3 MB at 33³ × 3) and what it
learns leaves as a plain ``.cube`` file.

Two regularisers keep every basis LUT a LOOK rather than a lookup of noise:
smoothness (squared differences between neighbouring nodes) and monotonicity
(each channel never decreases along its own axis, so no tone reversal).

A LUT lives as ``(3, N, N, N)`` indexed ``[channel, b, g, r]`` — the same
``[b, g, r]`` order as ``lut.Cube.table`` moved channels-first for torch.
"""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as F
from torch import Tensor, nn


def identity_lut(size: int) -> Tensor:
    """``(3, N, N, N)`` identity: the node's own colour, channels first."""
    axis = torch.linspace(0.0, 1.0, size)
    b, g, r = torch.meshgrid(axis, axis, axis, indexing="ij")
    return torch.stack([r, g, b], dim=0)


def apply_lut(lut: Tensor, img: Tensor) -> Tensor:
    """Trilinear lookup. ``lut`` ``(B, 3, N, N, N)`` or ``(3, N, N, N)``; ``img`` ``(B, 3, H, W)`` in [0, 1].

    Written with gathers rather than ``grid_sample`` so it runs the same on CPU, MPS and CUDA
    (3-D ``grid_sample`` has no MPS kernel), and so it IS the numpy ``lut.apply`` to the bit.
    """
    if lut.dim() == 4:
        lut = lut.unsqueeze(0).expand(img.shape[0], -1, -1, -1, -1)
    B, _, N, _, _ = lut.shape
    x = img.clamp(0.0, 1.0) * (N - 1)
    i0 = x.floor().clamp(max=N - 2).long()
    f = x - i0
    r0, g0, b0 = i0[:, 0], i0[:, 1], i0[:, 2]  # (B, H, W)
    fr, fg, fb = f[:, 0:1], f[:, 1:2], f[:, 2:3]  # (B, 1, H, W)
    flat = lut.reshape(B, 3, -1)  # (B, 3, N³), index = b·N² + g·N + r
    out = torch.zeros_like(img)
    for db, wb in ((0, 1 - fb), (1, fb)):
        for dg, wg in ((0, 1 - fg), (1, fg)):
            for dr, wr in ((0, 1 - fr), (1, fr)):
                idx = ((b0 + db) * N + (g0 + dg)) * N + (r0 + dr)  # (B, H, W)
                gathered = flat.gather(2, idx.reshape(B, 1, -1).expand(-1, 3, -1)).reshape_as(img)
                out = out + gathered * (wb * wg * wr)
    return out


def smoothness(luts: Tensor) -> Tensor:
    """Mean squared step between neighbouring nodes along the three axes, over ``(K, 3, N, N, N)``."""
    d = 0.0
    for axis in (2, 3, 4):
        a = luts.narrow(axis, 1, luts.shape[axis] - 1) - luts.narrow(axis, 0, luts.shape[axis] - 1)
        d = d + (a**2).mean()
    return d


def monotonicity(luts: Tensor) -> Tensor:
    """How much each channel DEcreases along its own axis (0 for a LUT that never reverses a tone).

    Axis 4 is red, 3 green, 2 blue in ``[b, g, r]`` order; channel 0 is red, 1 green, 2 blue.
    """
    penalty = 0.0
    for channel, axis in ((0, 4), (1, 3), (2, 2)):
        c = luts[:, channel]
        step = c.narrow(axis - 1, 1, c.shape[axis - 1] - 1) - c.narrow(axis - 1, 0, c.shape[axis - 1] - 1)
        penalty = penalty + F.relu(-step).mean()
    return penalty


class WeightNet(nn.Module):
    """The paper's classifier: stride-2 convolutions on the thumbnail, then the ``basis`` weights.

    Five stages at the paper's 256 px thumbnail; fewer on a smaller one, so the last map is never a
    single pixel (InstanceNorm needs more than one, in training and out of it).
    """

    def __init__(self, basis: int = 3, width: int = 16, dropout: float = 0.5, thumb: int = 256):
        super().__init__()
        stages = max(1, min(5, int(math.log2(max(thumb, 2))) - 1))
        widths = [width, 2 * width, 4 * width, 8 * width, 8 * width][:stages]
        layers: list[nn.Module] = []
        previous = 3
        for i, w in enumerate(widths):
            layers.append(nn.Conv2d(previous, w, 3, stride=2, padding=1))
            if i > 0:
                layers.append(nn.InstanceNorm2d(w, affine=True))
            layers.append(nn.LeakyReLU(0.2, inplace=True))
            previous = w
        layers += [nn.Dropout(dropout), nn.AdaptiveAvgPool2d(1)]
        self.features = nn.Sequential(*layers)
        self.head = nn.Conv2d(previous, basis, 1)
        nn.init.zeros_(self.head.weight)
        with torch.no_grad():  # starts on the identity LUT alone: the picture leaves as it came
            self.head.bias.zero_()
            self.head.bias[0] = 1.0

    def forward(self, thumb: Tensor) -> Tensor:
        return self.head(self.features(thumb)).flatten(1)  # (B, basis)


class AdaptiveLUT(nn.Module):
    def __init__(self, lut_size: int = 33, basis: int = 3, thumb: int = 256, width: int = 16):
        super().__init__()
        self.lut_size, self.basis, self.thumb = lut_size, basis, thumb
        luts = torch.zeros(basis, 3, lut_size, lut_size, lut_size)
        luts[0] = identity_lut(lut_size)
        self.luts = nn.Parameter(luts)
        self.weights = WeightNet(basis, width, thumb=thumb)

    def thumbnail(self, img: Tensor) -> Tensor:
        if img.shape[-2:] == (self.thumb, self.thumb):
            return img
        return F.interpolate(img, size=(self.thumb, self.thumb), mode="bilinear", align_corners=False,
                             antialias=True)

    def predict_lut(self, img: Tensor) -> tuple[Tensor, Tensor]:
        """The picture's own LUT ``(B, 3, N, N, N)`` and the weights that made it ``(B, basis)``."""
        w = self.weights(self.thumbnail(img))
        lut = torch.einsum("bk,kcxyz->bcxyz", w, self.luts)
        return lut, w

    def forward(self, img: Tensor) -> tuple[Tensor, Tensor]:
        lut, w = self.predict_lut(img)
        return apply_lut(lut, img), w

    def lut_from_weights(self, w: Tensor) -> Tensor:
        """``(basis,)`` → ``(3, N, N, N)``: the LUT a set of weights names (the run's MEAN look, say)."""
        return torch.einsum("k,kcxyz->cxyz", w, self.luts)

    def regularisers(self) -> tuple[Tensor, Tensor]:
        return smoothness(self.luts), monotonicity(self.luts)

    @staticmethod
    def from_config(model_cfg: dict) -> AdaptiveLUT:
        return AdaptiveLUT(
            lut_size=int(model_cfg.get("lut_size", 33)),
            basis=int(model_cfg.get("basis", 3)),
            thumb=int(model_cfg.get("thumb", 256)),
            width=int(model_cfg.get("width", 16)),
        )


def lut_to_table(lut: Tensor) -> np.ndarray:
    """``(3, N, N, N)`` torch → ``(N, N, N, 3)`` numpy indexed ``[b, g, r]``, what ``lut.Cube`` holds."""
    return np.clip(lut.detach().cpu().float().permute(1, 2, 3, 0).numpy(), 0.0, 1.0)
