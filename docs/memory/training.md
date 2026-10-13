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
- **The pairs panel opens on HIS pairs** (2026-10-13, his "make serve sert
  du synthetic"): `index.jsonl` keeps earlier sources first, so "the first
  24" showed the synthetic set his test run left behind. The panel picks a
  source (the first one that is not `synthetic`) and can show only the
  ALIGNED pairs (`meta.json` `alignment`), the ones to look at before
  trusting a crop. Any new listing over the index filters by source.
- **Trap**: a `display: inline-block` on a class beats the UA's `[hidden]`;
  the page carries `[hidden] { display: none !important }`.
- **Trap**: with `from __future__ import annotations`, a Pydantic model
  defined INSIDE `create_app` is a string FastAPI cannot resolve (it then
  reads the parameter as a query and answers 422); the body is taken as
  `dict = Body(...)` instead.

## M4 — the Winnow import (2026-10-13)

- **Every route was READ in Winnow's code, never guessed** (the lesson of
  `docs/winnow-timeline.md`): `GET /api/assets?kind=final&limit≤500&cursor`
  (`src/app/api/assets/route.ts`, `src/lib/api.ts`), rows = `a.*` +
  `original_asset_id` / `companion_*` / `group_kind` (`src/lib/assetQuery.ts`),
  `GET /api/assets/:id` and `/download` (streams the file), credentials =
  cookie `winnow_session` from `POST /api/auth/login {username, password}` or
  `Authorization: Bearer wnw_…` (`src/lib/auth.ts`, migration 0045). The
  public repo is cloned read-only at `/home/user/costardrouge/winnow` in a
  cloud session when needed; never attached, never written.
- **A Sony capture is listed by its `.HIF`**, the `.ARW` being the
  companion (`group_kind: raw_jpeg`) in NO list: the import fetches the
  companion's own row and file instead, and `winnow.json` keeps both ids
  (`id` the file fetched, `linked_id` what the final points at). HEIF itself
  reads through the `heif` extra (pillow-heif) when no RAW rides along.
- **Credential precedence is flag > file > environment**: the cloud
  container's environment carries `WINNOW_HOST` and a real `WINNOW_TOKEN`,
  which silently beat a test's token file until the order was fixed; the
  tests `delenv` it. Nothing credential-shaped is ever written under
  `training/`; a password is a `getpass` prompt and the cookie lives in memory.
- **Read-only by construction**: GET plus the login POST, nothing else; a
  `.part` file is renamed into place after the whole stream, so a cut
  transfer leaves nothing half-written and a rerun fetches only what is
  missing.

## M5 — fine-tuning and alignment (2026-10-13)

- **His instance holds ~1 890 original → final pairs** (dry run of
  2026-10-13: 1 803 ARW, 77 HIF, 4 DNG, 3 HEIC, 2 JPG originals; one final
  per original) — far above the few-hundred floor `docs/auto-develop.md`
  named. The finals are JPEGs; ingest decodes the ARW through rawpy with the
  camera white balance and no auto-brightening (`[raw]`), which is NOT what
  Capture One rendered: the model learns from rawpy's rendering to his
  export, so the `.cube` it yields is meant for a RAW developed the same way
  (Atelier's sensor base), and a FiveK pretrain stays the colour prior.
- **An edit is aligned by NCC of luminance, two stages** (`align.py`):
  turns × a coarse crop ladder at angle 0, then angles and finer scales
  around the best; NCC is blind to the tone change an edit IS. Thresholds
  set on synthetic pictures: `MIN_SCORE 0.8` (a real pair scores > 0.9 at
  128 px), `MAX_CROP 3` (a finer crop scores by chance on smooth content —
  0.74 on two UNRELATED synthetic pictures at 1/5). Re-measure both on his
  pairs before trusting a skip count.
- **The split for a fine-tune is a fifth of the GROUPS**, never of the
  pairs: his groups are one original + one final today, but a group of
  several edits would otherwise leak across the sides.

## M6 — the develop predictor (2026-10-13)

- **The dataset is Atelier's own training file**, never a Python re-read of
  rolls: `records.py` unpacks `atelier/training-pairs` v1 as
  `training-dump.ts` writes it; a change of that format is a `version`
  bump on both sides. An agent's record is left out by default
  (`--include-agent` keeps it); an untouched picture is kept as a zero
  vector — "nothing" is an answer the model must learn too.
- **Inputs are what Atelier already measures at bake** (`shot-record.ts`):
  the 256 px vignette, `SourceStats` (histogram resampled to 64 fractions +
  three linear means), five EXIF facts on log scales. The sidecar
  `develop-net.json` names the scaling so the browser feeds the same
  numbers; never add an input Atelier cannot compute at the same moment.
- **Outputs are squashed to each slider's range** (`tanh × range`), so a
  predicted record is always one Atelier accepts; the loss is a smooth L1 on
  ranges normalised to ±1, so exposure (±3) and a band (±100) weigh alike;
  the bar is the MAE of predicting nothing, logged beside every validation.
- **ONNX export goes through the torch.export exporter** (`dynamo=True`,
  opset 18, needs `onnxscript`), the TorchScript one only as a fallback —
  in PyTorch 2.14 the legacy path raises a `DeprecationWarning` the tests
  treat as an error. The file is run back through onnxruntime against torch
  before it is called exported; batch is fixed at one (the browser's case).
- **The synthetic training file's sliders follow the picture in EVERY
  record** (`_synthetic_develop`: exposure from the mean luma, contrast from
  its spread, temperature from the blue–red balance), and an untouched
  record's picture is BENT until that taste would leave it alone
  (`_needing_nothing`). The first version wrote zeros over pictures that
  called for an edit: label noise, on which the e2e bar (MAE < 0.6 of
  predicting nothing) was a coin toss across seeds and CPUs — 0.47–0.73
  measured, CI failed at 0.61 where the same torch wheel passed here at
  0.600. The test now trains 120 records for 120 epochs (a second of
  training; the cost of the test is the PNGs and the ONNX run-back) and
  measures 0.22–0.35 on six seeds. A threshold on a learning curve needs
  that margin, never a seed that happens to pass.
- **The export writes ONE file** (`external_data=False`): the dynamo
  exporter otherwise puts the weights in a `.onnx.data` beside the model,
  and Atelier's vault takes the model whole or not at all.
- **The Atelier side (B4) IS built** (2026-10-13, `docs/memory/develop-roll.md`,
  «A model of his OWN»): the two files load into a per-device vault, the
  wasm backend of `onnxruntime-web` (14.2 MB, served from our origin, fetched
  on first press) runs them as the verb *My own*; the input vectors are
  ported bit for bit (`own-model.ts`, pinned to numpy). A change of the
  sidecar or of `stats_vector` / `exif_vector` is a change on BOTH sides.
  The M2 `.cube` still goes through "Upload .cube" with nothing to build. A
  record's RECOVERY for a Winnow pair stays Atelier's engine's job, not a
  Python twin's.

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
- 2026-10-13 — **`make setup` installs EVERY extra the commands need,
  `onnx` included.** `uv sync` makes the venv EXACTLY the extras it is given,
  so a `uv sync --extra onnx` run after `make setup` uninstalled torch — the
  path `make export-develop` asked him to take. How to apply: a new extra a
  command needs goes into the Makefile's `EXTRAS`, never into an error
  message telling him to sync it alone.
