"""MIT-Adobe FiveK, read from whatever folder it was unpacked into.

The dataset (research and non-commercial licence — NEVER committed or shared)
is distributed as 5,000 RAW photos plus a Lightroom catalogue holding the five
experts' edits; the edits only exist as image files once someone EXPORTS them.
So the reader assumes as little as possible and says what it found:

- A photo is known by its id, ``a0001`` … ``a5000``: every file whose name
  starts with ``a`` + four digits (``a0001-jmac_DSC1459.dng``, ``a0001.jpg``,
  ``a0001.tif``) belongs to that photo.
- A file under a folder named ``expertC``, ``expert_c``, ``Expert-C`` or just
  ``C`` is expert C's edit (A–E likewise). Everything else — ``raw_photos/``,
  ``input/``, ``original/``, any DNG — is an INPUT.
- When a photo has several inputs (a DNG and a 480p JPEG of Zeng et al.'s
  pre-processed set), ``fivek_input_prefer`` picks the first extension found;
  rendered TIFF/JPEG come before the DNG by default, because the published
  baselines train on an as-shot rendering, not on a fresh demosaic.
- A ``.lrcat`` beside no exported expert folder is reported: the edits are in
  the catalogue and must be exported first (README, «FiveK»).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..imaging import is_picture, is_raw

PHOTO_ID = re.compile(r"^(a\d{4})(?=$|[-_. ])", re.IGNORECASE)
EXPERT_DIR = re.compile(r"^(?:expert[ _-]?)?([a-e])$", re.IGNORECASE)
EXPERTS = "ABCDE"


@dataclass(frozen=True)
class FiveKItem:
    id: str
    input: Path
    target: Path


@dataclass
class FiveKScan:
    root: Path
    expert: str
    items: list[FiveKItem] = field(default_factory=list)
    inputs: dict[str, list[Path]] = field(default_factory=dict)
    targets: dict[str, dict[str, Path]] = field(default_factory=dict)  # expert → id → file
    notes: list[str] = field(default_factory=list)

    @property
    def experts_found(self) -> list[str]:
        return sorted(e for e, files in self.targets.items() if files)


def expert_of(path: Path, root: Path) -> str | None:
    for part in path.relative_to(root).parts[:-1]:
        m = EXPERT_DIR.match(part)
        if m:
            return m.group(1).upper()
    return None


def _choose_input(files: list[Path], prefer: list[str]) -> Path:
    order = {ext.lower().lstrip("."): i for i, ext in enumerate(prefer)}
    return min(files, key=lambda p: (order.get(p.suffix.lower().lstrip("."), len(order)), len(str(p)), str(p)))


def scan_fivek(
    root: Path,
    expert: str = "C",
    prefer: list[str] | None = None,
    limit: int = 0,
) -> FiveKScan:
    expert = expert.upper()
    if expert not in EXPERTS:
        raise ValueError(f"expert must be one of A–E, got {expert!r}")
    prefer = prefer or ["tif", "tiff", "png", "jpg", "jpeg", "dng"]
    scan = FiveKScan(root=root, expert=expert)
    if not root.is_dir():
        scan.notes.append(f"the folder {root} does not exist.")
        return scan
    catalogues: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if name.lower().endswith(".lrcat"):
                catalogues.append(path)
                continue
            if name.startswith(".") or not is_picture(path):
                continue
            m = PHOTO_ID.match(name)
            if not m:
                continue
            pid = m.group(1).lower()
            who = expert_of(path, root)
            if who is not None and not is_raw(path):
                scan.targets.setdefault(who, {}).setdefault(pid, path)
            else:
                scan.inputs.setdefault(pid, []).append(path)

    chosen = scan.targets.get(expert, {})
    for pid in sorted(scan.inputs):
        if pid in chosen:
            scan.items.append(FiveKItem(pid, _choose_input(scan.inputs[pid], prefer), chosen[pid]))
            if limit and len(scan.items) >= limit:
                break

    if not scan.inputs:
        scan.notes.append("no FiveK photo found (files named a0001…a5000): `atelier-train fivek-fetch` downloads them.")
    if not chosen:
        found = ", ".join(scan.experts_found) or "none"
        if catalogues:
            scan.notes.append(
                f"no exported edit of expert {expert} (experts found: {found}); the edits are inside "
                f"{catalogues[0].name}: fetch them as images with `atelier-train fivek-fetch` (no Lightroom), "
                f"or export them to a folder named expert{expert}/."
            )
        else:
            scan.notes.append(f"no folder of expert {expert}'s edits (expected expert{expert}/; found: {found}).")
    missing = len([p for p in scan.inputs if p not in chosen]) if chosen else 0
    if chosen and missing:
        scan.notes.append(f"{missing} photo(s) have no edit by expert {expert} and are left out.")
    orphans = len([p for p in chosen if p not in scan.inputs])
    if orphans:
        scan.notes.append(f"{orphans} edit(s) by expert {expert} have no input photo beside them.")
    return scan
