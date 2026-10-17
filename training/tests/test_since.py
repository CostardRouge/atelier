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
