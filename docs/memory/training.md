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

## M2 — the model (2026-10-13)

- **The trilinear lookup is written with `gather`, never `grid_sample`**: a
  3-D `grid_sample` has no MPS kernel, and gathers run the same on CPU, MPS and
  CUDA — and ARE `lut.apply` to the bit (`test_model.py` holds them equal), so
  what the model applies in training is what Atelier applies to the `.cube`.
- **The split is by GROUP** (`data.split`, a seeded SHA-256 of
  `source/group`): two edits of one original never sit on both sides. The
  run writes `split.json` so an eval reads the same sides.
- **A run folder is self-describing**: `config.toml` carries the resolved
  config AND the sources trained on (`[train] sources`), so `eval` and
  `export` never need them again; `metrics.jsonl` one line per epoch;
  checkpoints written through a rename. `Run.sources` is the one reader.
- **The CNN's depth follows the thumbnail**: five stride-2 stages at 256 px,
  fewer below (`log2(thumb) − 1`), because `InstanceNorm2d` refuses a 1 × 1
  map in training and out of it (no running stats). The model starts on the
  identity LUT alone (head bias `[1, 0, …]`, basis LUT 0 = identity), so an
  untrained model leaves the picture as it came.
- **The synthetic set is unlearnable unless it has ONE style**: with several
  random transforms per group, one input has several answers and the e2e
  training test plateaued at fit 0.004. `generate(style=…)` /
  `synthetic.style` make every edit one transform — the training oracle; the
  default stays random, as the readers' exercise.
- Thresholds measured on CPU for the e2e test: identity PSNR on teal-orange
  ≈ 33.6 dB, the exported mean cube ≈ 40 dB; `fit` falls by > 10× in 60
  tiny epochs. Not a quality bar for real data.

## M3 — the dashboard (2026-10-13)

- **FastAPI + ONE static page, localhost only**, over the files the CLI
  already writes; Streamlit/Gradio/TensorBoard declined (heavy, no actions,
  no pair grids), a page inside Atelier declined (no backend by rule). The
  `ui` extra keeps fastapi/uvicorn out of the core; `serve.py` imports them
  lazily; `httpx` sits in the dev group for the TestClient.
- **An action is the CLI run as a SUBPROCESS** (`python -m
  atelier_training.cli …`, `ATELIER_TRAINING_ROOT` passed), never an import:
  the page does exactly what the Terminal does, a crash never takes it down,
  one job at a time, the log kept under `runs/dashboard/`. Arguments are
  checked against `ALLOWED_FLAGS`; the page is single-user and local, so
  that is the whole of its security.
- **Charts are hand-drawn SVG, one metric per chart, one axis**, series =
  the ticked runs (≤ 4) in the dataviz reference palette's first four slots
  — validated on the paper surfaces light (`#fbf8f1`: two slots under 3 : 1,
  hence direct labels + the table) and dark (`#2a251c`: all pass). Text wears
  ink tokens, never the series colour.
- **Trap**: a `display: inline-block` on a class beats the UA's `[hidden]`;
  the page carries `[hidden] { display: none !important }`.
- **Trap**: with `from __future__ import annotations`, a Pydantic model
  defined INSIDE `create_app` is a string FastAPI cannot resolve (it then
  reads the parameter as a query and answers 422); the body is taken as
  `dict = Body(...)` instead.

## Traps

- Pillow reads a 48-bit PNG as 8 bits per channel: 16-bit material goes
  through TIFF (`tifffile`), which `imaging.py` reads and writes.
- The ingest cache stores uint16 `.npy`, not PNG, for the same reason.
- `Image.fromarray(..., mode=)` is deprecated and gone in Pillow 13: a float32
  plane is opened as mode "F" by itself. The tests run with
  `-W error::DeprecationWarning` to catch the next one.
- A JPEG is decoded by its codec at 1/2, 1/4 or 1/8 (`Image.draft`) when the
  caller gives `load_image` a `long_edge` hint — never below the hint, the hint
  in the file's own orientation (a fit keeps the aspect, so the EXIF swap after
  costs nothing). TIFF, PNG and RAW decode whole.
- `index.jsonl` merges by id; a WHOLE run of a source drops that source's
  earlier entries (a pair gone from disk leaves), a `--limit` run keeps them;
  the file is written through a rename, never in place.
- A pair's id is the edit's path INSIDE its group without suffix
  (`pairs/<group>/edits/x`): two edits named alike in two sub-folders stay two.
- Ingest runs in a `ProcessPoolExecutor` with the `spawn` context (macOS's
  default, safe beside LibRaw/libtiff), half the cores capped at 8 — a RAW
  decode holds hundreds of MB, so more workers is not faster. The index keeps
  the discovery order whatever the finish order; a worker's exception is a
  skipped pair, never a crash. On the 96 px synthetic set the pool costs more
  than it saves (0.6 s → 1.0 s): the gain is on real files only.
- In a cloud container, run uv with `UV_PYTHON=3.13` (the system Python):
  GitHub release downloads, where uv fetches 3.12 from, answered 403 through
  the proxy. On the Mac `make setup` lets uv fetch 3.12.
