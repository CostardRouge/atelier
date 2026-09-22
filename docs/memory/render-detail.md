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

## The loupe: the file's own pixels under a magnified view (2026-09-20, P11 second commit)

The stage works to a pixel budget, so past its 1:1 a smooth resample invents
a gradient between preview pixels and "pixels" merely enlarges them — neither
is what a denoise looks like in the file (F5 of the brief, and what "pixel
piping" was read as). `useDevelopPicture({ loupe: true })` now decodes the
picture WHOLE the moment the view crosses the stage's `onePixel` — a JPEG
through `decodePhoto` + `fitPhotoForRender`, a RAW base through `decodeRaw`
whole, both capped at what the GPU takes — into a SECOND grader slot with the
same look, warps, layers and detail (its kernels at the file's density:
`pixelScale = decoded / file`), and draws the visible window on a canvas in
VIEWPORT space over the stage's, in device pixels, under the very transform
the stage canvas sits at (`view.rect` → `setTransform`, then the same
`drawPictureIn` / `drawImage` the stage paints with). So it lands on the
stage's picture to the pixel, the wipe and hold-for-before draw the file's
own untouched pixels on their side, and past the FILE's 1:1 the smooth /
pixels choice is applied to the loupe's context.

Rules: **one grader slot per surface** (`GraderSlot`, the stage's and the
loupe's) — a pass holds textures on the context it was first drawn with, and
a pass shared between two graphs re-uploads on every alternate draw; the
decode is **released three seconds after the view comes back** and at once
when the picture changes (a 24-megapixel bitmap is not kept for a look that
ended); a file with **no more pixels than the stage shows** (a proxy, a small
JPEG) says so in the pill rather than pretending; a clip gets no loupe. Both
Develop hosts have it — the workbench and the modal sheet — because it is
rendering, not a panel (§4.2). Three faults found by audit and fixed on
2026-09-22, worth not re-deriving: **a closed `ImageBitmap` reports width 0**,
so `fileWidth` must be read BEFORE `bitmap.close()` or the kernel scale
divides by zero and `detailTerms` clamps every kernel to the stage's strength;
the loupe's grader takes the **same gain grid** as the stage's (`gainField`),
or a RAW on the gain-map rung shows corrected shading on the stage and raw
shading under the loupe; and the picture-change effect **disposes the loupe's
grader** with the decode, because the three-second release timer returns
early once the state is back to idle and the WebGL2 context lived on until
unmount.

Measured in the pane on a 15-megapixel noisy JPEG (stage 3718 px): twelve
wheel notches took the view to 4000 %, the pill read `loupe · 5000 px`, the
loupe canvas covered the viewport (936×614 device pixels) and its centre
carried a pixel variance of 568 against the stage canvas's 532 — the file's
own grain, a little rougher than the budgeted preview's. Not measured: a
phone, where the whole decode is the same cost the still export already
pays (`MEMORY.md`'s open item on big photographs).

Measured in the pane on a 1600×1200 noisy JPEG with a hard edge: Luminance
80 cut the flat area's variance from 74 to 18; Amount 100 pushed the edge
from 59 | 195 to 27 | 209 (and raised the flat area's variance, as sharpening
noise does — the two sliders are used together for a reason); the roll
stored the record. ML denoise stays out (§4.3's
size class); a WebGPU compute path for denoise is the recorded next step if
a measurement asks.
