# The tone engine — a rolloff instead of a clip

*2026-10-05. From the maintainer's report: moving highlights, shadows or
whites leaves parts of a photograph burned, where Capture One gives a softer,
better-controlled result with fewer parts that burn and vanish; he wants the
same «pour toutes les expositions», to professional standards, and the whole
suite to hold on a phone. This brief records what was read in the code, what
was built, and the arithmetic — so the next control is added to the engine
and not beside it. The engine lives in `src/shared/develop/develop.ts`; the
GPU twin in `src/shared/render/glsl.ts` (`HEAD_APPLY`); the table between
them in `src/shared/develop/develop-head.ts`.*

## 1. What burned, and why (fact, read in the code)

| Symptom he saw | Cause, traced |
| --- | --- |
| Highlights −100 darkens a sky and leaves its brightest tenth as a white hole | `bandWeights.hi` was `4u(1 − u)`: a bump peaking at 3/4 and **zero at white** — the shadows band's mirror. The tones at 0.75 came down by 0.15, those at 1.0 not at all, so the gradient's span GREW and the top stayed burned. |
| Exposure +1 burns half the picture | A pure gain, then `Yc = min(Y, 1)` before the curve and a per-channel clip at the encode: every linear value above 0.5 went to white. |
| Contrast + flattens the brights to white | `clamp01(pivot + (v − pivot) × slope)`: at +100 every code above 0.80 was white, every code under 0.17 black. |
| Whites + flattens the top | The band added 0.2 at white, then `clamp01`. |
| A RAW's headroom cannot be recovered | `developLinear` clamped the luminance to 1 BEFORE `toneCurve` saw it, so the stops the sensor kept were never a number a slider could act on; a super-white took white's ratio and nothing more. |
| A warm highlight turns yellow, then white | The stage's end clipped per channel (`fromLinear`'s clamp on the CPU, `min(lin, 1)` in GLSL). Red clips first, green next: the hue rotates toward the secondary. Every other stage of the develop keeps «a grey stays grey, no hue rotates». |

Capture One's HDR tool (Highlight, Shadow, White, Black) is global and
luminance-based; what makes it soft is a shoulder at the top of its curve
(its default *Film Standard* curve already carries one) and a knee that
reaches into the RAW's headroom. Lightroom's Highlights is a local,
edge-aware tone mapper — a different, dearer thing, not built here.

## 2. The engine (built)

Four changes, one function each, all pure and specced.

**2.1 An extended luminance domain.** `encodeTone(Y)` is the sRGB encode up
to white, then `1 + K·log2(Y)` above it with `K = 0.3047` — the encode's
derivative at 1 (`1.055 / 2.4`) times `ln 2`, so the two halves meet at white
with the same slope (C¹). One stop of headroom is 0.3047 of encoded range. A
RAW at the metered gain `rawGain` keeps `log2(rawGain)` stops above the
displayed white; a render keeps nothing. `developLinear` no longer clamps the
luminance before the curve.

**2.2 Highlights reaches white.** `bandWeights.hi = u(2 − u)` over the upper
half: zero at mid-grey, 1 at white with zero slope, held at 1 above white.
Whites stays `u²`, held at 1 above. The lower half is unchanged — shadows is
still a bump zero at black, blacks the ramp — because a lifted black is fog
and a burned white is a defect: the asymmetry is on purpose.

**2.3 The toe and the shoulder** (`ToneShape`, resolved once per develop by
`toneShape(d)`). Let `rawTone(L)` be the bands then the contrast line with no
clamp. The reference white is the displayed white after the white balance and
the gains (`whiteLuminance`, `developLinear`'s own order on `[1, 1, 1]`),
moved toward the sensor's top by the recovery the author asked for:

```
lWhite   = encodeTone(yWhite)                     // where display white lands after the gains
lTop     = encodeTone(yWhite × rawGain)           // the sensor's top; = lWhite on a render
recovery = min(1, max(0, −highlights/100) + max(0, −whites/100))
lRef     = lWhite + (lTop − lWhite) × recovery
top      = min(1 + 2K, max(1, rawTone(lRef)))     // the value the shoulder maps to white
knee     = 1 − min(0.35, 0.75 × (top − 1))
bottom   = max(−2K, min(0, rawTone(0)))           // the value the toe maps to black
toe      = min(0.35, 0.75 × −bottom)
```

The shoulder is a cubic Hermite from `(knee, knee)` at slope 1 to `(top, 1)`
at slope 0; above `top` the value is white. The toe is its mirror at black.
The compression ratio `(top − knee)/(1 − knee)` never exceeds 2.8, under
Fritsch–Carlson's 3, so the cubic is monotone. Order of the stages: bands →
contrast → toe → shoulder → brightness (a gamma that keeps both ends fixed,
so it cannot push past what the shoulder bounded). `top = 1` means no
shoulder and a bit-identical pixel; `top` grows continuously with the sliders
and the gains, so a hair of contrast moves a near-white by a hair. The
rolloff reaches two stops (`TONE_ROLLOFF_STOPS`): what is pushed further is
a burn, and the clipping view (J) says so.

What this gives, slider by slider:

| Slider | Before | Now |
| --- | --- | --- |
| Exposure +1 | clips at linear 0.5 | `top = encodeTone(2)`: the top rolls off into white, order kept; −1 is the exact half it always was |
| Contrast +100 | white above 0.80, black under 0.17 | shoulder from 0.76, toe to 0.21: near-whites and deep shadows keep their order |
| Whites +100 | flat white from 0.87 | shoulder; white lands on white, 0.92 stays under it |
| Highlights −100, render | white untouched, 0.75 down by 0.15 | white down to 0.85, the gradient's span shrinks |
| Highlights −100, RAW with 2 stops | the headroom clipped | the whole headroom under white with its detail, the sensor's top AT white |
| Highlights −50, RAW with 2 stops | — | one stop recovered; the stop above it a burn |
| Whites −100, RAW with 1 stop | super-white took white's ratio | white to 0.8, the sensor's top at white, between them in order |
| As shot, or shadows +50 on a RAW | headroom clipped at the encode | headroom passes through `developLinear` untouched (the contract), clipped at the display |

**2.4 The display clip** (`clipToDisplay`). The hue is kept whatever
happens. Between brightness and colour the pixel is a blend of two
projections onto its own hue line: SCALED — divided by its brightest channel,
saturation kept, brightness given up — and KEPT — pulled toward the grey of
its own luminance until that channel is white, brightness kept, saturation
given up, white when it is brighter than white. The weight on KEPT is
`max(max − 1, min) / max`: a saturated colour just past white stays its
colour and gives up a little brightness, a colour far past white or close to
grey goes to white, and a ramp of one colour through the clip never darkens
on its way to white. Identity under white. One rule for the CPU stage
(`developStage`) and the shader (the end of `applyHead`).

Measured on the way (the gate's half-source row): KEPT alone is a cliff.
Pure yellow's luminance is 0.93 of white's, so keeping it forces a clipped
yellow to near-white at once — half a code of red in the source moved blue
by twenty codes. SCALED alone darkens a bright saturated core below its
halo (the max-RGB artefact). The blend has neither: its slope at the onset
is SCALED's, bounded, and it reaches white as the excess grows.

**2.5 The GPU twin.** `CubeHead.toneTop` is the table's domain (the brightest
input the gains can make, ≥ 1); the shader reads the tone table at
`_headEncodeTone(Y) / u_headToneTop` with no `min(Y, 1)` before it. The gate
(`scripts/check-render.mjs`, «the tone engine's TOP») holds the GPU to the
CPU on two stops of headroom with highlights −100, exposure +0.7, contrast
+60 and temperature +40, checks the grey ramp never steps down, that the
sensor's top lands at white, and that R ≥ G ≥ B survives the clip on a warm
row.

## 3. What changed for stored documents

A develop that pushes nothing past white renders to the ulp as before. One
with `highlights ≠ 0` renders differently at its top (the band's shape — the
fix itself). One with exposure > 0, contrast > 0 or whites > 0 rolls off where
it clipped. A clipped saturated highlight keeps its hue where it shifted
toward a secondary (the clip rule). No migration: the record is the same
numbers; only the arithmetic that reads them moved.

## 4. Deliberately not built

- **A default shoulder on a RAW as-shot** (Capture One's Film Standard):
  the as-shot stays linear to the display so `rawGain`'s metering keeps its
  meaning and «untouched is bit-identical» holds; the rolloff attaches to the
  sliders.
- **A local (edge-aware) highlights**: Lightroom's; a spatial pass, to be
  weighed on a phone before anything else.
- **A tunable weight in the clip's blend**: the weight is arithmetic on the
  pixel alone (`max(max − 1, min) / max`), with no constant to taste; if a
  sunset's core reads too pale or too dark on his pictures, a power on that
  weight is the one knob to add.

## 5. Open

- His eye on his own photographs: the knee's rate (0.75) and cap (0.35), the
  two-stop reach, and whether the shadows band should reach black after all.
- The performance workstream he asked for in the same breath — units of work,
  caches, sizes and thumbnails, IndexedDB where needed, so Develop holds on a
  phone — is the next brief.
