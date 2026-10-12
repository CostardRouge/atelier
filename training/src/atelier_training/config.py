"""Run configuration: one TOML file per run, layered over ``configs/default.toml``.

A user file only needs the keys it changes; ``--set section.key=value`` changes
one more on the command line. Paths are resolved against the training root
(the folder holding ``configs/``), never against the current directory, so a
command behaves the same wherever it is typed from.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parents[2]


def training_root() -> Path:
    """The ``training/`` folder: ``$ATELIER_TRAINING_ROOT``, else the nearest parent of the cwd holding
    ``configs/default.toml``, else the folder this package was installed from."""
    env = os.environ.get("ATELIER_TRAINING_ROOT")
    if env:
        return Path(env).resolve()
    here = Path.cwd().resolve()
    for folder in (here, *here.parents):
        if (folder / "configs" / "default.toml").is_file():
            return folder
        if (folder / "training" / "configs" / "default.toml").is_file():
            return folder / "training"
    return PACKAGE_ROOT


@dataclass(frozen=True)
class Paths:
    data: Path
    fivek: Path
    pairs: Path
    synthetic: Path
    cache: Path
    runs: Path


@dataclass(frozen=True)
class Config:
    root: Path
    paths: Paths
    values: dict[str, Any]

    def section(self, name: str) -> dict[str, Any]:
        return dict(self.values.get(name, {}))


def merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def parse_override(text: str) -> dict[str, Any]:
    """``"ingest.long_edge=768"`` → ``{"ingest": {"long_edge": 768}}``. The value is read as TOML
    (numbers, booleans, lists, quoted strings), and as a bare string when it is not valid TOML."""
    if "=" not in text:
        raise ValueError(f"--set expects section.key=value, got {text!r}")
    dotted, raw = text.split("=", 1)
    keys = [k.strip() for k in dotted.split(".") if k.strip()]
    if not keys:
        raise ValueError(f"--set has no key in {text!r}")
    try:
        value: Any = tomllib.loads(f"v = {raw.strip()}")["v"]
    except tomllib.TOMLDecodeError:
        value = raw.strip()
    out: dict[str, Any] = {keys[-1]: value}
    for key in reversed(keys[:-1]):
        out = {key: out}
    return out


def load_config(path: Path | str | None = None, overrides: list[str] | tuple[str, ...] = ()) -> Config:
    root = training_root()
    default_file = root / "configs" / "default.toml"
    if not default_file.is_file():
        default_file = PACKAGE_ROOT / "configs" / "default.toml"
    values = tomllib.loads(default_file.read_text(encoding="utf-8"))
    if path is not None:
        user = Path(path)
        if not user.is_absolute() and not user.is_file():
            user = root / user
        values = merge(values, tomllib.loads(user.read_text(encoding="utf-8")))
    for text in overrides:
        values = merge(values, parse_override(text))

    def resolve(key: str) -> Path:
        p = Path(values["paths"][key]).expanduser()
        return p if p.is_absolute() else (root / p)

    paths = Paths(*(resolve(k) for k in ("data", "fivek", "pairs", "synthetic", "cache", "runs")))
    return Config(root=root, paths=paths, values=values)
