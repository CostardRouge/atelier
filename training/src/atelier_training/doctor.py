"""``atelier-train doctor``: is this machine ready, and what is missing, in plain words."""

from __future__ import annotations

import os
import platform
import shutil
import sys
from dataclasses import dataclass

from .config import Config
from .datasets.fivek import scan_fivek
from .datasets.pairs import scan_pairs
from .device import is_apple_silicon, module_available, pick_device, torch_info

OK, WARN, FAIL, INFO = "ok", "warn", "fail", "info"
MARK = {OK: "✓", WARN: "!", FAIL: "✗", INFO: "·"}


@dataclass(frozen=True)
class Check:
    name: str
    status: str
    message: str
    fix: str | None = None

    def render(self) -> str:
        line = f"  {MARK[self.status]} {self.name}: {self.message}"
        return line + (f"\n      → {self.fix}" if self.fix else "")


def total_memory_bytes() -> int | None:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return None


def gib(n: float) -> str:
    return f"{n / 2**30:.0f} GB"


def machine_checks(config: Config) -> list[Check]:
    checks: list[Check] = []
    v = sys.version_info
    checks.append(
        Check("Python", OK, f"{v.major}.{v.minor}.{v.micro}")
        if v >= (3, 11)
        else Check("Python", FAIL, f"{v.major}.{v.minor} is too old", "Run `make setup`: uv installs the right one.")
    )
    missing = [m for m in ("numpy", "PIL", "tifffile") if not module_available(m)]
    checks.append(
        Check("Core libraries", FAIL, "missing: " + ", ".join(missing), "Run `make setup`.")
        if missing
        else Check("Core libraries", OK, "numpy, Pillow, tifffile")
    )

    info = torch_info()
    if info is None:
        checks.append(Check("PyTorch", WARN, "not installed — reading data works, training will not",
                            "Run `make setup` (it installs PyTorch)."))
    else:
        device = pick_device(str(config.section("device").get("prefer", "auto")))
        if device == "mps":
            checks.append(Check("PyTorch", OK, f"{info['version']}, training on the Mac's GPU (MPS)"))
        elif is_apple_silicon():
            checks.append(Check("PyTorch", WARN, f"{info['version']} but the Mac's GPU (MPS) is not usable",
                                "Update macOS to 12.3 or later, then `make setup` again."))
        else:
            checks.append(
                Check("PyTorch", INFO, f"{info['version']} on {device.upper()} — fine for tests, slow to train")
            )

    if is_apple_silicon():
        checks.append(
            Check("MLX (optional)", OK, "installed")
            if module_available("mlx")
            else Check("MLX (optional)", INFO, "not installed — not needed, PyTorch is the main backend")
        )
    checks.append(
        Check("RAW support", OK, "rawpy installed")
        if module_available("rawpy")
        else Check("RAW support", WARN, "rawpy missing — DNG / ARW files cannot be read",
                   "Run `make setup` (or `uv sync --extra raw`).")
    )

    mem = total_memory_bytes()
    if mem is None:
        checks.append(Check("Memory", INFO, "could not be read"))
    elif mem < 16 * 2**30:
        checks.append(Check("Memory", WARN, f"{gib(mem)} — training will need small batches"))
    else:
        checks.append(Check("Memory", OK, gib(mem)))

    folder = config.paths.data if config.paths.data.exists() else config.root
    free = shutil.disk_usage(folder).free
    checks.append(
        Check("Free disk", OK, gib(free))
        if free > 20 * 2**30
        else Check("Free disk", WARN, f"{gib(free)} — the prepared cache and checkpoints need room")
    )
    checks.append(Check("System", INFO, f"{platform.system()} {platform.machine()}"))
    return checks


def data_checks(config: Config) -> list[Check]:
    checks: list[Check] = []
    ingest = config.section("ingest")
    expert = str(ingest.get("fivek_expert", "C")).upper()
    p = config.paths
    if not p.fivek.is_dir():
        checks.append(Check("FiveK", WARN, f"no folder at {p.fivek}",
                            "Put the FiveK download there (README, «Où mettre FiveK»)."))
    else:
        scan = scan_fivek(p.fivek, expert, limit=0)
        status = OK if scan.items else WARN
        msg = f"{len(scan.inputs)} photos, {len(scan.items)} with an edit by expert {expert}"
        checks.append(Check("FiveK", status, msg, "; ".join(scan.notes) or None))
    if not p.pairs.is_dir():
        checks.append(Check("Your pairs", WARN, f"no folder at {p.pairs}",
                            "Create it and add one folder per original (README, «Vos paires»)."))
    else:
        scan = scan_pairs(p.pairs, float(ingest.get("aspect_tolerance", 0.01)), check_sizes=False)
        if not scan.groups:
            checks.append(Check("Your pairs", WARN, "the folder is empty"))
        elif scan.errors:
            checks.append(Check("Your pairs", WARN,
                                f"{len(scan.groups)} groups, {len(scan.errors)} problem(s)",
                                "Run `make validate` to see them."))
        else:
            checks.append(Check("Your pairs", OK, f"{len(scan.groups)} groups, {scan.pair_count} pairs"))
    checks.append(
        Check("Synthetic set", OK, "present")
        if (p.synthetic / "truth.json").is_file()
        else Check("Synthetic set", INFO, "not made yet", "Run `make synth` to try everything without real data.")
    )
    return checks


def run(config: Config) -> tuple[list[Check], int]:
    checks = machine_checks(config) + data_checks(config)
    return checks, (1 if any(c.status == FAIL for c in checks) else 0)
