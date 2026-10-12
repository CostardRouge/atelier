"""3D LUTs as Atelier reads them: the Adobe/IRIDAS ``.cube`` text format.

The table is held as ``(N, N, N, 3)`` indexed ``[b, g, r]``, so flattening it in
C order gives the file's row order — red fastest, then green, then blue — which
is also what Atelier's parser (``src/shared/lib/cube-parser.ts``) expects and
uploads as a WebGL 3D texture. Pure numpy: no framework needed to write or read
the deliverable of a run.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class Cube:
    table: np.ndarray  # (N, N, N, 3) float32, indexed [b, g, r]
    title: str | None = None
    domain_min: tuple[float, float, float] = (0.0, 0.0, 0.0)
    domain_max: tuple[float, float, float] = (1.0, 1.0, 1.0)
    comments: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return int(self.table.shape[0])


def lattice(size: int) -> np.ndarray:
    """The input colour at every node, ``(N, N, N, 3)`` indexed [b, g, r], holding (r, g, b)."""
    axis = np.linspace(0.0, 1.0, size, dtype=np.float32)
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r, g, b], axis=-1)


def identity(size: int = 33) -> Cube:
    return Cube(table=lattice(size), title=f"Identity {size}")


def from_function(fn: Callable[[np.ndarray], np.ndarray], size: int = 33, title: str | None = None) -> Cube:
    """Bake a pointwise colour transform (an ``(..., 3)`` → ``(..., 3)`` function on [0, 1]) into a cube."""
    nodes = lattice(size)
    table = np.asarray(fn(nodes.reshape(-1, 3)), dtype=np.float32).reshape(nodes.shape)
    return Cube(table=np.clip(table, 0.0, 1.0), title=title)


def to_text(cube: Cube) -> str:
    lines = [f"# {c}" for c in cube.comments]
    if cube.title:
        lines.append(f'TITLE "{cube.title}"')
    lines.append(f"LUT_3D_SIZE {cube.size}")
    if cube.domain_min != (0.0, 0.0, 0.0) or cube.domain_max != (1.0, 1.0, 1.0):
        lines.append("DOMAIN_MIN {:.6f} {:.6f} {:.6f}".format(*cube.domain_min))
        lines.append("DOMAIN_MAX {:.6f} {:.6f} {:.6f}".format(*cube.domain_max))
    rows = cube.table.reshape(-1, 3)
    lines.extend(f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in rows)
    return "\n".join(lines) + "\n"


def write_cube(cube: Cube, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_text(cube), encoding="utf-8")
    return path


class CubeFormatError(ValueError):
    pass


def parse_cube(text: str) -> Cube:
    """Read a 3D ``.cube``; a 1D LUT, a missing size or a wrong row count is refused."""
    size: int | None = None
    title: str | None = None
    dmin = (0.0, 0.0, 0.0)
    dmax = (1.0, 1.0, 1.0)
    comments: list[str] = []
    rows: list[tuple[float, float, float]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            comments.append(line[1:].strip())
            continue
        head = line.split()[0].upper()
        if head == "LUT_1D_SIZE":
            raise CubeFormatError("1D LUTs are not supported")
        if head == "LUT_3D_SIZE":
            size = int(line.split()[1])
        elif head == "TITLE":
            title = line[5:].strip().strip('"')
        elif head == "DOMAIN_MIN":
            dmin = tuple(float(v) for v in line.split()[1:4])  # type: ignore[assignment]
        elif head == "DOMAIN_MAX":
            dmax = tuple(float(v) for v in line.split()[1:4])  # type: ignore[assignment]
        elif head[0].isdigit() or head[0] in "-+.":
            if size is None:
                raise CubeFormatError("data row before LUT_3D_SIZE")
            parts = line.split()
            rows.append((float(parts[0]), float(parts[1]), float(parts[2])))
        # any other keyword (LUT_3D_INPUT_RANGE, vendor keys) is ignored, as Atelier does
    if size is None:
        raise CubeFormatError("no LUT_3D_SIZE")
    if len(rows) != size**3:
        raise CubeFormatError(f"expected {size**3} rows for size {size}, found {len(rows)}")
    table = np.asarray(rows, dtype=np.float32).reshape(size, size, size, 3)
    return Cube(table=table, title=title, domain_min=dmin, domain_max=dmax, comments=comments)


def read_cube(path: Path | str) -> Cube:
    return parse_cube(Path(path).read_text(encoding="utf-8"))


def apply(cube: Cube, img: np.ndarray) -> np.ndarray:
    """Trilinear lookup of an ``(..., 3)`` float image in [0, 1] (Atelier's ``trilinear`` mode)."""
    n = cube.size
    lo = np.asarray(cube.domain_min, dtype=np.float32)
    hi = np.asarray(cube.domain_max, dtype=np.float32)
    x = np.clip((img.astype(np.float32) - lo) / (hi - lo), 0.0, 1.0) * (n - 1)
    i0 = np.minimum(np.floor(x).astype(np.int64), n - 2)
    f = x - i0
    t = cube.table
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    out = np.zeros(img.shape, dtype=np.float32)
    for db, wb in ((0, 1 - fb), (1, fb)):
        for dg, wg in ((0, 1 - fg), (1, fg)):
            for dr, wr in ((0, 1 - fr), (1, fr)):
                out += t[b0 + db, g0 + dg, r0 + dr] * (wb * wg * wr)
    return out
