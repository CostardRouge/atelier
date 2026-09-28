# Trips piece editor — parity with the web app

The piece editor's CORE — the screen, the badge stage, the model every tab
writes through, the clock and the keys — against `src/tools/roadtrip/`
(`PostEditor.tsx`, `BadgeStage.tsx`, `DropZones.tsx`, `use-deck-transport.ts`,
`use-slide-library.ts`, `use-collage-refetch.ts`, `use-trip-grade.ts`,
`panels/PiecePicker.tsx`): map tasks tools-roadtrip-09, -10, -11 and -13.
The four tabs' bodies, the band «Aiguille» and the develop sheet are their own
tasks, hosted here as SLOTS (`PendingTabs.swift`, one block per task, the
PendingScreens pattern); their rows are listed below as ⏳ so the whole
screen is accounted for in one place.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's. Nothing here was run on a device:
this container has no Apple toolchain, so every view was written against the
SDK and compiled by CI alone.

Rows: 98 ✅ · 4 ≠ · 2 ⏳ (each tab's own table carries its rows)

## The screen (`PieceEditorView.swift`, `PieceInspector.swift`)

| Web (`PostEditor.tsx`) | Native | |
|---|---|---|
| The editor in the darkroom — neutral greys around a picture being graded | `.darkroom()` on the whole screen and on its sheets | ✅ |
| Wide: the stage and the band on the left at the column's full height, nothing above the picture | `PieceWorkbench.wide`: the stage column (stage, error line, band) beside a hairline | ✅ |
| Wide: the name and `date · kind` atop the inspector | `PieceNameField` over `PieceInspector` in a 352-point column | ✅ |
| The name edited in place, "Untitled piece", "What this piece shows" | a plain `TextField`, every keystroke through the piece's funnel (one undo step under `post:<id>`) | ✅ |
| Phone: the name and `date · kind` on ONE line | `PieceNameField(compact: true)` | ✅ |
| The four tabs Content · Look · Picture · Export | a segmented strip on a wide screen; the phone's own bottom strip | ✅ |
| The TAB is the screen's own state, never the route's | `PieceEditorModel.tab`; the route stays `.piece(tripId:day:postId:)` | ✅ |
| The piece picker rendered ONCE above the body on the hook's Content and Look | `PiecePickerRow` (the kernel's `badgePieces`), a menu picker | ✅ |
| The tab's body scrolls on its own, the badge stays in view | a `ScrollView` inside the inspector | ✅ |
| Phone: Content, Look and Export are a SHEET over the stage | `PieceInspectorSheet`, medium/large detents, the stage still live under it | ✅ |
| Phone: Picture is a DOCKED DRAWER sharing the column — no wash over the picture being judged | `PieceInspectorDrawer` on the Develop drawer's snaps (`drawerSnaps`), dragged or tapped | ✅ |
| A strip cell is marked only while its panel is UP | `inspectorOpen && tab == cell` | ✅ |
| The tabs are published into the SHELL's bottom bar, with its Library cell first | the editor draws its own strip and the app's tab bar hides inside it | ≠ a native tab bar is the app's navigation, not a tool's toolbar; the Library is reached through the app's own Library surface |
| A piece that is gone (deleted, the trip replaced without it) | "This piece is gone" with what happened, never a blank editor | ✅ |
| Content tab: the slide's words, delivery, the day, the counter and time modes, the camera credit | `ContentTabView` — `Content/`, table in `Content/PARITY.md` | ✅ |
| Look tab: the opener, the title style, this piece's look, the cascade, the placement, the shades | `LookTabView` — `Look/`, table in `Look/PARITY.md` | ✅ |
| Picture tab: the file and its in point, the layout, the framing, the motion cards, the develop, the format, the grade's rung | `PictureTabView` — `Picture/`, table in `Picture/PARITY.md` | ✅ |
| Export tab: the plan line by line, one format at a time, the Studio bridge | `ExportTabView` — `Export/`, table in `Export/PARITY.md` | ✅ |
| The develop SHEET over the selected cell, its apply-to verbs, its footer | `PieceDevelopSheet` — `Picture/PieceDevelopSheet.swift` (its stage's wipe, zoom and clipping wait on the Develop stage taking any picture — `Picture/PARITY.md`) | ✅ |

## The header bar (`PieceHeaderBar`, `PieceExportButton`)

| Web | Native | |
|---|---|---|
| Back to the overview, on the day you were on | the navigation stack's own back — the path carries the day | ✅ |
| ⚙ Trip, "Trip settings — the words, the closing card, what a new piece starts from" | `TripSettingsSheet(section: "words", postId:)` | ✅ |
| Undo and redo as ONE joined control, always both drawn | `PieceHistoryControl` — a `ControlGroup`, disabled rather than hidden | ✅ |
| The sync pill | `DocumentSyncPill(sync: store.sync)` | ✅ |
| Export: the ONE word of the bar, the piece's primary export | `PieceExportButton` → `exportPiece()`, which also brings the inspector to Export | ✅ |
| Export folds to its glyph while the sync pill speaks | `folds` = the pill shows and `pillNeedsAction` | ✅ |
| Export becomes its own progress fill while running, a number of fixed width, pressable (a second press ignored) | a fill masked left to right over the inverted face, `%` in monospaced digits, the sentence in its help | ✅ |
| The task pill | the tool's (`TripsTool`), never added here | ✅ |
| The finished files are downloaded | handed to a file mover once the run ends; the run's folder let go after (`exports.discard()`) | ≠ a device has no download folder; the person says where they go |

## The model (`PieceEditorModel*.swift`, `PieceLibrary.swift`)

| Web | Native | |
|---|---|---|
| Every write through the store's one funnel under `post:<id>` | `updatePost` / `setPost` / `changeTrip`, stamped, one undo label | ✅ |
| ONE `selectElement`: a badge piece → Content + focus, a caption line → Content + focus, the opener → Look | `selectElement(_:)` parses the id back (`pieceFromElementId`, `captionLineFromElementId`), `focusRequest` + `focusSeq` for the tab | ✅ |
| A closing-card line → the trip's sheet, opened on that line with its field focused | `tripSheet = <element id>` (`cta:headline:0`) — `TripSettingsSheet`'s `section` | ✅ |
| `selectedId` (the outline) and `piece` (what the chips edit) separate; a press on the empty picture keeps the piece | two fields; `selectElement(nil)` clears the outline only | ✅ |
| A selection is dropped on slide change | keyed on the SLIDE (`slideMaybeChanged`), not the index — a reorder or an undo can put another slide where the open one was | ✅ |
| A tap raises the phone's inspector, never mid-drag | `activate(_:compact:)` on a press that never travelled 4 points | ✅ |
| The deck: the hook, the content slides, the closing card, derived | `deckSlides`, cached per document revision (it prepares the opener) | ✅ |
| A collage: cell 0 IS the slide; the inspector, the Library and the develop sheet follow the SELECTED cell; a new slide starts on its lead | `selectCell`, `cellIndex` clamped, `cell*` read through `collageCellAt` | ✅ |
| The lead and the collage written in ONE go on the hook's badge or the slide | `writeLead` / `patchCell` / `swapCells` / `moveCell` / `setCollage` | ✅ |
| Add a slide (the ticked picture, or empty) and land on it; remove one; reorder content slides only; close with the call to action or not | `addSlide` / `removeSlide` / `moveSlide(from:to:)` / `setIncludeCta` / `editClosingCard` | ✅ |
| A framing written into the CARD in hand; a gesture between two cards writes nothing and SAYS so on the picture | `placeFraming` → `writeCard`, else `refuse()` → "Tap a card to reframe it" for 1.8 s | ✅ |
| A gesture on a moving slide stops it; the card written is the one under the needle | `holdTheNeedle` + `cardAtNeedle` | ✅ |
| A flip mirrors the rest AND every frame of the move | `flipPicture` (`flipFraming` + `flipMotion`) | ✅ |
| Picking a card puts the needle where the view arrives on it; a scrub or a pause picks the card under the needle | `selectCard`, `writeCards`, `followNeedle` | ✅ |
| The block moves, never one piece; soft-snapped unless Option | `moveBlock(to:)` over the kernel's `moveBlock` | ✅ |
| The opener's drawing is content: dragged by frame fractions, the variant clamps | `moveHook` over `HookVariant.moveBy`; `hookRect` over `frameBox` | ✅ |
| A shade's centre placed on the picture, on its axis, only on the hook's Look tab | `placeShade(_:compact:)`, `shadeHandle`, `moveShadeCentre`; a stale placing is dropped on any change | ✅ |
| A cut writes the in point and the SCREEN seconds; a speed keeps the footage; an in point past a shorter clip is reset | `setClipRange` / `setClipSpeed` / `keepInPointInside` | ✅ |
| The grade's three rungs: trip, piece, picture — down seeds, up drops | `gradeScope`, `gradeShown`, `setGradeScope`, `writeGrade`, `ownGrades`, `lookMissing` | ✅ |
| The develop's batch verbs write a COPY now; Done writes the open picture | `developApplyVerbs` (other slides, the day's other pieces), `setDevelop` | ✅ |
| The Library's scope: the piece's day, the trip shaded around it | `.publishMediaScope(mediaScope)` | ✅ |
| The Library follows the tool's kinds (photos and clips) | `.followsActiveAsset(pieceMediaKinds)` | ✅ |
| The Library's tick and the open slide kept in step BOTH ways; the restore settles before the record-back acts | `restorePass` / `recordPass` over the kernel's `restoreClaim` / `syncMove` | ✅ |
| An EMPTY cell takes only a picture ticked after it was selected | `cellBaseline` / `effectiveActive` | ✅ |
| A picture missing from the pool, named by a CONNECTED instance, fetched back once when the slide opens; a failure is said | `restorePass` → `refetch`, `PieceRecovery` (not signed in / gone / the error) | ✅ |
| A collage fetches every cell, three at a time, into the pool only | `collageRefetchPass` over `refsToFetch`, `refetchSummary` | ✅ |
| A slide stores the picture's HASH, found again by name then by content | `storedRef` (`hashedMediaRef`) and `findInPool` (`findMedia`), off the main actor | ✅ |
| The hook thumbnail kept from the stage's frame, only at rest on the END card, with its picture present, debounced 700 ms | `frameLanded` → `store.keepThumb` | ✅ |
| The garage opened from the Virée panel (`configureCar`) | `configureCar()` → `CarGarageSheet` | ✅ |
| The opener's pictures: the Library's file, else the instance's still fetched for these frames alone | the Library's file; a picture the pool does not hold is reported, one line | ⏳ the opener-pictures task (`use-hook-pictures`' `fetchPreviewStill`) |
| The hook's EXIF — the file's head, then what its source vouched for | `loadHookExif` (`readEffectiveExif` + `vouchedExif`) | ✅ |
| Pack looks resolved before a paint; baked again when the vault answers or the interpolation changes | `prepareLooks` / `lookPreferencesChanged` | ✅ |

## The badge stage (`BadgeStageView.swift`, `BadgeStagePointer.swift`, `BadgeStageChrome.swift`, `+Stage`)

| Web (`BadgeStage.tsx`, `DropZones.tsx`) | Native | |
|---|---|---|
| The open slide drawn through the EXPORT's renderer at the piece's aspect | `SlideRenderer` → `BadgeRenderer.image`, off the main actor, the latest request replacing any waiting | ✅ |
| The box measured, never taken from the picture | the largest box of the aspect inside the room (`fit`) | ✅ |
| The canvas's pixels follow the displayed size, between `previewLongEdge` and `maxPreviewLongEdge` | `framePixels` from the box and the screen's scale | ✅ |
| A still decoded ONCE within the stage's pixel budget, never enlarged | `BadgeSources.load(budget: maxStagePixels)` keyed per file | ✅ |
| A collage cell whose file did not change is not decoded again; one that cannot be is an empty cell | `loadCells` | ✅ |
| A clip's frame SEEKED, never re-decoded; scrubs coalesced | `playheadMoved` over `BadgeSource.seek` | ✅ |
| The clip plays its stretch on the stage at its speed, muted, looping over the cut; the out point watched every frame | `PieceClipPlayer` (`AVPlayer` + `ClipFrameTap`) | ✅ |
| Grain re-rolled per SOURCE frame while a clip plays | the playing frame reaches the renderer as a still, so its grain holds while the clip plays; paused and exported it is right | ⏳ a live source for `BadgeSource` (the clip-playback task) |
| The badge runs on the DELIVERED clock on a clip, the deck's on a still; at rest it draws SETTLED | `badgeTime` | ✅ |
| "decoding…" while a picture loads, an error in red under the stage | a capsule over the picture; `stageError` under it | ✅ |
| The piece's tasks as a hairline on the stage's bottom edge | `TaskEdge(scope: "piece:<id>")` | ✅ |
| A press on a badge piece selects it; a drag moves the WHOLE block | `BadgeStagePointer.begin` → `.block` | ✅ |
| The opener's drawing has second claim, after the badge | `hookRect` hit only where no element is | ✅ |
| A collage cell: selected on press; a drag reframes it in its own axes; a print on a free layout MOVES (Shift reframes); a 420 ms hold or an Option-drag SWAPS | `.cell` with `pending → pan / move / swap` | ✅ |
| The picture: a drag pans it inside its frame, clamped | `.picture` over the kernel's `panBy` | ✅ |
| PLACING, never Looking: wheel, trackpad and pinch zoom the FRAMING about the point under the hand, the cell under it | `ZoomTarget` (`zoomFramingAbout`), `WheelCatcher` on the Mac, `MagnifyGesture` | ✅ |
| A second finger ends what the first began | `onTakeover` / `onPinch` | ✅ |
| The pinch's centre drifting pans the picture | the pinch zooms about where it began | ≠ SwiftUI's pinch reports no moving centre |
| The cursor says what a press would do | `onContinuousHover` on the Mac: a hand on the block, a pointer on a piece or the opener, a grab over a picture, copy while swapping, a crosshair while placing a shade | ✅ |
| A collage's cells numbered, an empty one drawn as a slot, the selected one outlined | `BadgeStageChrome.drawCells` / `drawSlot` | ✅ |
| The selected element outlined by the paint's own measure, the opener by its rect | `drawSelection` (dashes, never burnt into the thumbnail) | ✅ |
| A shade's centre shown as its line or its point while placed | `drawShadeHandle` | ✅ |
| The corner word: which card of a move is shown, "Between … · 1.2 s", or why a gesture did nothing | `BadgeStageCaption` over `stageCaption` | ✅ |
| A picture dragged from the Library lands on the cell under it; BETWEEN cells the drop is refused | `BadgeStageDrop` (`DropDelegate`), `.forbidden` between cells | ✅ |
| The drop WRITES before it selects | `dropAsset` → `patchCell`, then `selectCell`, then the Library's tick | ✅ |
| The drop's zones light the moment a Library drag starts anywhere in the page | they light when the drag enters the STAGE | ≠ a drop delegate knows only its own surface |
| Every zone says what the drop WILL do, then what it became — the kernel's words | `PieceDropZonesView` over `dropChip` / `dropHint` | ✅ |
| An instance's picture fetched on drop says so, with an indeterminate sweep | `.fetching` + `PieceSweepBar` (still and centred under Reduce Motion) | ✅ |
| A screen reader hears each zone and the outcome | `AccessibilityNotification.Announcement` over `dropAnnouncement` | ✅ |
| Files dragged in from the Finder / Files onto the stage | — the web's stage takes Library drags only | ✅ |

## The clock and the keys (`PieceDeckClock.swift`, `+Keys`)

| Web (`use-deck-transport.ts`, `PostEditor.tsx`, `DeckStrip.tsx`) | Native | |
|---|---|---|
| Two clocks, never both: the clip on a loaded clip, a frame loop otherwise | `PieceDeckClock` + `PieceClipPlayer` | ✅ |
| Playback LOOPS — the piece, or the open slide (`L`); never while the cut is open | `nextAtEnd`, `loopsOpenSlide`, `toggleLoopScope` | ✅ |
| The piece's time is derived: the open slide's start plus its local time | `time` over `stripLayout` | ✅ |
| A picture still decoding holds a still's clock up to two seconds | `pendingGraceSeconds` | ✅ |
| Pressing play at a slide's end goes where the loop would | `toggle()` | ✅ |
| Space plays and pauses — the piece, or the cut while open; never with Shift, never repeated | `handleKey` | ✅ |
| ← / → step to the previous / next slide, Shift ±0.5 s; Home / End — only while the keyboard is on the band | `handleBandKey`, bound by the band itself — `Band/PARITY.md` | ✅ |
| I / O cut the open clip at the playhead, Shift back to the clip's ends | `setStart` / `setEnd` at `minHookSeconds / 4` | ✅ |
| M mutes the opener's ticks, only where it has a score | `soundOn` toggled | ✅ |
| The opener's ticks HEARD while it plays | `PieceHookSound` (an `AVAudioPlayerNode` over the kernel's `renderBed`) — `Band/PARITY.md` | ✅ |
| A field that types keeps every key; so does a sheet over the editor | `textEditing`, the three sheets | ✅ |
| ⌘Z / ⇧⌘Z | the window's `UndoManager`, which `TripsStore` registers every step with | ✅ |
| Delete / Escape | bound to nothing, as on the web: a badge piece is computed and a slide is removed from the band's menu | ✅ |
| The band «Aiguille»: the piece sliding under a fixed needle, the cut bar, the speed and loop pills, the motion marks, the slide rail with its ⋯ | `PieceDeckBand` (`Band/`) — the row, the strip, the rail's thumbnails, the cut — `Band/PARITY.md` | ✅ |
