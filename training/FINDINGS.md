# Training findings — what the adaptive LUT can learn of his editing

Where the training effort stands as of 2026-10-22: what was built, what was
measured on his Mac and what it means. Paused here and to be resumed later.
The plan is in `PLAN.md` and every milestone in it is built. The decisions and
traps are in `docs/memory/training.md`. The user guide is `README.md`, in
French. This file keeps the numbers and the verdict in one place, so a later
session does not have to run them again.

## 1. What was built

- **M1–M6 of `PLAN.md`:**
  - a uv workspace;
  - FiveK and his-pairs readers;
  - the adaptive 3D LUT (Zeng 2020: basis LUTs plus a weighing CNN on a
    thumbnail) with train, eval, export and bench;
  - the dashboard;
  - the read-only Winnow import of original → final pairs, aligned at ingest;
  - the fine-tune;
  - the `DevelopSettings` predictor (DevelopNet), exported to ONNX and run by
    Atelier as **My own**.
- **`fivek-fetch`** downloads MIT-Adobe FiveK photo by photo from MIT, with
  neither the archive nor Lightroom:
  - The list of 5 000 names comes from MIT's `legal/` lists.
  - The input is the photo's DNG rendered by rawpy.
  - The edit is expert C's 16-bit ProPhoto TIFF, converted to sRGB.
  - Each photo is stored at 768 px as a 16-bit deflated TIFF: about 4 MB a
    photo, about 20 GB in all.
- **Diagnostics in `eval`:**
  - the "doing nothing" baseline;
  - a per-picture ceiling (the best single global map, `best_global_map`);
  - a breakdown by capture year;
  - a check for groups that hold several edits;
  - `train.since` (keep only pairs captured on or after a date).

## 2. What was measured (his Mac, MPS, 56 ms a training step)

The scores are mean ΔE2000; lower is better.

| Run | Validation | Notes |
| --- | --- | --- |
| Doing nothing (the original as the edit) | 20.6 – 21.2 | the floor any model must beat |
| From scratch on his pairs, 8 or 32 bases, 60 epochs | 11.46 – 11.54 | the number of bases changes nothing |
| FiveK pretrain alone, 60 epochs, expert C | 8.5 on FiveK | plateau from epoch ~35, PSNR 21.4 |
| FiveK → fine-tuned on his pairs, 60 epochs, lr 5e-5 | **11.31** | train split 10.90 |
| Per-picture ceiling (one global map fitted to each pair) | **7.05** | the best ANY global colour transform can do |

By capture year (model / doing nothing):

| Year | Validation | Train | Pairs (train) |
| --- | --- | --- | --- |
| 2024 | 9.73 / 18.53 | 9.13 / 17.46 | 215 |
| 2025 | 11.87 / 22.19 | 11.33 / 22.74 | 894 |
| 2026 | 11.14 / 18.80 | 10.89 / 19.89 | 462 |

Groups that hold several edits of one original: **0 of 1 822**. He delivers
one edit per original.

## 3. What it means

- **The model works**: it halves the error of doing nothing (21 → 11.3).
- **It plateaus about 4 ΔE above the ceiling, and the causes we tested are
  ruled out:**
  - Not **capacity**: 32 bases score the same as 8.
  - Not **over-fitting**: train and validation are only 0.4 apart.
  - Not **data quantity**: 5 000 FiveK pairs bought 0.2.
  - Not **the age of the style**: the error does not fall in recent years, and
    the model/nothing ratio is flat (0.53 · 0.53 · 0.59).
  - Not **several answers to one input**: there is none.
- **What the gap is**: choices he makes **per picture** that the thumbnail does
  not predict. Two pictures that look alike as shot get different looks.
  An input-only global model can only learn the average of those choices.
- **What the ceiling is**: the 7.05 left even by a map fitted to each picture
  is **local** work (skies, subjects, vignettes, masks), which no `.cube` can
  express.
- **The verdict:** the adaptive `.cube` is a usable *starting point*,
  exportable today (`make export`, then "Upload .cube" in Atelier, where it
  lands at 40 %). It is not his style. More epochs, more bases, more FiveK or
  a filter by year will not close the gap. Only more information about each
  picture can.

## 4. What would close it, in order

1. **Learn from his Develop edits (the next step).** Every picture he develops
   in Atelier's Develop is already kept *as shot* beside his exact record
   (B1/B2 of `docs/auto-develop.md`, on by default). That gives the sliders
   themselves, rather than a guessed colour transform from an export, plus
   what DevelopNet reads beyond the pixels (camera, ISO, the as-shot stats).
   The pipeline exists end to end:
   1. Develop → ⚙ → *Learning* → *Training file* (a `.json`).
   2. `make records FILE=…`, then `make train-develop`, then
      `uv run atelier-train eval-develop`, then `make export-develop`.
   3. Load the two files in Develop → ⚙ → *Learning* → *Your model*.
   4. **My own** appears in the Auto row.

   What it waits on is **pairs**: a few hundred developed pictures before
   `eval-develop` beats doing nothing clearly. Every picture developed in
   Atelier from now on is a training example.
2. **Recover old Capture One settings, if any survive.** `.cos` files sit
   beside a session's RAWs in `CaptureOne/Settings*/`; a catalogue is a
   `.cocatalog`. They are small XML files holding the sliders, the
   layers/masks and the style applied. They would:
   - give DevelopNet targets for the 1 822 Winnow pairs;
   - mark which pictures carry local work, so they can be left out of the
     `.cube`'s training;
   - group pictures by style.

   They would not move the 7.05 ceiling. To look for them: `mdfind -name
   .cocatalog`, `mdfind -name .cos`, and `find /Volumes -maxdepth 6 -name
   "*.cos"` on old disks and Time Machine. With one file in hand, a reader
   translating it into `DevelopSettings` is a small, separate task.
3. **Not worth doing before 1 or 2:** a bigger LUT model, longer schedules,
   more FiveK experts, or a `since` filter. Each of these was measured, or is
   bounded, in §2–§3.

Still open with him: what the worst groups' grids show (`eval` draws them;
for example `pairs__winnow-157666`, `-157892`, `-162336`, `-81003`,
`-82585`). If black-and-white pictures or strong looks dominate them, a filter
on the `.cube`'s training set would be cheap.

## 5. Resuming

```bash
cd training
make setup        # once per machine
make doctor       # checks MPS, rawpy, the data folders
# the .cube path, already prepared on his Mac:
make train && make eval && make export
# the Develop path, once a training file exists:
make records FILE=~/Downloads/atelier-training-pairs.json
make train-develop && uv run atelier-train eval-develop && make export-develop
```

FiveK and his photos are never committed. FiveK is licensed for research and
non-commercial use, and it lives under `data/`, which git ignores.
