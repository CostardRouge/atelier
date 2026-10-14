"""``atelier-train train``: fit the adaptive LUT on the prepared pairs.

A run is a folder ``runs/<date>-<name>/`` holding the resolved ``config.toml``,
``metrics.jsonl`` (one line per epoch: losses, validation PSNR and ΔE), the
``last.pt`` and ``best.pt`` checkpoints and, once exported, the ``.cube``
files. ``--resume`` continues a run from ``last.pt``; ``--init`` starts a NEW
run from another run's weights (the fine-tune of M5). Nothing here reads the
network. ``bench`` times one step on this machine and extrapolates.
"""

from __future__ import annotations

import json
import shutil
import time
import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import DataLoader

from .config import Config, merge
from .data import Pair, PairDataset, pair_structure, read_index, split
from .device import pick_device
from .metrics import STRUCTURE_FLOOR, best_global_map, coarse, delta_e2000, score, srgb_to_lab, structure
from .model.lut3d import AdaptiveLUT


@dataclass
class Run:
    folder: Path
    config: dict
    device: str

    @property
    def sources(self) -> list[str]:
        """The sources this run trained on (written by `train`; an older run falls back to ingest's)."""
        return list(self.config.get("train", {}).get("sources") or self.config.get("ingest", {}).get("sources") or [])

    @property
    def metrics_file(self) -> Path:
        return self.folder / "metrics.jsonl"

    def log(self, record: dict) -> None:
        with self.metrics_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    def read_metrics(self) -> list[dict]:
        if not self.metrics_file.is_file():
            return []
        return [json.loads(line) for line in self.metrics_file.read_text(encoding="utf-8").splitlines() if line]


def _toml_dump(values: dict, indent: str = "") -> str:
    """Enough TOML for a resolved config: sections of scalars and lists."""
    lines: list[str] = []
    for key, value in values.items():
        if isinstance(value, dict):
            lines.append(f"\n[{key}]")
            lines.append(_toml_dump(value))
        else:
            lines.append(f"{key} = {json.dumps(value)}")
    return "\n".join(lines)


def new_run_folder(config: Config, name: str | None, sources: list[str]) -> tuple[Path, dict]:
    """The run's folder and its resolved config — the sources trained on written under ``[train]``,
    so `eval` and `export` read the same pairs without being told again."""
    word = name or str(config.section("train").get("name") or "") or "-".join(sources)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    folder = config.paths.runs / f"{stamp}-{word}"
    folder.mkdir(parents=True, exist_ok=False)
    values = merge(config.values, {"train": {"sources": list(sources)}})
    (folder / "config.toml").write_text(_toml_dump(values).lstrip() + "\n", encoding="utf-8")
    return folder, values


def load_run(folder: Path) -> Run:
    cfg = tomllib.loads((folder / "config.toml").read_text(encoding="utf-8"))
    return Run(folder=folder, config=cfg, device=pick_device(str(cfg.get("device", {}).get("prefer", "auto"))))


def latest_run(runs: Path) -> Path | None:
    if not runs.is_dir():
        return None
    candidates = sorted(p for p in runs.iterdir() if p.is_dir() and (p / "config.toml").is_file())
    return candidates[-1] if candidates else None


def build_model(cfg: dict, device: str) -> AdaptiveLUT:
    return AdaptiveLUT.from_config(cfg.get("model", {})).to(device)


def save_checkpoint(path: Path, model: AdaptiveLUT, optimizer, epoch: int, best: float, cfg: dict) -> None:
    tmp = path.with_suffix(".pt.tmp")
    torch.save({"model": model.state_dict(), "optimizer": optimizer.state_dict() if optimizer else None,
                "epoch": epoch, "best": best, "config": cfg}, tmp)
    tmp.replace(path)


def load_checkpoint(path: Path, device: str) -> dict:
    return torch.load(path, map_location=device, weights_only=False)


def load_model(run: Path | Run, which: str = "best", device: str | None = None) -> tuple[AdaptiveLUT, Run]:
    run = run if isinstance(run, Run) else load_run(run)
    device = device or run.device
    path = run.folder / f"{which}.pt"
    if not path.is_file():
        path = run.folder / "last.pt"
    state = load_checkpoint(path, device)
    model = build_model(run.config, device)
    model.load_state_dict(state["model"])
    model.eval()
    return model, run


MISALIGNED = STRUCTURE_FLOOR  # `structure` under this: the edit does not line up with its input


@torch.no_grad()
def evaluate_pairs(model: AdaptiveLUT, pairs: list[Pair], device: str,
                   keep: Callable[[str, Tensor, Tensor, Tensor], None] | None = None) -> dict:
    """Whole pictures one by one: the mean of every ``metrics.score`` key, plus per-pair rows. Each row also
    carries the score of DOING NOTHING (the input itself against the edit) and how well the two line up
    (``structure``), so a run can be told from no model at all and a broken pair from a hard one."""
    model.eval()
    ds = PairDataset(pairs)
    rows: list[dict] = []
    for i in range(len(ds)):
        a, b, pid = ds[i]
        a, b = a.unsqueeze(0).to(device), b.unsqueeze(0).to(device)
        out, _ = model(a)
        src, tgt = a[0].permute(1, 2, 0).cpu().numpy(), b[0].permute(1, 2, 0).cpu().numpy()
        out_np = out[0].permute(1, 2, 0).cpu().numpy()
        s = score(out_np, tgt)
        nothing = score(src, tgt)
        lined = structure(src, tgt)
        # The same colour difference at 1/8 size: detail and a few pixels of shift averaged out.
        lab_t = srgb_to_lab(coarse(tgt))
        ceiling = best_global_map(src, tgt)  # the best any colour map could do on this very picture
        s.update(identity_psnr=nothing["psnr"], identity_de2000_mean=nothing["de2000_mean"],
                 coarse_de2000_mean=float(delta_e2000(srgb_to_lab(coarse(out_np)), lab_t).mean()),
                 identity_coarse_de2000_mean=float(delta_e2000(srgb_to_lab(coarse(src)), lab_t).mean()),
                 ceiling_de2000_mean=float(delta_e2000(srgb_to_lab(ceiling), srgb_to_lab(tgt)).mean()),
                 ceiling_coarse_de2000_mean=float(delta_e2000(srgb_to_lab(coarse(ceiling)), lab_t).mean()),
                 structure=None if lined != lined else lined, id=pid)  # None: too flat to judge
        rows.append(s)
        if keep:
            keep(pid, a[0], b[0], out[0])
    keys = ("psnr", "de76_mean", "de76_p95", "de2000_mean", "de2000_p95")
    summary = {k: float(np.mean([r[k] for r in rows if np.isfinite(r[k])])) if rows else float("nan") for k in keys}
    summary["identity_psnr"] = float(np.mean([r["identity_psnr"] for r in rows if np.isfinite(r["identity_psnr"])]
                                             or [0])) if rows else float("nan")
    summary["identity_de2000_mean"] = float(np.mean([r["identity_de2000_mean"] for r in rows])) if rows \
        else float("nan")
    for key in ("coarse_de2000_mean", "identity_coarse_de2000_mean", "ceiling_de2000_mean",
                "ceiling_coarse_de2000_mean"):
        summary[key] = float(np.mean([r[key] for r in rows])) if rows else float("nan")
    summary["misaligned"] = sorted((r for r in rows if r["structure"] is not None and r["structure"] < MISALIGNED),
                                   key=lambda r: r["structure"])
    summary["misaligned"] = [{"id": r["id"], "structure": round(r["structure"], 3)} for r in summary["misaligned"]]
    summary["pairs"] = rows
    # Per GROUP (one original and its edits): where the model is far from his taste, worst first.
    by_group: dict[str, list[dict]] = {}
    for pair, row in zip(pairs, rows, strict=True):
        by_group.setdefault(f"{pair.source}/{pair.group}", []).append(row)
    groups = [{"group": g, "pairs": len(rs),
               "psnr": float(np.mean([r["psnr"] for r in rs if np.isfinite(r["psnr"])] or [0])),
               "de2000_mean": float(np.mean([r["de2000_mean"] for r in rs]))} for g, rs in by_group.items()]
    summary["groups"] = sorted(groups, key=lambda g: -g["de2000_mean"])
    return summary


def train(
    config: Config,
    sources: list[str] | None = None,
    name: str | None = None,
    resume: Path | None = None,
    init: Path | None = None,
    epochs: int | None = None,
    log: Callable[[str], None] = print,
) -> Run:
    tcfg = config.section("train")
    if resume is not None and not sources:
        sources = list(load_run(resume).config.get("train", {}).get("sources") or [])
    sources = sources or list(config.section("ingest").get("sources", ["fivek", "pairs"]))
    device = pick_device(str(config.section("device").get("prefer", "auto")))
    torch.manual_seed(int(tcfg.get("seed", 1)))

    pairs = read_index(config.paths.cache, sources)
    if not pairs:
        raise RuntimeError(f"no prepared pair for {', '.join(sources)}: run `atelier-train ingest` first.")

    if resume is not None:
        run = load_run(resume)
        cfg = run.config
        tcfg = dict(cfg.get("train", {}))
        state = load_checkpoint(run.folder / "last.pt", device)
    else:
        folder, cfg = new_run_folder(config, name, sources)
        run = Run(folder=folder, config=cfg, device=device)
        state = None

    train_pairs, val_pairs = split(pairs, float(tcfg.get("val_fraction", 0.1)), int(tcfg.get("seed", 1)))
    left_out: list[Pair] = []
    if bool(tcfg.get("skip_misaligned", True)):
        # An edit that is not a picture of its input (a neighbouring frame of a burst, a composite) teaches a
        # wrong colour map, and a squared loss weighs its ΔE 40 heavily. Validation keeps them, so runs compare.
        left_out = [p for p in train_pairs if pair_structure(p) < MISALIGNED]
        train_pairs = [p for p in train_pairs if p not in left_out]
    subset = int(tcfg.get("subset", 0))
    if subset > 0:
        # The memorising test: can the model reproduce a few pictures it sees again and again? Seeded, so a
        # resumed run trains on the same ones.
        order = np.random.default_rng(int(tcfg.get("seed", 1))).permutation(len(train_pairs))
        train_pairs = [train_pairs[i] for i in sorted(order[:subset])]
    (run.folder / "split.json").write_text(
        json.dumps({"train": [p.id for p in train_pairs], "validation": [p.id for p in val_pairs],
                    "left_out": [p.id for p in left_out]}, indent=1),
        encoding="utf-8",
    )
    if left_out:
        log(f"left out {len(left_out)} training pair(s) whose edit does not line up with its input "
            f"(structure < {MISALIGNED}), listed in split.json")
    if subset > 0:
        log(f"training on a subset of {len(train_pairs)} pair(s) (train.subset): every validation also scores "
            "them, so the log says how close the model gets to pictures it has seen")

    model = build_model(cfg, device)
    if init is not None:
        model.load_state_dict(load_checkpoint(Path(init) / "best.pt" if Path(init).is_dir() else Path(init),
                                              device)["model"])
    if bool(tcfg.get("freeze_luts", False)):  # a fine-tune that keeps the pretrained looks and learns the weighing
        model.luts.requires_grad_(False)
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],
                                  lr=float(tcfg.get("learning_rate", 2e-4)),
                                  weight_decay=float(tcfg.get("weight_decay", 0.0)))
    start, best = 0, float("-inf")
    if state is not None:
        model.load_state_dict(state["model"])
        if state.get("optimizer"):
            optimizer.load_state_dict(state["optimizer"])
        start, best = int(state["epoch"]), float(state.get("best", float("-inf")))

    total_epochs = epochs or int(tcfg.get("epochs", 200))
    batch = int(tcfg.get("batch_size", 8))
    crop = int(tcfg.get("crop", 256))
    smooth_w = float(tcfg.get("smooth_weight", 1e-4))
    mono_w = float(tcfg.get("monotonic_weight", 10.0))
    eval_every = max(1, int(tcfg.get("eval_every", 5)))
    loader = DataLoader(PairDataset(train_pairs, crop=crop, augment=True, seed=int(tcfg.get("seed", 1)),
                                    keep_in_memory=bool(tcfg.get("keep_in_memory", True))),
                        batch_size=batch, shuffle=True, drop_last=False, num_workers=0)

    log(f"run {run.folder.name}: {len(train_pairs)} training pairs, {len(val_pairs)} validation, "
        f"on {device.upper()}, {total_epochs} epochs")
    for epoch in range(start + 1, total_epochs + 1):
        model.train()
        t0 = time.perf_counter()
        sums = {"loss": 0.0, "fit": 0.0, "smooth": 0.0, "mono": 0.0}
        count = 0
        waited = 0.0  # time spent getting the next batch, apart from the GPU's work
        mark = time.perf_counter()
        for a, b, _ in loader:
            waited += time.perf_counter() - mark
            a, b = a.to(device, non_blocking=True), b.to(device, non_blocking=True)
            out, _ = model(a)
            fit = torch.mean((out - b) ** 2)
            smooth, mono = model.regularisers()
            loss = fit + smooth_w * smooth + mono_w * mono
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            n = a.shape[0]
            count += n
            for k, v in (("loss", loss), ("fit", fit), ("smooth", smooth), ("mono", mono)):
                sums[k] += float(v.detach()) * n
            mark = time.perf_counter()
        record = {"epoch": epoch, "seconds": round(time.perf_counter() - t0, 2), "data_seconds": round(waited, 2),
                  **{k: v / max(count, 1) for k, v in sums.items()}}
        if val_pairs and (epoch % eval_every == 0 or epoch == total_epochs):
            summary = evaluate_pairs(model, val_pairs, device)
            record.update({f"val_{k}": v for k, v in summary.items() if k != "pairs"})
            if subset > 0:
                seen = evaluate_pairs(model, train_pairs, device)
                record.update({"train_psnr": seen["psnr"], "train_de2000_mean": seen["de2000_mean"],
                               "train_ceiling_de2000_mean": seen["ceiling_de2000_mean"]})
            if summary["psnr"] > best:
                best = summary["psnr"]
                save_checkpoint(run.folder / "best.pt", model, optimizer, epoch, best, cfg)
        elif not val_pairs:
            save_checkpoint(run.folder / "best.pt", model, optimizer, epoch, best, cfg)
        save_checkpoint(run.folder / "last.pt", model, optimizer, epoch, best, cfg)
        run.log(record)
        line = f"  epoch {epoch}/{total_epochs}  loss {record['loss']:.5f}  fit {record['fit']:.5f}"
        if "val_psnr" in record:
            line += f"  val PSNR {record['val_psnr']:.2f} dB  ΔE00 {record['val_de2000_mean']:.2f}"
        if "train_de2000_mean" in record:
            line += (f"  seen ΔE00 {record['train_de2000_mean']:.2f}"
                     f" (ceiling {record['train_ceiling_de2000_mean']:.2f})")
        log(line + f"  ({record['seconds']} s, data {record['data_seconds']} s)")
    return run


def bench(config: Config, steps: int = 5, log: Callable[[str], None] = print) -> dict:
    """Time one training step at the configured sizes on this machine and extrapolate to a run."""
    device = pick_device(str(config.section("device").get("prefer", "auto")))
    tcfg, mcfg = config.section("train"), config.section("model")
    batch, crop = int(tcfg.get("batch_size", 8)), int(tcfg.get("crop", 256))
    model = build_model(config.values, device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    a = torch.rand(batch, 3, crop, crop, device=device)
    b = torch.rand(batch, 3, crop, crop, device=device)

    def step() -> None:
        out, _ = model(a)
        smooth, mono = model.regularisers()
        loss = torch.mean((out - b) ** 2) + 1e-4 * smooth + 10 * mono
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if device == "cuda":
            torch.cuda.synchronize()
        elif device == "mps":
            torch.mps.synchronize()

    step()  # warm-up: kernels compiled, memory allocated
    t0 = time.perf_counter()
    for _ in range(steps):
        step()
    per_step = (time.perf_counter() - t0) / steps
    try:
        pairs = len(read_index(config.paths.cache))
    except FileNotFoundError:
        pairs = 0
    epochs = int(tcfg.get("epochs", 200))
    steps_per_epoch = -(-pairs // batch) if pairs else 0
    seconds_run = per_step * steps_per_epoch * epochs
    result = {"device": device, "batch": batch, "crop": crop, "lut_size": int(mcfg.get("lut_size", 33)),
              "seconds_per_step": per_step, "pairs": pairs, "epochs": epochs,
              "seconds_per_epoch": per_step * steps_per_epoch, "seconds_run": seconds_run}
    log(f"{device.upper()}: {per_step * 1000:.0f} ms per step (batch {batch}, crop {crop}, LUT {result['lut_size']}³)")
    if pairs:
        log(f"{pairs} prepared pairs → {steps_per_epoch} steps per epoch, "
            f"{per_step * steps_per_epoch:.0f} s per epoch, ~{seconds_run / 3600:.1f} h for {epochs} epochs "
            "(the loading of the pairs not counted)")
    else:
        log("no prepared pair yet (`atelier-train ingest`), so no estimate for a whole run")
    return result


def remove_run(folder: Path) -> None:
    shutil.rmtree(folder)
