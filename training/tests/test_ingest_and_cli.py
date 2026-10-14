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


def test_a_cropped_edit_is_aligned_into_its_original(workspace):
    from atelier_training.datasets.pairs import manifest_text
    from atelier_training.imaging import save_image
    from atelier_training.synthetic import apply_transform, make_picture

    config = load_config(overrides=["ingest.long_edge=96"])
    g = config.paths.pairs / "g"
    original = make_picture(np.random.default_rng(11), 240, 160)
    save_image(original, g / "orig.png")
    crop = apply_transform("warm", original[20:140, 50:230])  # 180 × 120, a 3:2 cut of a 3:2 picture
    save_image(crop, g / "crop.png")
    square = apply_transform("faded", original[0:160, 40:200])  # 160 × 160: the aspect differs
    save_image(square, g / "square.png")
    (g / "manifest.toml").write_text(manifest_text("orig.png", [("crop.png", None), ("square.png", None)]),
                                     encoding="utf-8")

    report = ingest(config, sources=["pairs"], workers=1)
    assert report.skipped == [] and report.written == 2
    by_id = {e["id"]: e for e in report.entries}
    sq = json.loads((config.paths.cache / by_id["pairs/g/square"]["folder"] / "meta.json").read_text())
    assert sq["alignment"]["score"] > 0.9 and abs(sq["alignment"]["x0"] - 40) <= 3 and sq["width"] == 96
    a = np.load(config.paths.cache / by_id["pairs/g/square"]["folder"] / "input.npy") / 65535.0
    b = np.load(config.paths.cache / by_id["pairs/g/square"]["folder"] / "target.npy") / 65535.0
    assert np.abs(apply_transform("faded", a.astype(np.float32)) - b).mean() < 0.03  # the same pixels, graded
    # auto: a 3:2 cut of a 3:2 original does not line up as it is, so it is searched too (it was trusted once).
    crop_meta = json.loads((config.paths.cache / by_id["pairs/g/crop"]["folder"] / "meta.json").read_text())
    assert crop_meta["alignment"]["score"] > 0.9 and abs(crop_meta["alignment"]["x0"] - 50) <= 3
    assert crop_meta["structure"] > 0.9 and sq["structure"] > 0.9

    never = ingest(load_config(overrides=["ingest.long_edge=96", "ingest.align=never"]), sources=["pairs"],
                   workers=1, force=True)
    assert [pid for pid, _ in never.skipped] == ["pairs/g/square"]
    off = json.loads((config.paths.cache / "pairs/g/crop" / "meta.json").read_text())
    assert off["alignment"] is None and off["structure"] < 0.5  # what a run trusting the aspect learned from

    # A cache prepared before that check (no `structure` in its meta) is measured and the pair done again.
    del off["structure"]
    (config.paths.cache / "pairs/g/crop" / "meta.json").write_text(json.dumps(off))
    again = ingest(config, sources=["pairs"], workers=1)
    assert again.written == 1 and any("did not line up" in n for n in again.notes)  # the crop alone, done again
    fixed = json.loads((config.paths.cache / "pairs/g/crop" / "meta.json").read_text())
    assert fixed["alignment"]["score"] > 0.9 and fixed["structure"] > 0.9
    # A pair that lines up keeps its cache: the next run measures it once and reuses it.
    assert ingest(config, sources=["pairs"], workers=1).written == 0


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
