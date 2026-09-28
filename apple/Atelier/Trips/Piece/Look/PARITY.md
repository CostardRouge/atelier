# Trips piece editor — the Look tab — parity with the web app

The piece editor's LOOK tab (map task tools-roadtrip-15) against
`src/tools/roadtrip/panels/LookTab.tsx`, `panels/HookPicker.tsx`,
`PieceStylePanel.tsx` and `ShadesPanel.tsx`. The tab replaces the Look stand-in
of `Trips/Piece/PendingTabs.swift` under the same name and initialiser,
`LookTabView(model:)`.

- `LookTabView.swift` — the tab and its sections (the title style, this piece,
  the cascade, the placement, the shades);
- `OpenerPickerView.swift` — the opener's cards, the host of the variant's
  options and of its picture chooser;
- `PieceStyleRows.swift` — one piece's departures and the animation step rows
  (the web's `StepRows`), shared with the cascade;
- `ShadesPanelView.swift` — the stack of shades, one row per shade, the
  direction grid, the centre;
- `ShadeGlyphs.swift` — a direction's gradient and a falloff's curve;
- the kernel's `Roadtrip/PieceLook.swift` (+ `PieceLookTests.swift`, 24
  specs) — the tab's pure writes, which the web keeps inline in its components:
  an anchor's default position, absent against `null` in a piece's
  departures, the cascade's still step, a hand-picked cell demoting Anchor to
  Edge, the follow flags, a falloff drawn from the renderer's own stops.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's. Nothing here was run on a device: this
container has no Apple toolchain, so every view was written against the SDK and
compiled by CI alone; the kernel half ran here (Linux, 24 specs green).

Rows: 64 ✅ · 7 ≠ · 0 ⏳

## The tab (`LookTab.tsx`)

| Web | Native | |
|---|---|---|
| The opener FIRST, on the hook only — it decides what the hook is | `LookTabView`: "Opener" section above everything, `isHook` only | ✅ |
| The title style on every slide (it belongs to the whole trip) | `LookTitleStyleSection`, outside the hook branch | ✅ |
| On the hook: This piece · Cascade · Placement · Shades | four sections, in the web's order | ✅ |
| Elsewhere: "This slide" — "A caption and the closing card keep a fixed look; per-piece styling, placement and shades belong to the badge on the hook." | a section that does not fold, the sentence verbatim | ✅ |
| Every standing paragraph behind an ⓘ | `DevelopSection(info:)`, each section's own words | ✅ |
| A section's fold remembered | per device (`remember: .local`, every inspector's rule but Develop's) | ✅ |
| Every write through the piece's funnel, one undo step per gesture | `patchBadge` / `changeTrip` under `post:<id>` | ✅ |

## The opener (`HookPicker.tsx`)

| Web | Native | |
|---|---|---|
| Cards, never a dropdown — one per registered variant, in the registry's order | `OpenerPickerView` over the kernel's `hookVariants` | ✅ |
| A card: the variant's own sketch in a 4.6 × 2.2 rem box on the frame's ground, its name, its tagline | `OpenerCard`: `OpenerSketchView(variantId:)` in a 74 × 35 box on `palette.frame` | ✅ |
| A variant this piece cannot feed is greyed WITH the reason in place of its tagline, and cannot be picked | `hookUnmet(variant, ctx)` → the reason in accent ink, `.disabled`, 55 % | ✅ |
| The chosen card in the accent line and wash, `aria-pressed` | accent stroke + wash, the `isSelected` trait | ✅ |
| A click writes the FIRST layer only; the card already chosen keeps its settings | `setHookVariant` | ✅ |
| The variant's own panel under the cards; the badge has none | `OpenerOptionsView(model:)` for every variant but `defaultHookId`; an id this build does not know shows none | ✅ |
| The picker hosts the picture chooser a panel asks for (`host.choosePictures`) | `\.chooseOpenerPictures` in the environment → `OpenerPicturesSheet(model:)` in a sheet, in the darkroom | ≠ the action carries no `selected` / `choice` and resolves nothing: the chooser reads what the opener holds and writes back through the model itself (`OpenerPicturesSheet` takes the model alone) |
| How the opener's pictures are coming along, handed to its panel (`pictureStatus`) | the panel reads `model.hookPictureProblems` itself | ≠ the model is the host; nothing to hand down |
| The garage verb handed to Virée's panel (`configureCar`) | the panel calls `model.configureCar()` itself | ≠ same reason |

## The title style (`StylePanel`, the trip's)

| Web | Native | |
|---|---|---|
| "Title style", tagged Trip, the engine-level panel over `trip.theme`, its own legend hidden | `StylePanelView(theme:heading: nil)` — the Studio's own panel, as the web shares `StylePanel` | ✅ |
| Every card previews its look; picking one adopts it; the knobs tweak the copy | the panel's own (its PARITY is `Studio/Panels/PARITY.md`) | ✅ |
| A change is the TRIP's (`onChangeTrip`) | `changeTrip { $0.theme = … }` | ✅ |
| Words: "The trip’s words and closing card…" opens ⚙ Trip | `model.tripSheet = "words"` → `TripSettingsSheet(section: "words")` | ✅ |

## This piece (`PieceStylePanel.tsx`)

| Web | Native | |
|---|---|---|
| The piece in hand — chosen above the tabs or by a click on the stage | `model.piece`, the inspector's piece picker above | ✅ |
| "Back to the trip’s" in the header, only while the piece departs (any key written, a `null` included) | the section's action, `pieceStyleDeparts`; writes `{}` | ✅ |
| — | the header also wears the accent dot while the piece departs, so a folded section never hides it | ≠ the Develop inspector's rule, added |
| Case: As-is · UPPER · lower | a segmented picker; applied to the STRING by the kernel's `badgeElements` | ✅ |
| Ink · Background · Border: a switch decides the colour exists, the swatch owns it; off writes `null`; fallbacks `#ffffff` · `#d9442a` · `#ffffff` | `PieceOptionalColourRow` — a switch and the system colour well (dimmed while off), `#rrggbb` written | ✅ |
| The panel's rows only with a fill or an outline: Padding 5–120 % (0.3), Corners 0–6 (0.5), Border width 1–25 % (0.06) only with an outline | three `DevelopRangeSlider`s, the web's ranges, steps and fallbacks | ✅ |
| Each value departs by writing it; the element builder PINS that key in `styleOverrides` | the kernel's `badgeElements` (ported) | ✅ |
| Entrance / Exit: None · Fade · Slide · Scale · Typewriter · Wipe | `PieceStepRows`, the badge's own words | ✅ |
| None clears the step; a first preset starts from a plain half-second fade; another keeps the step's knobs | `pieceStepWithPreset` | ✅ |
| An animation with neither end left is written `null`; each end keeps the other | `pieceStyleEntrance` / `pieceStyleExit` | ✅ |
| Duration 0–2 s step 0.05, "0.50 s" | as the web | ✅ |
| Delay 0–2 s, the entrance only | as the web | ✅ |
| Easing: every curve of the one registry, the overshooting ones "— overshoots", `steps` "— in jumps" | `OverlayPanels.easingLabel` over `easingIds` | ✅ |
| Steps 2–12 under the stepped curve | as the web | ✅ |
| From: up · down · left · right, under Slide | as the web | ✅ |
| A range field shows its value, no reset | `DevelopRangeSlider`: the value, and a ↺ back to the web's own fallback | ≠ one slider for the whole app (`DevelopControls.swift`) |

## The cascade

| Web | Native | |
|---|---|---|
| "Cascade", tagged "on" while set, the two paragraphs behind ⓘ | as the web | ✅ |
| "Cascade the pieces": on writes the default cascade (slide up 5 %, 0.5 s, out-cubic, 0.12 s, sequence), off writes `null` | `defaultCascade()` / nil | ✅ |
| One entrance for the whole badge: the step rows WITHOUT Delay | `PieceStepRows(hideDelay: true)` | ✅ |
| None keeps the cascade on with a step that does nothing | `cascadeWithStep` → `cascadeStillStep` | ✅ |
| Order: "Sequence — In their own order" …; Random draws its seed once, kept after | `staggerOrders` + `OverlayPanels.staggerOrderLabel`, `sceneStaggerOrdered` | ✅ |
| Each: 0–0.60 s step 0.01, "0.12 s" | as the web | ✅ |
| Shuffle again (Random only) draws a new seed | `newStaggerSeed()` | ✅ |

## The placement

| Web | Native | |
|---|---|---|
| The 3×3 anchor grid; picking an anchor MOVES the block to that anchor's default position (x 0.07 / 0.5 / 0.93, y 0.08 / 0.5 / 0.92) | `OverlayAnchorGrid` + `badgeLayoutAnchored` (kernel, specced) | ✅ |
| Numeral 5–40 % step 0.5 % | as the web | ✅ |
| Duration 1–15 s step 0.5, "How long the hook lasts — what an exit animation lands on." | as the web | ✅ |
| "…drag the badge on the picture to place it exactly — hold Alt to skip the snap." | "hold Option to skip the snap" on the Mac; the clause is dropped on iPhone and iPad | ≠ the stage reads Option on the Mac only (`BadgeStagePointer.optionHeld`); a touch screen has no modifier to hold |

## The shades (`ShadesPanel.tsx`)

| Web | Native | |
|---|---|---|
| "Shades" + its sentence behind ⓘ | as the web | ✅ |
| No shade: "The picture is untouched. Add a shade where the type needs help — a bright sky exactly under the hook is the normal case." | as the web | ✅ |
| A row per shade: the switch ("Bypass shade n" / "Enable shade n"), "Shade n", its colour, remove | `ShadeRowView`'s header | ✅ |
| Off: the row dims to 60 % behind its left rule; its sliders grey | as the web | ✅ |
| From: a 3×3 grid, each cell the gradient it draws (the web's CSS gradients) | `ShadeDirectionGrid` + `ShadeGlyphButton` (`ShadeGlyph`, SwiftUI gradients on the same stops) | ✅ |
| The centre cell shows the centre shape in use; its three shapes (radial, the two bands) in a column beside the grid while the centre is the cell | as the web | ✅ |
| The hint names the direction, "— where the badge is anchored." under Anchor | `shadeShownDirection` + `shadeDirections`' labels | ✅ |
| Picking a cell by hand while anchored drops to Edge | `shadeDirectionPicked` | ✅ |
| Strength 0–100 % step 2 % | as the web | ✅ |
| Reach — Radius for the radial and the corners — dead on a top or bottom shade following the badge | `shadeIsRound`, `reachFollowsBadge` | ✅ |
| Core 0–90 %, "Full strength over n % of the reach/radius, then the fade." | `maxShadeCore`, `shadeCore` | ✅ |
| Falloff: five buttons, each drawn from the very stops the renderer gets; the chosen one's hint | `ShadeFalloffButton` over `shadeFalloffStops` | ✅ |
| Centre, for a band or a radial not following the badge: "Place on the picture" / "Done placing" (primary while placing) | `ShadeCentreRow` → `model.placeShade(_:compact:)` | ✅ |
| While placing: "Press or drag on the picture to move the centre" (band: "the band"); on a phone the inspector sheet steps aside | the model drops the sheet (`inspectorOpen = false`) and drops a stale placing on any change | ✅ |
| The across / down sliders (a band on its own axis), "50 % →", "50 % ↓" | "Across" / "Down" rows | ≠ a native slider row carries a name; the web's are unlabelled |
| "Back to the middle" once moved | `shadeCentred`; writes `center` absent | ✅ |
| Invert | as the web | ✅ |
| Follow badge: No · Edge · Anchor, the choice's title as its hint | a segmented picker, `shadeFollowing` (both flags written) | ✅ |
| Add: + Shade · Under the hook · Vignette (45 %) | `createShade()`, `createShade(followHook: true)`, `vignetteShade(0.45)` | ✅ |
| At four: "Four is the limit — past that it stops being a treatment." | `maxShades` | ✅ |
| A shade removed while its centre is being placed | placing stops with it | ✅ |
| The stage draws the centre's line or cross while placing | `BadgeStageChrome.drawShadeHandle` (landed with the stage) | ✅ |

## Once deferred, now built

| What | Built as | |
|---|---|---|
| The variant sketches, the options panels (Défilé's stops, the Itinerary's map, Virée's drive and "Configure the car…") and the picture chooser | `OpenerPickerView` hosts them by name — `OpenerSketchView`, `OpenerOptionsView`, `OpenerPicturesSheet` (`Piece/Openers/`, its own table); `PendingOpeners.swift` is gone | ✅ |
| The core's `Trips/Piece/PARITY.md` row "Look tab … ⏳" | flipped: `Look tab … LookTabView` reads ✅ there | ✅ |
