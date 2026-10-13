"""``atelier-train export``: what a run learned, as ``.cube`` files Atelier loads.

Two things leave a run:

- ``style.cube`` — the run's MEAN look: the basis weights averaged over the
  training pairs, turned into one LUT. The one file to drop into Atelier as a
  look ("Upload .cube"), where a creative look lands at 40 % by default.
- ``<picture>.cube`` — the LUT the model predicts for ONE picture
  (``--image``), what a per-photo automatic look will be once Atelier calls
  the model itself (M6).

Every file is 33³ (or the model's ``lut_size``), red fastest, with a TITLE
and a comment naming the run, through ``lut.write_cube``.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import torch

from . import lut
from .config import Config
from .data import read_index, split, to_tensor
from .imaging import load_image
from .model.lut3d import AdaptiveLUT, lut_to_table
from .train import Run, load_model


@torch.no_grad()
def mean_weights(model: AdaptiveLUT, pairs, device: str, limit: int = 0) -> np.ndarray:
    """The basis weights averaged over ``pairs`` (their inputs at thumbnail size)."""
    from .data import load_pair

    ws = []
    for pair in pairs[:limit] if limit else pairs:
        a, _ = load_pair(pair)
        _, w = model.predict_lut(to_tensor(a).unsqueeze(0).to(device))
        ws.append(w[0].cpu().numpy())
    return np.mean(np.stack(ws), axis=0) if ws else np.eye(1, model.basis)[0]


def _cube(model: AdaptiveLUT, table_lut: torch.Tensor, title: str, run: Run, comment: str) -> lut.Cube:
    cube = lut.Cube(table=lut_to_table(table_lut), title=title)
    cube.comments.append(f"atelier-training run {run.folder.name}: {comment}")
    return cube


@torch.no_grad()
def export_style(config: Config, run_folder: Path, limit: int = 0, log: Callable[[str], None] = print) -> Path:
    model, run = load_model(run_folder)
    tcfg = run.config.get("train", {})
    pairs = read_index(config.paths.cache, run.sources)
    train_pairs, _ = split(pairs, float(tcfg.get("val_fraction", 0.1)), int(tcfg.get("seed", 1)))
    w = mean_weights(model, train_pairs or pairs, run.device, limit)
    table = model.lut_from_weights(torch.as_tensor(w, dtype=torch.float32, device=run.device))
    cube = _cube(model, table, f"Atelier style {run.folder.name}", run,
                 f"mean of {len(train_pairs or pairs)} training pairs, weights {np.round(w, 4).tolist()}")
    path = lut.write_cube(cube, run.folder / "style.cube")
    log(f"wrote {path} (weights {np.round(w, 3).tolist()})")
    return path


@torch.no_grad()
def export_for_image(config: Config, run_folder: Path, image: Path, out: Path | None = None,
                     log: Callable[[str], None] = print) -> Path:
    model, run = load_model(run_folder)
    img = load_image(image, config.section("raw"), long_edge=model.thumb * 2)
    table, w = model.predict_lut(to_tensor(img).unsqueeze(0).to(run.device))
    cube = _cube(model, table[0], f"Atelier look for {image.stem}", run,
                 f"predicted for {image.name}, weights {np.round(w[0].cpu().numpy(), 4).tolist()}")
    path = lut.write_cube(cube, out or run.folder / f"{image.stem}.cube")
    log(f"wrote {path}")
    return path
