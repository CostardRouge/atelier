"""Fetch an expert's FiveK edits as images, one photo at a time, without Lightroom.

The 50 GB archive holds the DNGs and a Lightroom catalogue: the experts' edits are
SETTINGS, not pictures. MIT also serves every edit as its own file —
``img/tiff16_<expert>/<name>.tif``, a 16-bit TIFF in ProPhoto RGB (ROMM, D50,
gamma 1.8), ~32 MB each, ~160 GB for one expert — too much to keep. So each one
is downloaded, converted to sRGB (the space his finals are in), shrunk to a long
edge (1024 by default) and written as a 16-bit TIFF beside the DNGs, under
``expert<X>/`` where the FiveK reader looks; the download is deleted at once.
A photo whose edit is already there is skipped, so a cut run resumes.
"""

from __future__ import annotations

import struct
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..imaging import fit_long_edge, is_raw, resize_to, save_image
from .fivek import scan_fivek

BASE_URL = "https://data.csail.mit.edu/graphics/fivek/img"

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


def download(url: str, dest: Path) -> None:
    """Stream ``url`` into ``dest`` through a ``.part`` file, so a cut transfer never looks finished."""
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:  # noqa: S310 — a fixed https host
        while chunk := response.read(1 << 20):
            out.write(chunk)
    part.replace(dest)


@dataclass
class FetchReport:
    fetched: int = 0
    kept: int = 0
    failed: list[tuple[str, str]] = field(default_factory=list)
    photos: int = 0  # FiveK DNGs found under the root: 0 means the archive is not where it was looked for


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


def fetch_expert(
    root: Path,
    expert: str = "C",
    long_edge: int = 1024,
    limit: int = 0,
    log: Callable[[str], None] = print,
    fetch: Callable[[str, Path], None] = download,
) -> FetchReport:
    """Write ``root/expert<X>/<name>.tif`` for every FiveK DNG under ``root`` that has none yet."""
    expert = expert.upper()
    scan = scan_fivek(root, expert)
    have = scan.targets.get(expert, {})
    out_dir = root / f"expert{expert}"
    report = FetchReport()
    todo = []
    for pid in sorted(scan.inputs):
        raws = [p for p in scan.inputs[pid] if is_raw(p)]
        if not raws:
            continue
        if pid in have:
            report.kept += 1
            continue
        todo.append(raws[0].stem)
    report.photos = report.kept + len(todo)
    if limit:
        todo = todo[:limit]
    if todo:
        out_dir.mkdir(parents=True, exist_ok=True)
    for i, stem in enumerate(todo, 1):
        tmp = out_dir / f".{stem}.download.tif"
        try:
            fetch(f"{BASE_URL}/tiff16_{expert.lower()}/{stem}.tif", tmp)
            img = read_prophoto_tiff(tmp)
            h, w = img.shape[:2]
            if long_edge and max(w, h) > long_edge:
                img = resize_to(img, *fit_long_edge(w, h, long_edge))
            save_image(img, out_dir / f"{stem}.tif")
            report.fetched += 1
        except Exception as e:  # noqa: BLE001 — one missing or broken edit never stops the run
            report.failed.append((stem, str(e)))
        finally:
            tmp.unlink(missing_ok=True)
            tmp.with_name(tmp.name + ".part").unlink(missing_ok=True)
        if i % 50 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)} — {report.fetched} written, {len(report.failed)} failed")
    return report
