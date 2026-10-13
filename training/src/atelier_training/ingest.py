"""Prepare training pairs: every (input, edit) read, checked, resized and cached.

For each pair the cache holds ``<cache>/<source>/<id>/input.npy`` and
``target.npy`` (uint16, ``(H, W, 3)``, both at the SAME size: the input's,
long edge ≤ ``ingest.long_edge``) and a ``preview.jpg`` (input | edit) for the
dashboard of M3. ``<cache>/index.jsonl`` lists one pair per line (``write_index``
says how a run merges into it). A pair already cached and newer than its two
files is not redone, so an ingest can be stopped and rerun. A pair whose aspect
differs (a crop, a turn, a straightening) is ALIGNED through ``align.py`` — the
original cut to the edit's frame — and skipped, said, only when the edit is not
a cut of the original (``ingest.align``). A SLIM group (``winnow-import --slim``)
was prepared one group at a time by ``prepare_group`` and its files deleted: its
cached pairs are reused as they are, never redone.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Iterator
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from multiprocessing import get_context
from pathlib import Path

import numpy as np

from .align import align_pair
from .config import Config
from .datasets.fivek import scan_fivek
from .datasets.pairs import edit_stem, read_group, scan_pairs
from .imaging import (
    HeifSupportMissing,
    RawSupportMissing,
    fit_long_edge,
    load_image,
    resize_to,
    save_image,
    to_uint16,
)

SOURCES = ("fivek", "pairs", "synthetic")


@dataclass(frozen=True)
class PairRef:
    id: str  # "fivek/a0001-C", "pairs/<group>/<edit stem>"
    source: str
    group: str
    input: Path
    target: Path
    label: str | None = None
    slim: bool = False  # its files are gone: only its cache can serve it


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
            # The edit's path inside its group, suffix dropped: `x.jpg` and `edits/x.jpg` stay distinct.
            stem = edit_stem(edit.file, group.folder)
            yield PairRef(f"{source}/{group.name}/{stem}", source, group.name, group.original, edit.file, edit.label,
                          slim=group.slim)


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


def _cached(folder: Path) -> bool:
    return all((folder / n).is_file() for n in ("input.npy", "target.npy", "meta.json"))


def _fresh(folder: Path, ref: PairRef) -> bool:
    files = [folder / "input.npy", folder / "target.npy", folder / "meta.json"]
    if not _cached(folder):
        return False
    if ref.slim:
        return True  # nothing on disk to be newer than it
    newest_source = max(ref.input.stat().st_mtime, ref.target.stat().st_mtime)
    return min(f.stat().st_mtime for f in files) >= newest_source


def prepare_pair(ref: PairRef, out: Path, long_edge: int, tolerance: float, raw: dict, align: str = "auto") -> dict:
    """``align``: ``auto`` finds the edit's crop in the original when the aspects differ, ``always`` searches
    every pair (an edit cropped to the same aspect), ``never`` skips a mismatched pair as M1 did."""
    src = load_image(ref.input, raw, long_edge=None if align != "never" else long_edge)
    dst = load_image(ref.target, raw, long_edge=long_edge)
    (h, w), (th, tw) = src.shape[:2], dst.shape[:2]
    alignment = None
    mismatch = abs(tw / th - w / h) > tolerance * (w / h)
    if align == "always" or (align == "auto" and mismatch):
        src, found = align_pair(src, dst)  # ValueError when the edit is not a cut of the original: skipped, said
        alignment = found.as_dict()
        (h, w) = src.shape[:2]
    elif mismatch:
        raise ValueError(f"aspect differs ({w}×{h} vs {tw}×{th}): cropped or rotated")
    width, height = fit_long_edge(w, h, long_edge)
    a = resize_to(src, width, height)
    b = resize_to(dst, width, height)
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / "input.npy", to_uint16(a))
    np.save(out / "target.npy", to_uint16(b))
    save_image(np.concatenate([a, b], axis=1), out / "preview.jpg", quality=85)
    meta = {"width": width, "height": height, "input_size": [w, h], "target_size": [tw, th], "alignment": alignment}
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def default_workers() -> int:
    """Half the cores, between 1 and 8: a RAW decode holds hundreds of MB, so more is not faster."""
    return max(1, min(8, (os.cpu_count() or 2) // 2))


def _prepare_job(job: tuple[PairRef, Path, int, float, dict, str]) -> tuple[str, dict | str]:
    """Pool entry point (top level so it pickles): ``("ok", meta)`` or ``("error", message)`` —
    one bad file never raises across the process boundary and never stops the run."""
    ref, folder, long_edge, tol, raw, align = job
    try:
        return "ok", prepare_pair(ref, folder, long_edge, tol, raw, align)
    except Exception as e:  # noqa: BLE001
        return "error", str(e)


def ingest(
    config: Config,
    sources: list[str] | None = None,
    force: bool = False,
    limit: int = 0,
    progress: Callable[[int, int, PairRef], None] | None = None,
    workers: int | None = None,
) -> IngestReport:
    """Prepare the pairs of ``sources``. ``workers`` (default ``ingest.workers``, 0 = automatic) pairs
    are decoded at once in separate processes; 1 runs in this process. The index lists pairs in the
    order they were found, whatever order they finish in."""
    ingest_cfg = config.section("ingest")
    sources = sources or list(ingest_cfg.get("sources", ["fivek", "pairs"]))
    long_edge = int(ingest_cfg.get("long_edge", 512))
    tol = float(ingest_cfg.get("aspect_tolerance", 0.01))
    raw = config.section("raw")
    n_workers = int(ingest_cfg.get("workers", 0) if workers is None else workers) or default_workers()
    align = str(ingest_cfg.get("align", "auto"))
    if align not in ("auto", "always", "never"):
        raise ValueError(f"ingest.align must be auto, always or never (got {align!r})")
    report = IngestReport()
    refs = collect(config, sources, report)
    if limit:
        refs = refs[:limit]
    cache = config.paths.cache

    metas: dict[int, dict] = {}
    todo: list[int] = []
    for i, ref in enumerate(refs):
        folder = cache / ref.id
        if (not force or ref.slim) and _fresh(folder, ref):
            metas[i] = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
            report.reused += 1
        elif ref.slim:
            report.skipped.append((ref.id, "its files were deleted once prepared (winnow-import --slim) and its "
                                           "cache is gone: run `atelier-train winnow-import --slim` again"))
        else:
            todo.append(i)
    if force and any(r.slim for r in refs):
        report.notes.append("--force does not redo a slim group (its files are gone): delete its folder and run "
                            "`atelier-train winnow-import --slim` again to prepare it anew")

    def done(i: int, outcome: tuple[str, dict | str]) -> None:
        status, value = outcome
        if status == "ok":
            metas[i] = value  # type: ignore[assignment]
            report.written += 1
        else:
            report.skipped.append((refs[i].id, str(value)))

    jobs = [(refs[i], cache / refs[i].id, long_edge, tol, raw, align) for i in todo]
    finished = len(refs) - len(todo)
    if n_workers <= 1 or len(jobs) <= 1:
        for i, job in zip(todo, jobs, strict=True):
            finished += 1
            if progress:
                progress(finished, len(refs), refs[i])
            done(i, _prepare_job(job))
    else:
        # "spawn" is macOS's default and the safe one beside native decoders (LibRaw, libtiff).
        with ProcessPoolExecutor(max_workers=min(n_workers, len(jobs)), mp_context=get_context("spawn")) as pool:
            futures = {pool.submit(_prepare_job, job): i for i, job in zip(todo, jobs, strict=True)}
            for fut in as_completed(futures):
                i = futures[fut]
                finished += 1
                if progress:
                    progress(finished, len(refs), refs[i])
                try:
                    done(i, fut.result())
                except Exception as e:  # noqa: BLE001 — a worker that died (out of memory) is listed, not fatal
                    report.skipped.append((refs[i].id, f"worker failed: {e}"))

    for i, ref in enumerate(refs):
        if i not in metas:
            continue
        entry = {k: (str(v) if isinstance(v, Path) else v) for k, v in asdict(ref).items()}
        entry.update(width=metas[i]["width"], height=metas[i]["height"], folder=ref.id)
        report.entries.append(entry)
    report.skipped.sort()

    write_index(cache, report.entries, replaced=() if limit else sources)
    return report


def write_index(cache: Path, entries: list[dict], replaced: tuple[str, ...] | list[str] = ()) -> Path:
    """Merge this run's entries into ``index.jsonl``: an entry with the same id is replaced, and every
    earlier entry of a source in ``replaced`` is dropped (a whole run of a source is authoritative for
    it — a pair gone from disk leaves the index; a ``--limit`` run is not, and keeps the rest)."""
    index = cache / "index.jsonl"
    ids = {e["id"] for e in entries}
    kept: list[dict] = []
    if index.is_file():
        for line in index.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            if entry.get("id") not in ids and entry.get("source") not in replaced:
                kept.append(entry)
    cache.mkdir(parents=True, exist_ok=True)
    tmp = index.with_suffix(".jsonl.tmp")
    tmp.write_text("".join(json.dumps(e) + "\n" for e in kept + entries), encoding="utf-8")
    tmp.replace(index)  # one rename, so a run stopped mid-write never leaves a half index
    return index


def prepare_group(config: Config, folder: Path, source: str = "pairs") -> dict:
    """Prepare every edit of ONE group into the cache, in this process — what ``winnow-import --slim`` runs
    before deleting the group's files. Returns ``{"prepared": [stem…], "skipped": {stem: reason}}``. A
    missing RAW or HEIF decoder RAISES: deleting files no pair was made from would lose them for nothing."""
    ingest_cfg = config.section("ingest")
    long_edge = int(ingest_cfg.get("long_edge", 512))
    tol = float(ingest_cfg.get("aspect_tolerance", 0.01))
    align = str(ingest_cfg.get("align", "auto"))
    raw = config.section("raw")
    issues: list = []
    group = read_group(folder, issues)
    if group.original is None or not group.edits:
        raise ValueError("; ".join(i.message for i in issues) or f"{folder.name}: nothing to prepare")
    out: dict = {"prepared": [], "skipped": {}}
    for edit in group.edits:
        stem = edit_stem(edit.file, folder)
        ref = PairRef(f"{source}/{group.name}/{stem}", source, group.name, group.original, edit.file, edit.label)
        try:
            prepare_pair(ref, config.paths.cache / ref.id, long_edge, tol, raw, align)
        except (RawSupportMissing, HeifSupportMissing):
            raise
        except Exception as e:  # noqa: BLE001 — a pair that cannot be made is listed, as ingest does
            out["skipped"][stem] = str(e)
            continue
        out["prepared"].append(stem)
    return out


def group_prepared(config: Config, folder: Path, block: dict, source: str = "pairs") -> bool:
    """Whether every pair a slim group says it prepared is still in the cache."""
    return all(_cached(config.paths.cache / source / folder.name / stem) for stem in block.get("prepared", []))
