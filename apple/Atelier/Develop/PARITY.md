# Develop · the shell and the store — parity with the web

The Develop tool's SHELL (`src/tools/develop/DevelopTool.tsx`, `RollGallery.tsx`,
`NewRollModal.tsx`, `RollEditor.tsx`, `PictureWorkbench.tsx`, `Filmstrip.tsx`,
`SettingsSheet.tsx`, `src/shared/develop/DevelopViewport.tsx`,
`DevelopShortcuts.tsx`) against what `apple/Atelier/Develop/` builds: ✅ built
here, ⏳ deferred (why, and what it waits on). The Adjust sections have their
own table (`Panels/PARITY.md`). Nothing here has run on a device: every ✅ is
written and reasoned, compiled by CI, not yet seen.

Where things are:

| Folder | Holds |
| --- | --- |
| `Store/` | `RollStore` (rolls + locators + marks + thumbnails on disk), `PresetBookStore`, `PicturePool` (decodes, EXIF, as-shot stats, thumbnails), `RollEditor` (+ `Batch`, `Keys`, `Adding`, `Export`) |
| `Gallery/` | `RollGallery`, `RollCard`, `NewRollSheet` |
| `Editor/` | `RollEditorView` (the screen), `StageBar`, `ProgressLine`, `SettingsSheet`, `ShortcutsSheet`, `EditorCommands` |
| `Filmstrip/` | `FilmstripView`, its cell and delivery badge |
| `Stage/` | `DevelopStageView`, `StageGeometry`, `LookingZoom`, `DevelopRenderPlan`, `DevelopTool` (+ the overlay slot, the eyedropper), `StageZoomPill`, `StageFacts`, `WheelCatcher` |
| `Inspector/` | `InspectorView` (tabs + sections in the web's order), `InspectorDrawer` + `SectionStrip` (phone), `PresetsSection` + `ApplySection`, `PendingSections` (stand-ins until their tasks land) |
| `Crop/` | the Crop tab: `CropStageOverlay` (the zone on the stage) + `CropZoomPill`, `CropTabSections` → `CropSection`, `CropApplyFold`, `DeliveredPreview` + `BorderSection`, `PerspectiveSection`, `LensSection` (+ `LensProfileBlock`), `CropSession`, `LensfunStore`; the verbs in `Store/RollEditor+Crop.swift` |
| `Panels/` | the Adjust sections (their own task) |

Counts: **129 ✅ · 28 ⏳ · 8 part-built** — 165 table rows.

## The gallery — `RollGallery.tsx`, `NewRollModal.tsx`

| Control | |
| --- | --- |
| Rolls as cards, newest first | ✅ |
| Grouped by the source they are kept on, one group even with one source (`groupBySource`), header `SOURCE: LOCAL · N ROLLS`, "· not connected" for an unknown source | ✅ |
| Cover: the first four pictures' thumbnails as a mosaic (1 · 2 · 3 with the first spanning · 4), words when there is none (`no pictures yet` / `pictures drawn once opened`) | ✅ |
| Card facts: `N of M developed` (`rollProgress`, ignored pictures in neither number) · date · `N with a look` / `each with a look` | ✅ |
| The WHOLE card opens the roll; `open` tag on the roll last opened here | ✅ |
| ⋯ menu: Open / Resume · Rename… · Export `.roll.json` · Delete… | ✅ (Rename is native's addition; the web renames on the editor's title, which is built too) |
| Delete behind a confirmation: "Every picture's develop and look go with it. The files stay where they are." — thumbnails, locators and marks pruned with it | ✅ |
| New roll sheet: a name to replace (`Roll · 15 Sep`), selected on entry, Enter creates, Escape cancels; the roll opens at once | ✅ |
| "Keep on" a second source in the sheet | ⏳ the app's Winnow client (Sources task) |
| "Start with the photos ticked in the Library" | ⏳ the app has no Library yet; pictures are added from the editor's Add menu |
| Import a `.roll.json` → a NEW roll, fresh ids for the roll AND every picture (`readRollFile` + `rollDocFromFile`); every refusal said in the web's words (`RollFileError.message`) | ✅ |
| The dashed New-roll tile completing the grid, and a drop of a `.roll.json` on it | ✅ |
| Empty state: "No rolls yet" + Start the first one / or import a roll file | ✅ |
| Rolls kept on a Winnow: remote-only greyed cards, mirror on open, Move to…, the sync pill, absent-source notes | ⏳ the app's Winnow client (Sources task; the kernel's `DocSync` / `DocumentGallery` are ready) |
| The Library's "Develop" verb (a new roll from a picture looked at large) | ⏳ the app has no Library/lightbox yet |

## The editor — `RollEditor.tsx`, `DevelopTool.tsx`

| Behaviour | |
| --- | --- |
| ONE updater over the latest roll; every writer goes through it | ✅ `RollEditor.update` |
| Written THROUGH, no Done: local now (debounced 800 ms), flushed when the app leaves the foreground | ✅ |
| A refused local write is SAID (the web's banner) | ✅ `RollStore.storageFailed` |
| The develop is a DRAFT written 200 ms after it rests and when the picture is left (`WriteThrough`) | ✅ |
| Drafts kept LEVEL both ways: an undo, a paste, a batch, a preset landing on the open picture reseeds and drops what was owed | ✅ `reconcileDrafts` over `arrived` |
| Undo / redo over the whole roll (`History`), labelled `picture:<id>` so one picture's slider never merges into the next; 700 ms coalescing | ✅ |
| The same steps on the window's `UndoManager`: ⌘Z / ⇧⌘Z, the Edit menu, shake to undo | ✅ |
| An undo OPENS the picture it changed (`pictureAfterRestore`) | ✅ |
| Undo / redo buttons, both always drawn | ✅ the bar's ControlGroup |
| A never-inherit develop: stepping re-seeds the draft from the next picture | ✅ |
| What is a TOOL (tab, stage tool, facts, compare, ticked sections) survives a step | ✅ |
| The brush / heal-disc size kept across pictures | ⏳ with their tools (Layers, Repair tasks) — they belong on `RollEditor` beside `tab` |
| Roll name renamed in place on the bar; an emptied field gives the old name back | ✅ `RollTitle` |
| Add: from Photos (copied into the container), from Files (bookmark), a folder (ONE bookmark + each picture's path), a drop (files or a folder) | ✅ |
| A picture already on the roll is FOUND AGAIN (its bytes now in hand), never added twice; the status says `found N again · added M` | ✅ (`relink`, variants included) |
| A folder read as the Library reads a capture: a RAW yielding to its JPEG (`photoFiles`) | ✅ |
| Add a day from a Winnow (`WinnowDaySheet`) | ⏳ the app's Winnow client |
| The roll's folders remembered and reopened with one click | ✅ per picture (a folder bookmark in its locator); the status line offers "Add their folder again" |
| Working previews (a 2048 px copy of each local picture, opt-in) | ⏳ not needed yet: a Photos pick is copied whole; a bookmarked file is reachable while its volume is |
| Pictures fetched from their instance near the open one (`use-roll-media.ts`) | ⏳ the app's Winnow client; such a picture says `not connected` |
| Winnow's culling read live and filtered on (`use-roll-culling.ts`) | ⏳ the app's Winnow client |
| Take a picture off the roll; through a confirmation when it carries edits, naming them | ✅ |
| Variants: ⌘' (as edited) and "as shot" from the Add menu; a variant shares its file (locator) and wears the source's thumbnail until its own | ✅ |
| The Library's ticks as "Add N from the Library" | ⏳ no Library yet |
| Empty roll: "No pictures on this roll yet" + Add a folder / Photos / Files | ✅ |
| Drop veil: "Drop photographs or their folder: pictures already on the roll are found again, the others are added." | ✅ |
| The sync pill / history control in the header | ✅ history · ⏳ the pill (Sources task) |
| Route-addressed (`#/develop/<roll>/<picture>`) | ⏳ native navigation pushes the roll; the open picture is the editor's state, not restored across launches |

## The status line — `RollEditor.tsx`

| Part | |
| --- | --- |
| `N of M developed` | ✅ |
| `· N to export` | ✅ |
| `· N changed since exported` (per-device export marks beside the roll) | ✅ |
| `· N ignored` + Hide / Show (a device preference) | ✅ |
| `· N with a look` | ✅ |
| `· N selected` + Clear | ✅ |
| `· N from this device, not open` + reopen | ✅ |
| `· N on <host>, not connected` | ✅ said · ⏳ the link to Sources |
| fetching / could not be fetched / no longer on | ⏳ the app's Winnow client |
| Culling line and its filter | ⏳ the app's Winnow client |
| The editor's last word (`notice`) | ✅ |
| Hidden on a phone while the drawer is up | ✅ |

## The filmstrip — `Filmstrip.tsx`

| Control | |
| --- | --- |
| The pictures in the strip's order, the open one outlined in the accent and kept in view as ←/→ step | ✅ |
| A plain click opens; Shift REPLACES the selection with the range from the anchor, ⌘ toggles one and becomes the anchor (`selectionAfterClick`) | ✅ Mac (modifier flags) · ✅ touch as the cell's menu: Select / Select up to here |
| A checkmark on a selected cell, never a second ring | ✅ |
| The edited dot (`pictureEdits`), a variant's number | ✅ |
| Words in an empty cell by availability (`not open`, `not connected`, …); an unreachable picture greyed with a `!` | ✅ |
| Thumbnails: stored, else baked AS SHOT one decode at a time, once per visit; the open one redrawn AS DELIVERED 700 ms after it rests; kept on disk for the gallery | ✅ |
| The instance's own thumbnail for a remote cell | ⏳ the app's Winnow client |
| × to take a picture off: on hover on the Mac, always on a touch screen, overhanging its cell (the strip pays the room) | ✅ |
| Ignored cells dimmed, or left out (never the open one) | ✅ |
| The delivery badge: filled = the author's call, dashed = the roll's rule; a picture on the rule that stays out shows it only under the pointer (always on touch); a tap sends ↔ holds, its menu (right-click / a held finger) ignores ↔ brings back, sends, holds, back to the rule | ✅ |
| Culling marks | ⏳ the app's Winnow client |
| Drag to reorder | ⏳ not on the web either (`lightroom-gaps.md` item 29) |

## The stage — `DevelopViewport.tsx`, `use-develop-picture.ts`

| Behaviour | |
| --- | --- |
| The picture as delivered, rendered ONCE per change on a pixel budget (long edge 2560), one render in flight and one owed | ✅ |
| Through ONE seam, `DevelopRenderPlan` (default: crop + cap + the develop cube through `PictureRenderer` / `FrameGrader`) | ✅ |
| The look, border, perspective, lens, detail, vignette, repair, layers DRAWN | ⏳ the integration task adds the passes behind `DevelopRenderPlan`; meanwhile the stage SAYS which ones it does not draw ("not drawn here yet: …") |
| Looking zoom: fit to 4000 % (`inspectMaxZoom`), the point under the hand kept still (`zoomAbout`), clamped at the write | ✅ `LookingZoom` |
| Pinch (touch, trackpad) | ✅ `MagnifyGesture`, about where it began |
| Two fingers pan by their live centre during a pinch | ⏳ SwiftUI's `MagnifyGesture` gives no live centre; a drag pans after |
| The Mac's wheel: ⌘/ctrl-wheel and a bare vertical wheel zoom about the pointer, shift / sideways pan — through the kernel's `ZoomGestureMachine` | ✅ `WheelCatcher` |
| A drag pans once zoomed | ✅ |
| Double tap: closer about the tap, or the fit | ✅ |
| `Z`: closer, or back to the fit | ✅ |
| The ± pill at every width; the % a menu: Fit · 100 % (one pixel per device pixel, the landmark) · Smooth · Pixels as pixels | ✅ |
| Crop to this view (⇧C and the % menu's row): `zoneFromView` over the zoomed stage's visible window, written like a drawn zone on Free, the view back at the fit at once, `cropped to the view · C to adjust` / `· as close as a crop may go` | ✅ `RollEditor.cropToView` |
| The quiet `crop` pill heading the zoomed stage's top-right corner | ⏳ the stage's chips are the shell's; the ⇧C key and the % menu row carry the verb |
| The loupe: the file decoded whole past the stage's 1:1 | ⏳ the stage says "the stage's pixels, magnified" instead |
| Compare BEFORE → AFTER, left to right; no split is 0; a switch the host owns (`A/B`, remembered on the device); suspended while a tool holds the pointer, the divider back where it was | ✅ |
| At the fit a drag across the picture wipes; zoomed, the divider's handle wipes | ✅ |
| `\` held and `◐ hold for before` show the picture as shot, whole | ✅ |
| `after` / `before · after` / `before` pill | ✅ |
| `I`: the facts in the bottom-left corner — `captureLine` on top, marked with the accent, a hairline, then `developLines`, layers, detail, vignette, repair, the fidelity note | ✅ |
| The pixel under the pointer read under the histogram (`ReadoutStore`, only its line re-renders) | ✅ on a pointer (Mac, iPad) |
| `J` paints the clipping | ⏳ the pass exists (`ClippingPass`); the integration task wires it — the stage says "clipping — not painted here yet" |
| States: decoding…, a decoder's refusal, a picture not on this device (`availabilityText`) | ✅ |
| The grey dropper: the tool takes the pointer whole, "click / tap something grey", solves `whiteBalanceFor` on the source AS SHOT at the tapped pixel, then puts itself down | ✅ `EyedropperOverlay` |
| An overlay SLOT the active tool fills (`DevelopTool`: none · crop · mask · repair · eyedropper) with the view ↔ source transform (`StageGeometry`) | ✅ |
| Crop zone / mask marks / repair rings drawn on the stage | ✅ the crop's zone (`CropStageOverlay`, table below) · ⏳ masks, repair rings (their tasks; placeholders say so on the stage) |
| The task hairline on the stage's edge (`TaskEdge`) | ⏳ the tasks UI |

## The Crop tab — `CropStage.tsx`, `use-crop-zone.ts`, `crop-view.ts`, `CropPanel.tsx`, `BorderSection.tsx`, `KeystonePanel.tsx`, `LensPanel.tsx`, `lensfun-store.ts`

| Control / behaviour | |
| --- | --- |
| The tab raises the crop tool (the stage shows the WHOLE picture) and lowering it puts the tool down; the tab is the editor's, so stepping keeps it | ✅ `syncCropTool` over `CropTabHooks` |
| The zone DERIVED from the stored aspect + cover framing (`zoneFromCrop`), written back through `cropFromZone`; an undo or a batch verb moves it with no wiring | ✅ |
| The whole picture, turned and mirrored UNDER the zone, fitted once on the quarter-turned picture with 28 pt for the handles; a fine angle never refits it | ✅ an image layer transformed by the framing |
| Never the cropped render drawn as if it were whole (the render that follows the tool is awaited) | ✅ `framedStage` |
| The veil (even-odd), the turned picture's dashed outline, thirds (stronger while a gesture is on), the dense grid for 700 ms after the angle moves, the zone's edge, corner brackets and mid-edge bars | ✅ one `Canvas` |
| Inside the zone MOVES it, sliding along the picture's edge (`moveZone`) | ✅ |
| On the picture outside the zone DRAWS a new one after 6 pt, clamped from the last zone this draw made (`drawCandidate`, `clampToward`) | ✅ |
| Eight handles anchored on the opposite edge / corner, the grab offset kept, a finger's 22 pt reach against a pointer's 10 (`resizeZone`) | ✅ |
| Shift holds the ratio in Free | ✅ Mac (the modifier flags) · ⏳ iPad with a keyboard (SwiftUI's drag carries no modifiers) |
| Double-click / double-tap: the largest zone of the format (`maxZone`) | ✅ |
| Arrows nudge the zone once the stage has been pressed (Shift ×10); unpressed, ←/→ still step the roll | ✅ the stage takes focus on a press; leaving the tab hands the keys back |
| The cursor says what a press would do (resize / move / draw / Level) | ✅ Mac · a corner shows a pointing hand (macOS 14 has no diagonal resize cursor) |
| The size tag in the file's pixels + the shape while a gesture is on (`zoneInSourcePixels`, `describeAspect`) | ✅ |
| Level: "draw a line along the horizon, or along an upright", the line in the accent, under 12 pt a click keeps it armed (`levelDelta`) | ✅ |
| The crop's hint line (`drag inside to move · on the picture to draw · a handle to resize · double-click for the largest`) | ✅ in the handles' room at the bottom of the stage, hidden while a gesture or Level is on or the view is zoomed |
| A gesture writes ONCE, at its end — one undo step, no render of the whole picture per pointer move | ✅ (the web writes through a 200 ms draft; same document, fewer renders) |
| The VIEW: pinch, the Mac's wheel (`ZoomGestureMachine`), the ± pill and `Z` — 1..8×, clamped at the write (`clampCropView`, `zoomCropViewAbout`), never the zone | ✅ `CropView` (kernel) + `CropZoomPill` + `CropWheelTarget` |
| A second finger turns the first's gesture into a pinch: the zone keeps what it did and stops; the finger left starts nothing | ✅ |
| A pinch zooms about the fingers' LIVE centre | ⏳ SwiftUI's `MagnifyGesture` gives its start location only |
| Crop fold: Format (Free · Original · the eight named aspects, three columns, each titled); an untouched picture opens on Free and writes nothing (`openingCropChip`) | ✅ |
| Shape (`1.50:1 · free`) + swap portrait ↔ landscape (`X`), a preset without a turned twin swapping into Free | ✅ |
| Straighten −45..45 within the quarter, from the INTENT (`fitIntent`); `Straight` puts it back | ✅ |
| Level / Draw the line… · −90° / +90° (the zone turning with the picture) · Horizontal / Vertical flips (`flipZone`) · Reset (lands on Free) | ✅ |
| The ⓘ prose, in the web's words (double-click → double-tap on a touch screen) | ✅ |
| Apply crop to… (folded): this crop onto the selection, else the others, `done · …` said | ✅ |
| The delivered preview: the crop on its border, 240 pt, drawn by the export's own painter, `delivers W × H px` at the first target's cap | ✅ `DeliveredPreview` over `BorderPainter` |
| Borders (folded): the switch restoring the last border of this visit; File (Free + the named aspects); Fill (black · white · paper · vermilion · any colour · Blur); Left · right and Top · bottom (0..25 %, linked by default, the link button) | ✅ |
| Apply borders to… (folded), never the crop | ✅ |
| Perspective: Vertical · Horizontal · Turn · Stretch · Zoom with their ranges and printouts, nil the moment it does nothing, Reset | ✅ |
| Lens: Distortion · Secondary · Fringing red / blue · Vignetting · Falls off, nil the moment it does nothing (a midpoint alone is not a correction), Reset | ✅ |
| The lens profile: looked up from the picture's EXIF whatever tab is open; applied by itself on the SENSOR to a picture that never decided; only offered on a camera render (`Apply to this render`); Remove writes the web's `null` | ✅ `lookUpOpenLens` + `LensProfileBlock` |
| Lensfun, the third network exception: consent on the DEVICE (`atelier.lensfun`), one host, the maker's file then the independents', an ephemeral session, only the ANSWER kept (`lens-profiles.json`), a miss believed for a month, every state said (not allowed · looking · offline · camera / lens not in Lensfun · the picture says nothing) | ✅ `LensfunStore` over the kernel's `lookUpLens` |
| "On the sensor" | ✅ read as the app's own RAW decode (`CIRAWFilter`) — the web's is LibRaw's; the same picture, another developer (`native-app.md`) |
| The stage DRAWS the keystone, the lens and its profile | ⏳ the integration task's passes behind `DevelopRenderPlan`; until then the stage says "not drawn here yet: perspective, lens" |

## The stage bar

| Control | |
| --- | --- |
| The picture's NAME with its fidelity chip (`DevelopBaseChip`) | ✅ name + chip |
| The name as the menu of the capture's files and the RAW rungs | ⏳ the chip draws no choice yet: the app's RAW path (`CIRAWFilter`) honours neither a rendition nor a rung, and offering them would lie |
| `· copied` said beside the name, gone after a moment | ✅ |
| ONE well: Copy · Paste · Reset (a ghost), then Settings (⌘⇧C) · A/B · ? | ✅ |
| The clipboard's three step aside on the crop | ✅ |
| Phone: the verbs on a line of their own at a finger's height | ✅ |
| Nothing inserted (the % carries smooth ↔ pixels) | ✅ |

## The inspector — `PictureWorkbench.tsx`, `PanelHost`

| Section / behaviour | |
| --- | --- |
| Five tabs in order — Adjust · Detail · Layers · Crop · Export (`WorkbenchTab`) | ✅ |
| Wide: a column at the right, the tabs a segmented strip pinned at its top | ✅ |
| Phone: a DOCKED DRAWER under the stage (never a sheet), rests 0.28 / 0.4 / 0.6 of the column, dragged or tapped on its head, closed under its floor; edge to edge, rounded top; the five sections as its own strip at the bottom; the app's tab bar hidden inside the editor | ✅ |
| Adjust: histogram · Auto (+ pick grey) · white balance (a RAW) · light & colour · presence · levels · curve · mixer · grading · vignette · presets · apply to… · the look | ✅ wired (`Panels/`) · ⏳ the look (Looks task) |
| Presets: chips write a COPY; × removes; Save current as… (+ look); the book on this device (`presets.json` beside the rolls) | ✅ |
| Keep the preset book on a Winnow | ⏳ the app's Winnow client |
| Apply to N selected / Paste to N selected / Apply to N others (the develop's numbers, never the material) | ✅ |
| Apply look / crop / borders to… | ✅ look (its tab's stand-in) · crop and borders (`CropApplyFold`, folded, the web's words) |
| Detail: repair · detail | ✅ detail (`Panels/`) · ⏳ repair (Repair task) |
| Layers | ⏳ Layers task |
| Crop: crop · apply crop to… · borders · apply borders to… · perspective · lens | ✅ (`Crop/`, table below) |
| Export | ✅ interim: one picture, JPEG/HEIC, the first target's size and quality, to Files or Photos, named exactly after the picture, the original's metadata, marked as delivered · ⏳ the run, targets, metadata groups, watermark, delivery table, Ultra HDR (Export task) |
| Word the sections the web's way, ⓘ for the standing prose | ✅ (`DevelopSection`) |

## The sections picker — `SettingsSheet.tsx`

| Control | |
| --- | --- |
| Copied from X: sections + Paste (⌘⇧V) | ✅ |
| Tick: All · Edited here · Shared · None | ✅ |
| A row per section with its hint and `edited` / `as shot` | ✅ |
| Ticks remembered on the device (`atelier.develop.sections`) | ✅ |
| Reset (the ticked sections back to as shot, one undo step) · Copy · Apply to N selected · Apply to N others | ✅ |

## Keys — `editorKeyAction`, `DevelopShortcuts.tsx`

| Key | |
| --- | --- |
| ← / → step (a held arrow sweeps), over ignored pictures | ✅ |
| `\` held | ✅ |
| `Z` | ✅ (on the Crop tab the crop stage's view: two steps closer, or the fit) |
| `A` `D` `L` `C` `E` the tabs | ✅ |
| `H` / `?` the shortcuts sheet (the same key closes it while the editor has the keys) | ✅ |
| `I` facts · `J` clipping (the switch) · `V` B&W ↔ colour | ✅ |
| `P` send ↔ hold · `U` the roll's rule · `M` ignore (off the Layers tab), said in the status line | ✅ |
| `P` / `M` on the Layers tab, `X`, ⇧C, ⌫, Esc | ✅ `X` swaps the crop's orientation, ⇧C crops to the zoomed view, Esc puts the dropper down or disarms Level · ⏳ `P` / `M` / ⌫ answered by their tasks (Layers, Repair) |
| ⌘C / ⌘V the develop | ✅ Mac: the Edit menu's Copy / Paste (`onCopyCommand` / `onPasteCommand`, a field keeps its own) · iPad: keyboard shortcuts off while a field types |
| ⌘⇧C / ⌘⇧V / ⌘' | ✅ Mac: the *Picture* menu · iPad: keyboard shortcuts |
| ⌘Z / ⇧⌘Z | ✅ the window's `UndoManager` |
| A field keeps every key | ✅ the editor reads keys only while no field of it types |
| A slider keeps the keys it could use | ⏳ SwiftUI hands the press to the focused slider first; a letter bubbles up to the editor |
