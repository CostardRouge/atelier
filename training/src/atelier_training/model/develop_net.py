"""The DEVELOP predictor (M6): the picture as shot in, the eleven sliders of ``DevelopSettings`` out.

A small CNN on the vignette, joined with the histogram and linear means
Atelier's Auto verbs read and five camera facts, ends in eleven numbers each
squashed to its slider's own range (``tanh × range``), so the record it
writes is always one Atelier accepts. Exported to ONNX for the browser.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import Tensor, nn

from ..records import EXIF_KEYS, RANGES, SLIDERS, STATS_BINS
from .lut3d import WeightNet

STATS_DIM = STATS_BINS + 3
EXIF_DIM = len(EXIF_KEYS)


class DevelopNet(nn.Module):
    def __init__(self, thumb: int = 128, width: int = 16, hidden: int = 128):
        super().__init__()
        self.thumb = thumb
        backbone = WeightNet(basis=1, width=width, thumb=thumb)
        self.features = backbone.features  # the same stride-2 stack, ending on an average pool
        feat_dim = backbone.head.in_channels
        self.side = nn.Sequential(nn.Linear(STATS_DIM + EXIF_DIM, 64), nn.LeakyReLU(0.2, inplace=True))
        self.head = nn.Sequential(
            nn.Linear(feat_dim + 64, hidden), nn.LeakyReLU(0.2, inplace=True), nn.Dropout(0.2),
            nn.Linear(hidden, len(SLIDERS)),
        )
        nn.init.zeros_(self.head[-1].weight)
        nn.init.zeros_(self.head[-1].bias)  # starts on "do nothing": every slider at 0
        self.register_buffer("ranges", torch.tensor(RANGES, dtype=torch.float32))

    def thumbnail(self, img: Tensor) -> Tensor:
        if img.shape[-2:] == (self.thumb, self.thumb):
            return img
        return F.interpolate(img, size=(self.thumb, self.thumb), mode="bilinear", align_corners=False,
                             antialias=True)

    def forward(self, img: Tensor, stats: Tensor, exif: Tensor) -> Tensor:
        """``img`` (B, 3, H, W) in [0, 1]; ``stats`` (B, 67); ``exif`` (B, 5) → (B, 11) sliders in their own units."""
        f = self.features(self.thumbnail(img)).flatten(1)
        s = self.side(torch.cat([stats, exif], dim=1))
        raw = self.head(torch.cat([f, s], dim=1))
        return torch.tanh(raw) * self.ranges

    @staticmethod
    def from_config(cfg: dict) -> DevelopNet:
        return DevelopNet(thumb=int(cfg.get("thumb", 128)), width=int(cfg.get("width", 16)),
                          hidden=int(cfg.get("hidden", 128)))


def normalised_error(pred: Tensor, target: Tensor) -> Tensor:
    """Smooth L1 on sliders scaled to [-1, 1], so exposure (±3) and a band (±100) weigh the same."""
    ranges = torch.tensor(RANGES, dtype=pred.dtype, device=pred.device)
    return F.smooth_l1_loss(pred / ranges, target / ranges, beta=0.05)
