"""The develop predictor (M6): the records reader, the model, a CPU training that beats "nothing", the ONNX export."""

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from atelier_training.cli import main  # noqa: E402
from atelier_training.config import load_config  # noqa: E402
from atelier_training.model.develop_net import DevelopNet  # noqa: E402
from atelier_training.records import (  # noqa: E402
    RANGES,
    SLIDERS,
    exif_vector,
    read_records,
    stats_vector,
    synthetic_training_file,
    unpack,
)

TINY = ["develop.thumb=32", "develop.width=4", "develop.hidden=32", "develop.epochs=40", "develop.batch_size=8",
        "develop.learning_rate=0.003", "develop.val_fraction=0.2", "develop.eval_every=10"]
SET = [arg for o in TINY for arg in ("--set", o)]


def test_records_are_unpacked_and_agent_ones_left_out(workspace):
    file = synthetic_training_file(workspace / "pairs.json", count=20, size=32)
    out = workspace / "data" / "records"
    report = unpack(file, out, log=lambda s: None)
    assert report.read == 20 and report.agent == 2 and report.kept == 18 and report.skipped == []
    rows = read_records(out)
    assert len(rows) == 18 and (out / rows[0]["folder"] / "vignette.png").is_file()
    rec = rows[0]["record"]
    assert set(rec["sliders"]) == set(SLIDERS) and len(rec["stats"]) == 67 and len(rec["exif"]) == 5
    assert sum(1 for r in rows if not r["touched"]) == 3  # every fifth picture untouched, minus the agent's
    assert unpack(file, out, include_agent=True, log=lambda s: None).kept == 20


def test_vectors_are_robust_to_missing_fields():
    assert stats_vector(None) == [0.0] * 67
    v = stats_vector({"bins": [1, 1, 2, 4], "linearMean": [0.1, 0.2, 0.3]})
    assert len(v) == 67 and abs(sum(v[:64]) - 1.0) < 1e-6 and v[64:] == [0.1, 0.2, 0.3]
    assert exif_vector(None) == [0.0] * 5
    e = exif_vector({"iso": 400, "exposureTime": 0.5, "fNumber": 4, "focalLength35": 70, "exposureBias": -1})
    assert e == pytest.approx([2.0, -1.0, 2.0, 1.0, -1.0])


def test_a_fresh_model_predicts_nothing_within_the_ranges():
    model = DevelopNet(thumb=16, width=4, hidden=8).eval()
    out = model(torch.rand(2, 3, 20, 30), torch.rand(2, 67), torch.zeros(2, 5))
    assert out.shape == (2, 11) and torch.allclose(out, torch.zeros_like(out))
    model.head[-1].bias.data.fill_(10.0)
    out = model(torch.rand(2, 3, 20, 30), torch.rand(2, 67), torch.zeros(2, 5))
    assert torch.all(out <= torch.tensor(RANGES) + 1e-5)


def test_training_beats_predicting_nothing_and_exports(workspace, capsys):
    config = load_config(overrides=TINY)
    file = synthetic_training_file(workspace / "pairs.json", count=60, size=32, seed=8)
    assert main(["records", str(file), *SET]) == 0
    assert main(["train-develop", "--name", "e2e", *SET]) == 0
    runs = [r for r in sorted(config.paths.runs.iterdir()) if "-develop-" in r.name]
    assert len(runs) == 1 and runs[0].name.endswith("-develop-e2e")
    run = runs[0]
    metrics = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
    last = metrics[-1]
    assert last["val_mae"] < last["val_zero_mae"] * 0.6, (last["val_mae"], last["val_zero_mae"])

    assert main(["eval-develop", "--run", str(run), "--split", "validation", *SET]) == 0
    summary = json.loads((run / "eval" / "validation.json").read_text())
    assert summary["mae"]["contrast"] < 8 and summary["mae"]["exposure"] < 0.6
    assert "per slider" in capsys.readouterr().out

    pytest.importorskip("onnx")
    assert main(["export-develop", "--run", str(run), *SET]) == 0
    assert (run / "develop-net.onnx").is_file()
    sidecar = json.loads((run / "develop-net.json").read_text())
    assert sidecar["output"]["sliders"] == list(SLIDERS) and sidecar["thumb"] == 32
    ort = pytest.importorskip("onnxruntime")
    session = ort.InferenceSession(str(run / "develop-net.onnx"), providers=["CPUExecutionProvider"])
    got = session.run(None, {"vignette": np.random.default_rng(0).random((1, 3, 32, 32), dtype=np.float32),
                             "stats": np.zeros((1, 67), np.float32), "exif": np.zeros((1, 5), np.float32)})[0]
    assert got.shape == (1, 11)
