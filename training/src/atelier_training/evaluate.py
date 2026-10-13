"""``atelier-train eval``: score a run on whole pictures and draw the grids.

Writes ``<run>/eval/<split>.json`` (the summary and one row per pair) and
``<run>/eval/grids/<id>.jpg`` — ``input | his edit | model`` side by side,
the first ``--grids`` pairs, worst ΔE first so what the model gets wrong is on
top. The dashboard of M3 reads these files and nothing else.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
from torch import Tensor

from .config import Config
from .data import read_index, split
from .imaging import save_image
from .train import Run, evaluate_pairs, load_model


def _np(t: Tensor) -> np.ndarray:
    return t.detach().clamp(0, 1).permute(1, 2, 0).cpu().numpy()


def grid(a: np.ndarray, b: np.ndarray, out: np.ndarray, gap: int = 4) -> np.ndarray:
    """``input | target | output`` with a thin white gap, the three at one height."""
    spacer = np.ones((a.shape[0], gap, 3), dtype=np.float32)
    return np.concatenate([a, spacer, b, spacer, out], axis=1)


def evaluate(
    config: Config,
    run_folder: Path,
    which_split: str = "validation",
    grids: int = 24,
    sources: list[str] | None = None,
    log: Callable[[str], None] = print,
) -> dict:
    model, run = load_model(run_folder)
    tcfg = run.config.get("train", {})
    pairs = read_index(config.paths.cache, sources or run.sources)
    train_pairs, val_pairs = split(pairs, float(tcfg.get("val_fraction", 0.1)), int(tcfg.get("seed", 1)))
    chosen = {"validation": val_pairs, "train": train_pairs, "all": pairs}[which_split]
    if not chosen:
        raise RuntimeError(f"no pair in the {which_split} split.")

    out_dir = run.folder / "eval"
    grids_dir = out_dir / "grids"
    grids_dir.mkdir(parents=True, exist_ok=True)
    drawn: dict[str, np.ndarray] = {}

    def keep(pid: str, a: Tensor, b: Tensor, out: Tensor) -> None:
        drawn[pid] = grid(_np(a), _np(b), _np(out))

    summary = evaluate_pairs(model, chosen, run.device, keep=keep)
    worst_first = sorted(summary["pairs"], key=lambda r: -r["de2000_mean"])
    for row in worst_first[:grids]:
        save_image(drawn[row["id"]], grids_dir / (row["id"].replace("/", "__") + ".jpg"), quality=88)
    summary["split"] = which_split
    summary["grids"] = [row["id"] for row in worst_first[:grids]]
    (out_dir / f"{which_split}.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"{which_split}: {len(chosen)} pairs — PSNR {summary['psnr']:.2f} dB, "
        f"ΔE2000 mean {summary['de2000_mean']:.2f} (95th pct {summary['de2000_p95']:.2f}), "
        f"ΔE76 mean {summary['de76_mean']:.2f}")
    log(f"grids: {min(grids, len(chosen))} written to {grids_dir}")
    return summary


def latest_eval(run: Run) -> dict | None:
    folder = run.folder / "eval"
    if not folder.is_dir():
        return None
    files = sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime)
    return json.loads(files[-1].read_text(encoding="utf-8")) if files else None
