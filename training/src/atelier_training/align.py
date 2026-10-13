"""Find where an EDIT sits in its ORIGINAL when the edit was cropped, straightened or turned.

A pair only teaches colour when its two pictures show the same pixels. His
exports are often cropped (a 4:5 for a feed), straightened by a degree or
two, or turned; the ingest of M1 skipped those. This module finds the
transform — a 90° turn or a mirror, a small angle, a crop rectangle — by
normalised cross-correlation of the edit's luminance against the original's
at thumbnail size over a grid of hypotheses (NCC is blind to a tone change
that keeps the pattern, which is what an edit is), then cuts the original to
the edit's frame at the original's own density. Pure numpy (FFT
correlation), no OpenCV.

What it answers: the edit is a crop of the original, scaled, rotated by at
most ``MAX_ANGLE`` degrees after an optional turn or mirror. What it does
not: a perspective keystone, a lens correction, content moved by hand — those
score low and the pair is skipped, said.

The search is two-stage so a pair costs a few seconds, not minutes: every
turn at angle 0 over a coarse ladder of crop scales, then the angles and a
finer ladder around the best hit only.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from PIL import Image

THUMB = 128           # long edge of the edit's search thumbnail
MAX_CROP = 3.0        # the finest crop searched: the edit spans 1/3 of the original (finer scores by chance)
COARSE_RATIO = 1.15   # scale ladder step in the first stage
MAX_ANGLE = 6.0       # degrees of straightening searched either way
ANGLE_STEP = 1.0
MIN_SCORE = 0.8       # NCC below this is "not the same picture" (a real pair scores > 0.9 at this size)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
TURNS = ("none", "cw", "ccw", "half", "mirror", "mirror-cw", "mirror-ccw", "mirror-half")


@dataclass(frozen=True)
class Alignment:
    """How to cut the ORIGINAL (after ``turn``, then a rotation of ``angle`` about its centre) to get the edit.

    ``x0, y0, w, h`` are the crop rectangle in the turned-and-rotated original's own pixels; ``score`` is
    the normalised cross-correlation at the best hypothesis (1 = identical luminance pattern); ``scale``
    is the edit's pixels per original pixel inside the crop (< 1: the edit was downsized).
    """

    turn: str
    angle: float
    x0: int
    y0: int
    w: int
    h: int
    score: float
    scale: float

    def as_dict(self) -> dict:
        return asdict(self)


def luminance(img: np.ndarray) -> np.ndarray:
    return (img.astype(np.float32) @ LUMA).astype(np.float32)


def resize_plane(plane: np.ndarray, width: int, height: int) -> np.ndarray:
    if plane.shape == (height, width):
        return plane
    return np.asarray(Image.fromarray(np.ascontiguousarray(plane, dtype=np.float32)).resize(
        (max(1, width), max(1, height)), Image.BILINEAR), dtype=np.float32)


def apply_turn(img: np.ndarray, turn: str) -> np.ndarray:
    if turn.startswith("mirror"):
        img = img[:, ::-1]
        turn = turn[len("mirror") :].lstrip("-") or "none"
    if turn == "cw":
        return np.rot90(img, k=-1)
    if turn == "ccw":
        return np.rot90(img, k=1)
    if turn == "half":
        return np.rot90(img, k=2)
    return img


def rotate(img: np.ndarray, angle: float) -> np.ndarray:
    """Rotate about the centre by ``angle`` degrees (counter-clockwise positive), same size, bilinear, the
    edges filled with the nearest pixel — fine for a straightening of a few degrees."""
    if abs(angle) < 1e-6:
        return img
    h, w = img.shape[:2]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    t = math.radians(angle)
    c, s = math.cos(t), math.sin(t)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xs = c * (xx - cx) + s * (yy - cy) + cx
    ys = -s * (xx - cx) + c * (yy - cy) + cy
    return _bilinear(img, xs, ys)


def _bilinear(img: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    xs = np.clip(xs, 0, w - 1)
    ys = np.clip(ys, 0, h - 1)
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx, fy = xs - x0, ys - y0
    if img.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    bottom = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return (top * (1 - fy) + bottom * fy).astype(np.float32)


def ncc_map(image: np.ndarray, template: np.ndarray) -> np.ndarray:
    """Normalised cross-correlation of ``template`` at every valid position of ``image`` (both 2-D),
    through FFTs and box sums: ``(H - h + 1, W - w + 1)`` in [-1, 1]; a 1 × 1 of -1 when it cannot fit."""
    H, W = image.shape
    h, w = template.shape
    if h > H or w > W:
        return np.full((1, 1), -1.0, dtype=np.float32)
    t = template - template.mean()
    t_norm = float(np.sqrt((t**2).sum()))
    if t_norm < 1e-6:
        return np.zeros((H - h + 1, W - w + 1), dtype=np.float32)
    shape = (H + h - 1, W + w - 1)
    fi = np.fft.rfft2(image, shape)
    corr = np.fft.irfft2(fi * np.fft.rfft2(t[::-1, ::-1], shape), shape)[h - 1 : H, w - 1 : W]
    fo = np.fft.rfft2(np.ones((h, w), dtype=np.float32), shape)
    s1 = np.fft.irfft2(fi * fo, shape)[h - 1 : H, w - 1 : W]
    s2 = np.fft.irfft2(np.fft.rfft2(image * image, shape) * fo, shape)[h - 1 : H, w - 1 : W]
    var = np.maximum(s2 - s1 * s1 / (h * w), 1e-6)
    return np.clip(corr / (np.sqrt(var) * t_norm), -1.0, 1.0).astype(np.float32)


def _probe(lo_turned: np.ndarray, template: np.ndarray, scale: float, angle: float) -> tuple[float, int, int]:
    """Score the hypothesis (original resized by ``scale``, rotated by ``angle``) and where the edit lands."""
    oh, ow = lo_turned.shape
    th, tw = template.shape
    plane = resize_plane(lo_turned, max(tw, int(round(ow * scale))), max(th, int(round(oh * scale))))
    if angle:
        plane = rotate(plane, angle)
    ncc = ncc_map(plane, template)
    i = int(np.argmax(ncc))
    y, x = divmod(i, ncc.shape[1])
    return float(ncc[y, x]), x, y


def find_alignment(original: np.ndarray, edit: np.ndarray, max_angle: float = MAX_ANGLE,
                   angle_step: float = ANGLE_STEP, max_crop: float = MAX_CROP) -> Alignment:
    """Search turns × crop scales (× angles around the best) for the hypothesis explaining ``edit`` as a cut
    of ``original``. Never raises: a poor fit comes back with a low ``score``."""
    lo = luminance(original)
    le = luminance(edit)
    eh, ew = le.shape
    f = min(1.0, THUMB / max(ew, eh))
    tw, th = max(2, int(round(ew * f))), max(2, int(round(eh * f)))
    template = resize_plane(le, tw, th)
    px_per_edit = tw / ew  # thumbnail pixels per edit pixel

    def alignment(turn: str, scale: float, angle: float, score: float, x: int, y: int) -> Alignment:
        return Alignment(turn=turn, angle=float(angle), x0=int(round(x / scale)), y0=int(round(y / scale)),
                         w=int(round(tw / scale)), h=int(round(th / scale)), score=score,
                         scale=float(scale / px_per_edit))

    best: Alignment | None = None
    turned = {turn: apply_turn(lo, turn) for turn in TURNS}
    # Stage 1: every turn, angle 0, a coarse ladder from "the edit is the whole original" to the finest crop.
    for turn, lo_turned in turned.items():
        oh, ow = lo_turned.shape
        smin = max(tw / ow, th / oh)  # the crop fills the original along one axis
        steps = max(1, int(math.ceil(math.log(max_crop) / math.log(COARSE_RATIO))))
        for i in range(steps + 1):
            scale = smin * COARSE_RATIO**i
            score, x, y = _probe(lo_turned, template, scale, 0.0)
            if best is None or score > best.score:
                best = alignment(turn, scale, 0.0, score, x, y)
    assert best is not None
    # Stage 2: around the best turn and scale, finer scales and the angles.
    lo_turned = turned[best.turn]
    base = best.scale * px_per_edit
    angles = [0.0] + [a for k in range(1, int(max_angle / angle_step) + 1) for a in (k * angle_step, -k * angle_step)]
    for ratio in (1 / COARSE_RATIO**0.5, 1 / COARSE_RATIO**0.25, 1.0, COARSE_RATIO**0.25, COARSE_RATIO**0.5):
        scale = base * ratio
        for angle in angles:
            score, x, y = _probe(lo_turned, template, scale, angle)
            if score > best.score:
                best = alignment(best.turn, scale, angle, score, x, y)
    return best


def cut_original(original: np.ndarray, alignment: Alignment) -> np.ndarray:
    """The original turned, rotated and cropped as the alignment says, at the original's density."""
    img = apply_turn(original, alignment.turn)
    img = rotate(img, alignment.angle)
    h, w = img.shape[:2]
    x0, y0 = max(0, alignment.x0), max(0, alignment.y0)
    x1, y1 = min(w, alignment.x0 + alignment.w), min(h, alignment.y0 + alignment.h)
    return np.ascontiguousarray(img[y0:y1, x0:x1])


def align_pair(original: np.ndarray, edit: np.ndarray, min_score: float = MIN_SCORE) -> tuple[np.ndarray, Alignment]:
    """The original cut to the edit's frame, or ``ValueError`` when the edit is not a cut of it."""
    alignment = find_alignment(original, edit)
    if alignment.score < min_score:
        raise ValueError(f"the edit does not match a cut of the original (best score {alignment.score:.2f}, "
                         f"{alignment.turn}, {alignment.angle:+.0f}°)")
    cut = cut_original(original, alignment)
    if cut.shape[0] < 2 or cut.shape[1] < 2:
        raise ValueError("the matched crop is empty")
    return cut, alignment
