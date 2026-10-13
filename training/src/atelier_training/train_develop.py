"""``train-develop``, ``eval-develop``, ``export-develop``: the sliders predictor over his records.

A run lives under ``runs/<date>-develop-<name>/`` like a LUT run: ``config.toml``,
``metrics.jsonl`` (one line per epoch: the loss, the validation MAE per slider
in its own units, and the MAE of "predict nothing" as the bar to beat),
``best.pt`` / ``last.pt``. ``export-develop`` writes ``develop-net.onnx`` plus
``develop-net.json`` (the input names, the slider order and ranges, the
thumbnail size) — what Atelier's ``onnxruntime-web`` will load (B4 of
``docs/auto-develop.md``) — and checks the ONNX answers the torch model.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

from .config import Config, merge
from .data import is_validation
from .device import pick_device
from .imaging import load_image
from .model.develop_net import DevelopNet, normalised_error
from .records import EXIF_KEYS, RANGES, SLIDERS, read_records
from .train import Run, _toml_dump, load_checkpoint, load_run, save_checkpoint


class RecordDataset(Dataset):
    def __init__(self, rows: list[dict], root: Path, augment: bool = False, seed: int = 0):
        self.rows, self.root, self.augment = rows, root, augment
        self.rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        row = self.rows[i]
        rec = row["record"]
        img = load_image(self.root / row["folder"] / "vignette.png")
        if self.augment and self.rng.random() < 0.5:
            img = img[:, ::-1]
        x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)))
        stats = torch.tensor(rec["stats"], dtype=torch.float32)
        exif = torch.tensor(rec["exif"], dtype=torch.float32)
        y = torch.tensor([rec["sliders"][k] for k in SLIDERS], dtype=torch.float32)
        return x, stats, exif, y, row["id"]


def split_records(rows: list[dict], fraction: float, seed: int) -> tuple[list[dict], list[dict]]:
    val = [r for r in rows if is_validation(r["id"], fraction, seed)]
    train = [r for r in rows if not is_validation(r["id"], fraction, seed)]
    if fraction > 0 and len(rows) >= 2 and (not val or not train):
        val, train = rows[-1:], rows[:-1]
    return train, val


@torch.no_grad()
def evaluate_records(model: DevelopNet, rows: list[dict], root: Path, device: str) -> dict:
    model.eval()
    ds = RecordDataset(rows, root)
    loader = DataLoader(ds, batch_size=32)
    preds, targets, ids = [], [], []
    for x, stats, exif, y, pid in loader:
        out = model(x.to(device), stats.to(device), exif.to(device)).cpu()
        preds.append(out)
        targets.append(y)
        ids.extend(pid)
    p = torch.cat(preds).numpy() if preds else np.zeros((0, len(SLIDERS)))
    t = torch.cat(targets).numpy() if targets else np.zeros((0, len(SLIDERS)))
    mae = np.abs(p - t).mean(axis=0) if len(t) else np.zeros(len(SLIDERS))
    zero = np.abs(t).mean(axis=0) if len(t) else np.zeros(len(SLIDERS))
    ranges = np.asarray(RANGES)
    return {
        "mae": {k: float(v) for k, v in zip(SLIDERS, mae, strict=True)},
        "mae_normalised": float((mae / ranges).mean()),
        "zero_mae_normalised": float((zero / ranges).mean()),
        "pairs": [{"id": pid, **{k: float(v) for k, v in zip(SLIDERS, row, strict=True)}}
                  for pid, row in zip(ids, p, strict=True)],
    }


def train_develop(config: Config, name: str | None = None, epochs: int | None = None,
                  resume: Path | None = None, log: Callable[[str], None] = print) -> Run:
    dcfg = config.section("develop")
    root = config.paths.data / "records"
    rows = read_records(root)
    if len(rows) < 2:
        raise RuntimeError("fewer than two records: run `atelier-train records <training file>` first.")
    device = pick_device(str(config.section("device").get("prefer", "auto")))
    torch.manual_seed(int(dcfg.get("seed", 1)))
    if resume is not None:
        run = load_run(resume)
        cfg, state = run.config, load_checkpoint(run.folder / "last.pt", device)
        dcfg = dict(cfg.get("develop", {}))
    else:
        word = name or str(dcfg.get("name") or "") or "records"
        folder = config.paths.runs / f"{time.strftime('%Y%m%d-%H%M%S')}-develop-{word}"
        folder.mkdir(parents=True, exist_ok=False)
        cfg = merge(config.values, {"develop": {"kind": "develop-net"}})
        (folder / "config.toml").write_text(_toml_dump(cfg).lstrip() + "\n", encoding="utf-8")
        run, state = Run(folder=folder, config=cfg, device=device), None

    train_rows, val_rows = split_records(rows, float(dcfg.get("val_fraction", 0.15)), int(dcfg.get("seed", 1)))
    (run.folder / "split.json").write_text(json.dumps({"train": [r["id"] for r in train_rows],
                                                       "validation": [r["id"] for r in val_rows]}, indent=1),
                                           encoding="utf-8")
    model = DevelopNet.from_config(dcfg).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=float(dcfg.get("learning_rate", 3e-4)),
                                  weight_decay=float(dcfg.get("weight_decay", 1e-4)))
    start, best = 0, float("inf")
    if state is not None:
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        start, best = int(state["epoch"]), float(state.get("best", float("inf")))
    total = epochs or int(dcfg.get("epochs", 60))
    loader = DataLoader(RecordDataset(train_rows, root, augment=True, seed=int(dcfg.get("seed", 1))),
                        batch_size=int(dcfg.get("batch_size", 16)), shuffle=True)
    eval_every = max(1, int(dcfg.get("eval_every", 2)))
    log(f"run {run.folder.name}: {len(train_rows)} records to learn from, {len(val_rows)} to check, "
        f"on {device.upper()}, {total} epochs")
    for epoch in range(start + 1, total + 1):
        model.train()
        t0, total_loss, count = time.perf_counter(), 0.0, 0
        for x, stats, exif, y, _ in loader:
            x, stats, exif, y = x.to(device), stats.to(device), exif.to(device), y.to(device)
            loss = normalised_error(model(x, stats, exif), y)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach()) * x.shape[0]
            count += x.shape[0]
        record = {"epoch": epoch, "seconds": round(time.perf_counter() - t0, 2), "loss": total_loss / max(count, 1)}
        if val_rows and (epoch % eval_every == 0 or epoch == total):
            summary = evaluate_records(model, val_rows, root, device)
            record["val_mae"] = summary["mae_normalised"]
            record["val_zero_mae"] = summary["zero_mae_normalised"]
            record.update({f"val_mae_{k}": v for k, v in summary["mae"].items()})
            if summary["mae_normalised"] < best:
                best = summary["mae_normalised"]
                save_checkpoint(run.folder / "best.pt", model, optimizer, epoch, best, cfg)
        elif not val_rows:
            save_checkpoint(run.folder / "best.pt", model, optimizer, epoch, best, cfg)
        save_checkpoint(run.folder / "last.pt", model, optimizer, epoch, best, cfg)
        run.log(record)
        line = f"  epoch {epoch}/{total}  loss {record['loss']:.4f}"
        if "val_mae" in record:
            line += f"  val MAE {record['val_mae']:.4f} (nothing: {record['val_zero_mae']:.4f})"
        log(line + f"  ({record['seconds']} s)")
    return run


def load_develop_model(run_folder: Path, which: str = "best") -> tuple[DevelopNet, Run]:
    run = load_run(run_folder)
    path = run.folder / f"{which}.pt"
    state = load_checkpoint(path if path.is_file() else run.folder / "last.pt", run.device)
    model = DevelopNet.from_config(run.config.get("develop", {})).to(run.device)
    model.load_state_dict(state["model"])
    model.eval()
    return model, run


def eval_develop(config: Config, run_folder: Path, which_split: str = "validation",
                 log: Callable[[str], None] = print) -> dict:
    model, run = load_develop_model(run_folder)
    root = config.paths.data / "records"
    rows = read_records(root)
    dcfg = run.config.get("develop", {})
    train_rows, val_rows = split_records(rows, float(dcfg.get("val_fraction", 0.15)), int(dcfg.get("seed", 1)))
    chosen = {"validation": val_rows, "train": train_rows, "all": rows}[which_split]
    if not chosen:
        raise RuntimeError(f"no record in the {which_split} split.")
    summary = evaluate_records(model, chosen, root, run.device)
    summary["split"] = which_split
    out = run.folder / "eval"
    out.mkdir(exist_ok=True)
    (out / f"{which_split}.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"{which_split}: {len(chosen)} records — MAE {summary['mae_normalised']:.4f} of the range "
        f"(predicting nothing: {summary['zero_mae_normalised']:.4f})")
    worst = sorted(summary["mae"].items(), key=lambda kv: -kv[1] / RANGES[SLIDERS.index(kv[0])])[:4]
    log("per slider: " + ", ".join(f"{k} ±{v:.1f}" for k, v in worst))
    return summary


def export_develop(run_folder: Path, out: Path | None = None, log: Callable[[str], None] = print) -> Path:
    """``develop-net.onnx`` + its JSON sidecar; the ONNX is run back through onnxruntime against torch."""
    model, run = load_develop_model(run_folder)
    model = model.cpu().eval()
    dcfg = run.config.get("develop", {})
    thumb = int(dcfg.get("thumb", 128))
    target = out or run.folder / "develop-net.onnx"
    example = (torch.rand(1, 3, thumb, thumb), torch.rand(1, len(model.side[0].weight[0]) - len(EXIF_KEYS)),
               torch.zeros(1, len(EXIF_KEYS)))
    try:
        import onnx  # noqa: F401
    except ImportError as e:
        raise RuntimeError("exporting needs the `onnx` extra: `uv sync --extra onnx`") from e
    # The torch.export-based exporter (the default since 2.9; needs `onnxscript`), the TorchScript one as
    # the fallback where it refuses this graph — the browser runs one picture at a time, so no dynamic batch.
    try:
        torch.onnx.export(model, example, str(target), input_names=["vignette", "stats", "exif"],
                          output_names=["sliders"], dynamo=True, opset_version=18)
    except Exception as first:  # noqa: BLE001
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            try:
                torch.onnx.export(model, example, str(target), input_names=["vignette", "stats", "exif"],
                                  output_names=["sliders"], dynamo=False, opset_version=17)
            except Exception as second:
                raise RuntimeError(f"ONNX export failed both ways: {first}; then {second}") from second
        log("note: exported through the legacy TorchScript exporter")
    sidecar = {
        "kind": "atelier/develop-net", "version": 1, "run": run.folder.name, "thumb": thumb,
        "inputs": {"vignette": f"(1, 3, {thumb}, {thumb}) RGB in [0, 1], the picture as shot",
                   "stats": "(1, 67): the histogram resampled to 64 fractions, then the three linear means",
                   "exif": f"(1, {len(EXIF_KEYS)}): " + ", ".join(EXIF_KEYS)
                   + " as log2(iso/100), log2(seconds), log2(f), log2(focal35/35), bias"},
        "output": {"sliders": list(SLIDERS), "ranges": list(RANGES)},
    }
    target.with_suffix(".json").write_text(json.dumps(sidecar, indent=1), encoding="utf-8")
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
        got = session.run(None, {"vignette": example[0].numpy(), "stats": example[1].numpy(),
                                 "exif": example[2].numpy()})[0]
        with torch.no_grad():
            want = model(*example).numpy()
        gap = float(np.abs(got - want).max())
        if gap > 1e-3:
            raise RuntimeError(f"the ONNX answers differ from torch by {gap:.4f}")
        log(f"wrote {target} ({target.stat().st_size / 1e6:.1f} MB), checked against torch (max gap {gap:.2e})")
    except ImportError:
        log(f"wrote {target} (onnxruntime not installed: not run back)")
    return target
