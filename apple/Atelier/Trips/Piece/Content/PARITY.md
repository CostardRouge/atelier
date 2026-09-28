# Trips piece editor — the Content tab, parity with the web app

The piece editor's CONTENT tab (map task tools-roadtrip-14) against
`src/tools/roadtrip/panels/ContentTab.tsx`, `panels/SlideDelivery.tsx` and
`panels/CameraPanel.tsx`. It replaces the Content block of
`../PendingTabs.swift` under the same name and initialiser
(`ContentTabView(model:)`), writes only through `PieceEditorModel`, and its
words and arithmetic are the kernel's (`Roadtrip/PieceContent.swift`, specced
in `PieceContentTests.swift` — the web has no spec for these panels).

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's. Nothing here was run on a device:
this container has no Apple toolchain, so every view was written against the
SDK and compiled by CI alone.

Rows: 65 ✅ · 6 ≠ · 0 ⏳

## Files

| File | What |
|---|---|
| `ContentTabView.swift` | the tab: Slide and Day for every slide, Counter · Time · Camera on the hook |
| `PieceSlideSection.swift` | «Slide»: the badge piece's text, a caption, the closing card, and the focus a stage click asks for |
| `SlideDeliveryRows.swift` | `SlideDelivery.tsx`: Goes out as, Range, Speed, On screen |
| `PieceDaySection.swift` | «Day»: the day, the trip's count, a range, the picture's own date offered |
| `PieceModeSections.swift` | «Counter», «Time», «Camera» (the section around the panel) |
| `CameraPlatePanel.swift` | `CameraPanel.tsx`: the credit, the layouts, the facts, the place, the size, the body's name, the bar's shade |
| `CameraPlateTile.swift` | `LayoutTile` (the badge's elements through `OverlayPainter`) and the 3 × 3 cell grid |
| `ContentRows.swift` | the row grammar: label column, control, hint (a note, the real line in mono ink, a danger); the segmented strip |

## The tab (`ContentTab.tsx`)

| Web | Native | |
|---|---|---|
| Folding sections of label-and-control rows (`InspectorSection`, `FieldRow`) | `DevelopSection(remember: .local)` + `ContentFieldRow` (the overlay panels' label column) | ✅ |
| A section's fold remembered on this device | `@AppStorage` under the section's id (`piece.slide`, `piece.day`, …) | ✅ |
| Every standing paragraph behind an ⓘ | the section's `info`, unfolded by `DevelopInfoDot` | ✅ |
| Slide and Day on every slide; Counter, Time, Camera on the hook only | `ContentTabView` | ✅ |
| The day belongs to the PIECE — never inside the hook-only branch | `PieceDaySection` sits outside it | ✅ |
| Every write through the editor's funnel (one undo step per burst, `post:<id>`) | `patchBadge` / `patchSlide` / `updatePost` / `changeTrip` | ✅ |

## Slide (`ContentTab.tsx`, `SlideDelivery.tsx`)

| Web | Native | |
|---|---|---|
| «Slide», badged `Hook` / `Picture n` / `Closing card` | `slideName` | ✅ |
| ⓘ: when a slide goes out as a video; on the hook, what the text is and that clearing it gives the computed value back | two paragraphs, the second on the hook only | ✅ |
| Hook: `Text` — the override of the piece in hand, its computed line as the placeholder, `(nothing here)` when it has none | `TextField` over `textOverrides[piece]`, prompt from `model.content` | ✅ |
| Typed text is written on every keystroke; an emptied override is stored empty and reads as the computed value, never a blank | the kernel's `applyOverrides` trims it | ✅ |
| A trip whose dates read backwards: "This trip’s dates read backwards, so there is no total to count towards. Fix them and the badge comes back." in the danger ink | `model.content == nil` | ✅ |
| Content slide: `Caption`, "A line over this picture — optional" | `patchSlide { caption }` | ✅ |
| Closing card: `Card` — "Edit in the trip’s settings", "The trip’s call to action, shared by every deck that closes with it." | `model.editClosingCard()` → ⚙ Trip on the card | ✅ |
| A click on a badge piece or a caption line on the stage focuses this field (`textFieldRef`) | `focusRequest == .text` spent on appear and on each `focusSeq` | ✅ |
| While a field types, the editor's keys stand down | `model.textEditing` follows the focus | ✅ |
| Goes out as: Auto · Image · Video (a `Segmented`) | `ContentChoiceStrip` | ✅ |
| Each choice says what it would REALLY give — Auto its medium, Image `settled` / `one frame`, Video `a held card` — in a tooltip | drawn under each label (`slideMediumChoiceHint`) | ≠ a finger cannot hover; the words are the web's |
| The chosen one's real sentence under the row (`reasonSentence`), a re-timed clip "at 2×, without sound" | the kernel's `reasonSentence` | ✅ |
| The hook writes the badge's medium, a content slide its own | `patchBadge` / `patchSlide` | ✅ |
| The closing card has no delivery row — its medium is structural | not drawn on `.cta` | ✅ |
| A clip: `Range` — `0:01.20 → 0:04.20`, read, the cut being made on the band | `formatTimecode(model.clipRange)` | ✅ |
| A clip: `Speed` chips 0.25× … 4×, one control with the band's, writing the same field | `model.setClipSpeed` (keeps the footage, re-times the screen seconds) | ✅ |
| "A re-timed clip goes out without sound." under the chips while the speed is not 1 | `clipSpeedHint` | ✅ |
| `On screen`: 1 s … the ceiling, 0.5 steps, `4.0 s` | `DevelopRangeSlider` over `screenSecondsCeiling` | ✅ |
| Never more than the clip holds after its in point at its speed; the value read clamped | `min(slide.seconds, ceiling)` | ✅ |
| "At most 3.5s of the clip is left after its in point at 2×." / "How long this picture holds the screen when the piece plays." | `onScreenHint` | ✅ |
| The hook writes `hookSeconds`, a content slide `seconds` | `patchBadge` / `patchSlide` | ✅ |
| — | a clip too short to choose (ceiling = 1 s) shows its length as a read-out | ≠ a native slider with no travel is a broken control; the web's range input simply cannot move |
| — | the slider's ↺ puts back the hook's own hold + 1 s, or a content slide's 3 s, never past the ceiling | ≠ the app's one slider always carries a reset (`DevelopControls.swift`); the web's has none |

## Day (`ContentTab.tsx`)

| Web | Native | |
|---|---|---|
| «Day», ⓘ "Everything the badge says is counted from this day." | `PieceDaySection` | ✅ |
| `Day` (or `From` when a range shows): the day this piece tells, a date field | `TripDateField` (the native date picker, a day on the wall at noon) | ✅ |
| Beside it: `day 27 / 310`, `day 27–29 / 310`, or `outside the trip` | `pieceDayOfTrip` | ✅ |
| The picture's own date READ from the open slide's file: its EXIF, else what its source vouched for, else the file's date | `readCaptureDate` over the file's head, off the main actor, once per file (`leadRef`) | ✅ |
| "The picture is dated **27 Mar 2025** (the camera’s own record \| the capture time <instance> read at ingest \| the file’s date — a copy or an export rewrites it)" | `captureOffer` / `captureSourceWords`, the date in ink | ✅ |
| "file it under that day" — only when it is another day; OFFERED, never applied on its own | a link writing `post.date` | ✅ |
| "— outside this trip’s dates, so every count here would be about a day this picture has nothing to do with." in the danger ink | `captureOutsideTripWords` | ✅ |
| The last answer stays up while the next file is read | the `.task(id:)` replaces it on arrival | ✅ |
| "This piece covers several days…" reveals `Through` | `wantRange` | ✅ |
| `Through`: a date no earlier than the day; "One day" clears it | `TripDateField(min: post.date)`, `endDate = nil` | ✅ |
| An empty `Through` field waiting for a date | "Pick a date", which picks the piece's own day | ≠ `TripDateField`'s empty state: a native picker has no blank; nothing is written until the gesture |

## Counter (`ContentTab.tsx`)

| Web | Native | |
|---|---|---|
| «Counter», ⓘ "The number the badge leads with…" | `PieceCounterSection` | ✅ |
| `Mode`: a select whose every option reads `<label> · <the real line for THIS piece>` or the reason it cannot | `OverlayPanelMenu` over `pieceCounterChoices` (`counterPreviews`) — the list one click away | ✅ |
| The chosen mode's line repeated under it, in mono, in ink | `pieceCounterHint` → `.line` | ✅ |
| A mode that cannot count: its reason, then "It counts the single day above meanwhile." (range) or "Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile." | `pieceCounterHint` → `.reason` | ✅ |
| `Marker`: "Before the place" switch | `OverlayPanelToggle` over `showPin` | ✅ |
| "The place reads “Kalbarri”." or "No stage covers this day, so there is no place to mark — add one on the Overview." | `markerHint(pieceMarkerPlace)` | ✅ |

## Time (`ContentTab.tsx`)

| Web | Native | |
|---|---|---|
| «Time», ⓘ "The line about when, drawn under the place…" | `PieceTimeSection` | ✅ |
| `Mode`: every option `<label> · <the real line>` where it has one, the bare label where it would draw nothing | `pieceTimeChoices` (`timeAgoPreviews`) | ✅ |
| Under it: “515 days ago” in mono, or "No line about when…", "Not the anniversary on that day…", "Nothing true to say about that gap yet…" | `pieceTimeHint` | ✅ |
| `anniversary` only on the real anniversary | the kernel's `timeAgoLine` | ✅ |
| `Read on`: the day the piece goes out, today until set | `TripDateField` over `referenceDate ?? todayIso(Date(), .current)` — the kernel never reads the clock | ✅ |
| "Today" clears a set reading day | `referenceDate = nil` | ✅ |

## Camera (`CameraPanel.tsx`)

| Web | Native | |
|---|---|---|
| «Camera», ⓘ "What took the picture, credited on it…" | `PieceCameraSection` | ✅ |
| `Credit`: "On the picture" switch — opt-in, a badge is a signature | `showExif` | ✅ |
| Beside it: the hand-written Camera piece ("Written by hand on the Camera piece: “…”. Clear it there…"), the real line in quotes, "records none of the facts ticked below", or "records no camera, lens or exposure…" | `cameraCreditHint` over the hook picture's effective EXIF (`model.hookExif`; a clip nothing vouched for reads as none, as `useEffectiveExif` does) | ✅ |
| The values measured from the picture at every render, never stored; the CHOICE stored whole on the first control touched | `readPlateSpec` → one field changed → `badge.camera` | ✅ |
| `Layout`: eight tiles, two columns, each DRAWN with the picture's real facts through the badge's own elements and renderer | `CameraPlateTile`: `plateTileElements` (kernel) through `OverlayPainter` | ✅ |
| A tile over a picture recording none of the facts: "nothing recorded" | `plateTileNothing` | ✅ |
| The chosen tile ringed in the accent; the layout's hint under the grid | `pressed`, `plateLayouts[…].hint` | ✅ |
| The tile's canvas waits for the overlay fonts (`ensureOverlayFonts`) | the brand faces are registered at launch | ✅ |
| `Facts`: the chosen facts in order, then the rest in the table's | `cameraFieldRows` | ✅ |
| Each: a tick, its name, its value or "not recorded by this picture"; EV "±0 — the camera’s own reading, not drawn in a line"; unticked rows dimmed | `CameraFactRow` over `cameraFactValue` | ✅ |
| A ticked fact moves up / down, the arrows disabled at the ends ("Move ISO up") | `cameraFieldsMoved` | ✅ |
| `Place`: "Under the badge", or one cell of a 3 × 3 grid; the badge's own cell shaded | `CameraCellGrid` | ✅ |
| "Hung under the badge…", "The badge is anchored in this cell too — they will overlap.", "In a cell of its own…", the bar's and the margin's own sides | `cameraPlaceHint` | ✅ |
| `Size`: 60 % … 180 %, 5 % steps | `DevelopRangeSlider` over `minPlateSize…maxPlateSize`, `plateSizeLabel` | ✅ |
| `Body`: what this TRIP calls the file's body name, its placeholder the file's own name; "What this trip calls “FC8482” — written once, used on every piece." | `cameraBodyAlias` / `withCameraBodyAlias` written through `changeTrip` | ✅ |
| A blank name forgets the entry; every spelling of one body is one entry | `withCameraBodyAlias` | ✅ |
| Edge bar: "Shade under the bar" — a soft dark band along its edge, only while fewer than four shades | `cameraBarShade` appended to `badge.shades`, guarded by `maxShades` | ✅ |
| A tile's hint in its `title` | the tile's `.help` and its accessibility hint | ≠ a phone has no hover; VoiceOver reads it |
| The trip-dates danger line is an `alert` for a screen reader | read in place by VoiceOver | ≠ an announcement on every appearance would repeat itself on each slide opened |
