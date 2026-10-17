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
    written = run.folder / "split.json"
    if written.is_file():  # the pairs the run REALLY trained on: without those it left out, within a subset
        ids = json.loads(written.read_text(encoding="utf-8"))
        by_id = {p.id: p for p in pairs}
        train_pairs = [by_id[i] for i in ids.get("train", []) if i in by_id]
        val_pairs = [by_id[i] for i in ids.get("validation", []) if i in by_id]
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
    # The worst ΔE first, then the pairs that do not line up, so a broken pair can be SEEN.
    shown = [row["id"] for row in worst_first[:grids]]
    shown += [m["id"] for m in summary["misaligned"][:8] if m["id"] not in shown]
    for pid in shown:
        save_image(drawn[pid], grids_dir / (pid.replace("/", "__") + ".jpg"), quality=88)
    summary["split"] = which_split
    summary["grids"] = shown
    summary["years"] = by_year(summary["pairs"], {p.id: p.captured for p in chosen})
    (out_dir / f"{which_split}.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"{which_split}: {len(chosen)} pairs — PSNR {summary['psnr']:.2f} dB, "
        f"ΔE2000 mean {summary['de2000_mean']:.2f} (95th pct {summary['de2000_p95']:.2f}), "
        f"ΔE76 mean {summary['de76_mean']:.2f}")
    log(f"doing nothing (the input as it is): PSNR {summary['identity_psnr']:.2f} dB, "
        f"ΔE2000 mean {summary['identity_de2000_mean']:.2f} — the model has to beat this")
    log(f"at 1/8 size (detail and small shifts averaged out): model ΔE2000 {summary['coarse_de2000_mean']:.2f}, "
        f"doing nothing {summary['identity_coarse_de2000_mean']:.2f} — what is left is colour and light")
    log(f"best colour map per picture, fitted on the picture itself (no LUT can do better): ΔE2000 "
        f"{summary['ceiling_de2000_mean']:.2f}, at 1/8 {summary['ceiling_coarse_de2000_mean']:.2f} — what it "
        "misses depends on WHERE a pixel is (masks, a sky, a vignette)")
    bad = summary["misaligned"]
    if bad:
        log(f"{len(bad)} pair(s) whose edit does not line up with its input (structure < 0.5), worst first: "
            + ", ".join(f"{m['id']} ({m['structure']:.2f})" for m in bad[:8]))
    worst = summary.get("groups", [])[:5]
    if len(summary.get("groups", [])) > 1:
        log("worst groups: " + ", ".join(f"{g['group']} ΔE {g['de2000_mean']:.2f}" for g in worst))
    v = summary["variants"]
    if v["groups"]:
        log(f"{v['groups']} group(s) hold several edits of one original ({v['pairs']} pairs): the edits differ "
            f"from their own mean by ΔE2000 {v['spread_de2000_mean']:.2f} — seeing only the original, no model "
            f"does much better on them; this one scores {v['model_de2000_mean']:.2f} there")
    if summary["years"]:
        log("by capture year: " + " · ".join(f"{y['year']} ΔE {y['de2000_mean']:.2f} "
                                             f"(nothing {y['identity_de2000_mean']:.2f}, {y['pairs']} pairs)"
                                             for y in summary["years"]))
    log(f"grids: {len(shown)} written to {grids_dir}")
    return summary


def by_year(rows: list[dict], captured: dict[str, str | None]) -> list[dict]:
    """The mean ΔE of the rows per year their original was captured, oldest first; rows with no date are left
    out (FiveK, a local folder). Whether an old style is what the model misses shows here."""
    years: dict[str, list[dict]] = {}
    for row in rows:
        when = captured.get(row["id"])
        if when and when[:4].isdigit():
            years.setdefault(when[:4], []).append(row)
    return [{"year": y, "pairs": len(r),
             "de2000_mean": float(np.mean([x["de2000_mean"] for x in r])),
             "identity_de2000_mean": float(np.mean([x["identity_de2000_mean"] for x in r]))}
            for y, r in sorted(years.items())]


def latest_eval(run: Run) -> dict | None:
    folder = run.folder / "eval"
    if not folder.is_dir():
        return None
    files = sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime)
    return json.loads(files[-1].read_text(encoding="utf-8")) if files else None
