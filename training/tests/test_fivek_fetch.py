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


def test_with_no_archive_the_photos_come_from_mit_too(tmp_path, monkeypatch):
    from atelier_training.datasets import fivek_fetch

    root = tmp_path / "fivek"  # nothing on disk: the archive was deleted
    # 29 of MIT's names hold a space or parentheses ("a0532-jmacdscf0021 (1)"): the URL quotes them.
    lists = {fivek_fetch.LIST_URLS[0]: "a0002-two (1)\na0001-one\n", fivek_fetch.LIST_URLS[1]: "a0003-three\n\n"}
    asked, urls = [], []

    def fake_fetch(url, dest):
        urls.append(url)
        asked.append(url.rsplit("/", 2)[-2])
        if url.endswith(".tif"):
            tifffile.imwrite(dest, np.full((40, 60, 3), 32768, np.uint16), photometric="rgb")
        else:
            dest.write_bytes(b"a DNG")

    rendered = np.full((80, 120, 3), 0.25, np.float32)  # what rawpy would render, as shot
    monkeypatch.setattr(fivek_fetch, "load_image", lambda path, raw: rendered)
    monkeypatch.setattr(fivek_fetch, "require_rawpy", lambda: None)  # the CI installs no rawpy
    report = fetch_expert(root, "C", long_edge=30, limit=2, log=lambda s: None, fetch=fake_fetch,
                          fetch_text=lists.__getitem__)
    assert (report.photos, report.fetched, report.inputs) == (3, 2, 2) and asked == ["dng", "tiff16_c"] * 2
    assert load_image(root / "input" / "a0001-one.tif", {}).shape == (20, 30, 3)
    assert urls[-1].endswith("/tiff16_c/a0002-two%20%281%29.tif") and (root / "expertC" / "a0002-two (1).tif").is_file()
    assert not list(root.rglob(".*"))  # no download left behind
    assert [i.input.parent.name for i in scan_fivek(root, "C").items] == ["input", "input"]

    asked.clear()  # the next run fetches the third photo only
    report = fetch_expert(root, "C", long_edge=30, log=lambda s: None, fetch=fake_fetch, fetch_text=lists.__getitem__)
    assert (report.kept, report.fetched) == (2, 1) and asked == ["dng", "tiff16_c"]


def test_without_rawpy_nothing_is_downloaded(tmp_path, monkeypatch):
    import builtins

    from atelier_training.datasets import fivek_fetch

    real_import = builtins.__import__
    monkeypatch.setattr(builtins, "__import__",
                        lambda name, *a, **k: (_ for _ in ()).throw(ImportError(name)) if name == "rawpy"
                        else real_import(name, *a, **k))
    asked = []
    with pytest.raises(RuntimeError, match="rawpy"):
        fetch_expert(tmp_path, "C", log=lambda s: None, fetch=lambda url, dest: asked.append(url),
                     fetch_text={u: "a0001-one\n" for u in fivek_fetch.LIST_URLS}.__getitem__)
    assert asked == []


def test_a_download_shorter_than_its_length_is_tried_again(tmp_path, monkeypatch):
    import io

    from atelier_training.datasets import fivek_fetch

    bodies = [b"half", b"whole body"]  # a connection that closes early raises nothing: only the length tells

    class Response(io.BytesIO):
        headers = {"Content-Length": "10"}

        def __exit__(self, *exc):
            self.close()

    monkeypatch.setattr(fivek_fetch.urllib.request, "urlopen", lambda url, timeout: Response(bodies.pop(0)))
    fivek_fetch.download("https://x/y.tif", tmp_path / "y.tif")
    assert (tmp_path / "y.tif").read_bytes() == b"whole body" and not bodies

    monkeypatch.setattr(fivek_fetch.urllib.request, "urlopen", lambda url, timeout: Response(b"short"))
    with pytest.raises(OSError, match="truncated"):
        fivek_fetch.download("https://x/z.tif", tmp_path / "z.tif")
    assert not list(tmp_path.glob("z.tif*"))
