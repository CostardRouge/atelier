# The GAIN MAP — the camera's own shading, as a grid

Read before touching `render/gain-map.ts`, `render/gain-map-pass.ts`, or
anything that applies a DNG's `OpcodeList3` to a decoded RAW. Where the
numbers come from is `raw.md`, «The calibration a DNG carries»; the ladder
that decides whether it runs is `raw.md`, «The four rungs».

## Why it is not the lens pass (2026-09-20)

`lens.ts` corrects vignetting RADIALLY — one number at one radius — which is
the right model for a slider a person turns against a photograph. A camera's
own calibration is not that: DJI writes a **32 × 32 grid per colour plane**,
corner gains 5.93 / 5.06 / 4.97 against 1.00 in the middle, so it corrects
colour shading as well as brightness and it is not circular (microlenses and
a cover glass see to that). `vignetteGain(r, amount, midpoint)` cannot
express any of it, so the grid is a pass of its own. Nothing is invented:
every number is read out of the file, and a file with no GainMap gets no
pass.

## The rules (2026-09-20)

- **It multiplies LIGHT, never code** (`gainEncoded`, the twin of
  `vignetteEncoded` and for the same argument): a gain on an encoded value
  lifts a dark corner three times as much as a bright one. Mid grey ×2 is
  0.686, not 1.0 — pinned by a spec.
- **It runs FIRST, on the decoded sensor data**, before the develop reads a
  single value. A develop measured on a picture still 2.5 stops down in the
  corners would be measuring the lens. Before the repair pass too, so a
  copied pixel is copied from corrected data.
- **It asks WHERE a pixel is, so it converts with `imageUv`** —
  `render-geometry.md`'s rule. A grid read straight off `v_uv` lifts the
  OPPOSITE corner, which is the worst possible outcome because it still looks
  like a correction.
- **The grid is uploaded with `UNPACK_FLIP_Y_WEBGL` turned OFF and put back.**
  The graph leaves that flag ON for its source uploads and a TYPED ARRAY
  honours it (only a bitmap ignores it — `raw.md`). Left on, the grid lands
  upside down: measured by the render gate the moment the pass was written, as
  **100 codes** against the pure twin. This is the one trap in the pass.
- **Sampled with four `texelFetch`es and a manual bilinear**, never with
  LINEAR filtering: filtering a float texture needs `OES_texture_float_linear`,
  which not every GPU has (`render-core.md`), and it makes the shader the
  literal twin of `gainAt`.
- **The geometry is the FIRST map's**, and each colour plane is filled by
  sampling its own map at those nodes — the identity where every plane shares
  one grid, which is what the measured file writes.
- A field that would multiply nothing builds NO pass: a no-op resample costs a
  round trip through the transfer function for nothing.

Held by `scripts/check-render.mjs`: canvas and `ImageBitmap` both within 0
codes of `gain-map.ts` over 600 probes, and the two corners read as ABSOLUTE
facts as well — a grid flipped in both the shader and the twin would agree
with itself and still be wrong.
