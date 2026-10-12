"""The maintainer's own data: GROUPS of one original and several edits of it.

Layout (documented for him in ``training/README.md``)::

    data/pairs/
      <group>/                 one folder per original, any name ("2024-07-sydney-0412")
        manifest.toml          says which file is the original and which are edits
        DSC01234.ARW           the original (RAW, TIFF, JPEG or PNG)
        DSC01234-warm.jpg      an edit
        edits/DSC01234-bw.jpg  edits may sit in sub-folders

``manifest.toml``::

    original = "DSC01234.ARW"
    title = "Sydney, harbour at dusk"   # optional
    [[edits]]
    file = "DSC01234-warm.jpg"
    label = "warm"                       # optional, free text
    [[edits]]
    file = "edits/DSC01234-bw.jpg"

A folder whose name starts with ``_`` or ``.`` is ignored (a place to park things).
The validator reports every problem at once, in plain words, and never moves or
rewrites a file — except ``init_group``, on request, which only WRITES a manifest.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from ..imaging import RawSupportMissing, image_size, is_picture, is_raw

MANIFEST = "manifest.toml"


@dataclass(frozen=True)
class Edit:
    file: Path
    label: str | None = None


@dataclass
class Group:
    name: str
    folder: Path
    original: Path | None = None
    edits: list[Edit] = field(default_factory=list)
    title: str | None = None


@dataclass(frozen=True)
class Issue:
    level: str  # "error" | "warning"
    group: str
    message: str

    def __str__(self) -> str:
        mark = "✗" if self.level == "error" else "!"
        return f"{mark} [{self.group}] {self.message}"


@dataclass
class PairsScan:
    root: Path
    groups: list[Group] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    def valid_groups(self) -> list[Group]:
        bad = {i.group for i in self.errors}
        return [g for g in self.groups if g.name not in bad]

    @property
    def pair_count(self) -> int:
        return sum(len(g.edits) for g in self.valid_groups())


def _group_folders(root: Path) -> list[Path]:
    return sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))


def _pictures_in(folder: Path) -> list[Path]:
    return sorted(
        p for p in folder.rglob("*") if p.is_file() and not p.name.startswith(".") and is_picture(p)
    )


def read_group(folder: Path, issues: list[Issue]) -> Group:
    group = Group(name=folder.name, folder=folder)

    def err(msg: str) -> None:
        issues.append(Issue("error", group.name, msg))

    manifest = folder / MANIFEST
    if not manifest.is_file():
        err(f"no {MANIFEST}. Write one, or run `atelier-train init-group \"{folder}\"` to have it guessed.")
        return group
    try:
        data = tomllib.loads(manifest.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as e:
        err(f"{MANIFEST} cannot be read: {e}")
        return group
    group.title = data.get("title") if isinstance(data.get("title"), str) else None

    original = data.get("original")
    if not isinstance(original, str) or not original.strip():
        err(f'{MANIFEST} names no original (expected a line like original = "DSC01234.ARW").')
    else:
        path = folder / original
        if not path.is_file():
            err(f"the original {original!r} is not in the folder.")
        elif not is_picture(path):
            err(f"the original {original!r} is not a picture this tool reads (JPEG, PNG, TIFF or RAW).")
        else:
            group.original = path

    edits = data.get("edits", [])
    if not isinstance(edits, list) or not edits:
        err(f"{MANIFEST} lists no edit (expected at least one [[edits]] block with a file = ...).")
        edits = []
    seen: set[Path] = set()
    for i, entry in enumerate(edits, 1):
        if not isinstance(entry, dict) or not isinstance(entry.get("file"), str):
            err(f"edit #{i} has no file = \"...\" line.")
            continue
        path = folder / entry["file"]
        if not path.is_file():
            err(f"the edit {entry['file']!r} is not in the folder.")
            continue
        if not is_picture(path):
            err(f"the edit {entry['file']!r} is not a picture this tool reads.")
            continue
        if group.original is not None and path.resolve() == group.original.resolve():
            err(f"{entry['file']!r} is listed both as the original and as an edit.")
            continue
        if path.resolve() in seen:
            err(f"the edit {entry['file']!r} is listed twice.")
            continue
        seen.add(path.resolve())
        label = entry.get("label") if isinstance(entry.get("label"), str) else None
        group.edits.append(Edit(file=path, label=label))
    return group


def check_geometry(group: Group, issues: list[Issue], tolerance: float) -> None:
    """Warn where an edit cannot be compared pixel for pixel with its original."""
    if group.original is None:
        return
    try:
        ow, oh = image_size(group.original)
    except RawSupportMissing:
        issues.append(
            Issue("warning", group.name, f"{group.original.name} is a RAW and RAW support is not installed "
                  "(`make setup`); its size could not be checked.")
        )
        return
    except Exception as e:  # noqa: BLE001 — any unreadable file is reported, never raised
        issues.append(Issue("error", group.name, f"the original {group.original.name} cannot be read: {e}"))
        return
    for edit in group.edits:
        try:
            ew, eh = image_size(edit.file)
        except Exception as e:  # noqa: BLE001
            issues.append(Issue("error", group.name, f"the edit {edit.file.name} cannot be read: {e}"))
            continue
        if abs(ew / eh - ow / oh) > tolerance * (ow / oh):
            issues.append(
                Issue("warning", group.name, f"{edit.file.name} is {ew}×{eh} against an original of {ow}×{oh}: "
                      "it looks cropped or rotated, so it is skipped for now (aligning pairs comes in M5).")
            )


def scan_pairs(root: Path, aspect_tolerance: float = 0.01, check_sizes: bool = True) -> PairsScan:
    scan = PairsScan(root=root)
    if not root.is_dir():
        scan.issues.append(Issue("error", "-", f"the folder {root} does not exist."))
        return scan
    for folder in _group_folders(root):
        group = read_group(folder, scan.issues)
        scan.groups.append(group)
        listed = {e.file.resolve() for e in group.edits}
        if group.original is not None:
            listed.add(group.original.resolve())
        manifest_ok = (folder / MANIFEST).is_file()
        if manifest_ok:
            for p in _pictures_in(folder):
                if p.resolve() not in listed:
                    rel = p.relative_to(folder).as_posix()
                    scan.issues.append(
                        Issue("warning", group.name, f"{rel} is in the folder but not in {MANIFEST}: it is ignored.")
                    )
        if check_sizes and not any(i.level == "error" and i.group == group.name for i in scan.issues):
            check_geometry(group, scan.issues, aspect_tolerance)
    return scan


def _toml_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def manifest_text(original: str, edits: list[tuple[str, str | None]], title: str | None = None) -> str:
    lines = ["# One original and the edits made of it — see training/README.md."]
    lines.append(f"original = {_toml_str(original)}")
    if title:
        lines.append(f"title = {_toml_str(title)}")
    for file, label in edits:
        lines.append("")
        lines.append("[[edits]]")
        lines.append(f"file = {_toml_str(file)}")
        if label:
            lines.append(f"label = {_toml_str(label)}")
    return "\n".join(lines) + "\n"


class InitGroupError(RuntimeError):
    pass


def guess_original(pictures: list[Path], folder: Path) -> Path:
    """The file named like an original, else the only RAW, else the only picture with the shortest name."""
    named = [p for p in pictures if any(w in p.stem.lower() for w in ("original", "orig", "source"))]
    if len(named) == 1:
        return named[0]
    raws = [p for p in pictures if is_raw(p)]
    if len(raws) == 1:
        return raws[0]
    stems = sorted(pictures, key=lambda p: (len(p.stem), p.name))
    if len(stems) >= 2 and len(stems[0].stem) < len(stems[1].stem) and all(
        p.stem.startswith(stems[0].stem) for p in stems[1:]
    ):
        return stems[0]  # DSC01234.jpg beside DSC01234-warm.jpg, DSC01234-bw.jpg
    raise InitGroupError(
        f"cannot tell which file in {folder.name} is the original: name it with 'original' in it, "
        "or write manifest.toml by hand."
    )


def init_group(folder: Path, force: bool = False) -> Path:
    """Write a guessed ``manifest.toml`` for ``folder``; refuses to overwrite one unless ``force``."""
    folder = Path(folder)
    target = folder / MANIFEST
    if target.exists() and not force:
        raise InitGroupError(f"{target} already exists (pass --force to replace it).")
    pictures = _pictures_in(folder)
    if len(pictures) < 2:
        raise InitGroupError(f"{folder.name} holds {len(pictures)} picture(s); a group needs an original and one edit.")
    original = guess_original(pictures, folder)
    edits = [(p.relative_to(folder).as_posix(), None) for p in pictures if p != original]
    target.write_text(manifest_text(original.relative_to(folder).as_posix(), edits), encoding="utf-8")
    return target
