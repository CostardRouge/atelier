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

## The shape of the answer (2026-10-07, proposed, nothing decided)

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
