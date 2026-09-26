# Develop · the Adjust sections — parity with the web

Every control of the web components these views port, ✅ built here or ⏳
deferred (why, and what it waits on). The views are pure: each takes a
`Binding` to the kernel's record and plain facts, and writes nothing else —
the shell (`RollEditor` and its successor) owns the store, the stage and the
keys that belong to the workbench rather than to one section (J, V, ⌘Z).

Counts: **98 ✅ · 7 ⏳** table rows (the list at the foot adds two notes).

## `DevelopSection` — `DevelopFold.tsx` over `InspectorSection` (`shared/ui/Inspector.tsx`)

| Control | |
| --- | --- |
| Title band, rule above, the whole band folds (title, stretch, chevron) | ✅ |
| Chevron turned −90° while folded | ✅ |
| `marked` accent dot after the title ("Something here is set") | ✅ |
| `badge` tag after the title | ✅ |
| ⓘ folding the standing prose under the band (`InfoDot`), one paragraph per entry | ✅ |
| `actions` pinned right of the band, drawn while open | ✅ |
| `defaultOpen`; `foldable: false` = same header, no chevron | ✅ |
| Fold remembered for the SESSION (`@SceneStorage`, the web's `sessionStorage`), never on the roll | ✅ |
| `remember: 'local'` for the settled row (`@AppStorage`) | ✅ |
| Title hover tint on the Mac | ⏳ cosmetic; `.onHover` when the Mac shell is dressed |
| Controlled fold (`open` / `onOpenChange`) | ⏳ no Develop section uses it; add when a section's body costs a request |

## `DevelopSettledRow` — the web's `DevelopSection.tsx` (Trips / Studio settled row)

| Control | |
| --- | --- |
| "Correction" + `describeDevelop` sentence, muted when as shot, full sentence as help | ✅ |
| ↺ Back to as shot, drawn only with a develop | ✅ |
| `Develop…` pill, disabled without a picture, `openTitle` as help | ✅ |
| `badge`, `info`, fold remembered per editor | ✅ |

## `DevelopRangeSlider` — `RangeSlider` (`DevelopSliders.tsx`)

| Control | |
| --- | --- |
| Label, value in mono (`printed`, else `signed`) | ✅ |
| Accent dot ahead of the label + bold label while changed | ✅ |
| ↺ dimmed at rest, accent once changed — never hover-only | ✅ |
| Double-click the row to reset (double-tap on the label line) | ✅ |
| `swatch` chip (a mixer band's hue) | ✅ |
| `reset` value other than 0 (gamma 1, Blending 50, Detail 25, a kelvin's as-shot step) | ✅ |
| Shift + arrow steps ten | ✅ `.onKeyPress` |
| Haptic when the value lands on its default (drag through it, ↺, double-tap) | ✅ native addition (`.sensoryFeedback`) |

## `DevelopSlidersSection` — `DevelopSliders.tsx`

| Control | |
| --- | --- |
| Light (exposure, brightness, contrast) · Tone (highlights, shadows, whites, blacks) · Colour (temperature, tint, saturation, vibrance) | ✅ |
| Ranges / steps from `DevelopRange.of` (±3 EV at 0.05, ±100 at 1) | ✅ |
| Exposure printed `+0.35 EV`, the rest signed | ✅ |
| Each group marked while any field ≠ 0; its hint behind ⓘ | ✅ |
| `foldPrefix` (`layer.`) keeping a layer's folds apart | ✅ |

## `DevelopCurveSection` — `DevelopCurve.tsx`

| Control | |
| --- | --- |
| Luma · RGB · R · G · B switch, a `·` on a shaped channel | ✅ |
| The picture's histogram behind (`histogramShape`) | ✅ |
| Diagonal and quarter grid | ✅ |
| Spline SAMPLED from `makeCurve` (96 steps), in the channel's own ink | ✅ |
| Control points; the grabbed one larger, in the channel ink | ✅ |
| Press on a point grabs it; press elsewhere adds one (`addCurvePoint`) and grabs it | ✅ |
| Drag moves it, penned by its neighbours; an end dragged in sets a black/white point (`moveCurvePoint`) | ✅ |
| Double-click a point drops it, the last two stay (`removeCurvePoint`) | ✅ double-tap |
| Readout: the grabbed point `in 64, out 80`, else `N points`, else `straight` | ✅ |
| Reset {channel}; Reset all (with more than one channel shaped) | ✅ |
| The live curve held under the hand while a drag lasts | ✅ |
| Folded by default, marked while any channel is shaped, `foldPrefix` | ✅ |
| Accessible name `Luma curve, N points` | ✅ (+ each point's in/out as the value) |
| Per-point hover tooltip (`<title>`) | ⏳ no hover on a phone; the readout line says the grabbed point |

## `DevelopLevelsSection` — `DevelopLevelsSection` in `DevelopAuto.tsx`

| Control | |
| --- | --- |
| Black / Gamma / White, codes 0–255 shown, [0,1] stored; gamma 0.1–10 at 0.01, `1.00` printed | ✅ |
| Black and white never cross (1/255 apart) | ✅ |
| Reset levels (master only), R/G/B levels kept | ✅ |
| Folded by default, marked with any channel set | ✅ |
| Per-channel (R/G/B) levels by hand | ⏳ the web's own decision: master only, the curve's R/G/B are the tool; carried untouched |

## `DevelopMixerSection` — `DevelopMixer.tsx`

| Control | |
| --- | --- |
| Treatment Colour · B&W at the head of the section | ✅ |
| Colour: Hue · Saturation · Luminance switch, `•` on a moved channel | ✅ |
| Eight band sliders with their `hsl(centre 75% 52%)` swatch (`withMixerValue`) | ✅ |
| Reset {channel} (when moved) · Reset mixer | ✅ |
| B&W: title B&W mix, always marked, eight lights (`withMonoValue`), Reset mix | ✅ |
| Colour mixer kept while B&W is on | ✅ (the kernel's `mono` / `mixer` are separate records) |
| V switches the treatment | ⏳ the workbench's key — the shell binds it (help says "(V)") |

## `DevelopGradingSection` — `DevelopGrading.tsx`

| Control | |
| --- | --- |
| Shadows · Midtones · Highlights side by side, Global beside Blending / Balance | ✅ |
| Wheel: hue circle (red at the right, clockwise) under a grey fading to the rim | ✅ |
| Drag sets hue + strength (`wheelPoint`); puck at `pointOnWheel` in its own colour | ✅ |
| Double-click clears the colour, keeps the hue | ✅ double-tap |
| ←/→ turn, ↑/↓ strengthen, Shift ×10 | ✅ `.focusable` + `.onKeyPress` |
| `h° · s` under the wheel, `—` with no colour; label bold when set | ✅ |
| Light slider per wheel | ✅ |
| Blending (reset 50, printed plain) · Balance | ✅ |
| Blending / Balance kept as a draft while no wheel moves | ✅ (`@State`; the shell gives the section `.id(picture.id)`) |
| Reset grading; marked while a wheel moves; folded by default | ✅ |
| VoiceOver adjustable action on a wheel (strength ±5) | ✅ native addition |

## `DevelopAutoSection` — `DevelopAutoSection` in `DevelopAuto.tsx`

| Control | |
| --- | --- |
| Auto tone → `autoTone` into Levels; `auto tone · black 8 · white 246 · gamma 1.10` / `nothing to stretch` | ✅ |
| Auto colour → `autoColour` into temperature + tint (one write); `already neutral`; `· as far as the sliders reach` on a clamp | ✅ |
| Both disabled until the picture is read, saying so | ✅ |
| Pick grey / Pick… armed (the eyedropper, via `onPicking`) | ✅ — the stage reads the pixel and solves `whiteBalanceFor` |
| Not foldable; hint behind ⓘ | ✅ |

## `WhiteBalanceSection` — `src/tools/develop/WhiteBalancePanel.tsx`

| Control | |
| --- | --- |
| Drawn only on a develop on the sensor (`isRawDevelop`) | ✅ |
| Preset menu: As shot · the six Lightroom presets `Daylight · 5500 K` · Custom when it is one | ✅ |
| Temperature on a LOG scale 2000–50000 K over 1000 steps, printed `6500 K`, reset to as shot | ✅ |
| Tint −150…150, reset to as shot's | ✅ |
| Every value through `wbMatrix`, stored as `rawWb` with its matrix | ✅ |
| `as shot 6506 K, tint +10` line; As shot link | ✅ |
| No camera white from the decoder: the section SAYS so, and names a stored `rawWb` with As shot | ✅ native addition — `CIRAWFilter` hands out no `cam_mul`/`rgb_cam` yet |
| The stored matrix actually rendered | ⏳ the stage's job (`DevelopSettings.unrenderedStages` still lists `rawWb`) |

## `DevelopBaseChip` — `DevelopBaseMenu` in `DevelopBase.tsx`

| Control | |
| --- | --- |
| Trigger: the file's name + the fidelity chip (`pictureFidelity`) + ▾ | ✅ |
| Plain text, no menu, with one choice or none | ✅ |
| Proxy row, delivered rows (`renditionsOf`), each with `renditionFacts` and its sentence | ✅ |
| Blocked row listed, disabled, saying why | ✅ |
| Row not in hand: `— fetched from its instance and held for this session` | ✅ |
| Sensor rungs nested: `DJI_0101.DNG → Gain`, `→ Gain map`, `→ Gain map + warp` with `BASE_ADDS` | ✅ |
| Marked row (checkmark), its status while fetching / decoding, `metered +0.7 EV` / `at its white` | ✅ |
| `opens X from its instance · 74.0 MB, held for this session` before the sensor is fetched | ✅ |
| `this file asks for …` calibration footer | ✅ |
| Convenience init straight from `CaptureFacts` + `FidelityFile` (+ `rungsFor`) | ✅ native addition |

## `DetailSection` + `PresenceSection` — `DetailPanel.tsx`

| Control | |
| --- | --- |
| Noise: Luminance, Colour; two paragraphs behind ⓘ (the hint and the scale note) | ✅ |
| Fringing: Defringe, not foldable | ✅ |
| Sharpen: Amount, Radius (`1.2 px`, reset 1), Detail (reset 25), Masking | ✅ |
| Show the mask / Hide the mask (via `onMaskView`) | ✅ |
| `describeDetail` of this tab + Reset of this tab's keys only | ✅ |
| Stored as nil once nothing moves | ✅ |
| Presence: Texture, Clarity, Dehaze on the Adjust tab, over the same record | ✅ |

## `VignetteSection` — `VignettePanel.tsx`

| Control | |
| --- | --- |
| Amount, Midpoint, Roundness, Feather, Highlights with `postVignetteRanges` and the record's defaults as resets | ✅ |
| Midpoint / Feather / Highlights printed plain, Amount / Roundness signed | ✅ |
| Stored as nil at Amount 0; Reset vignette; folded by default, marked | ✅ |

## `DevelopHistogramView` — `DevelopHistogram.tsx`

| Control | |
| --- | --- |
| Three channel areas (`channelShapes`), screen-blended, on the frame | ✅ |
| Clip bars at each end, lit only when detail is lost | ✅ |
| `blacks 2.1 %` / `blacks —`, `whites …` in the info / accent ink | ✅ |
| The two ends as the clipping switch, underlined while on, `(J)` in the help | ✅ |
| The pixel under the pointer between them, `before · ` on the left of the wipe, a clip in its ink | ✅ (`ReadoutStore`, its own subscribed line) |
| J toggles the clipping | ⏳ the workbench's key — the shell binds it to the same callback |
| Accessible description | ✅ |

## Deferred, in one list

1. Title hover tint on the Mac — cosmetic.
2. Controlled fold — unused by Develop.
3. Per-point hover tooltip on the curve — hover only.
4. Per-channel levels by hand — the web's own decision.
5. V (treatment) — the shell's key.
6. The stored `rawWb` matrix rendered — the stage.
7. J (clipping) — the shell's key.
8. `Palette.info` is not a token yet: `Palette.developInfo` (in `DevelopControls.swift`) mirrors `--color-info` until `Theme.swift` grows it.
9. Nothing here has run on a device — CI is the first compiler.
