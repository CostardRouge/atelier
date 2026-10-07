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
