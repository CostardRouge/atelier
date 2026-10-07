# Camera colour profiles

**Status (2026-10-07).** §1 is the ask. §2 is FACT, read in this repository
and MEASURED in headless Chromium against the libraw-wasm build the suite
ships, on synthetic DNGs (none of his files is in the container). §3–§5
evaluate what a profile is, where one could come from without breaking the
local-first line, and what it costs in the render graph. §6 is the
recommendation, §7 the questions that are his, §8 the plan in commits. C1 —
reading a DNG's own profile and the spec's maths, applying nothing — is
built with this brief, because it needs no answer of his. **He answered §7
the same day: «go with your recommendations»** (§7.1), and C2 + C3 are
built: a RAW put on its sensor from now on is developed in the spec's
colour.

**This REOPENS item 19 of `docs/lightroom-gaps.md`**, which he parked on
2026-09-24 as overkill (§12 there): his reasons then were sRGB outputs and
"a camera-matching profile would change every look he has already set".
The second reason still holds and is what §7 Q1 asks.

---

## 1. What was asked

He showed Capture One's *Base Characteristics* panel — **ICC Profile: «Sony
A7C II ProStandard»**, and a *Curve* menu under it — and asked to start the
ICC profiles in a session of their own. The *Curve* half is being built in
a parallel session as Atelier's base tone curves (Linear · Standard · High
contrast · Lifted shadows · Auto, in the develop HEAD); this brief stays off
it and says where the two meet (§5.4).

## 2. What the sensor rung does with colour today (fact)

**The decoder** (`raw/raw-decoder.ts`, `librawSettings`): libraw-wasm 1.6,
`useCameraWb`, `outputColor: 1` (sRGB), 16 bits, highlight mode 0. LibRaw
turns camera RGB into linear sRGB with ONE 3×3, `rgb_cam`, built dcraw's
way (`cam_xyz_coeff`: `inverse(rows-normalised(ColorMatrix · xyz_rgb))`),
and clips to [0, 1] — so a colour past sRGB is gone at decode
(`lightroom-gaps.md` §11, measured then).

**Where that ONE matrix comes from:**

- **A non-DNG RAW** (his Sony A7C II ARW): LibRaw's built-in table, Adobe's
  D65 matrices transcribed (dcraw's `adobe_coeff`). `ILCE-7CM2` is named twice
  in `libraw.wasm`'s strings, once in a mixed-maker model list of the shape
  that table has — so the body is very likely known. **Not measured on a real
  ARW.** One illuminant only: LibRaw's table has no second matrix to
  interpolate with.
- **A DNG** (his DJI drone, an iPhone ProRAW, an Adobe DNG Converter output):
  the file's own `ColorMatrix`. Measured on five synthetic CFA DNGs (64×48,
  16-bit uncompressed, a Standard-light-A and a D65 matrix, generator in the
  session scratchpad, not in the repo):

  | file | `rgb_cam` matches dcraw's construction from |
  | --- | --- |
  | CM1 = A (17), CM2 = D65 (21) | CM2, to 3e-5 (CM1: 0.07 off) |
  | the same, order reversed | the D65 one again |
  | D65 alone | it |
  | A alone | it |
  | CM1/CM2 with a wild `ForwardMatrix` | the D65 one — **output bytes identical** |

  So LibRaw **picks the D65 matrix whatever the light** (else the last), **does
  not interpolate two illuminants**, and **ignores `ForwardMatrix`**. The
  as-shot multipliers are `1 / AsShotNeutral` either way.
- **A ProRAW in JPEG XL** (`raw/linear-dng.ts`, our own code): the same rule
  by design — the D65 matrix, dcraw's construction (now `dcrawRgbCam`, shared
  with `dng-color.ts`).

**What the decoder TELLS us** (measured, `metadata(true).color_data`):
`dng_color` is two slots of `{ illuminant, colormatrix 4×3, forwardmatrix
3×4, calibration 4×4 }`, zeros where the file has nothing; `dng_levels`
carries `asshotneutral`, `analogbalance`, `baseline_exposure`; `profile` /
`profile_length` an ICC profile a camera embedded; `cam_xyz` is all zeros for
a DNG (already known, `raw.md`). Everything a spec-correct matrix needs is
therefore reachable without a second parser for a CFA DNG — and for a
LinearRaw one, `linear-dng.ts` reads the tags itself.

**The kelvin white balance** (`raw/white-balance.ts`) reads the as-shot
temperature and computes new multipliers through `camXyz` — for a DNG,
recovered from that same D65 `rgb_cam`. So the white balance in kelvin
inherits the single-matrix choice.

### How far that lands from the DNG spec (measured, synthetic)

`raw/dng-color.ts` implements the spec's conversion (DNG 1.4 ch. 6: the
white found from the neutral by iteration, two calibrations interpolated
linearly in 1/T, camera → XYZ D50 by `ForwardMatrix` or by the inverse
`ColorMatrix` and Bradford). `dngCorrection` is the 3×3 in the DECODED
picture's own space that turns LibRaw's answer into the spec's. On the
synthetic pair above (the D65 matrix is Adobe's published Sony shape, the A
matrix is invented — **the magnitudes are illustrative, not his camera's**),
ΔE76 between the two on eight linear-sRGB patches:

| as-shot light | max matrix term off identity | skin | sky | foliage | red | green | blue | yellow | grey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2850 K | 0.176 | 4.6 | 5.6 | 6.1 | 19.1 | 16.2 | 15.7 | 11.9 | 0 |
| 3500 K | 0.121 | 2.9 | 4.3 | 2.7 | 10.8 | 7.8 | 13.3 | 5.9 | 0 |
| 4500 K | 0.071 | 1.5 | 2.5 | 1.2 | 4.9 | 3.4 | 8.5 | 2.3 | 0 |
| 5500 K | 0.041 | 0.6 | 1.1 | 0.6 | 2.0 | 1.8 | 3.6 | 0.9 | 0 |
| 6500 K | 0.020 | 0.2 | 0.2 | 0.5 | 0.7 | 1.1 | 1.2 | 0.5 | 0 |

About half of the tungsten gap is NOT the second matrix: with the D65 matrix
alone, the spec's Bradford adaptation in XYZ against dcraw's implicit
adaptation in camera RGB already differs by 2.5–19 ΔE at 2850 K. Greys never
move (both map the neutral to white). And the **as-shot temperature the
kelvin panel reads** is off too: a neutral made under 2850 K reads **2773 K,
tint −11.9** through the D65 matrix, against 2850 K, 0.0 through the spec;
3500 K reads 3428 / −13.4; 5500 K reads 5520 / −4.9.

## 3. What a camera profile is

**DCP (Adobe, the DNG spec's own profile).** A small TIFF-shaped file
(magic `IIRC` instead of `II*`) holding exactly the tags a DNG's IFD0 may
carry: `ColorMatrix1/2`, `ForwardMatrix1/2`, `CameraCalibration*` per
illuminant; `ProfileHueSatMap` (per illuminant, interpolated like the
matrices; 2.5D — hue × saturation, often 90 × 30 — or 3D with a value axis)
applied in HSV of linear ProPhoto right after the matrix; `ProfileLookTable`
(one, applied after exposure); `ProfileToneCurve` (REPLACES the raw
converter's default base curve); `BaselineExposureOffset`,
`DefaultBlackRender`; and `ProfileName`, `ProfileCopyright`,
`ProfileEmbedPolicy` (0 copy · 1 embed if used · 2 never embed · 3 free).
Adobe's *Adobe Standard* is matrices + hue/sat map; its *Camera Matching*
profiles (*Camera Standard*…) add a look table and a tone curve. Everything
in it is a 3×3, a smooth 3D table or a 1D curve — the three shapes this
render graph already has.

**ICC input profile (Capture One).** Camera RGB → PCS (XYZ or Lab D50), as
matrix + TRC or an `A2B0` LUT (curves → CLUT → curves → matrix → curves,
`lut16`/`mAB`). Evaluating one needs a CMM: LittleCMS compiled to wasm (MIT;
size unmeasured) or a TypeScript interpreter of the subset camera profiles
use, either baked into a lattice. Two things make it a weaker fit than a DCP:

1. Its INPUT is camera RGB, before any matrix — LibRaw hands us sRGB already
   clipped, so an ICC needs the decoder to output camera colour
   (`outputColor: 0`), which changes every RAW's bytes (§7 Q5).
2. Capture One's *ProStandard* is built for Capture One's own linearisation
   and white-balance convention. Fed LibRaw's camera RGB it is not guaranteed
   to reproduce Capture One's picture — **unmeasured**, and only one of his
   ARWs exported by Capture One beside its own render could measure it.

## 4. Where profiles could come from, the local-first line kept

1. **The DNG's own** — read now (C1). Which of his files carry what is
   UNMEASURED: a DJI DNG, an iPhone ProRAW and a DNG converted by Adobe's
   DNG Converter (which embeds *Adobe Standard*, policy "embed if used") each
   answer through `describeRaw` once one is in hand. His Sony ARW carries no
   DNG profile — it is not a DNG.
2. **A file he loads** — a `.dcp` or an `.icc` he holds, kept in a VAULT like
   a purchased `.cube` (`media-pipeline.md`, `docs/lut-packs.md`): bytes in
   IndexedDB under their hash, a REFERENCE on the picture, never inlined into
   a document. A profile whose `ProfileEmbedPolicy` is 2 is never copied to a
   Winnow. Adobe's DCPs ship with Adobe's DNG Converter and Camera Raw, and
   Capture One's ICCs with Capture One: **Atelier never ships them nor fetches
   them from Adobe or Phase One**; whether their licences let HIM load his
   copies into another program is his question (§7 Q3).
3. **One he makes** — a ColorChecker shot under the light, fitted locally
   (dcamprof/Argyll outside, or later in the browser: a matrix and a hue/sat
   map from 24 patches is a small least-squares problem). His data, no
   licence, no network.
4. **A public database** — none known for camera profiles the way Lensfun
   exists for lenses. RawTherapee ships community DCPs for some bodies
   (licence and coverage NOT checked here); darktable and LibRaw use Adobe's
   D65 matrices only. Fetching from anywhere would be a FIFTH network
   exception — his decision alone, and nothing found yet justifies asking.

## 5. What it costs in the render graph

1. **The matrices** (dual illuminant, forward matrix): ONE 3×3 in the decoded
   picture's space (`dngCorrection`), exactly the shape of `rawWb.matrix`,
   which the develop HEAD already applies first. Free per pixel; it composes
   with the kelvin matrix (the kelvin maths must then use the interpolated
   matrix too, or the as-shot read-out stays off as measured above). It
   cannot bring back what LibRaw clipped to sRGB — mild for in-gamut
   colours, wrong at the edge of saturated reds and greens.
2. **The hue/sat map** runs right after the matrix, BEFORE exposure: at the
   very start of the head, on a picture LibRaw already clipped. A 90×30×1
   table is 8 100 floats; on the GPU an HSV lookup with hue wrap (or a baked
   RGB lattice sampled per pixel) at the head's start. Not bakeable into the
   tail cube, which runs AFTER the tone stages.
3. **The look table** sits after exposure and before the tone curve — in the
   MIDDLE of the head (`glsl.ts` `HEAD_APPLY`, `develop-head.ts`), the code
   the parallel session is changing now. It waits for that work to land.
4. **The profile tone curve overlaps the base tone curves exactly**: a DCP's
   `ProfileToneCurve` is what Capture One's *Curve* and Lightroom's base curve
   ARE. It must become ONE more choice in that menu (*Profile's own*), drawn
   through the same table, never a second curve stage.
5. **Preview = export** by the lens profile's rule (`lens-profiles.md`): the
   RESOLVED profile lives on the picture (the correction matrix for its own
   neutral; a hash reference for tables kept in a vault), so an export, a
   second device and a `.roll.json` need nothing else, and a later file
   change never moves a developed picture. A profile is CALIBRATION, not an
   edit: no paste, preset or Apply-to carries it (`withoutBase`'s rule).
   Per pixel throughout, so bands and the kept upstream hold with a pass key.

## 6. Options and recommendation

| | what | needs | changes stored pictures? |
| --- | --- | --- | --- |
| A | spec-correct matrices from the file (dual illuminant, forward matrix), kelvin through them | nothing new | yes, every DNG with two matrices, mostly under tungsten |
| B | A + the DNG's own hue/sat map, look table, tone curve | the head's slots (§5.2–5.4) | only where a file carries them |
| C | B + a loaded `.dcp` (vault) | a DCP reader (`IIRC`), the vault, a picker | no — only where chosen |
| D | an ICC input profile (Capture One's) | camera RGB out of the decoder + a CMM | — |
| E | a profile made from a ColorChecker shot | C's machinery + a fit | — |

**Recommended: A, then B, then C with DCPs; D only if he wants Capture
One's look itself, after one ARW measures whether it can be matched; E
later.** A and B use only what the file already holds — no network, no
licence beyond `ProfileEmbedPolicy`. C is how his Sony gets a camera-specific
profile at all, since an ARW carries none. **Under all of them sits one
prerequisite worth deciding once**: asking LibRaw for camera (or wide)
colour instead of clipped sRGB and owning the matrix ourselves — the same
change §11 of `lightroom-gaps.md` found P3 needs. Without it, A is right in
the middle of the gamut and only approximately right at its edge.

## 7. His to decide

1. **Stored pictures**: may A move the colour of RAWs already developed, or
   only of pictures opened after it (an absent field = today's colour,
   recommended), or only on a per-picture switch?
2. **Which bodies matter**: Sony A7C II ARW, DJI DNG, iPhone ProRAW — one file
   of each through `describeRaw` (or the Rendition Inspector) says what each
   carries.
3. **Licences**: will he load Adobe's DCPs or Capture One's ICCs from his own
   installs into Atelier? (Atelier ships and fetches neither, ever.)
4. **The target**: correct camera colour (DCP/DNG route), or Capture One's
   *ProStandard* look itself (ICC route, uncertain)?
5. **The decoder's colour**: camera/wide out of LibRaw instead of sRGB —
   every RAW's bytes change; prerequisite for B done right and for P3.
6. **The profile's tone curve** as one choice of the base-curve menu — yes?
7. **Where the choice lives**: per picture (like the rung) with a roll default
   (like `opensOn`), never carried by a preset — yes?

### 7.1 His answers (2026-10-07: «go with your recommendations»)

1. **Stored pictures do not move.** The profile is written when a picture is
   put on its sensor from now on (by hand, by the roll, by a batch onto the
   roll's sensor); one already on its sensor keeps LibRaw's colour.
2. **All three bodies matter**; one file of each through `describeRaw` is
   still needed to know what each carries — no file of his is here.
3. **Loading his own `.dcp` / `.icc` is allowed**, his licence to judge;
   Atelier ships and fetches neither, ever (C8).
4. **The target is correct camera colour** (the DCP/DNG route); Capture
   One's *ProStandard* itself stays C9, a spike after one ARW measures it.
5. **LibRaw in camera colour: yes** — C4, next.
6. **The profile tone curve is one more base-curve choice** (C7).
7. **Per picture, calibration, carried by no preset or paste** — built that
   way; a roll-wide default waits until there is more than one profile to
   choose (C8).

## 8. Plan, in commits

| # | commit | needs | verified by |
| --- | --- | --- | --- |
| C1 | **BUILT.** `exif/dng-profile.ts` reads a DNG's profile tags (both calibrations, forward matrices, hue/sat map, look table, tone curve, embed policy, third illuminant, gain table map; a table past the head NAMED in `unread`); `RawProbe.profile`; `describeRaw` says it. `raw/dng-color.ts`: the spec's maths, `dngCorrection`, `librawPick`, `calibrationsFromLibraw`. Applies nothing. | — | specs; LibRaw's measured `rgb_cam` rebuilt to 1e-4 |
| C2 | **BUILT.** `RawMeta.white.calibrations` carries LibRaw's `dng_color` (and the JPEG XL path's IFD0); the picture's facts say `camera colour A + D65` | — | the decoder's real `dng_color` read back |
| C3 | **BUILT.** `DevelopSettings.rawProfile` — the resolved correction, `'pending'` until the gain's metering (stage or run), absent = today — applied as the head's ONE matrix; a kelvin balance is solved through the profile and REPLACES its matrix | Q1, Q7 | specs: the matrix in the head and in `developLinear`, kelvin = profile at the as-shot light |
| C4 | **BUILT.** LibRaw asked for camera colour (`outputColor: 0`); `applyCameraMatrix` turns the 16-bit plane into what LibRaw wrote in sRGB, in place, with the profile folded into its `rgb_cam` BEFORE the clip (the JPEG XL path folds it into its own `rgbCam`); the head stops applying the profile (`decodeProfileOf` feeds every decode) | Q5 | today's colour within 1 code in 8 bits (real decoder, synthetic DNGs); before vs after the clip up to 92 codes where LibRaw clipped |
| C5 | The hue/sat map as the head's first step (GPU + CPU twin) | C3, C4 | gate row |
| C6 | The look table between exposure and tone | C5, coordination | gate row |
| C7 | `ProfileToneCurve` as a base-curve choice | Q6 | spec |
| C8 | `.dcp` loading into a vault, picked per picture | Q3 | a DCP of his |
| C9 | ICC: a spike — LittleCMS wasm vs a TS subset, against one ARW Capture One exported | Q4 | ΔE vs Capture One's render |

## 9. Not measured

A real Sony ARW (whether LibRaw's table holds the A7C II's matrix), a real
DJI or ProRAW DNG (which profile tags each carries), Adobe's own matrices for
any of his bodies (the synthetic A matrix is invented), any DCP or ICC, and
anything on his Mac or phone. The illuminant temperatures in
`illuminantKelvin` are the DNG SDK's as recalled, not read at source.
