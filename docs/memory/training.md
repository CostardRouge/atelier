# Training — learning the maintainer's editing style (`training/`)

The Python workspace that trains, on his Mac only, a model imitating his
edits. User guide (French): `training/README.md`. Milestones and how to verify
each: `training/PLAN.md`. This file holds the decisions and traps.

## Decisions

- **2026-10-12 — Local only, never a hosted service.** Training and inference
  run on his machine (Apple Silicon Max, 32 GB); Imagen AI-style services were
  rejected by him as against the suite's local-first line. **How to apply**: no
  runtime network call in `training/` (package install aside); a dashboard binds
  to 127.0.0.1; Winnow is read with his own session and nothing of it lands in git.
- **2026-10-12 — The model writes a LUT first, then a record; never pixels.**
  M2 is Zeng et al. 2020's image-adaptive 3D LUT (CNN on a 256 px thumbnail →
  weights over a few learned 33³ basis LUTs, < 1 MB), exported as a `.cube`
  Atelier already loads as a look; M6 predicts `DevelopSettings`. Generative /
  diffusion output is OUT: it invents pixels, which `docs/auto-develop.md`
  («never invents») forbids. **How to apply**: any new model's output must be a
  LUT or a record the engine renders.
- **2026-10-12 — PyTorch is the backend, MLX an optional extra.** PyTorch has
  MPS and the paper's reference code; MLX is installed on Apple Silicon only
  (environment marker) so Linux/CI installs. **How to apply**: never import
  `torch` or `mlx` at module top level outside the model code; `device.py`
  guards it, and the core (data, `.cube`, doctor, tests) runs without either.
- **2026-10-12 — uv, one lockfile, torch routed per platform.** `uv.lock` is
  committed; `[tool.uv.sources]` sends Linux to PyTorch's CPU index (PyPI's
  Linux wheel pulls gigabytes of CUDA), macOS to PyPI (which carries MPS).
  `.python-version` is 3.12 for wheel coverage (rawpy, MLX). **How to apply**:
  change a dependency → `uv lock`, commit the lock in the same commit.
- **2026-10-12 — TOML configs, no YAML.** `configs/default.toml` holds every
  run parameter, a run file overlays only what it changes, `--set a.b=v` one
  key; read with stdlib `tomllib` (no dependency). Paths resolve against the
  training root, never the cwd.
- **2026-10-12 — The data layout of his groups is `manifest.toml` per folder**
  (one original, N `[[edits]]`), validated in plain words, never rewritten;
  `init-group` only WRITES a guessed manifest, refusing to overwrite. A
  cropped/rotated edit is a WARNING and skipped by ingest until M5 aligns pairs.
- **2026-10-12 — FiveK is read by file-name id (`a0001`) and folder name
  (`expertC`, `expert_c`, `C`).** The official download holds the experts'
  edits only inside `fivek.lrcat`; the reader says so instead of finding
  nothing. Rendered inputs (TIFF/JPEG) are preferred over the DNG by default,
  because the published baselines train on an as-shot rendering. Licence is
  research/non-commercial: never committed, never redistributed.
- **2026-10-12 — The synthetic set is the test oracle.** Pointwise transforms
  whose exact `.cube` is baked beside them, in the real folder layouts, so M2's
  end-to-end test is "training recovers `teal-orange.cube`" on CPU.
- **2026-10-12 — A `.cube` is held as `[b, g, r]`**, so a C-order flatten IS
  the file's red-fastest row order; checked to parse in Atelier's
  `src/shared/lib/cube-parser.ts` (node, 33³, title kept).
- **2026-10-12 — CI for Python is its own path-filtered workflow**
  (`.github/workflows/training.yml`): ruff + pytest on CPU without PyTorch, a
  few seconds. `training/` is excluded from ESLint; TS and Vitest only read
  `src/`. Never add a GPU or a FiveK job.

## Traps

- Pillow reads a 48-bit PNG as 8 bits per channel: 16-bit material goes
  through TIFF (`tifffile`), which `imaging.py` reads and writes.
- The ingest cache stores uint16 `.npy`, not PNG, for the same reason.
- In a cloud container, run uv with `UV_PYTHON=3.13` (the system Python):
  GitHub release downloads, where uv fetches 3.12 from, answered 403 through
  the proxy. On the Mac `make setup` lets uv fetch 3.12.
