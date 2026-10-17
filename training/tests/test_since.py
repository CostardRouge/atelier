"""Training on his RECENT pairs only: the capture date read from a Winnow group, the filter and the per-year score."""

import json

import pytest

pytest.importorskip("torch")

from atelier_training.data import read_index, since_filter  # noqa: E402
from atelier_training.evaluate import by_year  # noqa: E402


def _index(tmp_path, groups):
    cache, lines = tmp_path / "cache", []
    for source, group, captured in groups:
        folder = tmp_path / source / group
        folder.mkdir(parents=True)
        if captured is not ...:
            (folder / "winnow.json").write_text(json.dumps({"original": {"captured_at": captured}}))
        lines.append(json.dumps({"id": f"{source}/{group}/e", "source": source, "group": group,
                                 "input": str(folder / "original.jpg"), "folder": f"{source}/{group}/e"}))
    cache.mkdir()
    (cache / "index.jsonl").write_text("\n".join(lines))
    return read_index(cache)


def test_the_capture_date_comes_from_the_group_and_filters_his_pairs_only(tmp_path):
    pairs = _index(tmp_path, [("pairs", "old", "2019-07-02T10:00:00"), ("pairs", "new", "2025-03-01T08:00:00"),
                              ("pairs", "local", ...), ("pairs", "blank", None), ("fivek", "a0001", ...)])
    assert {p.group: p.captured for p in pairs} == {"old": "2019-07-02T10:00:00", "new": "2025-03-01T08:00:00",
                                                    "local": None, "blank": None, "a0001": None}
    kept, older, undated = since_filter(pairs, "2024")
    assert sorted(p.group for p in kept) == ["a0001", "new"] and (older, undated) == (1, 2)
    assert [p.group for p in since_filter(pairs, "2025-03-02")[0]] == ["a0001"]  # a day counts


def test_the_score_is_summed_up_per_capture_year():
    rows = [{"id": "a", "de2000_mean": 10.0, "identity_de2000_mean": 20.0},
            {"id": "b", "de2000_mean": 14.0, "identity_de2000_mean": 22.0},
            {"id": "c", "de2000_mean": 8.0, "identity_de2000_mean": 18.0},
            {"id": "d", "de2000_mean": 99.0, "identity_de2000_mean": 99.0}]
    years = by_year(rows, {"a": "2020-01-01", "b": "2020-12-31T23:00:00", "c": "2025-05-05", "d": None})
    assert years == [{"year": "2020", "pairs": 2, "de2000_mean": 12.0, "identity_de2000_mean": 21.0},
                     {"year": "2025", "pairs": 1, "de2000_mean": 8.0, "identity_de2000_mean": 18.0}]


def test_the_spread_between_edits_of_one_original_is_measured_where_they_are_cut_alike():
    import numpy as np

    from atelier_training.train import variant_spread

    grey, warm = np.full((8, 8, 3), 0.5, np.float32), np.full((8, 8, 3), 0.5, np.float32)
    warm[..., 0] = 0.7
    rows = [{"de2000_mean": d} for d in (4.0, 6.0, 9.0, 1.0, 2.0, 3.0)]
    targets = {"twins": [(0, grey, (8, 8, 3)), (1, grey.copy(), (8, 8, 3))],  # two equal edits: no spread
               "apart": [(2, grey, (8, 8, 3)), (3, warm, (8, 8, 3))],
               "alone": [(4, warm, (8, 8, 3))],  # one edit: nothing to compare
               "cropped": [(5, grey, (8, 8, 3)), (5, grey[:4], (4, 8, 3))]}  # cut differently: not comparable
    v = variant_spread(targets, rows)
    assert (v["groups"], v["pairs"]) == (2, 4) and v["model_de2000_mean"] == 5.0
    apart = variant_spread({"apart": targets["apart"]}, rows)["spread_de2000_mean"]
    assert apart > 1 and v["spread_de2000_mean"] == pytest.approx(apart / 2)
