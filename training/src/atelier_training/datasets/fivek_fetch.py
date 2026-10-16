"""Fetch FiveK from MIT one photo at a time, without the archive and without Lightroom.

The 50 GB archive holds the DNGs and a Lightroom catalogue: the experts' edits are
SETTINGS, not pictures. MIT serves every file on its own instead: the photo list
(``legal/filesAdobe.txt`` + ``legal/filesAdobeMIT.txt``, 5,000 names), each DNG
(``img/dng/<name>.dng``, ~10 MB) and each expert's edit (``img/tiff16_<x>/<name>.tif``,
a 16-bit TIFF in ProPhoto RGB — ROMM, D50, gamma 1.8 — ~32 MB). Nothing is kept
at full size:

- the EDIT is converted to sRGB (the space his finals are in), shrunk to a long
  edge (768 by default: ingest keeps 512, the rest is room to align a cropped edit) and written under ``expert<X>/``;
- the INPUT, when no DNG of that photo is already on disk, is the DNG rendered
  as shot by the same rawpy settings ``ingest`` uses, shrunk alike and written
  under ``input/`` (the reader takes a TIFF before a DNG);

each download is deleted at once, so the disk keeps ~5 MB a photo. A photo whose
files are already there is skipped, so a cut run resumes.
"""

from __future__ import annotations

import struct
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..imaging import fit_long_edge, is_raw, load_image, resize_to, to_uint16
from .fivek import PHOTO_ID, scan_fivek

BASE_URL = "https://data.csail.mit.edu/graphics/fivek/img"
LIST_URLS = ("https://data.csail.mit.edu/graphics/fivek/legal/filesAdobe.txt",
             "https://data.csail.mit.edu/graphics/fivek/legal/filesAdobeMIT.txt")

# ProPhoto (ROMM) primaries, D50 → XYZ; Bradford D50 → D65; XYZ → linear sRGB (D65).
PROPHOTO_TO_XYZ_D50 = np.array([[0.7976749, 0.1351917, 0.0313534],
                                [0.2880402, 0.7118741, 0.0000857],
                                [0.0000000, 0.0000000, 0.8252100]])
BRADFORD_D50_TO_D65 = np.array([[0.9555766, -0.0230393, 0.0631636],
                                [-0.0282895, 1.0099416, 0.0210077],
                                [0.0122982, -0.0204830, 1.3299098]])
XYZ_D65_TO_SRGB = np.array([[3.2404542, -1.5371385, -0.4985314],
                            [-0.9692660, 1.8760108, 0.0415560],
                            [0.0556434, -0.2040259, 1.0572252]])
PROPHOTO_TO_SRGB = XYZ_D65_TO_SRGB @ BRADFORD_D50_TO_D65 @ PROPHOTO_TO_XYZ_D50


def icc_gamma(icc: bytes | None, default: float = 1.8) -> float:
    """The gamma of an ICC profile's red TRC when it is a plain ``curv`` power (ROMM's 1.8), else ``default``."""
    if not icc or len(icc) < 132:
        return default
    count = struct.unpack(">I", icc[128:132])[0]
    for i in range(count):
        sig, offset, size = struct.unpack(">4sII", icc[132 + 12 * i: 144 + 12 * i])
        if sig == b"rTRC" and size >= 14 and icc[offset:offset + 4] == b"curv":
            n = struct.unpack(">I", icc[offset + 8:offset + 12])[0]
            if n == 1:
                return struct.unpack(">H", icc[offset + 12:offset + 14])[0] / 256.0
    return default


def prophoto_to_srgb(img: np.ndarray, gamma: float = 1.8) -> np.ndarray:
    """Encoded ProPhoto RGB in [0, 1] → encoded sRGB in [0, 1]; colours outside sRGB are clipped."""
    linear = np.clip(img, 0.0, 1.0) ** gamma
    srgb = np.clip(linear @ PROPHOTO_TO_SRGB.T, 0.0, 1.0)
    return np.where(srgb <= 0.0031308, 12.92 * srgb, 1.055 * srgb ** (1 / 2.4) - 0.055).astype(np.float32)


def download(url: str, dest: Path, attempts: int = 3) -> None:
    """Stream ``url`` into ``dest`` through a ``.part`` file, so a cut transfer never looks finished. A body
    shorter than its Content-Length (a connection that closes early raises nothing) is tried again."""
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, attempts + 1):
        with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:  # noqa: S310 — a fixed https host
            expected = int(response.headers.get("Content-Length") or -1)
            got = 0
            while chunk := response.read(1 << 20):
                out.write(chunk)
                got += len(chunk)
        if expected < 0 or got == expected:
            part.replace(dest)
            return
        if attempt == attempts:
            part.unlink(missing_ok=True)
            raise OSError(f"truncated download: {got} of {expected} bytes, {attempts} times")


def read_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:  # noqa: S310 — a fixed https host
        return response.read().decode("utf-8")


def mit_photo_list(fetch_text: Callable[[str], str] = read_text) -> list[str]:
    """The 5,000 photo names MIT serves (``a0001-jmac_DSC1459`` …), from its two licence lists."""
    names = {line.strip() for url in LIST_URLS for line in fetch_text(url).splitlines()}
    return sorted(n for n in names if PHOTO_ID.match(n))


@dataclass
class FetchReport:
    fetched: int = 0
    kept: int = 0
    failed: list[tuple[str, str]] = field(default_factory=list)
    photos: int = 0  # photos this run works over: the DNGs on disk, else MIT's list
    inputs: int = 0  # inputs rendered from a downloaded DNG


def read_prophoto_tiff(path: Path) -> np.ndarray:
    """A FiveK edit as encoded sRGB float, whatever gamma its embedded ROMM profile states."""
    import tifffile

    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        icc = page.tags.get("InterColorProfile")
        gamma = icc_gamma(bytes(icc.value) if icc else None)
        data = page.asarray()
    scale = 65535.0 if data.dtype == np.uint16 else 255.0
    return prophoto_to_srgb(data[..., :3].astype(np.float32) / scale, gamma)


def require_rawpy() -> None:
    try:
        import rawpy  # noqa: F401
    except ImportError as err:
        raise RuntimeError("rendering a DNG needs rawpy: run `make setup` (it installs the raw extra)") from err


def _save_shrunk(img: np.ndarray, dest: Path, long_edge: int) -> None:
    """A 16-bit TIFF, deflated losslessly (~12 % smaller: the low bits are noise and barely compress)."""
    import tifffile

    h, w = img.shape[:2]
    if long_edge and max(w, h) > long_edge:
        img = resize_to(img, *fit_long_edge(w, h, long_edge))
    tifffile.imwrite(dest, to_uint16(img), photometric="rgb", compression="zlib", predictor=True)


def fetch_expert(
    root: Path,
    expert: str = "C",
    long_edge: int = 768,
    limit: int = 0,
    log: Callable[[str], None] = print,
    fetch: Callable[[str, Path], None] = download,
    raw: dict | None = None,
    fetch_text: Callable[[str], str] = read_text,
) -> FetchReport:
    """Write ``root/expert<X>/<name>.tif`` for every photo that has none yet, and ``root/input/<name>.tif``
    for every photo that has no input at all. The photos are the DNGs under ``root`` when there are any
    (an archive already unpacked: only the edits are fetched), else MIT's whole list."""
    expert = expert.upper()
    scan = scan_fivek(root, expert)
    have = scan.targets.get(expert, {})
    local = {pid: [p for p in files if is_raw(p)] for pid, files in scan.inputs.items()}
    stems = sorted(raws[0].stem for raws in local.values() if raws)
    if not stems:
        stems = mit_photo_list(fetch_text)
    out_dir, in_dir = root / f"expert{expert}", root / "input"
    report = FetchReport(photos=len(stems))
    todo = []
    for stem in stems:
        pid = PHOTO_ID.match(stem).group(1).lower()
        need_input, need_edit = pid not in scan.inputs, pid not in have
        if need_input or need_edit:
            todo.append((stem, need_input, need_edit))
        else:
            report.kept += 1
    if limit:
        todo = todo[:limit]
    if any(need_input for _, need_input, _ in todo):
        require_rawpy()  # before the first download, not after it
    for i, (stem, need_input, need_edit) in enumerate(todo, 1):
        tmps = []
        try:
            if need_input:
                in_dir.mkdir(parents=True, exist_ok=True)
                tmp = in_dir / f".{stem}.download.dng"
                tmps.append(tmp)
                fetch(f"{BASE_URL}/dng/{urllib.parse.quote(stem)}.dng", tmp)
                _save_shrunk(load_image(tmp, raw or {}), in_dir / f"{stem}.tif", long_edge)
                report.inputs += 1
            if need_edit:
                out_dir.mkdir(parents=True, exist_ok=True)
                tmp = out_dir / f".{stem}.download.tif"
                tmps.append(tmp)
                fetch(f"{BASE_URL}/tiff16_{expert.lower()}/{urllib.parse.quote(stem)}.tif", tmp)
                _save_shrunk(read_prophoto_tiff(tmp), out_dir / f"{stem}.tif", long_edge)
            report.fetched += 1
        except Exception as e:  # noqa: BLE001 — one missing or broken photo never stops the run
            report.failed.append((stem, str(e)))
        finally:
            for tmp in tmps:
                tmp.unlink(missing_ok=True)
                tmp.with_name(tmp.name + ".part").unlink(missing_ok=True)
        if i % 50 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)} — {report.fetched} done, {len(report.failed)} failed")
    return report
