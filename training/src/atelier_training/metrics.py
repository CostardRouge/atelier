"""How far a picture is from the edit it should be — in numbers a photographer reads.

Pure numpy, no torch: the same module scores a model's output, an exported
``.cube`` applied by ``lut.apply``, or two files on disk.

- ``psnr``: peak signal-to-noise ratio in dB over sRGB values in [0, 1].
- ``delta_e76`` and ``delta_e2000``: colour difference in CIE Lab (D65, from
  sRGB through the IEC 61966-2-1 transfer), per pixel; ΔE2000 is the one that
  tracks what an eye sees (~1 is just noticeable, ~2–3 is a visible shift).
"""

from __future__ import annotations

import numpy as np

# sRGB (D65) → XYZ, rows X Y Z.
_M_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ],
    dtype=np.float64,
)
_D65 = np.array([0.95047, 1.0, 1.08883], dtype=np.float64)


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """``(..., 3)`` sRGB in [0, 1] → ``(..., 3)`` CIE L*a*b* (D65)."""
    lin = srgb_to_linear(np.clip(rgb, 0.0, 1.0))
    xyz = lin @ _M_RGB_TO_XYZ.T / _D65
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def delta_e76(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum((np.asarray(lab1) - np.asarray(lab2)) ** 2, axis=-1))


def delta_e2000(lab1: np.ndarray, lab2: np.ndarray, kl: float = 1.0, kc: float = 1.0, kh: float = 1.0) -> np.ndarray:
    """CIEDE2000 per element (Sharma, Wu & Dalal 2005), ``(...)`` from two ``(..., 3)`` Lab arrays."""
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cbar**7 / (Cbar**7 + 25.0**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dh = h2p - h1p
    dh = np.where(np.abs(dh) <= 180, dh, dh - 360 * np.sign(dh))
    dh = np.where(C1p * C2p == 0, 0.0, dh)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    hsum = h1p + h2p
    hbp = np.where(
        C1p * C2p == 0, hsum,
        np.where(np.abs(h1p - h2p) <= 180, hsum / 2, np.where(hsum < 360, hsum / 2 + 180, hsum / 2 - 180)),
    )
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dtheta = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp**7 / (Cbp**7 + 25.0**7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return np.sqrt((dLp / (kl * Sl)) ** 2 + (dCp / (kc * Sc)) ** 2 + (dHp / (kh * Sh)) ** 2
                   + Rt * (dCp / (kc * Sc)) * (dHp / (kh * Sh)))


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)) ** 2))
    return float("inf") if mse == 0 else float(10 * np.log10(1.0 / mse))


STRUCTURE_FLOOR = 0.5  # under this, two halves do not line up (set on synthetic shifts and his first run)


def structure(a: np.ndarray, b: np.ndarray, size: int = 128) -> float:
    """How well two pictures LINE UP, blind to their colours: the normalised correlation of their
    luminance gradients at ``size`` px on the long edge, each blurred over 3 × 3 so a pixel or two of
    lens correction does not count. ~1 for an edit of the same frame, near 0 for a turned, mirrored or
    mis-cropped pair — the pairs a colour model can only learn noise from. NaN when either half has no
    edges at all (a flat picture): nothing to line up, so nothing to judge."""
    h, w = a.shape[:2]
    step = max(1, int(np.ceil(max(h, w) / size)))

    def edges(img: np.ndarray) -> np.ndarray:
        y = np.asarray(img, dtype=np.float64)[::step, ::step, :3] @ np.array([0.2126, 0.7152, 0.0722])
        gx, gy = np.diff(y, axis=1)[:-1, :], np.diff(y, axis=0)[:, :-1]
        g = np.hypot(gx, gy)
        p = np.pad(g, 1, mode="edge")
        g = sum(p[dy:dy + g.shape[0], dx:dx + g.shape[1]] for dy in range(3) for dx in range(3)).ravel()
        return g - g.mean()

    ea, eb = edges(a), edges(b)
    den = float(np.sqrt((ea * ea).sum() * (eb * eb).sum()))
    return float((ea * eb).sum() / den) if den > 0 else float("nan")


def coarse(img: np.ndarray, block: int = 8) -> np.ndarray:
    """The picture as ``block`` × ``block`` means: what is left of it once detail and a few pixels of
    misregistration are averaged out — its colour and its light."""
    h, w = (img.shape[0] // block) * block, (img.shape[1] // block) * block
    if h == 0 or w == 0:
        return np.asarray(img, dtype=np.float32)
    x = np.asarray(img[:h, :w, :3], dtype=np.float32)
    return x.reshape(h // block, block, w // block, block, 3).mean(axis=(1, 3))


def best_global_map(src: np.ndarray, target: np.ndarray, bins: int = 17) -> np.ndarray:
    """The best a colour-to-colour map can do on THIS picture: every input colour (on a ``bins``³ grid)
    sent to the mean target colour of the pixels that had it, fitted on the picture itself. No LUT,
    adaptive or not, can beat it on that picture — what it still misses is work that depends on WHERE
    a pixel is (a mask, a darkened sky, a vignette), not on its colour."""
    x = np.clip(np.asarray(src, dtype=np.float32)[..., :3], 0, 1)
    t = np.asarray(target, dtype=np.float32)[..., :3].reshape(-1, 3)
    q = np.rint(x * (bins - 1)).astype(np.int64).reshape(-1, 3)
    cell = (q[:, 0] * bins + q[:, 1]) * bins + q[:, 2]
    count = np.bincount(cell, minlength=bins**3).astype(np.float64)
    out = np.empty_like(t)
    for c in range(3):
        mean = np.bincount(cell, weights=t[:, c], minlength=bins**3) / np.maximum(count, 1)
        out[:, c] = mean[cell]
    return out.reshape(x.shape)


def score(output: np.ndarray, target: np.ndarray) -> dict[str, float]:
    """Everything the dashboard shows for one pair: PSNR, mean and 95th-percentile ΔE76 and ΔE2000."""
    lab_o, lab_t = srgb_to_lab(output), srgb_to_lab(target)
    de76 = delta_e76(lab_o, lab_t)
    de00 = delta_e2000(lab_o, lab_t)
    return {
        "psnr": psnr(output, target),
        "de76_mean": float(de76.mean()),
        "de76_p95": float(np.percentile(de76, 95)),
        "de2000_mean": float(de00.mean()),
        "de2000_p95": float(np.percentile(de00, 95)),
    }
