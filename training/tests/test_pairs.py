import numpy as np
import pytest

from atelier_training.datasets.pairs import InitGroupError, init_group, manifest_text, scan_pairs
from atelier_training.imaging import save_image


def picture(path, w=40, h=30):
    save_image(np.full((h, w, 3), 0.5, np.float32), path)


def test_synthetic_groups_are_valid(synthetic):
    scan = scan_pairs(synthetic / "pairs")
    assert len(scan.groups) == 3
    assert scan.issues == []
    assert scan.pair_count == 6


def test_every_problem_is_reported(tmp_path):
    root = tmp_path / "pairs"
    # no manifest
    picture(root / "a" / "x.jpg")
    # missing edit, unlisted file, cropped edit
    b = root / "b"
    picture(b / "orig.png")
    picture(b / "crop.png", w=30, h=30)
    picture(b / "stray.png")
    (b / "manifest.toml").write_text(
        manifest_text("orig.png", [("crop.png", None), ("gone.png", None)]), encoding="utf-8"
    )
    # original listed as an edit, bad TOML
    c = root / "c"
    picture(c / "o.png")
    (c / "manifest.toml").write_text(manifest_text("o.png", [("o.png", None)]), encoding="utf-8")
    d = root / "d"
    d.mkdir()
    (d / "manifest.toml").write_text("original = \n", encoding="utf-8")
    # parked folder is ignored
    picture(root / "_parked" / "z.png")

    scan = scan_pairs(root)
    text = "\n".join(str(i) for i in scan.issues)
    assert {g.name for g in scan.groups} == {"a", "b", "c", "d"}
    assert "[a] no manifest.toml" in text
    assert "'gone.png' is not in the folder" in text
    assert "stray.png is in the folder but not in manifest.toml" in text
    assert "both as the original and as an edit" in text
    assert "[d] manifest.toml cannot be read" in text
    assert scan.valid_groups() == []


def test_a_cropped_edit_is_a_warning_not_an_error(tmp_path):
    g = tmp_path / "pairs" / "g"
    picture(g / "orig.png")
    picture(g / "crop.png", w=30, h=30)
    picture(g / "full.png")
    (g / "manifest.toml").write_text(manifest_text("orig.png", [("crop.png", None), ("full.png", "warm")]),
                                     encoding="utf-8")
    scan = scan_pairs(tmp_path / "pairs")
    assert scan.errors == []
    assert len(scan.warnings) == 1 and "cropped or rotated" in scan.warnings[0].message
    assert scan.pair_count == 2


def test_init_group_guesses_the_original(tmp_path):
    g = tmp_path / "DSC01234"
    picture(g / "DSC01234.jpg")
    picture(g / "DSC01234-warm.jpg")
    picture(g / "edits" / "DSC01234-bw.jpg")
    init_group(g)
    scan = scan_pairs(tmp_path)
    assert scan.issues == []
    assert scan.groups[0].original.name == "DSC01234.jpg"
    assert sorted(e.file.name for e in scan.groups[0].edits) == ["DSC01234-bw.jpg", "DSC01234-warm.jpg"]
    with pytest.raises(InitGroupError):
        init_group(g)  # never overwrites without --force


def test_init_group_refuses_to_guess_blindly(tmp_path):
    g = tmp_path / "g"
    picture(g / "one.jpg")
    picture(g / "two.jpg")
    with pytest.raises(InitGroupError, match="cannot tell"):
        init_group(g)


def test_a_path_outside_the_group_is_refused(tmp_path):
    root = tmp_path / "pairs"
    picture(root / "elsewhere.png")
    g = root / "g"
    picture(g / "edit.png")
    (g / "manifest.toml").write_text(manifest_text("../elsewhere.png", [("edit.png", None)]), encoding="utf-8")
    scan = scan_pairs(root)
    assert len(scan.errors) == 1 and "outside the group's folder" in scan.errors[0].message


def test_two_edits_with_one_name_in_two_folders_are_two_pairs(workspace):
    from atelier_training.config import load_config
    from atelier_training.ingest import IngestReport, collect

    config = load_config()
    g = config.paths.pairs / "g"
    picture(g / "orig.png")
    picture(g / "x.png")
    picture(g / "edits" / "x.png")
    (g / "manifest.toml").write_text(manifest_text("orig.png", [("x.png", None), ("edits/x.png", None)]),
                                     encoding="utf-8")
    refs = collect(config, ["pairs"], IngestReport())
    assert sorted(r.id for r in refs) == ["pairs/g/edits/x", "pairs/g/x"]
