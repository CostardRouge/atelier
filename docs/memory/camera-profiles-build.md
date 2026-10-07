# Camera colour profiles — the rules each phase fixed in the decoder

The decisions and the measurements behind them are in `camera-profiles.md`;
the brief is `docs/camera-profiles.md`. This file holds what C4 → C6 made
true of the RAW decoder (`raw/raw-decoder.ts`, `raw-image.ts`,
`hue-sat-map.ts`, `jxl-dng.ts`, `linear-dng.ts`): read it before touching
how a RAW's plane becomes sRGB.

## C4: the camera's matrix is OURS, and the profile acts before the clip (2026-10-07)

**Decision (his Q5).** LibRaw is asked for CAMERA colour (`outputColor: 0`,
balanced as shot, no matrix); `applyCameraMatrix` (`raw-image.ts`, pure)
turns the 16-bit plane IN PLACE into the plane LibRaw wrote in sRGB —
linearise, `rgb_cam` (read from the same full read, still reported), clip
to [0, 1] where LibRaw clipped, encode — so every table, box, meter and
byte downstream reads the plane it always did. The profile is folded into
that matrix (`P · rgb_cam`), BEFORE the clip; the JPEG XL path folds it
into its own `rgbCam`. **Rules a later agent must keep:**

- **Every decode of a RAW develop passes `decodeProfileOf(develop)`** — the
  stage, the loupe, the run's meter and render, the making-of. A decode
  that forgets it draws the picture in LibRaw's colour beside a head that
  no longer applies the profile: two colours for one picture.
- **The head carries the profile NO MORE**: `rawMatrixOf` is the kelvin
  balance alone, with the profile taken back out (`rawWb · P⁻¹`), because
  `rawWb.matrix` is still stored from LibRaw's colour (no migration).
- **`'resolve'`** asks the decoder to work the profile out of its own read
  (`RawDecoded.profile` says what it came to; the stage and the run store
  that); the held decode is remembered under the resolved matrix too, so
  storing it re-decodes nothing.
- **No `rgb_cam` in the read**: the whole decode is asked again in LibRaw's
  own sRGB and no profile is applied; a tile plan falls back to whole.

Measured with the real decoder in headless Chromium on three synthetic
DNGs: no profile reproduces LibRaw's own sRGB within 1 code in 8 bits
(16-bit max 53, the curve's knee — `bt709ToLinear`'s two branches meet at
0.081 vs 0.0813); a grey file is identical; with the profile, up to 92 codes
differ from C3's after-the-clip correction on ~27 % of the samples of a
deliberately saturated file — the colours LibRaw's matrix clipped. Cost:
~23 ns a pixel (12 MP in 278 ms here), banded. NOT measured: a real camera
file, a JPEG XL ProRAW through the profile, a phone.

## C5: the hue/sat map, in the decoder (2026-10-07)

**Decision.** The brief put the map in the head; C4 made the DECODER the
place — after the matrix, BEFORE the clip, in linear ProPhoto, the order the
DNG SDK renders in — so it runs in `applyCameraMatrix` and `developTile`
(JPEG XL), never in a shader. `raw/hue-sat-map.ts` (pure) is the SDK's HSV
and lookup AS RECALLED, not read at source. **Rules a later agent must
keep:**

- **The table is read from the FILE each time** (`RawHead.profile` from the
  probe, `LinearDng.profile`), like the opcodes; the picture stores only the
  blend weight (`RawProfile.hueSat.weight`, label `… · hue/sat`). A map whose
  bytes are past the head is not applied and not claimed.
- **The weight is the matrices'** at the as-shot light, resolved once with
  the profile; a kelvin balance moves the matrix, never re-blends the table.
- The decode cache key carries the weight (`profileToken`), and the stage's
  decode key is the request's JSON.
- **The hot loop goes through `compiledHueSat`**, never `mapHsv` /
  `mapSrgbThroughHueSat` (the readable reference a spec pins it to, to
  1e-9): no array per pixel, the way into ProPhoto folded into the matrix,
  an identity table skipped whole. Per-pixel tuples cost 265 ns/px against
  the plain matrix's 20; compiled, 80 (≈ 1 s more on 12 MP, banded).

Measured with the real decoder (synthetic DNGs, headless): an identity map
gives the profile without a map to the bit; a 40° map at weight 0.76 moves
3 026 of 3 072 pixels. NOT measured: a real Adobe/Apple profile, its look
on his eyes, a phone's cost.

## C6: the look table, in the decoder after the gain (2026-10-07)

**Decision.** The brief put it in the head's middle; it went in the
DECODER, because the head is composed from `DevelopSettings` alone by a
dozen consumers (`lut-stack.ts` and every cube cache above it) that never
hold the file — a table read from the file could only reach them through a
registry whose arrival no cube cache observes, and a picture opened cold
would render without its look. **Rules a later agent must keep:**

- **The look comes after the GAIN**: the stored `rawGain`, else metered on
  the matrix's plane BEFORE the look (the exposure the sensor needs, as the
  SDK sets exposure before its look) and handed on as the decode's gain, so
  the picture stores the gain its look was read at and every later decode
  is the first one to the bit. A tile plan without a stored gain decodes
  whole (`TilePlanMismatch`).
- **Only the value axis reads the gain** (`valueGain`): the map commutes
  with a uniform gain everywhere else, so the plane stays pre-gain as the
  head expects. The exposure and white-balance sliders act AFTER the look —
  the one departure from the spec's order, said in the brief.
- `RawProfile.look` is a fact, the table read from the file each time
  (`lookTableOf`), in the cache key; post-clip on LibRaw's plane, unclipped
  on a box-averaged one.

Measured with the real decoder (synthetic DNGs, headless): an identity look
gives the picture without it to the bit; a 25° look moves every pixel; the
first decode equals a later one at gain 1 and 3.94. NOT measured: a real
Camera Matching profile.

## C7: the profile's tone curve is a BASE CURVE (2026-10-07)

**Decision (his Q6).** `ProfileToneCurve` is the `profile` kind of
`BaseCurve`, never a second curve stage: it rides the head's tone table like
every base curve. **Rules a later agent must keep:**

- **Points, stored like Auto's** — the file's curve resampled by
  `profileCurvePoints` into the encoded domain (the profile's points joined
  by `makeCurve`, a 512-step grid, then the FEWEST grid points the shaper
  draws within 0.1 code, ≤ 32). Uniform spacing was measured 10 codes off
  near black on a lifted curve; adaptive is ≤ 0.1 there. A curve with an
  infinite slope at black (x^0.7) cannot be held by any finite list —
  neither by the profile's own points.
- **One file's, like a measurement**: `portableBaseCurve` drops the points,
  `landBaseCurve` keeps the target's own, an unread Profile draws Standard
  and says so, and it is OFFERED only where the file carries a curve
  (`readProfileCurve`, a megabyte of the head, held per file).
- **Filled by whoever has the file**: the stage on reading the head, the
  export run before it renders (a preset's, a paste's, the roll's opening);
  a file with none falls to Standard, said.
- On LUMINANCE (a grey stays grey), where the SDK applies its curve per
  channel with the hue kept — the departure, in the brief.

Driven headless on a synthetic DNG + DCP (2026-10-07): offered once the DCP with a curve was loaded, picked, 20 points stored; six words do not fit the menu's one row, so with Profile it lays out two rows of three. NOT seen on a real profile.

## C8: a loaded `.dcp`, kept by hash, chosen per picture (2026-10-07)

**Decision (his Q3: his own profiles, his licence).** `exif/dcp.ts` reads
the file through `readDngProfile` (the magic `IIRC`/`MMCR` aside, a DCP IS a
DNG's IFD0); `raw/profile-vault.ts` keeps the BYTES in `atelier-camera-profiles`
under their SHA-256. **Rules a later agent must keep:**

- **A reference, never the profile, on the picture**: `RawProfile.dcp` =
  hash + name, beside the RESOLVED matrix and weight. The tables are read
  from the vault at every decode (`tablesFor` in `raw-decoder.ts`, passed to
  `jxl-dng.ts` as `tables`); a vault that does not hold it gives the matrix
  alone, warned in the console and said in the panel.
- **Resolved on the workbench, on the decode's own white**
  (`rawProfileFromDcp` over `whiteThroughDcp` — the decode's neutral and
  `rgb_cam`, the DCP's calibrations), the very function a first decode uses
  for the file's own, so the stored matrix is what every decode folds in.
  The kelvin panel reads the same white; a kelvin balance set before is
  re-solved through the new profile at the same light; a `profile` curve is
  re-read from the new source (`profileCurveFor`).
- **The stage re-decodes when the profile it decoded with is not the one
  asked** (`profileKeyOf` in `use-develop-picture.ts`) — a choice, a change
  or an undo — but `'resolve'` turning into what it resolved to decodes
  nothing. Before C8 the profile only ever changed that way, so a ref was
  enough; the loupe drops with it.
- Calibration: no preset or paste carries it; offered only on the sensor,
  decoded, not following the roll, not on a clip. No roll-wide default yet.

Measured with the real decoder (synthetic DNG + DCP, headless): the DCP's
map moves 3 026 of 3 072 pixels; one missing from the vault equals its
matrix alone to the bit. Driven headless in Develop: a DNG dropped on a roll, put on its sensor, *Load a .dcp…*, the profile chosen and named, its reference stored, no page error. NOT measured: a DCP of his.

