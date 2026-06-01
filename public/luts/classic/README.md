# Built-in LUTs

`.cube` 3D colour look-up tables served as static assets and offered as presets
in the **LUT Studio** page.

## Adding your own

1. Drop a `.cube` file in this folder (Adobe/IRIDAS `LUT_3D_SIZE` format — the
   same files DaVinci Resolve / Premiere use). 1D LUTs are not supported.
2. Register it in [`src/lut/builtin-luts.ts`](../../src/lut/builtin-luts.ts) by
   adding an entry to `BUILTIN_LUTS`.

Users can also load any `.cube` at runtime via the **Upload .cube** button —
those never touch this folder.

## The starter set

The looks here are generated, not hand-tuned, by
[`scripts/gen-luts.mjs`](../../scripts/gen-luts.mjs). Re-run it with
`node scripts/gen-luts.mjs` to regenerate after editing that script.

| File | Look |
| --- | --- |
| `neutral.cube` | Identity — no change (useful baseline) |
| `warm.cube` | Warm tint |
| `cool.cube` | Cool / teal tint |
| `filmic-contrast.cube` | Gentle S-curve contrast |
| `bw.cube` | Black & white (Rec. 709 luma) |
| `sepia.cube` | Sepia tone |
