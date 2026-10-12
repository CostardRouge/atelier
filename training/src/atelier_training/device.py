"""Which compute device a run uses. PyTorch is optional: every import is guarded so the
core (data, synthetic set, .cube files, doctor) runs on a machine without it."""

from __future__ import annotations

import importlib.util
import platform


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def torch_info() -> dict[str, object] | None:
    """Version and backends of the installed PyTorch, or None when it is not installed."""
    if not module_available("torch"):
        return None
    import torch

    mps = getattr(torch.backends, "mps", None)
    return {
        "version": torch.__version__,
        "mps_built": bool(mps and mps.is_built()),
        "mps_available": bool(mps and mps.is_available()),
        "cuda_available": bool(torch.cuda.is_available()),
    }


def pick_device(prefer: str = "auto") -> str:
    """``"mps"`` on an Apple Silicon Mac, ``"cuda"`` where present, else ``"cpu"``.

    An explicit ``prefer`` that the machine cannot honour falls back to the CPU rather than failing,
    so a config written on the Mac still runs the tests elsewhere.
    """
    info = torch_info()
    if info is None:
        return "cpu"
    if prefer in ("mps", "auto") and info["mps_available"]:
        return "mps"
    if prefer in ("cuda", "auto") and info["cuda_available"]:
        return "cuda"
    return "cpu"


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"
