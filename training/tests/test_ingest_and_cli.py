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
    code = main(["doctor"])
    out = capsys.readouterr().out
    assert code == 0
    assert "Synthetic set: present" in out
    assert "FiveK: no folder" in out


def test_parallel_ingest_gives_the_same_result_as_sequential(synthetic):
    config = load_config(overrides=["ingest.long_edge=24"])
    sequential = ingest(config, sources=["synthetic"], workers=1)
    index = config.paths.cache / "index.jsonl"
    reference = index.read_text()
    reference_input = {e["id"]: (config.paths.cache / e["folder"] / "input.npy").read_bytes()
                       for e in sequential.entries}

    parallel = ingest(config, sources=["synthetic"], workers=3, force=True)
    assert parallel.written == sequential.written == 9 and parallel.skipped == []
    assert index.read_text() == reference  # same entries, same order
    for e in parallel.entries:
        assert (config.paths.cache / e["folder"] / "input.npy").read_bytes() == reference_input[e["id"]]


def test_a_bad_file_is_listed_not_fatal_in_a_worker(synthetic):
    config = load_config()
    (config.paths.synthetic / "pairs" / "group-002" / "original.png").write_bytes(b"not a png")
    report = ingest(config, sources=["synthetic"], workers=2)
    assert report.written == 7 and len(report.skipped) == 2
    assert {pid.split("/")[1] for pid, _ in report.skipped} == {"group-002"}
    assert len(report.entries) == 7


def test_a_limited_run_keeps_the_rest_of_the_index_and_a_whole_run_replaces_it(synthetic):
    config = load_config()
    full = ingest(config, sources=["synthetic"])
    assert len(full.entries) == 9
    index = config.paths.cache / "index.jsonl"

    limited = ingest(config, sources=["synthetic"], limit=2, force=True)
    assert limited.written == 2
    assert len(index.read_text().splitlines()) == 9  # the seven untouched pairs stay listed

    # A pair gone from disk leaves the index on the next WHOLE run of its source.
    import shutil

    shutil.rmtree(config.paths.synthetic / "pairs" / "group-001")
    again = ingest(config, sources=["synthetic"])
    assert len(again.entries) == 7
    assert len(index.read_text().splitlines()) == 7
    assert not (index.parent / "index.jsonl.tmp").exists()
