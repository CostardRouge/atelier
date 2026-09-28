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

**Its `gamm` option is a NO-OP as passed**; the output is always dcraw's
default BT.709 curve (measured: 0.5 of sensor white came back as 0.7059,
every gamma setting gave the same bytes — because the wrapper reads a
SIX-entry array and ignores the two-entry one the typings promise, read
2026-09-25). `raw-image.ts` inverts that curve exactly through a 65536-entry
table — sixteen bits carry it without loss — and it is the ONE assumption
about the decoder's output; a six-entry `gamm` WOULD be honoured and break
it, which the settings say. Do not "fix" the length.

**Settings**: 16-bit, camera white balance, camera matrix, sRGB primaries,
NO auto-bright, highlight mode 0 (clip at sensor saturation — everything
between the displayed white and saturation is kept whole, and that is the
headroom a develop reads), quality 3, half size when it fits, **the white
never lowered to the picture's own brightest pixel** (`adjustMaximumThr: 0`,
2026-09-25 — LibRaw's default did, silently, for any frame whose brightest
pixel sat within a quarter of white; `device-memory.md`, «Tiles», for what it
cost and what it costs to have turned it off), and an explicit `cropbox` on
EVERY open, because the settings persist on the instance (`WHOLE_CROP` for a
whole decode; a tile's rectangle otherwise). Measured on a synthetic
12-megapixel DNG: 2.2 s to open (parse + unpack), 0.6 s to demosaic at half
size, 1.6 s whole; ~500 MB of heap for the run.

**`userFlip` is deliberately ABSENT from those settings (2026-09-22).** LibRaw's
own default is `-1`, "use the file's flip", so `dcraw_process` turns the
picture the way the camera was held and transposes the output dimensions with
it. That is the whole reason the sensor path has always come back upright —
not our code, a good default. Its twin does not: a RAW's embedded render is
sliced out of the container and leaves the camera's Orientation behind, so it
had to be GIVEN the tag (`media-pipeline.md`, «A RAW's embedded render is
turned by a block we SPLICE into it»). The two halves are a PAIR: setting
`userFlip` here would turn the sensor rung back on its side while the proxy
rung stands up, which is the same defect with the signs swapped.

**One instance, one decode at a time**, serialised on a promise chain as
ffmpeg's runs are, and rebuilt after a refusal (its heap may be mid-file).
**Since 2026-09-23 what the decode COSTS is `device-memory.md`'s**: the plane
is converted in bands with nothing full-size in between (the first version
built three Float32 pictures and an iPhone reloaded on every DNG), a phone
decodes to a long edge per purpose and lets the worker go on rest and on a
hidden tab, and a decode is held for the session at its size. `raw-image.ts`'s
fused paths are bit-identical to the two-step ones, pinned by spec — the
numbers in this file did not move. **Since 2026-09-25 a big decode is cut
into TILES** (`raw-tiles.ts`, one `open()` per band through `cropbox`, bit
for bit the whole decode's bytes) and a REGION of the frame can be decoded
alone — `device-memory.md`, «Tiles». The wrapper applies its settings at
`open()` only and `imageData()` processes once per open, so a tile is a
re-open and a re-unpack of the file; LibRaw itself would re-process after
one unpack, but the package exposes no such verb.

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

## The four rungs: a LADDER, not a switch (2026-09-20)

**Decision (maintainer).** `DevelopSettings.base` was `render | raw`. It is
now four rungs, **each a real and nameable amount of the camera's own
calibration**:

| rung | what it adds |
| --- | --- |
| `proxy` | the 8-bit picture every browser decodes — the embedded render, or a source's proxy |
| `gain` | the sensor decoded to linear light, with the measured `rawGain` |
| `gainMap` | and the DNG's GainMap applied (`render-gain-map.md`) |
| `gainMapWarp` | and its WarpRectilinear (`camera-warp.ts`) |

Rules a later agent must keep:

- **`proxy` is the ABSENCE of a base**, never a stored value — which is what
  keeps "empty means as shot" true and what made the migration cost nothing:
  `render` → null, `raw` → `gain`. No stored document changed meaning, because
  `raw` WAS the sensor with its gain and no calibration, which is exactly what
  `gain` means. `normaliseBase` is the one reader.
- **A rung is offered only where the FILE carries the opcode**
  (`raw/calibration.ts`, `rungsFor`): no GainMap, no `gainMap` rung. This is
  the P6 rule — a correction nobody measured is worse than none — applied
  where the measured data finally exists.
- **A rung a file cannot reach is never left standing.** A picture developed
  on `gainMapWarp` and re-opened from a file whose opcodes are gone falls back
  to the top rung that IS there, rather than claiming a correction it cannot
  apply.
- **Each rung contains the one below**, so `calibrationAt` is a comparison and
  not a switch, and climbing can never lose what was already applied. **It
  also builds a fresh `{ gain, warp }` per call** (2026-09-22): the workbench
  memoises it on `[rung, calibration]`, and `use-develop-picture.ts` keys
  every effect on the two FIELDS, never the wrapper. Before that, a RAW on the
  gain-map rung re-rendered, re-graded and read the GPU back at frame rate for
  as long as it was open — the histogram effect took the wrapper's identity
  as a dep and SETS state, which is a loop by construction. The rule it
  taught: an effect that sets state must never take a dep the host rebuilds
  per render; key it on the values inside.
- **The base still travels nowhere.** `withoutBase` strips all four; a preset,
  a paste and a batch verb keep each target's own.
- **The calibration is read once per file and held for the session**
  (`readRawCalibration`), the shape `original-cache.ts` already uses: a stage
  that re-reads a header on every repaint is a stage that stutters.
- **`developLines` names the rung** (`RAW + gain map +2.0 EV metered`): "RAW"
  alone let a picture with 2.5 stops taken out of its corners read the same as
  one without.

**The PREVIEW carries the calibration from `gain map` up** — the maintainer's
own recommendation, and the reason it is right: a GainMap multiply and a
radial warp are one GPU pass each, trivial beside the decode itself (4.4 s
whole, 456 ms at the stage budget), so applying them on the stage makes
export-at-max a no-op for shading and `preview = export` hold by
construction rather than by a warning.

## The tool (2026-09-20, P10 second commit)

**The ladder hangs off the FIDELITY CHIP** (`DevelopBaseMenu`,
`shared/develop/DevelopBase.tsx`, an `OverflowMenu` whose worded trigger IS
the chip — the maintainer's placement, 2026-09-20). The chip already says
what the picture IS, so what it could be belongs on the same word, above the
photograph, where the question comes up. It replaced the Develop tab's
`DevelopBaseSection`: one control for one value, never two. Each rung's line
says what it ADDS, and the foot of the menu says what the FILE asks for in
the numbers a person can check (`gain map up to 5.93× · warp ×1.049 · CA
0.9 px at the corner`) rather than a promise. Drawn only where a RAW is
REACHABLE (the file itself is one, or a proxy's original is —
`MediaOrigin.name`), and hidden under 880px of tool width as the chip always
was. The modal hosts (Trips, the Studio) never see it — the maintainer's
call that they keep the simple sheet.

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

## White balance in kelvin: one 3×3 matrix on the decoded picture (2026-09-23, audit item 17)

`raw/white-balance.ts` (pure, tested) + `WhiteBalancePanel.tsx`
(Develop tool, on a RAW base whose decode gave the camera's white).
**The approach**: the picture is decoded ONCE, balanced as shot (camera
white balance, camera matrix, sRGB); a kelvin balance is then the exact
re-balance `rgb_cam · diag(new ÷ as-shot multipliers) · rgb_cam⁻¹` in linear
light, the multipliers the camera would have used under that light coming
from `cam_xyz · XYZ(T, tint)` — what LibRaw would give with `userMul`,
without a second decode. **Stored on the develop** as `rawWb { kelvin, tint,
matrix }`, like `rawGain` and for the same reason (preview = export), applied
FIRST in `developLinear` and only on a RAW base; `withoutBase` strips it, so
copy/paste/presets/Apply-to leave it — a white balance is one capture's, and
pasting it to another RAW would need that RAW's own matrix (open: a sync that
recomputes the matrix per target). **Facts measured on a synthetic DNG**
(128×96, sRGB primaries, AsShotNeutral of a 2850 K black body, made in the
scratchpad): libraw-wasm 1.6's full read carries the colour under
`color_data`, NOT `color` as its typings say; `cam_mul` is 1 / AsShotNeutral
(camera space); `rgb_cam` is camera → sRGB with the COLOUR COLUMNS first;
and **`cam_xyz` is all ZEROS for a DNG** — recovered as `diag(1/pre_mul) ·
rgb_cam⁻¹ · XYZ→sRGB`, since LibRaw built `rgb_cam` as the inverse of
`cam_xyz · xyz_rgb` with rows normalised by `pre_mul`. The as-shot read back
2850.03 K, tint 0.00. **Conventions**: the locus is Krystek's rational fit in
uv (smooth — Kim's piecewise cubic kinks at 4000 K and threw a round trip 8 K
off there); tint is 3000 per unit Duv, POSITIVE toward green, so Lightroom's
Daylight (5500 K, +10) is daylight's own chromaticity and the correction of a
+tint is magenta; the slider is log-scaled 2000–50000 K. In the app: the
sensor rung showed the panel with *as shot 2850 K*, Daylight warmed the grey,
Tungsten and As shot gave it back.

## Which FILE the sensor's data is in — see `renditions.md`

A capture is often several files (Sony `.ARW` + `.HIF`, DJI `.DNG` + `.JPG`),
and everything about reaching the RAW that is a SEPARATE file — the decision,
Winnow's pairing, the measurements on his own bodies, and the pure module over
them — lives in `renditions.md`. This file stays about what happens once the
sensor's bytes are in hand.

## What a DJI DNG actually holds (measured 2026-09-20, body FC8482)

Two files off the maintainer's own drone (DJI Fly, `dji_fly_*_photo.DNG`,
74 MB each), walked by `probeRaw` itself and decoded in the browser pane —
this replaces the format EXAMPLE `develop.md` carried, which was never a
measurement:

- **IFD0** — 160×90 JPEG thumbnail.
- **SubIFD** — 8064×4536 CFA, **compression 1, uncompressed** 16 bits,
  73 156 608 bytes: the file, near enough. Black 4096, white 65472, 16:9 at
  capture. No JPEG XL on this body, so P3's decoder question does not arise
  for it — ProRAW and ARW are still unanswered.
- **SubIFD1** — **960×540** JPEG, 762 KB. The only thing a browser can draw.

**0.52 of 36.6 megapixels — 8.4× short on the long edge.** That is the whole
of "macOS shows it sharp, Atelier shows it pixelated": nothing in
`pickPreview` is wrong (it takes the larger of the two JPEGs correctly), the
render simply is not in the file, and macOS is not showing a preview at all —
it demosaics the CFA plane and applies the opcodes below. Any stage wider than
960 px upscales; the 640 px thumbnail is the one surface the embedded render
is honestly big enough for. **A camera that writes a preview this small is the
case `DevelopSettings.base` exists for** — what nothing says today is the
PIXEL count: `pictureFidelity` names the bits and never the size, and
`DecodedPhoto.viaRawPreview` is returned by `photo-frame.ts` and read by
nobody.

Decode timings, this Mac, the 74 MB already in memory: **4.4 s** whole
(8064×4536, including the wasm's first load), **456 ms** at
`budgetPixels: 3840×2160` — LibRaw's half (4032×2268) box-averaged to
2016×1134. So the panel's "a few seconds, once" is right for the first decode
and pessimistic for every one after.

## LibRaw skips the DNG opcodes, and DJI's are enormous (2026-09-20)

`OpcodeList3` on that body carries **GainMap + WarpRectilinear**, and LibRaw
applies neither:

- **GainMap** (12 364 bytes) — a 32×32 grid over three planes, corner gains
  **5.93 / 5.06 / 4.97** (R/G/B) against 1.00 at the centre: about **2.5
  stops** of vignetting, and a different figure per channel, so colour shading
  as well. Measured against DJI's own render on patches 5 % in from each
  corner, LibRaw's corners land at **0.44–0.51** of where the render puts them
  relative to the centre.
- **WarpRectilinear** (164 bytes) — three planes, centre 0.5,0.5, and it is
  **almost entirely a 4.93 % magnification**: the green plane is `k0 = 0.9530`
  with `k1 = k2 = k3 = 0` EXACTLY, a pure scale, and the red and blue planes
  deviate from their own `k0` by at most 0.6 px and 1.2 px at the corner. So
  this lens needs no distortion correction worth a pixel; what the two other
  planes carry is lateral CA, +0.70 px R−G and −0.22 px B−G at the corner.

So `base: 'raw'` on a DJI file is sharper than the render and **wrong**, but
not in equal parts: the corners are the fault (2.5 stops), the frame is 4.93 %
wider than the render's, and the distortion everyone expects a drone lens to
need is simply not in the numbers. Saying it is the floor; correcting it is
the cure. Showing it as the better material without saying either is the
fabrication this file's rules exist to stop.

**And it retires the reason P6 shipped with no lens profiles.** The index
records "a profile is MEASURED calibration data and invented coefficients
would be a fabricated correction". A DNG carries that calibration for the
exact body and lens, inside the file, in the DNG spec's own units — and
`render/lens.ts` + `lens-pass.ts` already do the radial warp and the
per-channel scale it asks for. Both blobs are tiny and sit in the head the
probe already reads, so `raw-probe.ts`'s TIFF reader is the whole of the
parsing work.

## ProRAW in JPEG XL: developed without LibRaw (2026-09-26)

**Decision.** A DNG whose sensor IFD is LinearRaw (34892) compressed as JPEG XL (52546) — Apple's ProRAW with JPEG XL compression — never reaches LibRaw, whose npm build cannot read JPEG XL. `decodeRaw` asks `readLinearDng` (`raw/linear-dng.ts`, pure) first; for such a file `raw/jxl-dng.ts` decodes the tiles through `jxl-oxide-wasm` on a small WORKER POOL (`media/jxl-pool.ts` + `jxl-worker.ts`: up to 4 on a computer, 2 on a phone, let go when idle or hidden, the main thread as fallback), with a window of tiles in flight equal to the pool, and `developTile` writes each one straight into what `convert` / `encodeBoxed` take — LibRaw's 16-bit BT.709 codes at whole density, box sums otherwise — so the gain, the half-floats, the as-shot bytes and the kelvin white (`RawWhite` from the same matrices) come out of the SAME functions as a LibRaw decode. **Why it works without a wasm build of ours**: LinearRaw is already demosaiced, so what LibRaw would do is arithmetic, and the arithmetic is dcraw's — black/white to [0, 1]; `1 / AsShotNeutral` normalised so the SMALLEST multiplier is 1 and each channel clips at the sensor's white (`highlight: 0`); `rgb_cam = inverse(rows-normalised(ColorMatrix · xyz_rgb))`, the D65 matrix preferred (dcraw's `cam_xyz_coeff`); clip. A tile's samples come out of jxl-oxide as a PNG (its one way out) read by `media/png-read.ts` (inflate + unfilter, 16 bits kept — a browser decode would colour-manage and cut to 8).

**Measured** in headless Chromium on a synthetic 1200 × 800 LinearRaw DNG (lossless 16-bit JXL tiles of 256², edge tiles padded, orientation 1 and 6) against its UNCOMPRESSED twin decoded by LibRaw: same `rgb_cam` and as-shot multipliers to three decimals, same sizes/turn/region, as-shot bytes within 4 codes (mean 0.18), half-floats within 0.014. Speed: ~1 µs a pixel on one thread (render 22 ms + PNG encode 28 ms + read 11 ms per 256² tile), ~0.5 µs with three workers — 12 MP boxed to the stage in 5.9 s, an 800 × 600 loupe region (20 tiles) in 0.6 s; a region reads ONLY its tiles, which is the tile decode a phone needs, given by the format. The generator is `scratchpad/gen-linear-dng.py` (not in the repo).

**Also**: a JPEG XL RENDER inside a RAW is now a preview (`pickPreview`, `RawPreview.format: 'jxl'`; a JPEG of the same size wins, being free); a turned one is decoded and drawn turned once (`turnedJxl`), since no tag can be spliced into a JPEG XL. **Not applied, said in `linear-dng.ts`**: `BaselineExposure`, `ProfileGainTableMap` (Apple's local tone map — a ProRAW will look flatter than Photos shows it), `CameraCalibration`/`AnalogBalance`, `DefaultCrop`, opcode lists. **Not measured**: a real ProRAW JXL file — whether its tiles are lossy XYB (jxl-oxide then renders into the declared colour encoding, assumed linear) and whether its JXL bit depth equals `BitsPerSample` (assumed). One of his iPhone files through the Rendition Inspector settles both.

