# Built-in LUTs

`.cube` 3D colour look-up tables served as static assets and offered as presets
in the **LUT Studio** page.

## Adding your own

Just drop a `.cube` file in here — no code to edit. The `luts-manifest` Vite
plugin (see [`vite.config.ts`](../../vite.config.ts)) scans this folder
recursively at build time and the picker updates itself.

- **Format:** Adobe/IRIDAS `LUT_3D_SIZE` (the same files DaVinci Resolve /
  Premiere use). 1D LUTs are not supported.
- **Grouping:** sub-folders become `<optgroup>`s in the picker. So
  `apple/Apple_Log_to_Rec709.cube` shows up under an **APPLE** heading as
  "Apple Log To Rec709". Files dropped at the root show up ungrouped.
- **Naming:** the label comes from the filename — underscores and hyphens become
  spaces, each word's first letter is capitalised (deliberate casing like
  `Rec709` or `DLog` is preserved).

Users can also load any `.cube` at runtime via the **Upload .cube** button —
those never touch this folder.

## The starter set

The looks in [`classic/`](./classic) are generated, not hand-tuned, by
[`scripts/gen-luts.mjs`](../../scripts/gen-luts.mjs). Re-run it with
`node scripts/gen-luts.mjs` to regenerate after editing that script.

| File | Look |
| --- | --- |
| `classic/neutral.cube` | Identity — no change (useful baseline) |
| `classic/warm.cube` | Warm tint |
| `classic/cool.cube` | Cool / teal tint |
| `classic/filmic-contrast.cube` | Gentle S-curve contrast |
| `classic/bw.cube` | Black & white (Rec. 709 luma) |
| `classic/sepia.cube` | Sepia tone |
