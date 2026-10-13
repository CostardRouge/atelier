from __future__ import annotations

from pathlib import Path

import pytest

from atelier_training.config import load_config
from atelier_training.synthetic import generate


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A throwaway training root holding the real default config, so paths resolve under tmp_path."""
    configs = tmp_path / "configs"
    configs.mkdir()
    real = Path(__file__).resolve().parents[1] / "configs" / "default.toml"
    (configs / "default.toml").write_text(real.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setenv("ATELIER_TRAINING_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def synthetic(workspace: Path) -> Path:
    out = load_config().paths.synthetic
    generate(out, groups=3, size=(48, 32), edits_per_group=2, fivek_photos=3, seed=3, lut_size=17)
    return out
