# Studio panels — parity with the web app

The overlay engine's EDITING PANELS (`src/shared/overlay/ElementPalette.tsx`,
`ElementList.tsx`, `ElementPanel.tsx`, `StylePanel.tsx`, `TimingPanel.tsx`,
`ScenePanel.tsx`, `GuidesControl.tsx`, and the Studio's own
`src/tools/studio/OutroPanel.tsx` and `InfoPanel.tsx`) against this folder.
✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

These are PURE views over `Binding`s to the kernel's overlay types and plain
callbacks — no store. The Studio shell places them (in `DevelopSection`s, the
way the web's editor wraps them in `InspectorSection`s) and owns the document,
the selection, the playhead and the undo history. Everything a panel computes
— a cell's words, a pinned override, a window that must not cross, a QR's
first placement, the cadence sentence — is the kernel's
`Overlay/OverlayPanels.swift`, spec'd in `OverlayPanelsTests.swift` (30 cases,
green on Linux), so the views are controls over it and nothing else.

Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK and compiled by CI alone.

Rows: 93 ✅ · 11 ≠ · 2 ⏳ — plus three deferrals that are the shell's, not a panel's (keyboard, undo, a device run), listed at the end.

## Shared controls (`OverlayPanelControls.swift`)

| Web (`src/shared/ui/Inspector.tsx`) | Native | |
|---|---|---|
| `FieldRow` — label column, control, hint under it | `OverlayPanelRow` (84 pt label column), `OverlayPanelHint` | ✅ |
| `RangeField` — slider + printed value | `DevelopRangeSlider`, the app's ONE slider (web ranges, steps, printed values); it adds Develop's reset ↺ to the creator's default and a haptic on landing there | ≠ |
| `SelectField` / `NativeSelect` | `OverlayPanelPicker` / `OverlayPanelMenu`, a native menu picker | ✅ |
| `ToggleField` (switch + words) | `OverlayPanelToggle` | ✅ |
| `SwitchRow` (label + switch + hint) | `OverlayPanelSwitch` | ✅ |
| `NumberField` (typed, `onClear` when emptied, unit inside) | `OverlayPanelNumberField`: commits as typed, empty calls `onClear`, unit beside, a stepper on the Mac, a comma read as a decimal point | ✅ |
| `TextField` | `OverlayPanelTextInput` / `OverlayPanelTextField` | ✅ |
| `<input type="color">` (writes `#rrggbb`) | `ColorPicker` reading the CSS string through `CSSColor`, writing `#rrggbb` | ✅ |
| `Readout` (the hex beside a swatch) | `OverlayPanelColourRow(readout:)` | ✅ |
| `Button variant="ghost" / "danger"` | `DevelopLinkButtonStyle` / `OverlayPanelDangerButtonStyle` | ✅ |

## Add an element (`ElementPaletteView.swift`)

| Web | Native | |
|---|---|---|
| Foldable, never a dropdown; fold state owned by the caller (`open` / `onOpenChange`) | `isOpen: Binding<Bool>` | ✅ |
| `bare`: the host draws the header | `bare: true` | ✅ |
| "Add an element" header with a chevron | ✅ accent ink, the whole line toggles | ✅ |
| Groups Intro · Flight · Camera · Time · Instruments · Shapes, mono uppercase legend | the kernel's `paletteGroups` | ✅ |
| Three cells per row | `LazyVGrid`, three flexible columns | ✅ |
| A cell IS its constructor (`elementFor`); a press adds a FRESH element | `OverlayPanels.paletteElement`, `onAdd(el)` | ✅ |
| Cell name, parenthetical dropped ("Clock (HH:MM:SS)" → "Clock") | `paletteItemName` | ✅ |
| Placed count: `•` for one, the number for more; tooltip "Add another X (n already on the frame)" / "Add X" | ✅ `.help` + accessibility label | ✅ |
| An intro cell counts nothing and says where it lands (`intro`, `+0.5s`) | `paletteTimingHint` | ✅ |
| A telemetry cell previews the LIVE value at the playhead, or the label / field name when the cue has none — never a fabricated reading | `palettePreviewText` | ✅ |
| The project's time shift reaches the Clock cell | `timeShift` | ✅ |
| The preview wears the theme (font, weight, case, spacing, colour, glow) | ≠ painted by the REAL renderer (`OverlayElementPreview` → `OverlayPainter`), where the web approximates in CSS (`previewTextStyle`) — the cell shows the legibility and the full glow too | ≠ |
| Shape cells draw a glyph (arrow, tape with its sight colour, battery, corners, the phone mid-turn) with the glow as a drop shadow | the web's own SVG paths, in SwiftUI `Canvas` | ✅ |
| Dark 2rem stage, edges faded so a long readout says "there is more" | 32 pt `frame` stage, gradient mask | ✅ |
| Hover: border takes the accent | ✅ press and hover | ✅ |
| Drag a cell onto the frame | ⏳ the web adds by click too; a `.draggable` cell waits on the Studio stage's drop target | ⏳ |

## Elements (`ElementListView.swift`)

| Web | Native | |
|---|---|---|
| One row per element in the deck's order (the draw order) | ✅ | ✅ |
| Eye toggles visibility (`◉` / `○`), titled Hide / Show | ≠ an `eye` / `eye.slash` symbol — a layer's visibility is an eye (`develop-roll.md`) | ≠ |
| Preview: the text the stage draws at this cue, `(empty)` for silence; shapes by name | `OverlayPanels.listRow` | ✅ |
| Mono tag: glyph for a shape, `TXT`, else the field key (uppercase) | ✅ | ✅ |
| Hidden element struck through, faint | ✅ | ✅ |
| Selected row on the accent wash; hover on paper-2 | ✅ | ✅ |
| Tap selects | ✅ | ✅ |
| × on hover with a pointer, ALWAYS and finger-sized on touch | ✅ 32 pt on iOS, hover or selected on the Mac | ✅ |
| Empty: "No elements yet. Add a telemetry field or text, then drag it onto the frame." | ✅ | ✅ |
| The selected row scrolled into view when the stage selects | every row carries `.id(element.id)` for the host's `ScrollViewReader` | ✅ |
| The legacy page's add row (field dropdown, + Field / + Text / + Arrow / + Corners / Add deck) | ≠ belongs to the retired overlay page; the palette is the Studio's way in | ≠ |
| — | context menu: Hide/Show, Remove; Bring forward / Send backward when the host passes `onMove` (native addition, off by default — the web does not reorder) | ≠ |
| Lock | ≠ not on the web and not in the element model; a lock would be a document field the web does not write | ≠ |

## Element style (`ElementPanelView.swift`)

| Web | Native | |
|---|---|---|
| Under a theme: "Following the project style." / "n properties overriding the style." + Reset all | `overridesSentence`, Reset all writes `[]` | ✅ |
| Controls show the RESOLVED appearance under a theme | `resolveElementStyle` | ✅ |
| Editing an appearance control pins it (font, weight, italic, colour, legibility) | `pinningStyle`, only on growth, the web's Set order | ✅ |
| "Back to theme" dot beside a pinned label | `OverlayThemeResetDot` | ✅ |
| Text: the words | ✅ | ✅ |
| Field menu (every field, its label), Prefix "(none)" | ✅ | ✅ |
| Time field: Clock 24/12-hour, Show AM / PM, Seconds, Milliseconds (timestamp), Date style (six samples) | ✅ only the touched key written (`patchTimeFormat`) | ✅ |
| Time note: "The flight log records a bare wall-clock reading with no timezone…" — no timezone picker | ✅ | ✅ |
| Speed unit m/s · km/h · mph | ✅ | ✅ |
| "Value from the start" on derived readouts and both heading instruments, with its hint | ✅ | ✅ |
| Heading arrow: note, compass ring, orientation (north-up / track-up) when the ring is on | ✅ | ✅ |
| Smoothing 0–3 s (`off`), Heading lost (dim / hold / hide) with its hint, Hold for 0.5–10 s unless hide | ✅ | ✅ |
| Heading tape: note, width, span, labels every, tick every, tick height, edge fade, opacity, sight colour, sight mark, reading, cardinals, baseline rule | ✅ | ✅ |
| Battery: note (`.srt` in mono), Level from (a value I set / a telemetry key), Level 0–100, Key with the probe placeholder and "never invents a level" hint, Cell width, Low colour, Alarm under, Reading (with Hidden) | ✅ | ✅ |
| Frame corners: note, Arm length, Inset; no anchor, no size | ✅ | ✅ |
| Rotate phone: note, Caption, Turn, Phone size, Arrow size, Cycle, Tip back upright, Caption at | ✅ | ✅ |
| Font (not arrow / corners) | ✅ | ✅ |
| Size 1.5–14 % (not corners) — always the element's own | ✅ | ✅ |
| Colour (hex, `#ffffff` when not a hex) | ✅ | ✅ |
| Weight Regular / Medium / Semibold / Bold, Italic (not arrow / corners) | ✅ | ✅ |
| Anchor 3 × 3 grid (not corners), titled with the anchor | `OverlayAnchorGrid` | ✅ |
| Legibility None / Drop shadow / Background box; Box/Shadow colour + Opacity writing `rgba()` | `splitColor` / `rgba` | ✅ |
| Legibility radius and outline (`radiusFrac`, `borderColor`, `borderWidthFrac`) | ≠ the web's element panel has no control for them either (the badge's style panel does, Trips); carried and drawn | ≠ |
| — | a slider's ↺ returns the kind's CREATOR default (`OverlayPanels.freshElement`) | ≠ |

## Timing (`TimingPanelView.swift`)

| Web | Native | |
|---|---|---|
| The clock sentence: in a scene (its name, start, end) or from the clip's in point | ✅ | ✅ |
| Scene: "Take it out" | ✅ | ✅ |
| Window: Timed / The whole clip; on → 0–3 s, or 0 → the scene's end inside one | `timingWindowToggled` | ✅ |
| Appears / Disappears, typed, each with a Playhead button (read in the scene's clock, to hundredths) | ✅ | ✅ |
| Disappears empty = "with the scene" / "end of clip" | `onClear` → `end: null` | ✅ |
| The ends never cross (end ≤ start → start + 0.1 s) | `timingWindow` | ✅ |
| Entrance / Exit preset: Cut · Fade · Slide + fade · Scale + fade · Typewriter · Wipe | ✅ | ✅ |
| Switching on starts from a usable step (0.5 s out / 0.4 s in), never the zero-length Cut | `timingStepChanged` | ✅ |
| A cut writes `null` and keeps the other end | `withTimingStep` | ✅ |
| Duration 0.05–3 s, Curve from the ONE registry (overshooting "— overshoots", steps "— in jumps"), Steps 2–12 | ✅ | ✅ |
| Slide: Direction, Travel 1–40 %; Scale: From / To 20–200 % | ✅ | ✅ |
| Wait 0–5 s on an entrance | ✅ | ✅ |
| "An exit needs an end to play against — give the element a window above." | `timingExitNeedsEnd` | ✅ |

## Intro scene (`ScenePanelView.swift`)

| Web | Native | |
|---|---|---|
| Starts / Ends (typed), Ends' Playhead | ✅ | ✅ |
| A scene never ends before it starts (+0.2 s) | `scenePatched` | ✅ |
| Veil on/off (the default scrim), its colour, Strength 5–100 %, Fade 0–2 s | ✅ | ✅ |
| Cascade on/off with its two hints, Order (label — hint), Each 0–1 s, Shuffle again for random | ✅ a shuffle's seed drawn once | ✅ |
| Solo with its hint; Comes back 0–3 s (`cut`) | ✅ | ✅ |
| Contents: "Nothing in it yet." / "n elements" | ✅ | ✅ |
| Remove the intro — a two-step inline confirm (Remove / Keep) | ≠ a `confirmationDialog`, the platform's destructive verb | ≠ |
| The section's badge `0.0–3.0 s` | `OverlayPanels.sceneBadge` for the host's section | ✅ |

## Outro (`OutroPanelView.swift`)

| Web | Native | |
|---|---|---|
| Preview painted by the export's own renderer at the card's midpoint, 7.5rem wide at the project's ratio | `OutroPainter` in a 120 pt `Canvas` | ✅ |
| Holds for 1–15 s, never under 0.5 | `outroSeconds` | ✅ |
| Ground colour + its hex | ✅ | ✅ |
| Line n: text + remove | ✅ | ✅ |
| + Line (under the lowest, never past 0.92) | the kernel's `withOutroLine` | ✅ |
| QR link, "empty means no QR"; a first link placed centred under the middle, light on the card's ground; the refusal sentence in the danger ink | `outroWithQrUrl`, `prepareOutro().qrProblem` | ✅ |
| Remove the outro (immediate) with its hint | ≠ confirmed first (`confirmationDialog`) | ≠ |
| The section's badge `+ 4.0 s`; "Add an outro" when there is none | `outroBadge`; the Add verb is the host's (`createOutroCard(projectName)`) | ✅ |
| Free placement of the card's elements on a stage of its own | ⏳ deferred on the web too (`MEMORY.md`, 2026-08-25) | ⏳ |

## Guides (`GuidesControlView.swift`)

| Web | Native | |
|---|---|---|
| Safe area Off · TikTok · Instagram Reels · YouTube Shorts · YouTube; picking one goes back to `auto` | ✅ | ✅ |
| Rotate: shows what `auto` resolves to for this frame, pins upright / rotated | `shouldRotateSafeZone` | ✅ |
| Grid show, Divisions cols × rows (1–12), Snap | ✅ divisions as two menus | ✅ |
| Snap hint "…hold Alt to bypass" | ≠ "hold Option" on the Mac; no modifier named on a phone, which has none | ≠ |
| `layout="rows"` and `layout="toolbar"` (capsules with icons and their tooltips) | `.rows` / `.toolbar` | ✅ |

## Info (`InfoPanelView.swift`)

| Web | Native | |
|---|---|---|
| Clip / Photo section: Name, Size, Detail | ✅ | ✅ |
| Clip: Duration, Cadence (measured, overridden "set by hand", or "plays at n fps · shooting cadence not measurable"), Flight summary | `infoCadence`, `infoFlight` | ✅ |
| Photo: Camera, Lens | `infoCamera`, `infoLens` | ✅ |
| Photo: Exposure (EXIF) and Place and time (EXIF) through the ONE cue; "No EXIF in this file." | ✅ | ✅ |
| Clip: Flight and Camera "At playhead"; "No flight log (.srt) with this clip…" | ✅ | ✅ |
| A missing value reads `—`, faint | ✅ | ✅ |
| Sections remember their fold on this device | `DevelopSection(remember: .local)` | ✅ |
| Values selectable | ✅ `.textSelection` (native addition) | ✅ |

## Deferred, and what each waits on

- ⏳ Dragging a palette cell onto the stage — the Studio stage's drop target.
- ⏳ The outro's own stage — deferred on the web too.
- ⏳ Keyboard: Delete removes the selected element, Space plays — the Studio
  shell's `.keyboardShortcut`s, not a panel's.
- ⏳ Undo — the shell's `History` store + `UndoManager`; every panel writes
  whole values through its binding, which is what that store watches.
- ⏳ Running any of it on a device.
