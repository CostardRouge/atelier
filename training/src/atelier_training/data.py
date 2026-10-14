"""The prepared pairs as torch tensors, split by GROUP.

Reads ``<cache>/index.jsonl`` (what ``ingest`` wrote). A group is one original
and every edit of it (FiveK: the photo id), and the validation set holds whole
groups: two edits of one original never sit on both sides, or the model would
be scored on a picture it has seen. The split is a seeded hash of the group
name, so it is the same on every machine and every run.

Training samples are a random crop (``train.crop``) with a random horizontal
flip; the LUT is colour only, so a crop teaches as much as the whole frame at a
fraction of the cost. Validation and export see whole pictures, one at a time.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import Dataset

from .metrics import structure


@dataclass(frozen=True)
class Pair:
    id: str
    source: str
    group: str
    folder: Path
    label: str | None = None


def read_index(cache: Path, sources: list[str] | tuple[str, ...] | None = None) -> list[Pair]:
    index = cache / "index.jsonl"
    if not index.is_file():
        raise FileNotFoundError(f"{index} is missing: run `atelier-train ingest` first.")
    pairs: list[Pair] = []
    for line in index.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if sources and e["source"] not in sources:
            continue
        pairs.append(Pair(e["id"], e["source"], e["group"], cache / e["folder"], e.get("label")))
    return pairs


def is_validation(group: str, fraction: float, seed: int = 0) -> bool:
    """A stable, seeded decision per group: the same group is held out on every run."""
    if fraction <= 0:
        return False
    digest = hashlib.sha256(f"{seed}:{group}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32 < fraction


def split(pairs: list[Pair], fraction: float, seed: int = 0) -> tuple[list[Pair], list[Pair]]:
    """``(train, validation)``, whole groups on one side — and at least one pair in each when there are two groups."""
    val = [p for p in pairs if is_validation(f"{p.source}/{p.group}", fraction, seed)]
    train = [p for p in pairs if not is_validation(f"{p.source}/{p.group}", fraction, seed)]
    groups = sorted({f"{p.source}/{p.group}" for p in pairs})
    if fraction > 0 and len(groups) >= 2 and (not val or not train):
        held = groups[-1] if not val else groups[0]
        val = [p for p in pairs if f"{p.source}/{p.group}" == held]
        train = [p for p in pairs if f"{p.source}/{p.group}" != held]
    return train, val


def load_pair_u16(pair: Pair) -> tuple[np.ndarray, np.ndarray]:
    """Both halves as stored: ``(H, W, 3)`` uint16."""
    return np.load(pair.folder / "input.npy"), np.load(pair.folder / "target.npy")


def pair_structure(pair: Pair) -> float:
    """How well the pair's two halves line up (``metrics.structure``): the value ingest wrote, else measured
    from the cache (a pair aligned before ingest started writing it). NaN for a pair too flat to judge."""
    meta_file = pair.folder / "meta.json"
    if meta_file.is_file():
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        if "structure" in meta:
            return float("nan") if meta["structure"] is None else float(meta["structure"])
    return structure(*load_pair(pair))


def load_pair(pair: Pair) -> tuple[np.ndarray, np.ndarray]:
    """Both halves as ``(H, W, 3)`` float32 in [0, 1]."""
    a, b = load_pair_u16(pair)
    return a.astype(np.float32) / 65535.0, b.astype(np.float32) / 65535.0


def to_tensor(img: np.ndarray) -> Tensor:
    return torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)))


class PairDataset(Dataset):
    def __init__(self, pairs: list[Pair], crop: int | None = None, augment: bool = False, seed: int = 0,
                 keep_in_memory: bool = False):
        """``keep_in_memory``: hold every pair's uint16 arrays after its first read (~2 MB a pair at 512 px)
        instead of reading two files per pair per epoch — measured on his Mac, the disk cost 3× the GPU."""
        self.pairs = pairs
        self.crop = crop
        self.augment = augment
        self.rng = np.random.default_rng(seed)
        self.memory: dict[int, tuple[np.ndarray, np.ndarray]] | None = {} if keep_in_memory else None

    def _read(self, i: int) -> tuple[np.ndarray, np.ndarray]:
        if self.memory is None:
            return load_pair_u16(self.pairs[i])
        if i not in self.memory:
            self.memory[i] = load_pair_u16(self.pairs[i])
        return self.memory[i]

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, i: int) -> tuple[Tensor, Tensor, str]:
        a, b = self._read(i)  # uint16: cut first, convert only the crop
        if self.crop:
            h, w = a.shape[:2]
            ch, cw = min(self.crop, h), min(self.crop, w)
            y = int(self.rng.integers(0, h - ch + 1))
            x = int(self.rng.integers(0, w - cw + 1))
            a, b = a[y : y + ch, x : x + cw], b[y : y + ch, x : x + cw]
            if ch != cw or ch != self.crop:  # a picture smaller than the crop is padded by reflection
                pad_h, pad_w = self.crop - ch, self.crop - cw
                a = np.pad(a, ((0, pad_h), (0, pad_w), (0, 0)), mode="reflect" if min(h, w) > 1 else "edge")
                b = np.pad(b, ((0, pad_h), (0, pad_w), (0, 0)), mode="reflect" if min(h, w) > 1 else "edge")
        if self.augment and self.rng.random() < 0.5:
            a, b = a[:, ::-1], b[:, ::-1]
        a, b = a.astype(np.float32) / 65535.0, b.astype(np.float32) / 65535.0
        return to_tensor(a), to_tensor(b), self.pairs[i].id
