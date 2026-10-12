"""Reading and writing pictures as float32 RGB in [0, 1], whatever the file.

JPEG, PNG and TIFF (8 or 16 bit, through tifffile) are first-class. A RAW goes
through rawpy, an OPTIONAL extra (`uv sync --extra raw`): without it a RAW is
reported, never silently skipped. Pillow reads a 48-bit PNG as 8 bits per
channel — use TIFF when the precision matters.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".tif", ".tiff"})
RAW_EXTS = frozenset(
    {".dng", ".arw", ".cr2", ".cr3", ".nef", ".raf", ".orf", ".rw2", ".nrw", ".pef", ".srw"}
)


class RawSupportMissing(RuntimeError):
    """A RAW file was asked for and rawpy is not installed."""

    def __init__(self, path: Path):
        super().__init__(
            f"{path.name} is a RAW file and RAW support is not installed. "
            "Run `make setup` (or `uv sync --extra raw`) and try again."
        )


def is_raw(path: Path) -> bool:
    return path.suffix.lower() in RAW_EXTS


def is_picture(path: Path) -> bool:
    ext = path.suffix.lower()
    return ext in IMAGE_EXTS or ext in RAW_EXTS


def _to_float_rgb(array: np.ndarray) -> np.ndarray:
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    if array.ndim == 3 and array.shape[0] in (3, 4) and array.shape[-1] not in (3, 4):
        array = np.moveaxis(array, 0, -1)  # planar TIFF
    array = array[..., :3]
    if array.dtype == np.uint8:
        out = array.astype(np.float32) / 255.0
    elif array.dtype == np.uint16:
        out = array.astype(np.float32) / 65535.0
    elif np.issubdtype(array.dtype, np.floating):
        out = array.astype(np.float32)
    else:
        info = np.iinfo(array.dtype)
        out = array.astype(np.float32) / float(info.max)
    return np.clip(out, 0.0, 1.0)


def load_image(
    path: Path | str,
    raw_options: dict[str, Any] | None = None,
    long_edge: int | None = None,
) -> np.ndarray:
    """The picture as an ``(H, W, 3)`` float32 array in [0, 1], upright for JPEG/PNG (EXIF orientation).

    ``long_edge`` is a HINT: the caller will resize to that long edge anyway, so a JPEG may be
    decoded at 1/2, 1/4 or 1/8 scale by the codec itself (never below the hint) — a 24 MP file
    then costs a fraction of the time and memory. Every other format is decoded whole.
    """
    path = Path(path)
    ext = path.suffix.lower()
    if ext in RAW_EXTS:
        return _load_raw(path, raw_options or {})
    if ext in (".tif", ".tiff"):
        import tifffile

        return _to_float_rgb(np.asarray(tifffile.imread(path)))
    if ext not in IMAGE_EXTS:
        raise ValueError(f"{path.name}: unsupported file type {ext!r}")
    with Image.open(path) as im:
        if long_edge and im.format == "JPEG":
            # The hint is in the file's own orientation: a fit keeps the aspect, so a swap of w/h
            # by the EXIF orientation applied below changes nothing.
            im.draft(None, fit_long_edge(*im.size, long_edge))
        im = ImageOps.exif_transpose(im)
        if im.mode in ("I;16", "I;16B", "I;16L", "I"):
            return _to_float_rgb(np.asarray(im).astype(np.uint16))
        return _to_float_rgb(np.asarray(im.convert("RGB")))


def _load_raw(path: Path, options: dict[str, Any]) -> np.ndarray:
    try:
        import rawpy
    except ImportError as err:
        raise RawSupportMissing(path) from err
    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(
            use_camera_wb=bool(options.get("use_camera_wb", True)),
            no_auto_bright=bool(options.get("no_auto_bright", True)),
            output_bps=16,
        )
    return _to_float_rgb(rgb)


def image_size(path: Path | str) -> tuple[int, int]:
    """``(width, height)`` as the picture will be loaded, read from the header where possible."""
    path = Path(path)
    ext = path.suffix.lower()
    if ext in RAW_EXTS:
        try:
            import rawpy
        except ImportError as err:
            raise RawSupportMissing(path) from err
        with rawpy.imread(str(path)) as raw:
            s = raw.sizes
            w, h = s.width, s.height
            return (h, w) if s.flip in (5, 6) else (w, h)
    if ext in (".tif", ".tiff"):
        import tifffile

        with tifffile.TiffFile(path) as tif:
            shape = tif.pages[0].shape
        if len(shape) == 3 and shape[0] in (3, 4) and shape[-1] not in (3, 4):
            return shape[2], shape[1]
        return shape[1], shape[0]
    with Image.open(path) as im:
        w, h = im.size
        orientation = im.getexif().get(0x0112, 1)
    return (h, w) if orientation in (5, 6, 7, 8) else (w, h)


def resize_to(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resample each channel in float (Lanczos), so no precision is lost to 8 bits on the way."""
    if img.shape[1] == width and img.shape[0] == height:
        return img.astype(np.float32, copy=False)
    # A float32 plane opens as mode "F" by itself (the `mode=` argument is gone in Pillow 13).
    channels = [
        np.asarray(Image.fromarray(np.ascontiguousarray(img[..., c], dtype=np.float32)).resize(
            (width, height), Image.LANCZOS))
        for c in range(3)
    ]
    return np.clip(np.stack(channels, axis=-1), 0.0, 1.0).astype(np.float32)


def fit_long_edge(width: int, height: int, long_edge: int) -> tuple[int, int]:
    """The size with the long edge at most ``long_edge`` (never upscaled), aspect kept."""
    scale = min(1.0, long_edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def to_uint16(img: np.ndarray) -> np.ndarray:
    return np.round(np.clip(img, 0.0, 1.0) * 65535.0).astype(np.uint16)


def to_uint8(img: np.ndarray) -> np.ndarray:
    return np.round(np.clip(img, 0.0, 1.0) * 255.0).astype(np.uint8)


def save_image(img: np.ndarray, path: Path | str, quality: int = 92) -> None:
    """8-bit PNG/JPEG through Pillow, 16-bit TIFF through tifffile."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    if ext in (".tif", ".tiff"):
        import tifffile

        tifffile.imwrite(path, to_uint16(img), photometric="rgb")
        return
    im = Image.fromarray(to_uint8(img), mode="RGB")
    if ext in (".jpg", ".jpeg"):
        im.save(path, quality=quality)
    else:
        im.save(path)
