"""His DEVELOP RECORDS, read from the training file Atelier writes.

Atelier's Develop keeps, for every picture it has in hand, the picture AS
SHOT (a 256 px vignette, the histogram and linear means its Auto verbs read,
the camera's facts) beside the RECORD the author wrote over it — and writes
them all into one JSON file from Settings → Learning → *Training file*
(``src/shared/develop/training-dump.ts``, kind ``atelier/training-pairs``,
version 1). That file is the dataset of the second model (M6): the picture
as shot in, the eleven sliders of ``DevelopSettings`` out.

``atelier-train records <file.json>`` unpacks it under ``data/records/``:
one folder per picture with ``vignette.png``, ``record.json`` (the sliders,
the stats, the EXIF, what was touched) and an ``index.jsonl``. A record an
AGENT wrote (journal ``via: 'agent'``) is left out by default — a model
learning his taste must not learn a machine's. An untouched picture is kept:
"do nothing here" is an answer too.
"""

from __future__ import annotations

import base64
import io
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .imaging import save_image

KIND = "atelier/training-pairs"
SLIDERS = ("exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks",
           "temperature", "tint", "saturation", "vibrance")
RANGES = (3.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0)
STATS_BINS = 64   # the histogram is resampled to this many bins whatever the file carries
EXIF_KEYS = ("iso", "exposureTime", "fNumber", "focalLength35", "exposureBias")


@dataclass
class RecordsReport:
    read: int = 0
    kept: int = 0
    skipped: list[tuple[str, str]] = field(default_factory=list)
    agent: int = 0


def read_training_file(path: Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("kind") != KIND:
        raise ValueError(f"{path.name} is not an Atelier training file (kind {data.get('kind')!r}, expected {KIND!r})")
    if int(data.get("version", 0)) != 1:
        raise ValueError(f"{path.name} is version {data.get('version')}; this reader knows version 1")
    return data


def decode_vignette(data_url: str) -> np.ndarray:
    if not data_url.startswith("data:image/"):
        raise ValueError("the vignette is not a data URL")
    payload = data_url.split(",", 1)[1]
    with Image.open(io.BytesIO(base64.b64decode(payload))) as im:
        return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def slider_vector(develop: dict[str, Any]) -> list[float]:
    return [float(develop.get(k, 0.0) or 0.0) for k in SLIDERS]


def stats_vector(stats: dict[str, Any] | None) -> list[float]:
    """The histogram as ``STATS_BINS`` fractions plus the three linear means: 67 numbers, or zeros."""
    if not stats or not stats.get("bins"):
        return [0.0] * (STATS_BINS + 3)
    bins = np.asarray(stats["bins"], dtype=np.float64)
    total = float(bins.sum()) or 1.0
    # Resample the file's bins onto STATS_BINS by linear interpolation of the cumulative histogram.
    cum = np.concatenate([[0.0], np.cumsum(bins) / total])
    edges = np.linspace(0, len(bins), STATS_BINS + 1)
    resampled = np.diff(np.interp(edges, np.arange(len(bins) + 1), cum))
    means = [float(v) for v in (stats.get("linearMean") or [0, 0, 0])[:3]]
    return [float(v) for v in resampled] + means


def exif_vector(exif: dict[str, Any] | None) -> list[float]:
    """Five camera facts on a log/linear scale a network can read; 0 where unknown."""
    e = exif or {}
    iso = float(e.get("iso") or 0)
    t = float(e.get("exposureTime") or 0)
    f = float(e.get("fNumber") or 0)
    fl = float(e.get("focalLength35") or e.get("focalLength") or 0)
    bias = float(e.get("exposureBias") or 0)
    return [np.log2(iso / 100) if iso > 0 else 0.0, np.log2(t) if t > 0 else 0.0, np.log2(f) if f > 0 else 0.0,
            np.log2(fl / 35) if fl > 0 else 0.0, bias]


def unpack(file: Path, out: Path, include_agent: bool = False, log: Callable[[str], None] = print) -> RecordsReport:
    data = read_training_file(file)
    report = RecordsReport()
    entries: list[dict[str, Any]] = []
    for pair in data.get("pairs", []):
        report.read += 1
        roll, picture = pair.get("roll", {}), pair.get("picture", {})
        pid = f"{roll.get('id', 'roll')}/{picture.get('id', report.read)}"
        if pair.get("agent") and not include_agent:
            report.agent += 1
            continue
        shot = pair.get("shot") or {}
        if not shot.get("vignette"):
            report.skipped.append((pid, "no vignette"))
            continue
        try:
            vignette = decode_vignette(shot["vignette"])
        except Exception as e:  # noqa: BLE001 — a bad vignette is listed, never fatal
            report.skipped.append((pid, f"vignette unreadable: {e}"))
            continue
        develop = (pair.get("record") or {}).get("develop") or {}
        folder = out / pid
        save_image(vignette, folder / "vignette.png")
        record = {
            "id": pid, "roll": roll.get("name"), "picture": picture.get("name"), "hash": picture.get("hash"),
            "edits": pair.get("edits") or [], "touched": bool(pair.get("edits")),
            "sliders": dict(zip(SLIDERS, slider_vector(develop), strict=True)),
            "stats": stats_vector(shot.get("stats")), "exif": exif_vector(shot.get("exif")),
            "exif_raw": shot.get("exif"), "aspect": shot.get("aspect"),
        }
        (folder / "record.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
        entries.append({"id": pid, "folder": pid, "touched": record["touched"], "roll": roll.get("id")})
        report.kept += 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.jsonl").write_text("".join(json.dumps(e) + "\n" for e in entries), encoding="utf-8")
    log(f"{report.kept} record(s) kept of {report.read} ({report.agent} by an agent left out, "
        f"{len(report.skipped)} skipped) → {out}")
    return report


def read_records(out: Path) -> list[dict[str, Any]]:
    index = out / "index.jsonl"
    if not index.is_file():
        raise FileNotFoundError(f"{index} is missing: run `atelier-train records <training file>` first.")
    rows = []
    for line in index.read_text(encoding="utf-8").splitlines():
        if line.strip():
            e = json.loads(line)
            e["record"] = json.loads((out / e["folder"] / "record.json").read_text(encoding="utf-8"))
            rows.append(e)
    return rows


def synthetic_training_file(path: Path, count: int = 40, seed: int = 3, size: int = 64) -> Path:
    """An Atelier training file whose sliders FOLLOW the picture, so a model can be checked to learn it:
    exposure lifts a dark picture, temperature answers the blue–red balance, contrast is a taste constant."""
    from .synthetic import make_picture

    rng = np.random.default_rng(seed)
    pairs = []
    for i in range(count):
        img = make_picture(rng, size, size) ** float(rng.uniform(0.6, 1.8))  # vary the brightness
        luma = float((img @ np.array([0.2126, 0.7152, 0.0722], np.float32)).mean())
        mean = img.reshape(-1, 3).mean(axis=0)
        develop = {
            "exposure": round(float(np.clip((0.5 - luma) * 3.0, -3, 3)), 3),
            "contrast": 20.0,
            "temperature": round(float(np.clip((mean[2] - mean[0]) * 150.0, -100, 100)), 2),
            "brightness": 0.0, "highlights": 0.0, "shadows": 0.0, "whites": 0.0, "blacks": 0.0,
            "tint": 0.0, "saturation": 0.0, "vibrance": 0.0,
        }
        buf = io.BytesIO()
        Image.fromarray((img * 255).round().astype(np.uint8)).save(buf, format="JPEG", quality=92)
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        hist, _ = np.histogram(img @ np.array([0.2126, 0.7152, 0.0722], np.float32), bins=256, range=(0, 1))
        pairs.append({
            "roll": {"id": "synthetic", "name": "Synthetic"},
            "picture": {"id": f"p{i:03d}", "name": f"p{i:03d}.jpg", "size": 0, "hash": None, "variant": None},
            "edits": ["develop"] if i % 5 else [],
            "agent": i % 17 == 0,
            "shot": {"vignette": data_url, "aspect": 1.0, "natural": None, "viaRawPreview": False,
                     "stats": {"bins": hist.tolist(), "total": int(hist.sum()),
                               "linearMean": [float(v) for v in mean], "counted": int(hist.sum())},
                     "exif": {"iso": 400, "exposureTime": 1 / 250, "fNumber": 2.8, "focalLength35": 35}},
            "record": {"develop": develop if i % 5 else dict.fromkeys(SLIDERS, 0.0)},
        })
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"kind": KIND, "version": 1, "exportedAt": "2026-10-13T00:00:00Z", "pairs": pairs}),
                    encoding="utf-8")
    return path
