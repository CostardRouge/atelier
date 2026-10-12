import json

import numpy as np

from atelier_training.cli import main
from atelier_training.config import load_config
from atelier_training.ingest import ingest


def test_ingest_synthetic_writes_aligned_pairs(synthetic):
    config = load_config(overrides=["ingest.long_edge=24"])
    report = ingest(config, sources=["synthetic"])
    assert report.skipped == []
    assert report.written == 6 + 3  # 3 groups × 2 edits, 3 FiveK-like photos
    lines = (config.paths.cache / "index.jsonl").read_text().splitlines()
    assert len(lines) == 9
    entry = json.loads(lines[0])
    folder = config.paths.cache / entry["folder"]
    a, b = np.load(folder / "input.npy"), np.load(folder / "target.npy")
    assert a.dtype == np.uint16 and a.shape == b.shape == (16, 24, 3)
    assert (folder / "preview.jpg").is_file()

    again = ingest(config, sources=["synthetic"])
    assert again.written == 0 and again.reused == 9


def test_the_target_really_is_the_known_transform(synthetic):
    from atelier_training.synthetic import apply_transform

    config = load_config()
    ingest(config, sources=["synthetic"])
    folder = config.paths.cache / "synthetic" / "a0001-C"
    a = np.load(folder / "input.npy") / 65535.0
    b = np.load(folder / "target.npy") / 65535.0
    assert np.abs(apply_transform("teal-orange", a.astype(np.float32)) - b).max() < 0.01


def test_cli_commands_run_without_real_data(workspace, capsys):
    assert main(["synth", "--set", "synthetic.groups=2", "--set", "synthetic.size=[32, 24]"]) == 0
    assert main(["validate", str(load_config().paths.synthetic / "pairs")]) == 0
    assert main(["ingest", "--source", "synthetic"]) == 0
    assert main(["train"]) == 2
    code = main(["doctor"])
    out = capsys.readouterr().out
    assert code == 0
    assert "Synthetic set: present" in out
    assert "FiveK: no folder" in out
