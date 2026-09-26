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
| `Store/` | `RollStore` (rolls + locators + marks + thumbnails on disk), `PresetBookStore`, `PicturePool` (decodes, EXIF, as-shot stats, thumbnails), `RollEditor` (+ `Batch`, `Keys`, `Adding`, `Export`, `Run` — the Export tab's state, plan and verbs) |
| `Gallery/` | `RollGallery`, `RollCard`, `NewRollSheet` |
| `Editor/` | `RollEditorView` (the screen), `StageBar`, `ProgressLine`, `SettingsSheet`, `ShortcutsSheet`, `EditorCommands` |
| `Filmstrip/` | `FilmstripView`, its cell and delivery badge |
| `Layers/` | `LayersTab` (+ `LayerListSection`), `MaskSection` (+ `MaskShapeControls`), `MaskStageOverlay`, `LayerLooking` (the tab's own render, the seam a plan reads, the colour a layer sees); the state and verbs are `Store/RollEditor+Layers.swift` |
| `Stage/` | `DevelopStageView`, `StageGeometry`, `LookingZoom`, `DevelopRenderPlan`, `DevelopTool` (+ the overlay slot, the eyedropper), `StageZoomPill`, `StageFacts`, `WheelCatcher` |
| `Render/` | `FullDevelopRenderPlan` (every pass in the web's order, the crop, the border, the budget), `RawSource` (the RAW's render first, its sensor on a rung, the device class), `DevelopLooks` (built-ins from the bundle, pack looks from the vault, `DiskPackStore`); the editor's side in `Store/RollEditor+Render.swift` |
| `Inspector/` | `InspectorView` (tabs + sections in the web's order), `InspectorDrawer` + `SectionStrip` (phone), `PresetsSection` + `ApplySection`, `PendingSections` (stand-ins until their tasks land) |
| `Look/` | `DevelopLookSection` — the Adjust tab's last block: `Apply look to…` at its head, the shared grade panel (`../Look/GradeStackView.swift`, its own `../Look/PARITY.md`) bound to the OPEN picture's look (roll v5); the binding and the scene's picture are `Store/RollEditor+Look.swift` |
| `Crop/` | the Crop tab: `CropStageOverlay` (the zone on the stage) + `CropZoomPill`, `CropTabSections` → `CropSection`, `CropApplyFold`, `DeliveredPreview` + `BorderSection`, `PerspectiveSection`, `LensSection` (+ `LensProfileBlock`), `CropSession`, `LensfunStore`; the verbs in `Store/RollEditor+Crop.swift` |
| `Repair/` | the Detail tab's repair: `RepairSection` (heal · clone · dust), `RepairStageOverlay` (the tool on the stage) + `RepairMarksOverlay` (the idle slot's rings), `RepairHandles` / `RepairLookingLayer` / `DustMapLayer` (`RepairRings.swift`), `RepairLooking` (the repaired picture, the map, the field read off the decode); the state and verbs in `Store/RollEditor+Repair.swift` |
| `Panels/` | the Adjust sections (their own task) |
| `Export/` | the Export tab (`ExportTab` and one file per section) and the RUN (`RollExportRun`, `DeliveredFile`) |

Counts: **241 ✅ · 32 ⏳ · 8 part-built** — 281 table rows (the Layers table: 36 ✅ · 4 ⏳ of 40; the Repair table: 24 ✅ · 2 ⏳ of 26).

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
| The brush / heal-disc size kept across pictures | ✅ the brush (`LayerEditState.brush`) and the heal disc (`RepairEditState.tool` — heal or clone, size, feather), both held by the editor |
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
| Through ONE seam, `DevelopRenderPlan` — the stage, the snapshot and every export draw through `FullDevelopRenderPlan` (`Render/`), installed when the editor opens | ✅ |
| EVERY pass in the web's order (`use-develop-picture.ts`, `roll-render.ts`): gain map → repair → colour noise → denoise → defringe → the ONE cube (develop + the picture's own look, tetrahedral) → camera warp → lens → keystone → layers → dehaze · clarity · texture → sharpen → post-crop vignette → film grain / halation → the crop | ✅ `FullDevelopRenderPlan.assemble`; the gate reads the order (`AtelierTests/Develop/FullDevelopRenderPlanTests`) |
| A RAW opens on the camera's render INSIDE it (`rawRenderFirst`, its orientation given back), the system's own demosaic only where it carries none; a develop on a rung above the proxy is drawn from the SENSOR (`CIRAWFilter`, linear, sRGB-encoded, sensor white at 1), the gain map and the camera warp at their rungs, the exposure measured once and stored, the stage's decode held as half floats, a phone's edges from `rawDecodeEdge` | ✅ `RawSource` · ⏳ Apple's demosaic is not LibRaw's: a web develop's stored `rawGain` lands on other pixels here (unmeasured on a device) |
| A RAW's white balance in Kelvin (`rawWb.matrix`) applied first inside the cube | ✅ `developLinear` |
| Everything at SOURCE density before the crop; the budget scales the whole source (a preview within twice its cap), a framing zoomed in is drawn from the pixels it magnifies and brought down once cut | ✅ `budgetScale` / `renderScale` |
| The look: built-in LUTs by the web's ids (`builtin:<id>`, the bundle's `luts/` — a folder reference to `public/luts/`), film stocks generated from their settings, an old inlined `.cube`, pack looks from the vault on this device; a look that cannot grade here SAID, never neutral | ✅ `DevelopLooks` (+ `DiskPackStore`) · ⏳ a pack look this device does not hold is not fetched from its instance (the vault's hosts wait on the Sources screen) |
| The border drawn round the crop in every DELIVERY (colour, or the crop blurred on a tiny copy) | ✅ in exports · ⏳ not on the stage: its geometry has no border canvas; the Crop tab's delivered preview shows it |
| Subject layers: segmented off the main thread (Vision), the stage drawing without a subject until it lands, a delivery segmenting its own | ✅ one `SubjectMasks` shared with the Layers tab; the tab's wash and blink drawn LAST (`LayerLooking`) |
| What is not drawn is SAID ("not drawn here: …"): a RAW base on a file that is not a RAW, a refused sensor, a look this build or vault lacks, a subject Vision cannot answer | ✅ `unrendered` |
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
| `J` paints the clipping on the delivered frame's own pixels, the stage only (never the histogram, a snapshot or a file); the readout reads a mark as the clip it marks, and never on the before side | ✅ `DevelopRenderPlan.looking` + `ClippingPass` |
| States: decoding…, a decoder's refusal, a picture not on this device (`availabilityText`) | ✅ |
| The grey dropper: the tool takes the pointer whole, "click / tap something grey", solves `whiteBalanceFor` on the source AS SHOT at the tapped pixel, then puts itself down | ✅ `EyedropperOverlay` |
| An overlay SLOT the active tool fills (`DevelopTool`: none · crop · mask · repair · eyedropper) with the view ↔ source transform (`StageGeometry`) | ✅ |
| Crop zone / mask marks / repair rings drawn on the stage | ✅ the crop's zone (`CropStageOverlay`, table «The Crop tab») · the mask's marks, handles and brush (`MaskStageOverlay`) · the repair's rings, handles, proposed spots and map (`RepairStageOverlay`, `RepairMarksOverlay`, table «Repair») |
| The task hairline on the stage's edge (`TaskEdge`) | ✅ `../Tasks/TaskEdge.swift` on the bottom edge, scoped to the open picture: its opening (`Opening <file>`, no Cancel) and its sensor's decode (`Opening <file>` · the sensor’s data) |
| The same hairline on the filmstrip cell of a picture being opened | ✅ native addition — the web's filmstrip draws none |

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
| The name as the menu of the capture's files and the RAW rungs | ✅ a RAW in hand: its render and its sensor with the rungs its file reaches (`rungsFor`), the measured exposure stored once (`RollEditor+Render`) · ⏳ a capture's OTHER files (a proxy's original, a companion, a folder's sibling) — the renditions task |
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
| Adjust: histogram · Auto (+ pick grey) · white balance (a RAW) · light & colour · presence · levels · curve · mixer · grading · vignette · presets · apply to… · the look | ✅ wired (`Panels/`; the look `Look/DevelopLookSection` over the shared grade panel, `../Look/`) |
| Presets: chips write a COPY; × removes; Save current as… (+ look); the book on this device (`presets.json` beside the rolls) | ✅ |
| Keep the preset book on a Winnow | ⏳ the app's Winnow client |
| Apply to N selected / Paste to N selected / Apply to N others (the develop's numbers, never the material) | ✅ |
| Apply look / crop / borders to… | ✅ look (at the head of the Look section, where the web draws them) · crop and borders (`CropApplyFold`, folded, the web's words) |
| Detail: repair · detail | ✅ repair (`Repair/`, table «Repair» below) · detail (`Panels/`) |
| Layers | ✅ the list, the mask and the layer's develop (`Layers/`, table «Layers» below) |
| Crop: crop · apply crop to… · borders · apply borders to… · perspective · lens | ✅ (`Crop/`, table below) |
| Export | ✅ the whole tab and the run — «The Export tab» and «The run» below |
| Word the sections the web's way, ⓘ for the standing prose | ✅ (`DevelopSection`) |

## The Export tab — `ExportPanel.tsx`, `ExportTargets.tsx`, `DeliveryTable.tsx`, `MetadataSection.tsx`

| Control | |
| --- | --- |
| The sections in the web's order — Export · Watermark · Pictures · Metadata · HDR · Deliver — each with its ⓘ prose | ✅ `Export/ExportTab.swift` |
| Targets: the first into the chosen folder ("Where you choose, at the click" / "The chosen folder"), each other into a sub-folder named after it (`targetFolder`), renamed in place, removed | ✅ |
| Two targets writing into one sub-folder said ("the second numbers its files") | ✅ |
| Size: Full size · Long edge · Short edge · Megapixels · Percentage; a mode switch re-expresses the size (`convertSize`); the number committed on Return or leaving the field, clamped (`readSize`) | ✅ |
| Quality 50–100 % · Sharpen Off / Low / Standard / High ("for a screen, after the resize") · Watermark, per target | ✅ |
| Also write: the five presets, a repeated name numbered | ✅ |
| Delivers: the run's sentence over the pictures that leave (`planRun`), before a byte moves | ✅ |
| *Proxies only, for this run* — never on the roll | ✅ kept per roll for the app's session (`RollRunState`), not reset with the editor as the web's is |
| This picture: the calculator's line (`deliverySummary`, the first target) and its reason; what the stage does not draw said | ✅ |
| Watermark: the line (a template, drafted, written on leaving), Reads (the line on the picture in hand, or why nothing), Where, Size, Opacity, Tone, Drawn on | ✅ |
| Pictures: one 48 pt row per picture, the whole row the target (send ↔ hold; an ignored one back into the work), ↺ back to the rule, › open, the plan's line, the thumbnail, `send` / `hold` chips, E4's `changed` / `✓ time` | ✅ |
| Pictures: filters All · Edited · Leaving · Held · Changed, `N of M leave`, the ignored folded and unfolding by themselves for the open picture | ✅ |
| Pictures: Winnow's *Picks* filter and culling marks | ⏳ the app's Winnow client |
| Metadata: Leaves — All · Share online · Minimal (+ Custom); the seven groups one row each and the Signature locked among them; the one cost said (copied whole vs rebuilt) | ✅ |
| Creator and copyright from the preset book's identity, drafted and written on leaving; the copyright read on this picture's capture year | ✅ |
| The picture's title and caption, drafted, one undo step per field, written to the picture they were typed under; "Kept on the picture, not written" when the group is off | ✅ |
| HDR: Deliver Ultra HDR JPEG, Reach 1–4 stops, the display's sentence (its EDR headroom), the last run's line | ✅ |
| Deliver: Replace a file of the same name (the roll's), the verbs — this picture · N selected · N pictures · N new or changed — the progress line with its Cancel, the run's note | ✅ |
| Every line of the run's sentence one tap away (the web shows the first and `(+N more)`) | ✅ native addition |
| Format: JPEG (the web's) or HEIC — this device's choice, never the roll's | ✅ native addition |
| Into: a folder, or Photos (each picture's first target, under its own name) | ✅ native addition |
| Sending the finals home to a Winnow | ⏳ unplugged on the web too (`develop-roll.md`) |

## The run — `use-roll-export.ts`, `roll-render.ts`, `deliver-files.ts`

| Behaviour | |
| --- | --- |
| The folder picked AT THE CLICK, before a pixel is rendered (`.fileImporter`, its security scope held for the run); Photos' permission asked first | ✅ `Export/RollExportRun.swift` |
| Each picture rendered ONCE through the editor's own `DevelopRenderPlan` at `.whole` (Core Image tiles it), then cut to every target | ✅ |
| The crop at the source's own density, inside its border where the plan draws one; a size a cap that never upscales (`deliveredLayout`, `longEdgeFor`) | ✅ |
| Screen sharpening after the resize, in bands of 256 rows, each band's upper neighbour the ORIGINAL row (the web's canvas loop reads it back sharpened) | ✅ `Export/DeliveredFile.swift` |
| The watermark in Core Text after the sharpening, the suite's sans at 500, a soft shadow of the opposite tone, squeezed to the margins like `fillText`; a line that says nothing not drawn, and said | ✅ |
| JPEG through ImageIO, stamped with the ORIGINAL's EXIF, ONE XMP packet and the sRGB profile (`stampExif`): signed, the rights, the words, the place | ✅ |
| HEIC carrying the same metadata (the kernel's block read back by ImageIO) | ✅ · the maker notes may stay behind |
| The metadata of a container the kernel's parser does not walk (a HEIC from Photos) read by ImageIO as the original's own account | ✅ native addition |
| Ultra HDR from a RAW: a darker render, the gain map measured, the file read back and checked before it is called Ultra HDR (`encodeUltraHdr`); a render or a HEIC leaves plain, said | ✅ written · unmeasured on a device; the whole rendition is held in floats (~36 B a pixel), as the web's is |
| The place named offline from the bundled GeoNames index (`project.yml` bundles `public/geo/cities.json`) | ✅ |
| Named EXACTLY after the picture (`exportName`); numbered within the run, and around the folder's own names unless Replace | ✅ |
| Other targets into their sub-folders, a variant into `Variant N/`, a refused file said with the folder's words | ✅ |
| Each file written as it lands | ✅ (the web holds the roll until the end) |
| What LANDED marked on this device (`export-marks.ts`) | ✅ |
| One task per run, a picture at a time; Cancel between two pictures, what was written kept and said | ✅ one task (`TaskCenter`) on the tab and in the toolbar's pill, its Cancel the tab's own; unscoped as on the web, so the stage's edge keeps to the open picture's work |
| A RAW base set aside under *Proxies only*, or when the RAW is out of reach — said | ✅ |
| What the render plan does not draw yet (the look, the layers…) said per run | ✅ |
| A RAW decoded under its sensor's pixels (the GPU's cap, a phone's ceiling) said | ⏳ the system's RAW developer decodes whole; nothing is capped to say |
| A proxy's original, a companion RAW or the file set above the photograph fetched from an instance | ⏳ the app's Winnow client |
| The run warning when the chosen folder is the one the pictures came from | ⏳ in the web's memory, not in its code |

## Layers — `LayersPanel.tsx`, `MaskPanel.tsx`, the mask half of `PictureWorkbench.tsx`, `use-subject-masks.ts`

| Control / behaviour | |
| --- | --- |
| The stack drawn TOP FIRST; every write through the kernel's helpers, addressed by id (`addLayer`, `moveLayer`, `patchLayer`, `removeLayer`) and through `update` — merged per picture into one undo step | ✅ |
| Add by kind — Linear · Radial · Brightness · Colour · Painted · Subject · Whole picture — on top, opened at once; a fresh Subject or Colour comes with Pick on | ✅ |
| `12 layers is the limit — each one is a pass over the whole picture`, the add pills disabled | ✅ |
| Empty: "No layers. Add one and it changes nothing until you move a slider on it." | ✅ |
| Visibility is a VERB: the eye / the eye crossed out, the hidden row struck through | ✅ |
| The row's words: `layerLabel` (the name, else the mask described, `… except the subject`), `· NN %` under full opacity | ✅ |
| Move up · Move down · Delete | ✅ (a layer whose develop changes something asks first — native; ⌘Z brings it back either way) |
| Rename · Duplicate | ✅ native additions (the web has neither): the row's menu; an emptied name gives the row back to its mask; a copy lands just above, `<label> copy` (`renameLayer`, `duplicateLayer`) |
| How the mask is shown: Hidden · Outline · Fill (Outline by default), `M` steps it; BY ITSELF while Pick / Paint is on, else only when pinned ("keep it shown once Pick / Paint is off" / "show it now — …") | ✅ |
| Done closes the layer | ✅ (+ Esc once Pick / Paint is off) |
| `Mask · <describeMask>` / `Mask · N combined` | ✅ |
| The kind: Whole · Linear · Radial · Brightness · Colour · Painted · Subject, 4 to a row (3 for a part); a switch starts the new shape FRESH | ✅ |
| Linear: Across · Down · Angle · Feather — the web's ranges, steps and resets | ✅ |
| Radial: Across · Down · Width · Height · Turn · Feather | ✅ |
| Brightness: From · To (held apart) · Feather | ✅ |
| Painted: Paint / Painting · Erase · Undo stroke · Clear · Size (1–80 %) · Softness; "nothing painted yet — an empty painted mask covers nothing, …" | ✅ |
| Brush FLOW | ⏳ not in the document: a stroke carries radius, hardness and erase only, on the web and in the kernel alike — a flow is a new stroke field on both sides first |
| The Pencil's pressure | ⏳ the same reason: a stroke has ONE radius |
| Subject: Pick / Picking · Clear · the status in the web's words ("tap the subject on the picture", "finding it… (N points)", "N points · tap a marker to remove it · found — move a slider below to act on it") | ✅ + two native states: the model's refusal in its own words (the Simulator), "no subject under them" |
| Colour range: Pick · the swatches (a tap takes one off) · Clear · Refine · its three lines | ✅ |
| Invert — "apply everywhere the mask is not" / "this part before it combines" | ✅ |
| Opacity, 0–100 % | ✅ |
| Except — «sauf le sujet» — offered only where a subject layer exists; "The subject", else each subject's label; its two lines | ✅ |
| Combine: the next op (Add · Subtract · Intersect), `+ / − / ∩ <kind>` for any kind but a subject, at most 4 parts; the new part opens (Pick / Paint on for a colour or a painted one) | ✅ |
| The components: the layer's own mask, then each part (`describePart`); a row opens it, the trash removes it; the open part's op as *This part* | ✅ |
| The layer's DEVELOP edited by the Adjust tab's own sections — Light · Tone · Colour, Curve — folded under `layer.` | ✅ |
| Levels, the mixer, the grading wheels inside a layer | ⏳ the web offers the sliders and the curve only; those three sections take no `foldPrefix` yet |
| The stage's pointer is the mask tool's while a layer is open (`DevelopTool.mask`): the compare suspended, its drag and wipe standing down; the overlay keeps the pinch, a drag pans once zoomed, a double tap (when nothing is being made), the Mac's wheel | ✅ (the web suspends the compare only while Pick / Paint is on) |
| A linear mask's full · mid · none lines and its handles — the centre, a turn knob on the mid line, a feather bar on each edge line (`linearGuides`, `dragLinear`) | ✅ native addition — the web places a gradient with numbers only |
| A radial mask's ellipse and dashed feather ring and its handles — the centre, the two half-axes, the ring, a turn knob (`radialGuides`, `dragRadial`) | ✅ native addition |
| Painting: a drag lays a VECTOR stroke (finger, Pencil, pointer); a press off the picture starts nothing; a hand past the edge carries on; points closer than the step dropped (`beginStroke`, `continueStroke`); the brush's ring and core under the pointer | ✅ |
| Picking: a tap adds a subject point or samples a colour AS THIS LAYER SEES IT (the develop, the warps, the layers under it — 5 × 5 at 512 px), a tap on a marker takes it off | ✅ |
| A brightness band put on a tapped tone, the tone and how much of it is in read under the pointer | ✅ native addition |
| The picked points drawn: a `+` disc turning `−` under the pointer, answering its own press; a colour's marker ringed in its colour | ✅ |
| The Mac's cursor: copy while picking, a crosshair while painting | ✅ |
| Show-the-mask: the layer's own pass with a one-colour cube (`LayerPasses.overlay`), outline or wash | ✅ on the Layers tab's own render |
| The region a tap added blinks twice, 90 ms a beat; nothing under reduced motion | ✅ |
| A subject segmented on the TAP, from the picture as its geometry bends it, one run at a time, the last good map kept, cached per picture + frame + points | ✅ on Apple's Vision (`SubjectMasks`), not MediaPipe — its differences are that file's header |
| The layers drawn on the stage with no layer open, in the filmstrip, the histogram and the export | ⏳ the integration task: `LayerStack` / `LayerPasses.build` behind `DevelopRenderPlan`, reading `LayerEditState.looking` for the subject maps, the wash and the blink (this tab's own render then stands down: `planDrawsLayers`) |
| Apply layers to other pictures | ✅ the sections picker's `Layers` section (the shell's) |

## Repair — `RepairPanel.tsx`, the repair half of `PictureWorkbench.tsx`, `DevelopViewport.tsx`'s rings

| Control / behaviour | |
| --- | --- |
| The list is the picture's `repair` (`readPatches` on read — junk dropped, capped at 64, a repeated id dropped; an empty list written as the web's `[]`); every write through `update`, ONE undo step per gesture — a patch being placed and aimed, or a ring being dragged, is held LIVE and written at the gesture's end | ✅ `Store/RollEditor+Repair.swift` |
| Title `Repair · N patches · N healed, N cloned`, the accent dot while it holds any; the web's ⓘ text | ✅ |
| Repair / Repairing… (a pressed pill), refused at 64 patches unless already on | ✅ |
| Heal · Clone, Size (0.4–40 %, step 0.2, `N.N %`), Feather (0–100 %, step 5): the SELECTED patch's (`· this patch`), else what the next patch is placed with | ✅ |
| What the next patch is placed with kept across pictures; Repair armed, the selection and the dust scan start over on the next picture (the web's workbench is keyed per picture) | ✅ |
| `patch N of M · drag its ring to move it, click it to take it off, drag the dashed one to change its source` + Done (Esc) + Remove (⌫) | ✅ (`tap` on a touch screen) |
| `drag a ring to move it · click a solid ring to take it off · click a dashed one to edit it` / `64 patches, the most a picture holds` | ✅ |
| Undo last · Clear | ✅ (Clear asks first — native, a destructive verb; ⌘Z brings the patches back either way) |
| The stage's pointer is the repair tool's exactly while Repair is armed ON THE DETAIL TAB (the web's `repairActive`): the compare suspended, the stage's own drag standing down | ✅ `DevelopTool.repair` |
| A tap places a patch sourced from beside it (`defaultSource`), selected at once; a drag from it AIMS the source at any distance (`placeSource`) — the angle read inside the disc too, the discs never overlapping; a press off the picture places nothing | ✅ (the source follows once the press has moved 3 pt, so a finger's tremor never swings a tap's source round; the web reads it from the first pixel) |
| Every ring a HANDLE on the Detail tab, Repair armed or not: a drag on the solid ring moves the patch with its source (`movePatch`), on the dashed ring the source alone (`placeSource`, no dead zone); a press under 3 pt is a TAP — solid: take it off, dashed: select; a hand past the edge still moves it to the edge (unbounded points) | ✅ |
| A ring's press CLAIMED against the stage (the web's `data-ring` for the zoom machine): no wipe, no pan, no second patch placed under it; a hit disc of at least 11 pt (22 under a finger) | ✅ a child's gesture takes precedence over the stage's own |
| The rings drawn as FACTS on every other tab: the destination solid, the source dashed, a dotted link; a clone in the warm ink, a heal in the light one, the selected patch in the accent with its centre dot; the `−` in the solid ring under the pointer | ✅ (the idle slot and over the mask tool; the crop draws its own stage) |
| The Mac's cursor: a native `−` over a solid ring, an open hand over a dashed one, a closed hand once the press moves, back when it lets go; a crosshair over the picture while Repair is on | ✅ `RepairCursor` |
| While Repair holds the pointer: a pinch zooms, a press off the picture pans the zoomed picture, the Mac's wheel zooms | ✅ |
| A chip on the stage saying what a tap does, and the 64-patch limit | ✅ native addition — the web says it in the panel alone |
| Find spots / Finding spots…: the stage's decode read back ONCE at 1024 px into a field (`dustField`), the sensitivity then reading the field and never the picture (`dustSpots`) | ✅ off the main thread (`PicturePool.dustField`) — the web measures in an effect, ~110 ms on the main thread; `looking over the picture…` meanwhile |
| `N spots proposed` / `no spot proposed` / `the picture is not decoded yet`, a spot already under a patch left out; Heal all, said: `N spots healed · N left, no room`, `N found, no room left`, `no spot could be healed from a neighbour` | ✅ |
| Sensitivity (0–100 %, step 2), `show the map — …`, `tap a dotted ring to heal that spot · a proposal is never a patch until it is taken` | ✅ |
| The spots as dotted rings with a `+`, each healed by its own tap from its cleanest neighbour (`dustPatch`, with the next patch's feather) or said: `that spot sits where no neighbour can be borrowed from — place a patch by hand`; a spot the crop left out not offered | ✅ |
| The MAP in the picture's place, white on black as a share of the threshold (`dustVeil`), drawn through the stage's framing and zoom so a ring lands on the mark it names | ✅ `DustMapLayer` (one affine map from the source to the view) |
| Nothing of the scan kept on the roll; the field let go when the scan is turned off or the picture changes | ✅ |
| The repair DRAWN by the stage's plan — the stage, the filmstrip cell, the histogram, the export | ⏳ the integration task: `DetailPasses.make(detail:repair:…)` behind `DevelopRenderPlan`. Meanwhile the Detail tab draws the repaired picture itself (`RepairLooking`: the patches on the source at the stage's budget, then the stage's own plan), live under a drag, to the right of the divider off the tool — and stands down the moment the plan draws the repair (`planDrawsRepair`) |
| The divider's left half shows the patches too (the web's split lives in the cube) | ⏳ the same integration: until then the stage's own before has no patch |
| `N patches · …` in the facts (`I`) | ✅ (the shell's `factLines`) |
| Apply the repair to other pictures, copy and paste it | ✅ the sections picker's `Repair` section (the shell's) |

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
| `P` / `M` on the Layers tab, `X`, ⇧C, ⌫, Esc | ✅ `P` / `M` answered by the Layers tab (`layerKey` — the press now carries `layersTab`, which the shell never set), `X` swaps the crop's orientation, ⇧C crops to the zoomed view, Esc lets go of Pick / Paint and then of the layer, puts the dropper down or disarms Level; on the Detail tab ⌫ takes the selected repair patch off and Esc lets go of it, then puts Repair down (`repairRemoveKey`, `repairEscapeKey`) |
| ⌘C / ⌘V the develop | ✅ Mac: the Edit menu's Copy / Paste (`onCopyCommand` / `onPasteCommand`, a field keeps its own) · iPad: keyboard shortcuts off while a field types |
| ⌘⇧C / ⌘⇧V / ⌘' | ✅ Mac: the *Picture* menu · iPad: keyboard shortcuts |
| ⌘Z / ⇧⌘Z | ✅ the window's `UndoManager` |
| A field keeps every key | ✅ the editor reads keys only while no field of it types |
| A slider keeps the keys it could use | ⏳ SwiftUI hands the press to the focused slider first; a letter bubbles up to the editor |
