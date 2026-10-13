# Training plan — learning the maintainer's editing style, locally

The plan for later sessions. One milestone ≈ one PR; inside it, one commit per
task (CLAUDE.md rule 1). Decisions and rejected options live in
`docs/memory/training.md`; the user guide (French) is `README.md`.

**Goal.** On his Mac (Apple Silicon Max, 32 GB), train a small model that
imitates his editing, so Atelier can (a) apply an automatic per-photo LUT and
(b) predict `DevelopSettings` in his style. Nothing is uploaded, ever.

**Never verifiable in a cloud session:** MPS, MLX, real FiveK, his pairs, his
Winnow. Each milestone below says what a session CAN prove (CPU + synthetic
set) and what only his Mac can.

---

## M1 — workspace and data layer — BUILT (2026-10-12)

`training/` with uv (lockfile), PyTorch as an extra (MPS on Mac, CPU index on
Linux), MLX and rawpy as extras; `atelier-train doctor | synth | validate |
init-group | ingest` (+ `train | eval | export` stubs exiting 2); readers for
FiveK (defensive, `datasets/fivek.py`) and his groups (`datasets/pairs.py`,
`manifest.toml`); the synthetic set with known transforms and their exact
`.cube`; the `.cube` writer/reader/trilinear apply (`lut.py`), checked to be
read by Atelier's own `src/shared/lib/cube-parser.ts`; the ingest cache
(`data/cache/<source>/<id>/{input,target}.npy` uint16, same size, `preview.jpg`,
`index.jsonl`); 31 pytest specs on CPU; a CPU-only CI job without PyTorch
(`.github/workflows/training.yml`).

Not verified here: `make setup` on macOS (MPS wheel, MLX, rawpy wheel), a real
FiveK folder, a real RAW decode, `doctor` on his Mac.

## M2 — the image-adaptive 3D LUT model, training, evaluation, `.cube` export — BUILT (2026-10-13)

`model/lut3d.py` (the CNN, the basis LUTs, a gather-based trilinear `apply_lut`
held equal to `lut.apply`, the two regularisers), `data.py` (the index as a
torch dataset, the split by GROUP), `train.py` (runs under `runs/<date>-<name>/`
with `config.toml`, `metrics.jsonl`, `best.pt`/`last.pt`, `split.json`;
`--resume`, `--init`; `bench`), `evaluate.py` (`eval/<split>.json`, the grids
worst-ΔE first), `export.py` (`style.cube`, `--image`), `metrics.py` (Lab,
ΔE76, ΔE2000 against Sharma's pairs, PSNR). The end-to-end test trains on CPU
on a synthetic set made with one `style` and recovers it: val PSNR ≈ 33 dB,
ΔE2000 ≈ 1, the exported cube at 40 dB on a fresh picture against 33.6 for the
identity. CI: a second job with the torch CPU extra.

Not verified here: MPS at all (speed, `gather` on a 5-D tensor, the
`InstanceNorm` kernels), the paper's ~25 dB on real FiveK, batch sizes above
8 on his memory. Run `make bench` first on the Mac.

**Delivered as planned:**
- `model/lut3d.py`: Zeng et al. 2020 (TPAMI, "Learning Image-adaptive 3D
  Lookup Tables…"): a tiny CNN on a 256 px thumbnail of the input predicts
  weights over `model.basis` (3) learned 33³ basis LUTs; the output is the
  weighted LUT applied trilinearly (write the trilinear in torch with
  `grid_sample` on a 5-D tensor, and test it against `lut.apply`). Basis LUT 0
  initialised to identity, others to zero. Regularisers: smoothness (TV on the
  lattice) and monotonicity, weights in `[train]`. < 1 MB of parameters.
- `data/torch_dataset.py` over `cache/index.jsonl` (random crops + flips for
  training, whole images for eval; a split by GROUP, never by pair, so two
  edits of one original never sit on both sides).
- `atelier-train train`: device from `pick_device`, AdamW, checkpoints and a
  `metrics.jsonl` per run in `runs/<timestamp>-<name>/` with a copy of the
  resolved config; resumable (`--resume`).
- `atelier-train eval`: PSNR and mean/95th-percentile ΔE (CIE76 then ΔE2000)
  in Lab from sRGB D65 — a pure numpy module with its own tests (known Lab
  values) — plus image grids `input | target | output` saved as JPEG.
- `atelier-train export`: the predicted LUT for ONE picture (`--image`), and
  the run's MEAN LUT (weights averaged over the train set) as a single
  "my style" `.cube`; 33³, through `lut.write_cube`.

**Verify (here).** On the synthetic FiveK-like set (one "expert" =
`teal-orange`), training must bring the exported mean LUT within a small max
error of `data/synthetic/luts/teal-orange.cube` (e.g. ΔE mean < 1) in a few
hundred CPU steps — that is the end-to-end test, run in pytest with a tiny
config. **Verify (his Mac).** `make train` on FiveK expert C on MPS; the
paper's numbers (~25 dB PSNR on FiveK C at 480p) are the sanity bar.

## M3 — the local dashboard

**Delivers.** `atelier-train serve` → `http://127.0.0.1:<port>` only, a
FastAPI app (optional extra `ui`) serving ONE static HTML page (no build
step, no npm: plain JS + a small chart lib vendored or written by hand) with:
actions (doctor, ingest, train, stop, eval, export) run as subprocesses with
their log streamed (SSE), loss/PSNR/ΔE curves read from `metrics.jsonl`, and
image grids (before | his edit | model) paged per run and per group. Runs
compared side by side.

**Why FastAPI + one page.** He wants to pilot and SEE, not read terminals;
the API is ~10 routes over files that already exist (`runs/`, `cache/`), and
FastAPI + uvicorn is two pinned dependencies. Rejected: Streamlit/Gradio
(heavy, opinionated layouts, re-run model fights long jobs), TensorBoard
(curves yes, actions and his pair grids no), a page inside Atelier itself
(Atelier is a static site with no backend by rule — it could later READ an
exported run, never start one). Bind to localhost only; no auth needed.

**Verify.** pytest with FastAPI's TestClient on a synthetic run; the page
opened headless (Playwright is in the container) to check it renders. His
Mac: does it feel usable.

## M4 — import original → final pairs from his Winnow (read-only)

**Delivers.** `atelier-train winnow-import --host <url> --since <date>`:
lists his finals that carry `original_asset_id` (Winnow `src/lib/reconcile.ts`,
`edit_count`; Atelier's client `src/shared/sources/winnow/client.ts` is the
reference for routes and auth), downloads original + final(s) into
`data/pairs/winnow-<asset id>/` with a generated `manifest.toml`, idempotent.
Auth: his session cookie or a token read from an env var or the macOS
Keychain, NEVER written to the repo or a config file under git; GET only.

**Verify.** Against a stub server in pytest (the routes read from Winnow's
code, not guessed — the timeline import was once written against a guess and
broke on every key, MEMORY.md 2026-09-03). His Winnow: only he can.

## M5 — fine-tuning on his pairs, per-group validation

**Delivers.** `train --init runs/<fivek run>` fine-tunes on `pairs` (lower LR,
fewer epochs, optionally frozen basis LUTs), a split by group, per-group ΔE in
the eval report and the grids, and ALIGNMENT for cropped/rotated edits
(feature matching or an ECC affine on downscaled luminance) so the pairs M1
skips become usable. Optionally the Atelier training dump
(`src/shared/develop/training-dump.ts`, `atelier/training-pairs` v1: a 256 px
vignette as shot + the record) as another source.

**Verify.** Synthetic groups with a known crop/rotation for the aligner; his
Mac for the real fine-tune.

## M6 — parameter predictor → `DevelopSettings`, and the Atelier side

**Delivers.** A second model: thumbnail (+ the as-shot stats Atelier already
measures, `SourceStats`) → the slider vector of `DevelopSettings`
(`src/shared/develop/develop.ts`: exposure, brightness, contrast, the four
bands, temperature, tint, saturation, vibrance; curves later). Targets come
from the training dump (records he wrote) and, for pairs without a record,
from RECOVERING the sliders by optimisation through a differentiable twin of
Atelier's develop (`docs/auto-develop.md` §6 B3). Export to ONNX.

Atelier side, two options, his call: (1) import the per-photo `.cube` from M2
(nothing to build: vault, "Upload .cube", lands at 40 % —
`src/shared/lut/look-strength.ts`); (2) `onnxruntime-web` from our own origin,
model under `public/models/`, loaded on first ask like the segmenter, a verb
*Auto · my own* writing `DevelopSettings` (B4 of `docs/auto-develop.md`).
Option 2 adds ONNX Runtime's weight to `dist/` (measured at 14–28 MB in
`docs/mask-ui-redesign.md`) — measure before deciding.

**Verify.** Unit tests for the twin against Atelier's maths on fixed values
(port `develop.ts` numbers, compare to vitest outputs); the browser verb
driven headless; quality only on his pictures.
