# Camera colour profiles — what a RAW's colour is converted with

Read before touching how camera RGB becomes the picture's colour: LibRaw's
`outputColor` / `rgb_cam`, `linear-dng.ts`'s `linearDngColor`, the kelvin
maths' `camXyz`, a DNG's `ColorMatrix` / `ForwardMatrix` / profile tables, a
`.dcp` or an input `.icc`. The brief is `docs/camera-profiles.md`; the white
balance in kelvin is `raw.md`; the decoder's settings `raw.md`, «The
decoder».

## Item 19 is REOPENED (2026-10-07)

He parked «DCP/ICC» as overkill on 2026-09-24 (`lightroom-gaps.md` §12:
sRGB outputs, and a camera-matching profile would change every look already
set). On 2026-10-07 he showed Capture One's *Base Characteristics* (*ICC
Profile: «Sony A7C II ProStandard»*, and a *Curve* menu) and asked to start
the profiles in a session of their own. **How to apply**: the second reason
of the parking still stands — anything that moves a stored picture's colour
waits for his answer to Q1 of the brief; reading and saying are free.

## What LibRaw does with a DNG's colour — measured, not assumed (2026-10-07)

On synthetic CFA DNGs through libraw-wasm 1.6 in headless Chromium:
`rgb_cam` is dcraw's construction from the **D65** `ColorMatrix` whatever
the file's order and whatever the light (else the last matrix); **no
dual-illuminant interpolation**; **`ForwardMatrix` ignored** (a wild one left
the output bytes identical). The full read's `color_data.dng_color` exposes
BOTH slots (`illuminant`, `colormatrix` 4×3, `forwardmatrix` 3×4,
`calibration` 4×4, zeros = absent) and `dng_levels` the as-shot neutral and
analog balance — so the spec's maths needs no second parser for a CFA DNG.
For an ARW the one matrix is LibRaw's built-in Adobe D65 table (`ILCE-7CM2`
is named in the wasm; not decoded here). **Measured gap to the DNG spec**
(synthetic pair, so illustrative): up to 19 ΔE76 on saturated patches and a
0.18 matrix term at 2850 K, ~1 ΔE at 6500 K, greys never; about half of it is
the adaptation method (Bradford in XYZ vs dcraw's in camera RGB), not the
second matrix. The as-shot kelvin read-out under tungsten is ~80 K low and
−12 tint through the D65 matrix. **How to apply**: never claim LibRaw "uses
the file's profile" — it uses ONE of its matrices; and a new consumer of the
camera's colour reads `dng-color.ts`, not a second construction.

## The shape of the answer (2026-10-07, DECIDED: «go with your recommendations»)

The matrices are ONE 3×3 in the decoded picture's space (`dngCorrection`),
the slot `rawWb.matrix` already has in the develop head; the hue/sat map is
the head's first step; the look table sits between exposure and tone (the
head's middle — the parallel base-curve session's code); a DCP's
`ProfileToneCurve` is ONE more choice of the base-curve menu, never a second
curve stage. A profile is CALIBRATION, stored RESOLVED on the picture like a
lens profile, carried by no paste or preset. Adobe's DCPs and Capture One's
ICCs are never shipped nor fetched — a user may load his own into a vault
(his licence question). An ICC input profile needs camera RGB out of LibRaw
(today clipped sRGB) and a CMM, and Capture One's are built for Capture One's
own pipeline — the weakest fit. The common prerequisite for anything past a
3×3 done right is LibRaw in camera/wide colour, the same change P3 needs
(`lightroom-gaps.md` §11).

## C1: read and said, applied nowhere (2026-10-07)

`exif/dng-profile.ts` (pure) reads IFD0's profile tags through the one TIFF
reader; `RawProbe.profile` carries them and `describeRaw` ends with them
(`profile "Adobe Standard" · A + D65 · forward matrices · hue/sat map
90×30×1`). Rules: a table whose bytes are past the probe's megabyte is
NAMED in `unread`, never dropped (the opcode reader's rule); absurd table
dims are refused before allocating; a third illuminant (DNG 1.6) and a gain
table map are SAID, not read. `raw/dng-color.ts` (pure) is the spec's maths —
`interpolationWeight` (linear in 1/T, clamped), `neutralToXy` (the SDK's
iteration from D50), `cameraToXyzD50` (forward matrix normalised to D50, else
inverse matrix + Bradford), `balancedToSrgb`, `dngCorrection` (the 3×3 from
LibRaw's answer to the spec's, identity under D65 with one D65 matrix — a
spec pins it), `librawPick` (LibRaw's own choice, measured) and
`calibrationsFromLibraw` (the measured `dng_color` shape). `dcrawRgbCam` is
now the ONE construction of dcraw's `rgb_cam` (`linear-dng.ts` calls it).
`illuminantKelvin` holds the DNG SDK's temperatures AS RECALLED — check them
at source before anything is applied with them.

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
eyes on the result. **Next: C4** (LibRaw in camera colour, his Q5 yes) — the
profile then stops being a correction of a clipped sRGB decode.
