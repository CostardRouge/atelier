# Trips piece editor — the PICTURE tab and its develop sheet — parity

The Picture tab of the piece editor and the Develop sheet it opens, against
`src/tools/roadtrip/panels/PictureTab.tsx`, `panels/LayoutSection.tsx`,
`panels/CollageMotionSection.tsx`, `FrameStrip.tsx`, `panels/PanZoomSection.tsx`,
`panels/MotionCards.tsx`, `panels/TourMap.tsx`, the Picture-tab half of
`PostEditor.tsx` (the card verbs, the quick moves, the map's verbs, the
develop sheet's wiring) and `shared/develop/DevelopSheet.tsx` as Trips opens
it: map tasks tools-roadtrip-17 and -18.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's unless a row says otherwise. Nothing
here was run on a device: this container has no Apple toolchain, so every
view was written against the SDK, parsed here (`swiftc -parse`) and compiled
by CI alone.

Rows: 95 ✅ · 6 ≠ · 2 ⏳

## Files

| File | What |
|---|---|
| `PictureTabView.swift` | the tab (`PictureTabView(model:)`) and its Picture section (`PiecePictureFileSection`) |
| `PieceEditorModel+Picture.swift` | the verbs the tab calls: the in point, `pictureFrameBox` / `presetBox`, the quick moves, the card verbs, the map's verbs, `cardThumb` |
| `PieceFrameStrip.swift` | the in-point filmstrip |
| `PieceLayoutSection.swift` | Layout: the shelf, the spacing, Behind, the cell stepper, Kept |
| `PieceCollageMotionSection.swift` | a collage's Motion (Arrive / Leave) and its step rows |
| `PieceFramingSection.swift` | Framing |
| `PiecePanZoomSection.swift` | Pan & zoom: the move, the cards' verbs, Pause, the quick moves, the tour, the travel |
| `PieceMotionCardsRow.swift` | the row of cards |
| `PieceTourMap.swift` | the map, and the Mac's wheel over it |
| `PieceFormatSection.swift` | Format |
| `PieceGradeSection.swift` | Grade and the rung chips (`PieceGradeScopeChips`) |
| `PieceDevelopSheet.swift` | the develop sheet (`PieceDevelopSheet(model:)`): the cell's decode, the draft, the grade and the column — its picture side (the bar, the stage, the caption, the keys) is the shared `Develop/Sheet/` |

## The Picture section (`PiecePictureFileSection`)

| Web | Native | |
|---|---|---|
| File: the selected cell's file, else (one picture) the slide's own ref's name, else "None", muted with no file | the same, from `cellRef` and the slide's ref | ✅ |
| No file: "It lives on <instance> — fetching it back…" / "Not in the Library right now. The slide keeps its place in the deck." | the same, from `recovery` / `missing` | ✅ |
| A fetch that failed: the reason in red and "Sign in there" | the reason in `danger`, `Link("Sign in there")` to the instance's login | ✅ |
| "Tick a photo or a clip in the Library on the left." | "Tick a photo or a clip in the Library." | ≠ the Library is a sheet on a phone, never on the left |
| The ⓘ: the slide composes over the Library's tick; the connected instance's tab lists this piece's own day — said only when there is one | the same, the instance named by `shortHost` of the first connection | ✅ |
| The closing card: "carries no photograph: a flat ground is what keeps the QR readable…" | the same sentence | ✅ |
| A clip's In point on a filmstrip: it moves the in point and keeps the slide's length (the band makes the cut and picks the speed) | `PieceFrameStrip` → `setInPoint` (the hook's badge, or the content slide) | ✅ |
| The strip's cell count suits its measured width | `stripCount` over the GeometryReader's width | ✅ |
| A cell samples the MIDDLE of its slice; cells stream in as they decode; leaving ends the decode | `filmstrip(source:count:maxSize:)` (`AVAssetImageGenerator`), `.task(id:)` | ✅ |
| The drag throttled to one change per animation frame | one write per display frame (16 ms), the latest moment winning | ✅ |
| Held a hair short of the end — a seek past the last frame never lands | `timeFromPointer` | ✅ |
| The handle clamped whole at both ends, eased when not dragging | clamped offset, eased unless dragging or Reduce Motion | ✅ |
| ← / → nudge, Shift jumps, Home / End | `.onKeyPress` over `keyStep` while the strip has focus | ✅ |
| `role="slider"` with its value in seconds | an adjustable accessibility element ("Frame of the clip", "2.40 seconds") | ✅ |
| Blob URLs revoked on the way out | — nothing to revoke: the cells are `CGImage`s | ✅ |

## Layout (`PieceLayoutSection`)

| Web | Native | |
|---|---|---|
| "One" and every template, grouped, 4 across, each tile drawn by the real solver at 26 × 46 | `PieceLayoutShelf` / `PieceLayoutGlyph` over `resolveLayout` | ✅ |
| A tile's title: `<name> · <n> cells` | `.help` | ✅ |
| Badge `<layout> · <count>`; "One picture" in the header hands the frame back to the lead | the same; `setCollage(nil)` + `selectCell(0)` | ✅ |
| A new layout never loses a picture (`retemplateCollage`); a cell past the new count hands the inspector to the lead | the same | ✅ |
| Gap 0–6 %, Padding 0–10 %, Corners 0–8 %, step 0.2 %, not on a free layout | three `DevelopRangeSlider`s | ✅ |
| The spacing sliders have no reset | each carries the app's ↺ back to `defaultLayoutSpacing` | ≠ the app has ONE slider row, and it always carries its ↺ |
| Behind: six grounds (Frame black, Ink, Paper, Surface, Sand, Vermilion), "Shows between the cells and in an empty one." | swatches, the picked one ringed | ✅ |
| Cell: ‹ `i of N` › and the cell's file (or "Empty") | `PieceLayoutCellRow` | ✅ |
| "Use the ticked picture" (disabled with nothing ticked, or when it is already there) / "Empty this cell" | the same, `useActiveInCell` / `clearCell` | ✅ |
| The cell's hint: its own fetch, else "The first cell is this slide’s own picture — the Library follows it." / "The Library follows the selected cell…" | the same | ✅ |
| One status line for the collage's fetches | `refetchSummary` | ✅ |
| Kept: `cell n · <name>` chips, "Not drawn by this layout; a bigger one brings them back." | the same | ✅ |
| The ⓘ: tap / drag / hold / Option-drag on the stage; a picture dragged from the Library onto a cell | the same words, "hover" kept for the Mac | ✅ |

## A collage's Motion (`PieceCollageMotionSection`)

| Web | Native | |
|---|---|---|
| Badge "video" when the cells arrive or leave; the ⓘ with the slide's seconds | the same | ✅ |
| Arrive: "The cells arrive" → the default entrance | `defaultCollageEnter()` | ✅ |
| The entrance's rows: preset (None · Fade · Slide · Scale · Typewriter · Wipe), Duration 0–2 s, Easing (every curve, "— overshoots" / "— in jumps"), Steps, From (a slide's direction) — no Delay | `PieceCollageStepRows` over `OverlayPanels.easingLabel` | ✅ |
| Inside, for a slide or a scale only | "Move the picture inside its cell" | ✅ |
| Order with each order's hint; Random draws a seed ONCE | `staggerOrders`, `newStaggerSeed()` when none | ✅ |
| Each 0–0.6 s; "Shuffle again" on Random | the same | ✅ |
| Leave: "The cells leave" mirrors the entrance when there is one; "Mirror the entrance" | `mirroredExit` / `defaultCollageExit()` | ✅ |
| The exit's rows; "Leave in reverse order" | the same | ✅ |

## Framing (`PieceFramingSection`)

| Web | Native | |
|---|---|---|
| Badge "Cell n" on a later cell of a collage | the same | ✅ |
| The rows show the framing AS SHOWN — the card in hand — and write through the one writer | `shownFraming(…, own: true)` → `placeFraming(cellIndex, …)` | ✅ |
| Fit: Fill \| Whole; a new fit starts centred at 1× | a segmented picker | ✅ |
| Zoom 1…8 (`1.00×`), Rotation −180…180 step 0.5 (`12°`) | two `DevelopRangeSlider`s | ✅ |
| Turn: −90° / +90° / Straight (disabled when straight) | the same, through `wrapDegrees` | ✅ |
| Flip: Horizontal / Vertical — the rest AND every frame of the move | `flipPicture(cellIndex, axis:)` | ✅ |
| Reset, only when the picture departs from its fit's start, back to the default INSIDE the fit | the same | ✅ |
| The ⓘ: gestures, Fill vs Whole, the flips; a linked Studio project frames its reel there | the same, "pinch" named first | ✅ |

## Pan & zoom (`PiecePanZoomSection`, `PieceMotionCardsRow`, `PieceTourMap`, `+Picture`)

| Web | Native | |
|---|---|---|
| Move: Play / Pause the slide from its first frame (disabled while still); `n cards` or "Holds still"; "Hold still" | `playMove`, `setMotionFromSection(nil)` | ✅ |
| The row: one card per frame the view rests on, drawn through `drawFramed` from ONE picture decoded within 0.5 MP, ungraded | `PieceMotionCardsRow` / `PieceCardThumbnail` over `CellPainter.drawFramed` | ✅ |
| The card's width follows the frame's shape (40–132 at 84 high) | the same arithmetic | ✅ |
| Glide seconds on each arrow; `hold n s` under each card but the last | the same | ✅ |
| The picked card ringed and scrolled into view | `ScrollViewReader` | ✅ |
| A still picture: one card with a dashed Start ghost — a starter move ×1.15 on the same point, landing on Start | `starterMotion` → `setMotionFromSection` | ✅ |
| Another file's picture never drawn under this one's cards; a picture that cannot be drawn leaves them dark | the decode is keyed on the file and the moment; nothing is shown until it lands | ✅ |
| A tap on a card: the stage shows it, the needle goes to its arrival | `selectCard` | ✅ |
| + Stop (a card after the picked one, a touch closer), refused at `maxCards` with the sentence; Remove, never End; "The needle is between two cards…" | `addCard` / `dropCard` over `insertCard` / `removeCard` | ✅ |
| Pause 0–2 s, disabled with "A pause needs a second card." | `setHold` over `cardsMotion` | ✅ |
| Six quick moves, 3 across, each disabled with its reason, the reasons listed under them one line per reason naming its buttons | `motionPresetRows` over `presetProblem`, `presetHint` | ✅ |
| A quick move writes Start and End, picks Start and plays | `writePreset` over `applyPreset` | ✅ |
| The preset box: the picture's shape from the FILES in hand, the frame (or the cell) at a nominal 1080 | `presetBox` over `pictureSizes` and `pictureFrameBox` | ✅ |
| Tour: "Plan a tour…" / "Close the map", disabled "The picture is still being read"; `n stops` | the same | ✅ |
| The map: every card's window (four corners, turned with the picture), the path dashed, each dot numbered, the picked one in the accent | `PieceTourMap` over `tourPlan` (`stopOf`, `framingWindow`) | ✅ |
| A tap on the picture adds a card after the last — the new End — at the picked card's zoom, and the same finger goes on placing it | `mapAdd` then `mapMove` | ✅ |
| A dot: picked on press, dragged at its own zoom, its instants kept | `selectCard`, `mapMove` over `writeCard` | ✅ |
| A dot's grab reaches at least 12 px | 12 points | ✅ |
| A pinch (two pointers), a trackpad or the wheel zooms the picked card about the point it looks at; a second finger moves nothing | `MagnifyGesture` and, on the Mac, `WheelCatcher` → `zoomCardBy` (read from the document as it is now) | ✅ |
| The browser's own pinch refused on the map | — a native pinch is the app's own | ✅ |
| The map is the FILE itself (`<img>` / a `<video>` seeked to the frame) | the same half-megapixel decode the cards are drawn from | ≠ one decode serves both, and the map is never wider than the panel |
| The map's help line; Zoom 1…8 for the picked card, "Pick a card to zoom it." between two | the same, `zoomCard` | ✅ |
| Easing (every curve) and Steps; Starts: With the slide / After the opener — only when the opener has seconds | `PiecePanZoomTravel` | ✅ |
| The ⓘ, four paragraphs | the same | ✅ |

## Develop (`PictureTabView.developRow`, `PieceDevelopSheet`)

| Web | Native | |
|---|---|---|
| The settled row: the develop's sentence, Develop… (disabled "Tick a picture first"), ↺ back to as shot, badge "Cell n", the ⓘ | `DevelopSettledRow` | ✅ |
| The sheet over the SELECTED cell — "Develop · <file>", the picture (a clip's frame at the in point, never live) | `PieceDevelopSheet`, decoded once within 1600 px | ✅ |
| No picture: "This slide has no picture yet — tick one in the Library." | the same; a file that cannot be decoded says why | ✅ |
| The preview: the draft develop FIRST, then the look the picture wears on its rung, and its grain; the stage keeps the stored value until Done | `LookLibrary.resolve(gradeShown)` → one cube + `FilmPass`, off the main actor, the latest winning | ✅ |
| Done writes the selected cell (as shot written as none); Cancel drops the draft; Enter / Escape | `setDevelop`, `.defaultAction` / `.cancelAction` | ✅ |
| The footer: "writes to cell 2 of the hook" / "writes to slide 3", then what was just done | `developFooterHint` + the told line | ✅ |
| Histogram of what the preview shows — the picture as delivered, never the clipping painted on it | `DevelopHistogramView` over `DevelopSheetPicture.histogram` | ✅ |
| Auto tone / Auto colour, measured on the picture AS SHOT | `DevelopAutoSection` over the sheet's `measureSource` | ✅ |
| The grey dropper: "click something grey", one click reads the picture AS SHOT through the viewport's own draw (a zoom or a pan cannot misplace it), `whiteBalanceFor`, "picked grey · temperature n, tint n", then put down; the wipe and the pan stand down while it is armed | `DevelopSheetStage`: a tap through `StageGeometry.pointAt` → a 5 × 5 patch of the source → `whiteBalanceFor`; "tap something grey" on a phone | ✅ |
| The sliders, white balance, levels, curve, mixer (and B&W), grading wheels | the Develop panels, `trips.` folds | ✅ |
| Copy / Paste / As shot in the header — the session's clipboard shared with every host, Paste enabled the moment any host copies | `DevelopSheetBar` over `copyDevelop` / `pasteDevelop`, the listener on `DevelopSheetPicture`; ⌘C / ⌘V (`DevelopSheetKeys`: the Edit menu on the Mac, the keyboard's chords on an iPad) | ✅ |
| Presets: the person's own book, a chip writes a COPY; Save… names the draft | `PresetBookStore`, an alert for the name | ✅ |
| Apply to n other slides / n pictures of this day — a COPY now, Done still writes this one | `developApplyVerbs`, "done · apply to …" | ✅ |
| The Look under it: the rung chips in its header, the host's grade panel on that rung | `PieceGradeScopeChips` + `GradeStackView` | ✅ |
| The fidelity chip — what the picture is, with its pixels (`pictureFidelity`), computed by the SHEET from the file and what it measured, never by the host | `DevelopSheetPicture.fidelity`: a still's own decode (its pixels, the camera's render inside a RAW, the sensor's size), a clip's frame unmeasured as on the web; a RAW with no render of its own is named the system's demosaic, as the Develop tool names it | ✅ |
| The caption under the picture (`DevelopCaption`): the develop's sentence, the fidelity's note, the gesture that applies now ("drag across the picture to compare…", "nothing changes the picture yet") | `DevelopSheetCaption` — "pinch or double-tap to look closer" on a phone, "wheel or pinch" on the Mac | ✅ |
| The before/after wipe: before LEFT, after RIGHT, no split is 0; a drag across the picture at the fit, the handle when zoomed; `after` / `before · after` / `before`; ◐ hold for before | `DevelopSheetStage`, the Develop stage's rules over `DevelopSheetPicture` (`wipe`, `holding`, `before` rendered once as shot); `\` holds too | ✅ |
| Always comparing | `A/B` in the bar, remembered on this device (`atelier.develop.sheet.compare`), suspended while the dropper is armed and the divider back where it was | ≠ the Develop stage's switch in the sheet too — one way of looking in every Develop screen |
| The view zoom to 4000 % — wheel, pinch, `Z`, the arrows pan once zoomed; one preview pixel per device pixel a LANDMARK; `smooth` / `pixels` past 1:1, the device's preference shared with the Develop tool | `LookingZoom` + `StageZoomPill` (Fit · 100 % · Smooth · Pixels as pixels under the `%`, no crop row), a double tap, the Mac's wheel through `WheelCatcher`; `atelier.develop.pixelView` | ✅ |
| The zoom pill only above 820px; the pixels pill only while magnifying | the pill at every width, smooth ↔ pixels under its `%` | ≠ the Develop stage's rule: a label of fixed width, nothing inserted, and the pill answers where a pinch cannot |
| The loupe: past the stage's 1:1 the file decoded whole and drawn at its own density | "the stage’s pixels, magnified" said on the picture instead | ⏳ the Develop tool has no loupe yet either (`LookingZoom`); the sheet takes it the day the stage does |
| J paints the clipping on the picture (the histogram's end words are the switch); the pixel under the pointer said under the histogram, "before ·" on the left of the divider | `J` (`DevelopSheetKeys`) or the end words → `toggleClipping`, painted by `ClippingPass` over what is SHOWN only; `onContinuousHover` → `readoutOf` → the `ReadoutStore` the histogram's middle line listens to | ✅ |
| The picture beside the column on a wide sheet; on a phone the picture takes 38 % of the height and the column scrolls under it | `DevelopSheetFrame`, split at 820 points measured on the sheet itself | ✅ |
| A preset that carries a look | — | ⏳ the web's sheet does not offer it either (the roll's editor does) |

## Format (`PieceFormatSection`)

| Web | Native | |
|---|---|---|
| The presets from tallest to widest, 4 across, each an outline 12 on its long side and its id; the label as the title | `aspectPresets` sorted, `PieceFormatGlyph` | ✅ |
| One per piece, shown on every slide | `patchBadge { $0.aspectId = … }` | ✅ |

## Grade (`PieceGradeSection`)

| Web | Native | |
|---|---|---|
| Grade of: Trip · Piece · Picture, the titles as help; no Picture chip on the closing card | `PieceGradeScopeChips` → `setGradeScope` | ✅ |
| Down a rung seeds from what is shown, up drops what is below | the model's `setGradeScope` over `moveGradeScope` | ✅ |
| Badge Trip / Piece; the ⓘ per rung, and the linked project's reel | the same | ✅ |
| The Studio's GradePanel on the rung shown | `GradeStackView` bound through `gradeShown` / `writeGrade`; an emptied look on a picture's own rung stays a departure | ✅ |
| The look gallery's scene shows the aimed look on THIS picture | the stage's decoded lead as `LookPicture` | ✅ |
| The stack's error in red | the panel's own, plus each look this device cannot grade (`lookMissing`) | ✅ |
| "the Studio’s own shader" in the ⓘ | "the same engine" | ≠ the app's engine is its render graph, not the Studio's shader |

## Around the tab

| Web | Native | |
|---|---|---|
| On a phone the Picture tab is a DRAWER sharing the column, never a sheet | the piece editor's `PieceInspectorDrawer` hosts this view | ✅ |
| The develop sheet a full-screen sheet on a phone | the editor's `.sheet` | ✅ |
