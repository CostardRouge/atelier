# Camera colour profiles — what a RAW's colour is converted with

Read before touching how camera RGB becomes the picture's colour: LibRaw's
`outputColor` / `rgb_cam`, `linear-dng.ts`'s `linearDngColor`, the kelvin
maths' `camXyz`, a DNG's `ColorMatrix` / `ForwardMatrix` / profile tables, a
`.dcp` or an input `.icc`. The brief is `docs/camera-profiles.md`; the white
balance in kelvin is `raw.md`; the decoder's settings `raw.md`, «The
decoder».

## Item 19 is REOPENED (2026-10-07)

Parked as overkill on 2026-09-24 (`lightroom-gaps.md` §12), reopened after he
showed Capture One's *Base Characteristics*; his answers are the brief's
§7.1. **How to apply**: a stored picture's colour never moves (his Q1).

## What LibRaw does with a DNG's colour — measured, not assumed (2026-10-07)

On synthetic CFA DNGs through libraw-wasm 1.6 in headless Chromium:
`rgb_cam` is dcraw's construction from the **D65** `ColorMatrix` whatever
the file's order and whatever the light (else the last matrix); **no
dual-illuminant interpolation**; **`ForwardMatrix` ignored** (a wild one left
the output bytes identical). The full read's `color_data.dng_color` exposes
BOTH slots (`illuminant`, `colormatrix` 4×3, `forwardmatrix` 3×4,
`calibration` 4×4, zeros = absent) and `dng_levels` the as-shot neutral and
analog balance — so the spec's maths needs no second parser for a CFA DNG.
For an ARW the one matrix is LibRaw's built-in Adobe D65 table. **Measured gap to the DNG spec**
(synthetic pair, so illustrative): up to 19 ΔE76 on saturated patches and a
0.18 matrix term at 2850 K, ~1 ΔE at 6500 K, greys never; about half of it is
the adaptation method (Bradford in XYZ vs dcraw's in camera RGB), not the
second matrix. The as-shot kelvin read-out under tungsten is ~80 K low and
−12 tint through the D65 matrix. **How to apply**: never claim LibRaw "uses
the file's profile" — it uses ONE of its matrices; and a new consumer of the
camera's colour reads `dng-color.ts`, not a second construction.

## The shape of the answer (2026-10-07, DECIDED: «go with your recommendations»)

The matrices are ONE 3×3 (`dngCorrection`) and the hue/sat map runs right
after it, both in the DECODER before the clip (C4, C5); the look table sits
between exposure and tone (the head's middle — the base-curve session's
code); a DCP's `ProfileToneCurve` is ONE more choice of the base-curve menu,
never a second curve stage. A profile is CALIBRATION, stored RESOLVED on the
picture like a lens profile, carried by no paste or preset. Adobe's DCPs and
Capture One's ICCs are never shipped nor fetched — a user may load his own
into a vault (his licence question). An ICC input profile also needs a CMM,
and Capture One's are built for its own pipeline — the weakest fit.

## C1: read and said, applied nowhere (2026-10-07)

`exif/dng-profile.ts` (pure) reads IFD0's profile tags through the one TIFF
reader into `RawProbe.profile`, said by `describeRaw`. A table past the
probe's megabyte is NAMED in `unread`, never dropped; absurd dims are refused
before allocating; a third illuminant and a gain table map are SAID, not
read. `raw/dng-color.ts` (pure) is the spec's maths (`interpolationWeight`,
`neutralToXy`, `cameraToXyzD50`, `dngCorrection`, `librawPick`,
`calibrationsFromLibraw`); `dcrawRgbCam` is the ONE construction of dcraw's
`rgb_cam`. `illuminantKelvin` holds the SDK's temperatures AS RECALLED —
check them at source.

## C2 + C3: the spec's colour on a picture put on its sensor (2026-10-07)

**Decision (his answers, brief §7.1).** `DevelopSettings.rawProfile` holds
the RESOLVED correction (`rawProfileFor` → `dngCorrection` at the as-shot
neutral, through `calibrationsOf`: the file's own, else LibRaw's one matrix
taken as D65's — so an ARW gets the spec's Bradford adaptation too). **Rules
a later agent must keep:**

- **Stored pictures never move**: absent = LibRaw's colour. The profile is
  written only where the gain is FIRST metered for a picture newly on its
  sensor, marked by `rawProfile: 'pending'` (`PROFILE_PENDING`) — set by the
  hand climb from the proxy (`onBase`), by `ontoRollSensor` (a batch onto the
  roll's sensor), and implied for a follower; resolved by whichever meters
  first, the stage's decode (`onRawDecoded`) or the run's (`meterRaw`, which
  now returns the profile beside the gain). *Meter the exposure again* never
  adds one. A follower holds it for the visit (`followProfile`) and writes it
  with its first numbers (`inheritedRef`).
- **ONE matrix in the head**: `rawMatrixOf` = `rawWb.matrix ?? profile`. A
  kelvin balance on a profiled picture is solved THROUGH the profile
  (`profiledWbMatrix`, green held like `wbMatrix`) and REPLACES its matrix —
  at the as-shot light it equals the profile's, so As shot never jumps. The
  as-shot reading is `profiledAsShot` (the spec's white). Never stack the two.
- **Calibration, not an edit**: `withoutBase` drops it; the draft's
  `setDraft`, Apply-to (`developOnto`, `RollEditor`'s batch) and a fresh
  variant keep the TARGET's own, like `rawGain`.
- **`'pending'` applies nothing** (`appliedProfile`), so a picture caught
  between the climb and its decode draws LibRaw's colour for that moment.

Measured: the decoder's real `dng_color` (synthetic DNGs, headless) read back
through `calibrationsFromLibraw` → a profile per file; a dual A + D65 file
with no forward matrix reads its as-shot light 3290 K / −2.3 through the spec
against LibRaw's 3211 K / −15.8. NOT measured: any real camera file, his
eyes on the result.

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
