"""Training on CPU on the synthetic set must RECOVER the known transform: the end-to-end test of M2."""

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from atelier_training import lut  # noqa: E402
from atelier_training.cli import main  # noqa: E402
from atelier_training.config import load_config  # noqa: E402
from atelier_training.data import is_validation, read_index, split  # noqa: E402
from atelier_training.ingest import ingest  # noqa: E402
from atelier_training.metrics import psnr  # noqa: E402
from atelier_training.synthetic import apply_transform, make_picture  # noqa: E402

TINY = [
    "model.lut_size=9", "model.basis=2", "model.thumb=16", "model.width=4",
    "train.epochs=60", "train.batch_size=4", "train.crop=32", "train.learning_rate=0.01",
    "train.eval_every=20", "train.val_fraction=0.34", "train.smooth_weight=0.0001",
]
SET = [arg for o in TINY for arg in ("--set", o)]


def test_split_is_stable_and_by_group(synthetic):
    config = load_config()
    ingest(config, sources=["synthetic"], workers=1)
    pairs = read_index(config.paths.cache, ["synthetic"])
    train, val = split(pairs, 0.34, seed=1)
    assert train and val and len(train) + len(val) == len(pairs)
    assert not ({p.group for p in train} & {p.group for p in val})
    assert split(pairs, 0.34, seed=1) == (train, val)
    assert is_validation("g", 0.5, 7) == is_validation("g", 0.5, 7)
    assert split(pairs, 0.0, seed=1) == (pairs, [])


def test_training_recovers_the_synthetic_look(workspace):
    from atelier_training.synthetic import generate

    config = load_config(overrides=TINY)
    # One consistent "photographer": every edit of the set is teal-orange, in both halves.
    generate(config.paths.synthetic, groups=4, size=(48, 32), edits_per_group=1, fivek_photos=4, seed=3,
             lut_size=9, style="teal-orange")
    ingest(config, sources=["synthetic"], workers=1)
    assert main(["train", "--source", "synthetic", "--name", "e2e", *SET]) == 0
    runs = sorted(config.paths.runs.iterdir())
    assert len(runs) == 1 and runs[0].name.endswith("-e2e")
    run = runs[0]
    metrics = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
    assert len(metrics) == 60 and (run / "best.pt").is_file() and (run / "last.pt").is_file()
    assert metrics[-1]["fit"] < metrics[0]["fit"] / 10  # it learned the look

    # eval writes the summary and the grids
    assert main(["eval", "--run", str(run), "--split", "all", "--grids", "3", *SET]) == 0
    summary = json.loads((run / "eval" / "all.json").read_text())
    assert summary["psnr"] > 30 and len(list((run / "eval" / "grids").glob("*.jpg"))) == 3

    # export writes a .cube that, applied by the NUMPY path, brings a fresh picture close to the edit
    assert main(["export", "--run", str(run), *SET]) == 0
    cube = lut.read_cube(run / "style.cube")
    assert cube.size == 9 and cube.title.startswith("Atelier style")
    fresh = make_picture(np.random.default_rng(99), 48, 32)
    target = apply_transform("teal-orange", fresh)
    got = psnr(lut.apply(cube, fresh), target)
    assert got > psnr(fresh, target) + 5 and got > 38, got  # identity sits at ~33.6 dB on this look

    # a per-picture export, then resume for a few more epochs
    picture = config.paths.synthetic / "pairs" / "group-001" / "original.png"
    assert main(["export", "--run", str(run), "--image", str(picture), *SET]) == 0
    assert (run / "original.cube").is_file()
    assert main(["train", "--resume", str(run), "--epochs", "62", *SET]) == 0
    metrics = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
    assert [m["epoch"] for m in metrics][-3:] == [60, 61, 62]


def test_finetune_from_a_run_with_frozen_luts_and_per_group_eval(workspace):
    from atelier_training.synthetic import generate
    from atelier_training.train import load_model

    config = load_config(overrides=TINY)
    generate(config.paths.synthetic, groups=4, size=(48, 32), edits_per_group=1, fivek_photos=3, seed=5,
             lut_size=9, style="warm")
    ingest(config, sources=["synthetic"], workers=1)
    assert main(["train", "--source", "synthetic", "--name", "base", "--epochs", "8", *SET]) == 0
    base = sorted(config.paths.runs.iterdir())[0]
    model_before, _ = load_model(base)

    # A fine-tune that keeps the basis LUTs: only the weighing CNN moves.
    assert main(["train", "--source", "synthetic", "--name", "tuned", "--init", str(base), "--epochs", "4",
                 "--set", "train.freeze_luts=true", *SET]) == 0
    tuned = [r for r in sorted(config.paths.runs.iterdir()) if r.name.endswith("-tuned")][0]
    model_after, run = load_model(tuned)
    assert torch.equal(model_before.luts, model_after.luts)
    assert not all(torch.equal(a, b) for a, b in zip(model_before.weights.parameters(),
                                                     model_after.weights.parameters(), strict=True))

    assert main(["eval", "--run", str(tuned), "--split", "all", "--grids", "1", *SET]) == 0
    summary = json.loads((tuned / "eval" / "all.json").read_text())
    groups = summary["groups"]
    assert len(groups) == 7 and groups == sorted(groups, key=lambda g: -g["de2000_mean"])
    assert sum(g["pairs"] for g in groups) == len(summary["pairs"])
    # Every row says what doing nothing scores and how well its two halves line up (a synthetic edit: perfectly).
    assert all((r["structure"] is None or r["structure"] > 0.9) and np.isfinite(r["identity_de2000_mean"])
               for r in summary["pairs"])
    assert summary["misaligned"] == [] and "identity_psnr" in summary
    assert np.isfinite(summary["coarse_de2000_mean"]) and np.isfinite(summary["identity_coarse_de2000_mean"])
    assert summary["ceiling_de2000_mean"] <= summary["identity_de2000_mean"]
    metrics = [json.loads(line) for line in (tuned / "metrics.jsonl").read_text().splitlines() if line.strip()]
    assert all(0 <= m["data_seconds"] <= m["seconds"] for m in metrics if "data_seconds" in m)


def test_a_pair_that_does_not_line_up_is_left_out_of_training_and_kept_in_validation(synthetic, capsys):
    config = load_config(overrides=TINY)
    ingest(config, sources=["synthetic"], workers=1)
    pairs = read_index(config.paths.cache, ["synthetic"])
    train, val = split(pairs, 0.34, seed=1)
    # One training pair's edit becomes another picture (a neighbouring frame of a burst), and one validation pair too.
    for victim in (train[0], val[0]):
        target = np.load(victim.folder / "target.npy")
        np.save(victim.folder / "target.npy", np.ascontiguousarray(np.rot90(target, 2)))
        meta = json.loads((victim.folder / "meta.json").read_text())
        meta.pop("structure", None)  # prepared before ingest wrote it: measured from the cache
        (victim.folder / "meta.json").write_text(json.dumps(meta))
    assert main(["train", "--source", "synthetic", "--name", "skip", "--epochs", "1", *SET]) == 0
    assert "left out 1 training pair(s)" in capsys.readouterr().out
    def split_of(name: str) -> dict:
        run = next(r for r in config.paths.runs.iterdir() if r.name.endswith(f"-{name}"))
        return json.loads((run / "split.json").read_text())

    written = split_of("skip")
    assert written["left_out"] == [train[0].id] and train[0].id not in written["train"]
    assert val[0].id in written["validation"]

    assert main(["train", "--source", "synthetic", "--name", "all", "--epochs", "1",
                 "--set", "train.skip_misaligned=false", *SET]) == 0
    kept = split_of("all")
    assert kept["left_out"] == [] and train[0].id in kept["train"]


def test_bench_and_missing_run_messages(synthetic, capsys):
    config = load_config(overrides=TINY)
    assert main(["bench", "--steps", "1", *SET]) == 0
    assert "ms per step" in capsys.readouterr().out
    assert main(["eval"]) == 1
    assert "no run found" in capsys.readouterr().out
    assert main(["train", "--source", "pairs"]) == 1  # nothing ingested under pairs
    assert config.paths.runs.exists() is False or not list(config.paths.runs.iterdir())


def test_the_dataset_held_in_memory_reads_each_pair_once_and_gives_the_same_tensors(synthetic):
    from atelier_training.data import PairDataset, read_index

    config = load_config(overrides=TINY)
    ingest(config, sources=["synthetic"], workers=1)
    pairs = read_index(config.paths.cache, ["synthetic"])[:3]
    held, plain = PairDataset(pairs, keep_in_memory=True), PairDataset(pairs)
    for i in range(len(pairs)):
        assert all(torch.equal(x, y) for x, y in zip(held[i][:2], plain[i][:2], strict=True))
    assert set(held.memory) == {0, 1, 2} and plain.memory is None
    for folder in {p.folder for p in pairs}:  # gone from disk: the held copy still serves
        for f in folder.glob("*.npy"):
            f.unlink()
    assert held[0][0].dtype == torch.float32
