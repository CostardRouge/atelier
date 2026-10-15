"""FiveK edits fetched as images: the ProPhoto → sRGB conversion and the resumable, one-at-a-time run."""

import struct

import numpy as np
import pytest

tifffile = pytest.importorskip("tifffile")

from atelier_training.datasets.fivek import scan_fivek  # noqa: E402
from atelier_training.datasets.fivek_fetch import fetch_expert, icc_gamma, prophoto_to_srgb  # noqa: E402
from atelier_training.imaging import load_image  # noqa: E402


def _icc_with_gamma(gamma: float) -> bytes:
    """The smallest ICC profile ``icc_gamma`` reads: a header, one tag (rTRC) and a one-entry ``curv``."""
    curv = b"curv" + b"\0" * 4 + struct.pack(">I", 1) + struct.pack(">H", round(gamma * 256))
    header = b"\0" * 128 + struct.pack(">I", 1) + struct.pack(">4sII", b"rTRC", 144, len(curv))
    return header + curv


def test_icc_gamma_reads_a_curv_power_and_falls_back():
    assert icc_gamma(_icc_with_gamma(1.8)) == pytest.approx(1.8, abs=0.01)
    assert icc_gamma(_icc_with_gamma(2.2)) == pytest.approx(2.2, abs=0.01)
    assert icc_gamma(None) == 1.8 and icc_gamma(b"short") == 1.8


def test_prophoto_to_srgb_keeps_greys_and_clips_what_srgb_cannot_show():
    grey = np.full((1, 1, 3), 0.5, np.float32)
    out = prophoto_to_srgb(grey)
    assert np.allclose(out, out[..., :1], atol=2e-3)  # D50 grey is D65 grey after Bradford
    assert out[0, 0, 0] == pytest.approx(0.574, abs=0.01)  # 0.5^1.8 linear, sRGB-encoded
    assert np.allclose(prophoto_to_srgb(np.ones((1, 1, 3), np.float32)), 1.0, atol=2e-3)
    red = prophoto_to_srgb(np.array([[[1.0, 0.0, 0.0]]], np.float32))
    assert red[0, 0, 0] == 1.0 and red.min() >= 0.0  # ProPhoto's red is outside sRGB: clipped, never negative


def test_fetch_writes_srgb_edits_beside_the_dngs_and_resumes(tmp_path):
    root = tmp_path / "fivek"
    (root / "raw_photos").mkdir(parents=True)
    for name in ("a0001-one", "a0002-two", "a0003-three"):
        (root / "raw_photos" / f"{name}.dng").write_bytes(b"not decoded here")
    asked = []

    def fake_fetch(url, dest):
        asked.append(url)
        if "a0003" in url:
            raise OSError("HTTP Error 404: Not Found")
        tifffile.imwrite(dest, np.full((40, 60, 3), 32768, np.uint16), photometric="rgb",
                         extratags=[(34675, "B", None, _icc_with_gamma(1.8), False)])

    report = fetch_expert(root, "C", long_edge=30, log=lambda s: None, fetch=fake_fetch)
    assert (report.fetched, report.kept) == (2, 0) and [s for s, _ in report.failed] == ["a0003-three"]
    assert asked[0].endswith("/tiff16_c/a0001-one.tif")
    edit = load_image(root / "expertC" / "a0001-one.tif", {})
    assert edit.shape == (20, 30, 3) and edit.mean() == pytest.approx(0.574, abs=0.01)
    assert not list((root / "expertC").glob(".*"))  # no download left behind
    scan = scan_fivek(root, "C")
    assert [i.id for i in scan.items] == ["a0001", "a0002"] and scan.items[0].input.suffix == ".dng"

    asked.clear()  # a second run fetches only what is missing
    report = fetch_expert(root, "C", long_edge=30, log=lambda s: None, fetch=fake_fetch)
    assert report.kept == 2 and asked == [asked[0]] and asked[0].endswith("a0003-three.tif")
    assert report.photos == 3


def test_no_dng_under_the_root_is_said_and_fails(workspace, capsys):
    from atelier_training.cli import main

    assert main(["fivek-fetch", "--limit", "5"]) == 1
    out = capsys.readouterr().out
    assert "no FiveK DNG" in out and "--set paths.fivek=" in out
    assert not (workspace / "data" / "fivek" / "expertC").exists()  # nothing created where nothing was found
