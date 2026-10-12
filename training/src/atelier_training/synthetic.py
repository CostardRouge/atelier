"""A tiny SYNTHETIC dataset: procedural pictures and KNOWN colour transforms.

It exists so every command and every test runs without real data, and so a
model can be checked against a truth: each transform is pointwise, so its
exact 3D LUT is baked beside the pictures (``luts/<name>.cube``) and M2's
model should recover it. Laid out exactly like the real data — groups with a
``manifest.toml`` under ``pairs/``, and a FiveK-shaped folder under ``fivek/``
(16-bit TIFF inputs, ``expertC/`` targets) — so the readers are exercised as is.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np

from . import lut
from .datasets.pairs import manifest_text
from .imaging import save_image

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _srgb_to_linear(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _luma(x: np.ndarray) -> np.ndarray:
    return (x @ LUMA)[..., None]


def warm(x: np.ndarray) -> np.ndarray:
    return np.clip(np.power(np.clip(x * np.array([1.06, 1.0, 0.9], np.float32), 0, 1), 0.95), 0, 1)


def contrast(x: np.ndarray) -> np.ndarray:
    c = 6.0
    s = 1 / (1 + np.exp(-c * (x - 0.5)))
    lo, hi = 1 / (1 + np.exp(c / 2)), 1 / (1 + np.exp(-c / 2))
    return (s - lo) / (hi - lo)


def teal_orange(x: np.ndarray) -> np.ndarray:
    tint = (_luma(x) - 0.5) * np.array([0.16, 0.02, -0.16], np.float32)
    return np.clip(x + tint, 0, 1)


def faded(x: np.ndarray) -> np.ndarray:
    y = 0.6 * x + 0.4 * _luma(x)
    return 0.06 + 0.9 * y


def brighter(x: np.ndarray) -> np.ndarray:
    return _linear_to_srgb(_srgb_to_linear(x) * 1.41)


TRANSFORMS: dict[str, Callable[[np.ndarray], np.ndarray]] = {
    "warm": warm,
    "contrast": contrast,
    "teal-orange": teal_orange,
    "faded": faded,
    "brighter": brighter,
}


def apply_transform(name: str, img: np.ndarray) -> np.ndarray:
    return np.clip(TRANSFORMS[name](img.astype(np.float32)), 0, 1).astype(np.float32)


def make_picture(rng: np.random.Generator, width: int, height: int) -> np.ndarray:
    """Gradients, flat colour patches, soft blobs and a little noise: every hue and every level."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    u, v = xx / max(width - 1, 1), yy / max(height - 1, 1)
    a, b = rng.uniform(0, 2 * np.pi, size=2)
    img = np.stack(
        [0.5 + 0.5 * np.sin(2 * np.pi * (u * np.cos(a) + v * np.sin(a)) + k * 2.1 + b) for k in range(3)],
        axis=-1,
    )
    for _ in range(rng.integers(2, 5)):
        cx, cy, r = rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0.1, 0.35)
        w = np.exp(-(((u - cx) ** 2 + (v - cy) ** 2) / (2 * r * r)))[..., None]
        img = img * (1 - w) + rng.uniform(0, 1, size=3) * w
    ph, pw = max(1, height // 4), max(1, width // 6)
    for _ in range(4):
        y0, x0 = rng.integers(0, max(height - ph, 1)), rng.integers(0, max(width - pw, 1))
        img[y0 : y0 + ph, x0 : x0 + pw] = rng.uniform(0, 1, size=3)
    img += rng.normal(0, 0.01, size=img.shape)
    return np.clip(img, 0, 1).astype(np.float32)


def generate(
    out: Path,
    groups: int = 12,
    size: tuple[int, int] = (96, 64),
    edits_per_group: int = 3,
    fivek_photos: int = 8,
    seed: int = 7,
    lut_size: int = 33,
) -> dict:
    """Write the synthetic set under ``out`` and return what ``truth.json`` says."""
    rng = np.random.default_rng(seed)
    width, height = size
    names = list(TRANSFORMS)
    truth: dict = {"seed": seed, "transforms": names, "pairs": {}, "fivek": {}}

    for g in range(groups):
        folder = out / "pairs" / f"group-{g + 1:03d}"
        original = make_picture(rng, width, height)
        save_image(original, folder / "original.png")
        chosen = rng.choice(len(names), size=min(edits_per_group, len(names)), replace=False)
        edits: list[tuple[str, str | None]] = []
        for k in chosen:
            name = names[int(k)]
            file = f"edit-{name}.png"
            save_image(apply_transform(name, original), folder / file)
            edits.append((file, name))
        (folder / "manifest.toml").write_text(manifest_text("original.png", edits), encoding="utf-8")
        truth["pairs"][folder.name] = [label for _, label in edits]

    # FiveK-shaped: 16-bit TIFF inputs, expert C's edits all made by one transform (one "expert style").
    expert_style = "teal-orange"
    for i in range(fivek_photos):
        pid = f"a{i + 1:04d}"
        picture = make_picture(rng, width, height)
        save_image(picture, out / "fivek" / "raw_photos" / "HQa1to700" / "photos" / f"{pid}-synth.tif")
        save_image(apply_transform(expert_style, picture), out / "fivek" / "expertC" / f"{pid}.tif")
        truth["fivek"][pid] = expert_style

    for name in names:
        cube = lut.from_function(TRANSFORMS[name], size=lut_size, title=f"synthetic {name}")
        cube.comments.append("Ground truth of the synthetic set (atelier-training).")
        lut.write_cube(cube, out / "luts" / f"{name}.cube")

    (out / "truth.json").write_text(json.dumps(truth, indent=2), encoding="utf-8")
    return truth
