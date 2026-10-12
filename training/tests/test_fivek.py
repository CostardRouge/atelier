import numpy as np

from atelier_training.datasets.fivek import scan_fivek
from atelier_training.imaging import save_image


def touch(path):
    save_image(np.zeros((4, 6, 3), np.float32), path)


def test_synthetic_fivek_is_read(synthetic):
    scan = scan_fivek(synthetic / "fivek", "C")
    assert [i.id for i in scan.items] == ["a0001", "a0002", "a0003"]
    assert scan.items[0].input.name == "a0001-synth.tif"
    assert scan.items[0].target.parent.name == "expertC"
    assert scan.notes == []


def test_zeng_style_layout_and_input_preference(tmp_path):
    root = tmp_path / "fivek"
    touch(root / "input" / "JPG" / "480p" / "a0001.jpg")
    touch(root / "input" / "TIF" / "a0001.tif")
    touch(root / "expert_c" / "JPG" / "480p" / "a0001.jpg")
    touch(root / "Expert-A" / "a0001.jpg")
    scan = scan_fivek(root, "c")
    assert len(scan.items) == 1
    assert scan.items[0].input.suffix == ".tif"  # TIFF before JPEG by default
    assert scan.experts_found == ["A", "C"]
    jpg_first = scan_fivek(root, "C", prefer=["jpg"])
    assert jpg_first.items[0].input.suffix == ".jpg"


def test_catalogue_without_exports_is_explained(tmp_path):
    root = tmp_path / "fivek"
    touch(root / "raw_photos" / "HQa1to700" / "photos" / "a0001-x.tif")
    (root / "fivek.lrcat").write_text("")
    scan = scan_fivek(root, "C")
    assert scan.items == []
    assert any("fivek.lrcat" in n and "expertC/" in n for n in scan.notes)


def test_missing_folder_and_partial_coverage(tmp_path):
    assert scan_fivek(tmp_path / "nope").notes
    root = tmp_path / "fivek"
    touch(root / "in" / "a0001.tif")
    touch(root / "in" / "a0002.tif")
    touch(root / "C" / "a0001.tif")
    scan = scan_fivek(root, "C")
    assert len(scan.items) == 1
    assert any("1 photo(s) have no edit" in n for n in scan.notes)
