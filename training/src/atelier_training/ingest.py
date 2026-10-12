"""Prepare training pairs: every (input, edit) read, checked, resized and cached.

For each pair the cache holds ``<cache>/<source>/<id>/input.npy`` and
``target.npy`` (uint16, ``(H, W, 3)``, both at the SAME size: the input's,
long edge ≤ ``ingest.long_edge``) and a ``preview.jpg`` (input | edit) for the
dashboard of M3. ``<cache>/index.jsonl`` lists one pair per line. A pair
already cached and newer than its two files is not redone, so an ingest can be
stopped and rerun. A pair whose aspect differs (a crop, a rotation) is
SKIPPED and said: aligning those is M5's work.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .config import Config
from .datasets.fivek import scan_fivek
from .datasets.pairs import scan_pairs
from .imaging import RawSupportMissing, fit_long_edge, load_image, resize_to, save_image, to_uint16

SOURCES = ("fivek", "pairs", "synthetic")


@dataclass(frozen=True)
class PairRef:
    id: str  # "fivek/a0001-C", "pairs/<group>/<edit stem>"
    source: str
    group: str
    input: Path
    target: Path
    label: str | None = None


@dataclass
class IngestReport:
    written: int = 0
    reused: int = 0
    skipped: list[tuple[str, str]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    entries: list[dict] = field(default_factory=list)


def _pairs_refs(source: str, root: Path, tolerance: float, report: IngestReport) -> Iterator[PairRef]:
    scan = scan_pairs(root, aspect_tolerance=tolerance, check_sizes=False)
    for issue in scan.errors:
        report.notes.append(str(issue))
    for group in scan.valid_groups():
        assert group.original is not None
        for edit in group.edits:
            yield PairRef(f"{source}/{group.name}/{edit.file.stem}", source, group.name, group.original, edit.file,
                          edit.label)


def _fivek_refs(source: str, root: Path, ingest: dict, report: IngestReport) -> Iterator[PairRef]:
    expert = str(ingest.get("fivek_expert", "C")).upper()
    scan = scan_fivek(root, expert, list(ingest.get("fivek_input_prefer", [])) or None,
                      int(ingest.get("fivek_limit", 0)))
    report.notes.extend(f"FiveK ({root.name}): {n}" for n in scan.notes)
    for item in scan.items:
        yield PairRef(f"{source}/{item.id}-{expert}", source, item.id, item.input, item.target, f"expert {expert}")


def collect(config: Config, sources: list[str], report: IngestReport) -> list[PairRef]:
    ingest = config.section("ingest")
    tol = float(ingest.get("aspect_tolerance", 0.01))
    refs: list[PairRef] = []
    for source in sources:
        if source == "fivek":
            refs.extend(_fivek_refs("fivek", config.paths.fivek, ingest, report))
        elif source == "pairs":
            refs.extend(_pairs_refs("pairs", config.paths.pairs, tol, report))
        elif source == "synthetic":
            refs.extend(_pairs_refs("synthetic", config.paths.synthetic / "pairs", tol, report))
            refs.extend(_fivek_refs("synthetic", config.paths.synthetic / "fivek", ingest, report))
        else:
            raise ValueError(f"unknown source {source!r} (expected one of {', '.join(SOURCES)})")
    return refs


def _fresh(folder: Path, ref: PairRef) -> bool:
    files = [folder / "input.npy", folder / "target.npy", folder / "meta.json"]
    if not all(f.is_file() for f in files):
        return False
    newest_source = max(ref.input.stat().st_mtime, ref.target.stat().st_mtime)
    return min(f.stat().st_mtime for f in files) >= newest_source


def prepare_pair(ref: PairRef, out: Path, long_edge: int, tolerance: float, raw: dict) -> dict:
    src = load_image(ref.input, raw)
    dst = load_image(ref.target, raw)
    (h, w), (th, tw) = src.shape[:2], dst.shape[:2]
    if abs(tw / th - w / h) > tolerance * (w / h):
        raise ValueError(f"aspect differs ({w}×{h} vs {tw}×{th}): cropped or rotated")
    width, height = fit_long_edge(w, h, long_edge)
    a = resize_to(src, width, height)
    b = resize_to(dst, width, height)
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / "input.npy", to_uint16(a))
    np.save(out / "target.npy", to_uint16(b))
    save_image(np.concatenate([a, b], axis=1), out / "preview.jpg", quality=85)
    meta = {"width": width, "height": height, "input_size": [w, h], "target_size": [tw, th]}
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def ingest(
    config: Config,
    sources: list[str] | None = None,
    force: bool = False,
    limit: int = 0,
    progress: Callable[[int, int, PairRef], None] | None = None,
) -> IngestReport:
    ingest_cfg = config.section("ingest")
    sources = sources or list(ingest_cfg.get("sources", ["fivek", "pairs"]))
    long_edge = int(ingest_cfg.get("long_edge", 512))
    tol = float(ingest_cfg.get("aspect_tolerance", 0.01))
    raw = config.section("raw")
    report = IngestReport()
    refs = collect(config, sources, report)
    if limit:
        refs = refs[:limit]
    cache = config.paths.cache
    for n, ref in enumerate(refs, 1):
        if progress:
            progress(n, len(refs), ref)
        folder = cache / ref.id
        try:
            if not force and _fresh(folder, ref):
                meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
                report.reused += 1
            else:
                meta = prepare_pair(ref, folder, long_edge, tol, raw)
                report.written += 1
        except RawSupportMissing as e:
            report.skipped.append((ref.id, str(e)))
            continue
        except Exception as e:  # noqa: BLE001 — one bad file never stops the run; it is listed
            report.skipped.append((ref.id, str(e)))
            continue
        entry = {k: (str(v) if isinstance(v, Path) else v) for k, v in asdict(ref).items()}
        entry.update(width=meta["width"], height=meta["height"], folder=str(folder.relative_to(cache)))
        report.entries.append(entry)

    # The index keeps what other sources ingested earlier and replaces this run's sources.
    index = cache / "index.jsonl"
    kept: list[dict] = []
    if index.is_file():
        for line in index.read_text(encoding="utf-8").splitlines():
            if line.strip():
                entry = json.loads(line)
                if entry.get("source") not in sources:
                    kept.append(entry)
    cache.mkdir(parents=True, exist_ok=True)
    index.write_text("".join(json.dumps(e) + "\n" for e in kept + report.entries), encoding="utf-8")
    return report
