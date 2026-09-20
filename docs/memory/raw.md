# RAW — the sensor's own data, decoded and developed

Read before touching `src/shared/raw/`, `DevelopSettings.base` / `rawGain`,
`render/half-image.ts`, the graph's half-float source, or anything that
decides which BYTES a picture is developed from. The plan it fulfils is P10
of `docs/photo-editor.md` and O5–O6 of `docs/develop-originals.md`; the
8-bit fallback (a RAW's embedded render) is `develop.md`, «A RAW draws
today»; the material/pixels split is `develop-originals.md` §7.

## The decoder (2026-09-20, P10 engine)

`libraw-wasm` 1.6.0 (LibRaw compiled by Emscripten, its own module worker),
dynamically imported by `raw-decoder.ts` — never in the main bundle, 1.4 MB
of wasm nobody who never opens a RAW should pay. Excluded from Vite's
pre-bundling like ffmpeg (`vite.config.ts`), or dev rewrites its worker URL.

**It works WITHOUT cross-origin isolation.** The build declares a shared
memory but was measured decoding on a page where `crossOriginIsolated` is
false and `SharedArrayBuffer` is undefined — the constraint that forced the
single-threaded ffmpeg does not bite here. Re-check on a new version of the
package: the gate for it is the probe in this file's history, a decode from
the dev server in headless Chromium.

**Its `gamm` option is IGNORED**; the output is always dcraw's default BT.709
curve (measured: 0.5 of sensor white came back as 0.7059, every gamma setting
gave the same bytes). `raw-image.ts` inverts that curve exactly through a
65536-entry table — sixteen bits carry it without loss — and it is the ONE
assumption about the decoder's output; a build that starts honouring `gamm`
would break it, which the settings say.

**Settings**: 16-bit, camera white balance, camera matrix, sRGB primaries,
NO auto-bright, highlight mode 0 (clip at sensor saturation — everything
between the displayed white and saturation is kept whole, and that is the
headroom a develop reads), quality 3, half size when it fits. Measured on a
synthetic 12-megapixel DNG: 2.2 s to open (parse + unpack), 0.6 s to
demosaic at half size, 1.6 s whole; ~500 MB of heap for the run.

**One instance, one decode at a time**, serialised on a promise chain as
ffmpeg's runs are, and rebuilt after a refusal (its heap may be mid-file).

## The picture the GPU takes (2026-09-20)

A RAW becomes a `HalfImage`: RGB half-floats, sRGB-ENCODED, sensor white at
1.0, uploaded once per identity as `RGB16F` (`graph.ts`). Encoded rather than
linear so the cube pass reads it as it reads any source — a linear source
would need a pass of its own before the cube. A typed-array upload HONOURS
`UNPACK_FLIP_Y_WEBGL` (only a bitmap ignores it), so it lands like a canvas
and `u_flipY` stays 0; three 2-byte channels make an odd width a row that is
not 4-aligned, so `UNPACK_ALIGNMENT` is 2 for that upload. The gate draws a
191×97 half source: the right way up, the ramp exact, and graded within two
codes of the same picture as a canvas — two, not one, because this GPU writes
a half a hair under `k/255` as `k−1` and a steep curve doubles it; an 8-bit
source holds exact `k/255` and never meets it, a RAW's values are continuous
and meet it harmlessly. Without WebGL2 a half image cannot be drawn at all
and the pass-through grader says so once.

## The develop on a RAW: the same cube, the sensor's range (2026-09-20)

**`DevelopSettings.base: 'raw'` and `rawGain`** — the material, and the
picture's own exposure MEASURED at decode (`autoBrightGain`: the brightest
1 % at white, dcraw's own rule, bounded ×1..×16, three decimals). The cube's
`[0,1]` is then the SENSOR's range: `developStage` decodes a lattice point,
multiplies by the gain and develops, so a value the sensor kept above the
displayed white is still there for "highlights −100" and "−1 EV" to reach.
That is the whole of highlight recovery, and it needed no second engine: the
cube survives as node 2, at its densest lattice (64³) because the displayed
picture comes from the lower part of the range.

**Why the gain is STORED and not re-measured**: two decodes (the stage's at
half size, the export's whole) measure two numbers a hair apart, and preview
= export is a promise. A develop with `base: 'raw'` is NEVER default, even
with every slider at 0.

**The base is a fact about ONE picture's bytes and travels nowhere**:
`withoutBase` strips it from the clipboard, a preset and a batch verb (which
keeps each TARGET's own base). Copying a RAW's gain onto a JPEG would be
stops too bright; copying it onto another RAW would be another picture's
exposure.

**Layers and geometry are unchanged**: they run after the one cube, on the
displayed picture, RAW or not.

## The calibration a DNG carries, READ (2026-09-20)

`shared/exif/dng-opcodes.ts` (pure, 9 specs) parses `OpcodeList3` out of the
head `raw-probe.ts` already walks, through the same TIFF reader; the probe
returns it as `RawProbe.calibration` and `rawCalibration(file)` fetches it
with a megabyte and no decoder. `describeRaw` now ends with what the file
really asks for — `gain map 32×32 ×3 · up to 5.93× · warp ×1.049` — instead
of counting lists.

Rules a later agent must keep:

- **The bytes are BIG-ENDIAN, always**, whatever the TIFF's own byte order.
  That is the one trap in the format: read little-endian, a gain of 1.0 comes
  back as a denormal near 1e-40, which is a correction that turns a picture
  black rather than one that merely looks wrong. A spec pins the byte.
- **Only list 3 is read.** Lists 1 and 2 act on the MOSAIC, before and during
  demosaicing — inside LibRaw, where nothing here can reach. Reading them
  would offer a correction that cannot be applied.
- **A GainMap with a row or column PITCH above 1 is refused**, not applied: a
  pitch addresses one CFA plane of a mosaic, and spreading it over every
  pixel of the demosaiced picture would be a real correction of the wrong
  thing. `unread` names it rather than dropping it silently.
- **Sizes are the spec's, and they check out against the real file**: a
  GainMap's parameters are 76 bytes plus `rows × cols × planes` float32s —
  76 + 32·32·3·4 = **12 364**, exactly the blob PR #145 measured — and a
  three-plane WarpRectilinear is 4 + 3·6·8 + 16 = **164**, also exact. If a
  future reader disagrees with those two numbers it has the layout wrong.
- **Nothing is invented.** A file with no opcodes yields null and the rungs
  above `gain` are simply not offered.

## The tool (2026-09-20, P10 second commit)

`DevelopBaseSection` (`shared/develop/DevelopBase.tsx`, drawn under the
histogram of the Develop tab, only where a RAW is REACHABLE: the file itself
is one, or a proxy's original is — `MediaOrigin.name`) is a Segmented
*Camera render · RAW* with one status line: what RAW would fetch and weigh,
"decoding…", or "the sensor's data, metered +x.x EV". The modal hosts (Trips,
the Studio) never see it — the maintainer's call that they keep the simple
sheet.

- **`useDevelopPicture` takes a `raw` option** (the file and the stored gain)
  and decodes through `decodeRaw` at the STAGE budget (half size when it
  fits, box for the rest, capped at `maxRenderSize`), building a `BadgeSource`
  whose `image` is the as-shot 8-bit canvas (the wipe's untouched side, the
  dropper, the stats) and whose `gpu` is the half image every grade renders.
  The gain is read at decode time and NOT a dependency of the effect: it is
  measured by the first decode and stored by the host right after, and a
  re-decode for the number the decode produced would be seconds for nothing.
- **The gain is stored the moment it is measured** (`onRawDecoded` →
  `patch({ base: 'raw', rawGain })`), once; a stored gain is never overwritten
  by a later decode's measurement.
- **A proxy's RAW original** is `heldOriginal` or fetched once and
  `holdOriginal`'d (decision 3), the status line saying its weight; a failed
  fetch puts the base back and says why.
- **The export** (`use-roll-export.ts`) resolves the RAW the same way and
  hands `renderRollPicture` a `raw` option: `renderFromRaw` decodes whole, or
  at half size only when the half still has TWICE the long edge asked for (a
  crop may keep a fraction), grades the half image through the picture's own
  cube — the gain is in it — and the same passes, then `deliver`s exactly as a
  render is. A RAW develop whose RAW is unreachable renders its NUMBERS on the
  render, base stripped, and the run says so: never the gain on a render,
  never silently the wrong material.
- **The draft keeps its material through a paste, a preset and "As shot"**
  (`setDraft` keeps `base`/`rawGain`; `replace` is the whole record, for an
  undo's re-seed); `asShot` is about the numbers.
- **The chip** reads `RAW · 16-bit linear` with the base on, whatever the file
  in hand is.

Measured in the pane (a 12 MP synthetic DNG dropped on the editor): the
switch decoded 2000×1500 at half size, metered at its white (a patch above
saturation clips more than 1 %), −1.5 EV read 160 on the clipped patch, and
the export decoded the whole 4000×3000 and wrote the same 160 — preview =
export from two decodes of two sizes, which is what storing the gain buys.
