# Detail — denoise, defringe, sharpen

Read before touching `src/shared/render/detail.ts`, `detail-pass.ts`, the
Detail tab (`tools/develop/DetailPanel.tsx`), `RollPicture.detail`, or before
adding any pass that reads a NEIGHBOURHOOD. The graph is `render-core.md`;
the brief is `docs/photo-editor.md` P11.

## Four classic passes, one pure module (2026-09-20, P11 first commit)

`detail.ts` (pure, 7 specs) holds the record — `luminance`, `colour`,
`defringe`, `sharpen`, `sharpenRadius` — and the per-pixel maths of each
operation over a clamped image; `detail-pass.ts` is their GLSL, a
TRANSCRIPTION tap for tap, and the render gate holds the GPU to the pure
functions at 96 probes of a noisy edge (chroma 1 code, the rest 0). No
wavelets and no guided filter, deliberately: a separable Gaussian on the
chroma, a 7×7 bilateral on the luma, a 3×3 gradient gate for the fringe and a
Gaussian unsharp mask on the luma are what a bounded fragment kernel does
well, and each has a pure twin a spec can hold.

**Rules that shaped it**:

- **Colour noise blurs the CHROMA alone** (a BT.709 split on the encoded
  values, `toYcc`), luma untouched to the bit: the eye reads edges from luma,
  so the chroma blur can go much further than the luma one without
  softening anything.
- **Luminance noise is a bilateral**: a pixel averages with neighbours of
  similar brightness, so a wall smooths and a step edge stays where it is.
  The slider is the range sigma (0.02..0.12 of the encoded range, a clean ISO
  800 to a rough high ISO); the spatial sigma is fixed at 1.5 px.
- **Defringe pulls PURPLE chroma at a STEEP luma edge toward neutral**
  (`Cb > 0 && Cr > 0`, gradient over `DEFRINGE_EDGE`), and leaves a purple
  wall away from any edge alone — that is the whole test, and the spec runs
  it. Green fringing is not touched.
- **Sharpen is an unsharp mask on the LUMA, applied to RGB as ONE ratio**:
  no hue rotates, no coloured halo is invented, black stays black.
- **Kernels are in SOURCE pixels.** The stage passes `pixelScale` (its
  pixels per file pixel, ≤ 1, from the RAW's sensor size or the measured
  file) and the export scales by the same rule (a picture fitted to the GPU
  cap, a half-size RAW decode). A fair preview, not the truth: the honest
  judge is the loupe (P11's second commit).
- **ORDER**: noise and fringe run BEFORE the cube, on the source (noise is a
  property of the sensor's pixels; a later lift would amplify what was
  left); sharpen runs LAST, after every warp and layer, so nothing resamples
  it. `makeFrameGrader` gained a `before` list for it and `setPasses` its
  second argument; `detailPasses` hands both lists back and the grader
  places them — `graph-grader.ts` draws `[...pre, cube, ...extra]`.
- **A GLSL loop needs a constant bound**, so every kernel walks
  `-MAX..MAX` and `continue`s past the radius asked for: one program serves
  every slider value and the graph's program cache stays one entry per pass.

**Where it lives**: `RollPicture.detail` (additive, `detailOrNull` on read,
no migration), a fifth inspector tab *Detail* between Develop and Layers —
what is NEXT TO a pixel rather than what a pixel is — written through like
the lens, reaching the stage, the crop stage, the thumbnail and the export,
and named in the facts corner.

Measured in the pane on a 1600×1200 noisy JPEG with a hard edge: Luminance
80 cut the flat area's variance from 74 to 18; Amount 100 pushed the edge
from 59 | 195 to 27 | 209 (and raised the flat area's variance, as sharpening
noise does — the two sliders are used together for a reason); the roll
stored the record. ML denoise stays out (§4.3's
size class); a WebGPU compute path for denoise is the recorded next step if
a measurement asks.
