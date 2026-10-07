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
after it, both in the DECODER before the clip (C4, C5); the look table
after the exposure, in the decoder too (C6); a DCP's `ProfileToneCurve` is ONE more choice of the base-curve menu,
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

## Built per phase

C4 (LibRaw in camera colour, our matrix), C5 (the hue/sat map) and C6 (the
look table) each fixed rules for the DECODER — what every decode must pass,
where each table runs, what is cached under what: they are in
`camera-profiles-build.md`. Read it before touching `raw-decoder.ts`'s colour,
`applyCameraMatrix`, `hue-sat-map.ts` or `jxl-dng.ts`'s profile.
