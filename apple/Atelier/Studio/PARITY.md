# Studio shell — parity with the web app

The Studio's SHELL — the gallery, the editor, the stage and the transport —
against `src/tools/studio/` (`StudioTool.tsx`, `ProjectGallery.tsx`,
`NewProjectModal.tsx`, `StudioEditor.tsx`, `ProjectSettingsModal.tsx`) and the
shared pieces it wires (`src/shared/media/TrimBar.tsx`, `use-video-transport`,
`use-video-scrub`, `use-overlay-stage`, `frame-grab.ts`, `DevelopSheet`). The
panels INSIDE the inspector are `Panels/PARITY.md`'s; the Export tab —
Output · Variants · Export and the finals home, against the Export tab of
`StudioEditor.tsx` and `handleExport`, `export-variant.ts`, `photo-frame.ts`'s
`exportPhotoVariant`, `export-tail.ts`, `delivery-source.ts` and
`SendFinalsPanel.tsx` — is `Export/`'s, its table below.
✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

The arithmetic is the kernel's, spec'd on Linux: `Projects/StudioEditing.swift`
(the transport's rules, the trim keys, the deck's add/remove, the stage drag,
the wipe, the notices, the cadence and shift drafts, the save states, the
import words — `StudioEditingTests`, 33 cases) and `Media/FrameGrab.swift`
(`frameGrabName`, the web's spec ported), over what was already there
(`Trim.swift`, `Reconcile.swift`, `MediaDevelop.swift`, `History.swift`,
`ProjectFile.swift`, `ExportVariants.swift`, `OverlayGeometry.swift`). The
Export tab's words and numbers are `Projects/StudioExport.swift`
(`StudioExportTests`, 15 cases); its run is held by a GATE on macOS
(`AtelierTests/Studio/StudioExportGateTests.swift`): a two-second clip painted
there, exported at two variants through the very path the tab runs, each file
read back for its size, length and cadence and for the burnt-in element's own
pixels, plus a trimmed cut and a still. What the project takes from the
shell's LIBRARY — which of its instance media this device lost and how that
is said, what a save keeps meanwhile, the capture day it publishes — is
`Projects/StudioRecovery.swift` (`StudioRecoveryTests`, 12 cases; no web
twin, the rules Trips and Develop keep for their re-fetch).

Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK and compiled by CI alone.

Rows: 154 ✅ · 20 ≠ · 4 ⏳ — plus the deferrals gathered at the end (the Export tab alone: 29 ✅ · 6 ≠ · 1 ⏳).

## Documents (`Store/StudioStore.swift`)

| Web | Native | |
|---|---|---|
| Projects in IndexedDB (`project-store`), one per id | `DocumentStore<ProjectDoc>` — `projects/<id>.json`, the web's own JSON through the kernel's reader and writer | ✅ |
| Kept on a Winnow: local now, remote on idle, the pill (`use-document-sync`) | `DocumentSync<ProjectDoc>` — the 800 ms autosave lands locally, the record goes dirty, the push follows on idle, on leaving (`documentSyncLifecycle`) and on the pill's Save now | ✅ |
| Take theirs / keep as local replace the document UNDER the editor, which remounts | a new GENERATION of the open project; the editor view builds a new editor on it; the owed save is DROPPED first (`onDiscardPending`) | ✅ |
| Deleted here from the pill | the store closes the project and the gallery pops the editor (`closedByDelete`) | ✅ |
| A save owed when the editor is left | flushed on leaving; written on the stored copy even when another project has opened meanwhile, its sync record marked dirty on disk | ✅ |
| Opening asks the instance first (`resume`) | ✅ | ✅ |
| The folder handle (`media.dirHandle`) re-listed on open | its security-scoped BOOKMARK is `media.dirHandle`, listed again recursively on open | ✅ |
| Reconcile id → hash → name; a rename ABSORBED once and persisted (`adoptRenames`) | ✅, the hashes read off the main actor (128 KiB per file, memoised) | ✅ |
| Files the Library holds for the project (a global pool) | the shell's Library FEEDS the project (below), and the project keeps its own working set: its folder, plus its LOOSE files in a side table beside the document (`<id>.locators.json`) — a bookmark per file pointed at, a folder's file by the folder's bookmark and its path, a copy for a Photos pick (in a folder of its own, so it keeps its NAME and date — the ref the web and the Library call it by) | ≠ — the web's project IS the Library's selection, so opening one pours its folder into the pool and a save writes whatever is ticked there; here a project reopens tomorrow on its own table, and the Library's pool is never filled by opening one |
| Returning to the editor resumes it | the editor is KEPT while its project is open (`liveEditor`): the playhead, the selection and the history survive a trip to the gallery | ✅ |
| `#/studio/open/<id>` — another tool hands a project over; the route rewrites itself on arrival, a project already open is revealed, not listed again | `StudioStore.shared.openHandedOver(_:)` — opens the project by id as its card would, then `handedOver` waits for the gallery, which pushes its editor and consumes it (`takeHandOff`); the caller moves the shell with `shellNavigate(.studio)` | ✅ the seam — Trips' own call is its bridge's task |

## The gallery (`Gallery/StudioGallery.swift`, `StudioProjectCard.swift`)

| Web (`ProjectGallery.tsx`) | Native | |
|---|---|---|
| Cards, newest first, the baked thumbnail (nothing decodes the media) | ✅ the autosave's 480 px JPEG, decoded off the main actor | ✅ |
| Grouped by source, one group even with one source | ✅ `source: … · N projects` | ✅ |
| An instance not connected: `NOT CONNECTED — MEDIA MAY BE UNREACHABLE` | ✅ | ✅ |
| The instance's list: checking…, a failure with Sign in | ✅ | ✅ |
| A project only there: greyed, pulled on open | ✅ `openRemote` mirrors, then opens | ✅ |
| Absent sources said, never dropped (`AbsentSourceNotes`) | ✅ | ✅ |
| The WHOLE card opens | ✅ | ✅ |
| `open` on the project last opened here; its verb Resume | ✅ | ✅ |
| Facts line: format · date · length · elements · files | ✅ | ✅ |
| ⋯ → Use as template | ✅ a LOCAL copy, "(template)" | ✅ |
| ⋯ → Move to … (confirmed) | ✅ | ✅ |
| ⋯ → Delete… (confirmed: the media stays) | ✅, the side table and the app's own copies go too | ✅ |
| Busy line (opening… moving… deleting…) | ✅ | ✅ |
| New project, Import in the bar | ✅ the navigation bar | ✅ |
| The dashed tile completing the local grid; a `.atelier.json` dropped on it | ✅ | ✅ |
| Import asks WHERE only when there is a choice | ✅ | ✅ |
| Import = a NEW project, named from the file | ✅ `importedProjectName` | ✅ |
| Empty state with Create / import | ✅ `ContentUnavailableView` | ✅ |
| Two columns on a phone | ✅ | ✅ |
| On paper; the darkroom is the editor's | ✅ | ✅ |

## New project (`Gallery/NewProjectSheet.swift`)

| Web (`NewProjectModal.tsx`) | Native | |
|---|---|---|
| Name | ✅ | ✅ |
| Format — the presets as shape tiles, named by destination | ✅ `StudioAspectGrid` | ✅ |
| Start from: house style / a template | "Blank" / a template — no house style ships with this build, and the sheet says Blank rather than applying one silently | ≠ |
| Keep on (only with a second source) | ✅ | ✅ |
| Media folder (optional), remembered never copied | ✅ a bookmark; its files listed and hashed in the sheet | ✅ |
| A template carries no trims and no develops | ✅ | ✅ |

## The project bar and the banners (`Editor/StudioEditorChrome.swift`)

| Web | Native | |
|---|---|---|
| Back to the gallery (`PageBar`) | the navigation stack's back | ≠ |
| The name, renamed in place; emptied gives the old name back | ✅ in the navigation bar's title | ✅ |
| Undo / redo, always both drawn | ✅ | ✅ |
| The sync pill | ✅ `DocumentSyncPill` | ✅ |
| The save state as a pill (dot + word, the word only where it waits on the author on a phone) | ✅ | ✅ |
| Format chip + gear → settings | ✅ (⇧⌘, on a Mac) | ✅ |
| "N media files were renamed…" (paper) | ✅ | ✅ |
| Missing (paper) / changed (danger) media, Point to the folder, Remove missing | ✅ | ✅ |
| Storage refused | ✅ | ✅ |
| The clip header: ‹ n/N ›, name, size · codec · cadence (or size · type), no telemetry / no exif chip once read | ✅ | ✅ |
| Unreadable `.srt`; a clip that cannot play; a look that will not grade here | ✅ under the stage | ✅ |

## Media (`Store/StudioLibrary.swift`, `Store/StudioStore+Recovery.swift`, `Editor/StudioEditor+Media.swift`, `Editor/StudioEditor+Library.swift`, `Editor/StudioLibraryLink.swift`)

| Web | Native | |
|---|---|---|
| Clips + stills + their `.srt`, grouped by base name (`useActiveAsset(STUDIO_KINDS)`) | ✅ the kernel's `buildAssets` + `usableAssets(studioKinds)` | ✅ |
| The Library's active asset IS the open media (`useActiveAsset(STUDIO_KINDS)`): a click on a row opens it | `.followsActiveAsset(Tool.studio.accepts)`; what is PUT TO WORK in the Library while the editor is on screen (a row, a tile, `Use in Studio`, an instance pick — the Library's `activations`, a second tap on the active row included) joins the project and opens (`StudioEditor.take`, `StudioLibraryLink`) | ≠ — follows the gesture, never the Library's own settle: on a phone every tab's stack stays alive, and opening a project does not take whatever the Library last had active |
| — each file of the capture by what its location IS | a bookmark through `add(urls:)`; a folder's file with its folder's locator (`.folder(bookmark, path)`); a Photos copy into the container under its name and date (`add(receivedCopy:ref:)`); an instance's file for the SESSION (`addFetched`) — its ref kept as the Library holds it (the original's hash, the asset id) | ✅ |
| ‹ › echoes the open media back to the Library (`lib.setActive`), whose row wears the ring | the media on the stage is the Library's active one whenever the Library's selection holds it | ✅ |
| A picture dragged out of the Library onto the stage | `.libraryDropDestination` on the editor — an instance's tile fetched first — beside files and folders from Files or the Finder; "could not be brought from …" when it fails | ✅ |
| The Library one tap away on a phone | the editor hides the tab bar: `LibraryButton` in its own bar | ✅ |
| An instance's media (the Library's Winnow tab), vouched with the original's hash | ✅ the Library registers every fetched file's identity (`registerMediaIdentity`), so the project names it by content, a develop is guarded by the ORIGINAL's hash, and the Export tab's three instance paths wake | ✅ |
| — lost to a reload: the pool is empty and the project says "missing" | re-found when the project OPENS (`StudioStore+Recovery.swift`, the kernel's `Projects/StudioRecovery.swift`): from the Library when it still holds the capture, else fetched back from the ref's `assetId` — only from an instance connected here, one capture at a time, each a task scoped to it with its bytes and a Cancel, into the pool then the project; the media the project was saved on opens when it lands | ≠ — the web's Studio does not fetch back (Trips and Develop do, `architecture.md`); a byte cache stays declined — a fetched file is the session's |
| — what the recovery says | `Fetching 2 media files back from host…`; out of reach (`… which this device is not connected to — connect it in Sources`, Open Sources); refused (its reason, `Not signed in to host`, Sign in there); `host no longer has …`; Try again; the folder banner counts only the rest (`missingOutsideRecovery`) and "Remove missing" leaves them | ✅ native words |
| — a save meanwhile | keeps every ref the recovery still speaks for (`filesKeepingRecovery`): a clip being fetched back, refused or out of reach never falls off the project | ≠ — the web's save writes the working set alone, and drops what the reload lost |
| The Studio's media scope (the Library's instance tab lists a day the tool publishes) | the open media's capture day, MEASURED or absent — its log's first timestamp, a still's EXIF, else a fetched file's capture instant, never a local file's mtime — published as `14 Mar 2025 · Studio`, a tile still opening large (`studioMediaScope`) | ≠ — the web's Studio publishes none; its instance tab asks for a day by hand |
| A still's EXIF: the file's, with what its source vouched for merged under it (`read-exif.ts`) | ✅ `vouchedExif(mediaOrigin, knownIdentity.exif)` — a Winnow proxy's exposure, position and altitude readable at last | ✅ |
| Added from Photos, Files or a folder in the editor | the Add menu and a drop on the editor, as before — beside the Library | ✅ |
| ‹ › steps through the working set; navigation, never an edit | ✅ | ✅ |
| A clip's facts from the container | ✅ `VideoSource.open` | ✅ |
| The `.srt` parsed at scale 1, the cadence measured, re-timed on a change | ✅ | ✅ |
| A still: decoded to the stage budget, its EXIF the ONE cue | ✅ 2560 px, `cueFromExif` | ✅ |
| HEVC the browser cannot decode → in-browser transcode (`TranscodeControl`) | none needed: AVFoundation decodes HEVC | ≠ |
| The media list saved is the working set, never the folder listing | ✅ (an empty working set keeps the stored list, as the web) | ✅ |

## The stage (`Stage/StudioStageView.swift`)

| Web (`use-overlay-stage`) | Native | |
|---|---|---|
| The frame under the playhead, fitted, no view zoom | ✅ `ClipFrameTap`, fitted to the stage's pixels | ✅ |
| Graded through the one grader: the look + the media's develop, one cube | ✅ `FrameGrader`, the cube baked off the main actor | ✅ |
| Grain and halation: the web's Studio stage previews NONE (its exports do) | the film node on the stage too — preview = export | ≠ |
| Overlays burnt in by the export's own drawing at the frame's time and cue | ✅ `OverlayPainter.burnIn` | ✅ |
| A still's deck settled (`settleForStill`), no clock, no scene | ✅ | ✅ |
| Guides (editor chrome, never in a file) | ✅ `GuidesPainter` over the picture | ✅ |
| The selected element's dashed outline (`measureOverlays`) | ✅ | ✅ |
| The selected element ghosted outside its window, reachable | ✅ `ghostId` | ✅ |
| A press hit-tests and selects; a drag moves, clamped, snapped (grid or edges), Alt free | ✅ Option on a Mac | ✅ |
| A tap (no travel) on a phone raises the inspector | ✅ | ✅ |
| A/B: the original LEFT of the divider, any drag moves it | ✅ | ✅ |
| A palette cell dragged onto the stage | ⏳ (`Panels/PARITY.md`) | ⏳ |

## The transport (`Stage/StudioTransportBar.swift`, `StudioTrimBar.swift`, `Editor/StudioPlayback.swift`)

| Web | Native | |
|---|---|---|
| Play / pause | ✅ `AVPlayer`, muted — the preview is for the eye; the export copies the sound | ✅ |
| A play on the out point replays from the in point | ✅ `playStartTime` | ✅ |
| The out point pauses ON the handle, or ↻ loops (a per-frame watch) | ✅ checked about sixty times a second | ✅ |
| Stepping clips while playing hands playback over (`resumeAcrossMedia`) | ✅ | ✅ |
| A scrub coalesced: the latest target when a seek lands | ✅ | ✅ |
| Timecode · trim bar · length | ✅ | ✅ |
| The trim bar: two bands, the handles on the rail, the playhead by its head; the handles stop a frame apart; the picture follows what is dragged; the push both ways | ✅ the kernel's `setStart` / `setEnd` / `pushBounds` | ✅ |
| Each handle and the playhead adjustable a frame per step (VoiceOver) | ✅ | ✅ |
| In/out per clip, bound half, keyed by media name, guarded by duration | ✅ `restoreTrim` / `writeClipTrim` | ✅ |
| The readout line, always drawn: TRIM + span + ↺, or the hint | ✅, the hint learned once | ✅ |
| ⌾ capture the frame: full resolution, graded, burnt in, no chrome, `clip-frame-1m12s.jpg` | ✅ saved through the system's file exporter | ✅ |
| Preview speed menu (and the clip's realtime rate) | ✅ | ✅ |
| A still's bar: STILL + A/B | ✅ | ✅ |
| A lane under the trim bar, one bar per timed element | ⏳ not built on the web either (open item) | ⏳ |

## Keys

| Web | Native | |
|---|---|---|
| Space plays; a text field keeps it | ✅ the editor's focus reads keys only while no field of it types | ✅ |
| ← → a frame, Shift a second | ✅ | ✅ |
| `I` / `O` cut at the playhead, Shift releases the handle | ✅ `trimKeyRange` | ✅ |
| Delete / Backspace removes the selected element | ✅ | ✅ |
| ⌘Z / ⇧⌘Z | ✅ the window's `UndoManager`, every step registered | ✅ |
| A control a CLICK left focused hands Space back to the transport | SwiftUI buttons take no keyboard focus from a tap; the editor re-takes focus when a field or a sheet lets go | ≠ |

## Undo (`Editor/StudioEditor.swift`)

| Web | Native | |
|---|---|---|
| A stack of whole documents watching the one change funnel | ✅ `StudioEdit` is the value; `update` is the funnel the kernel's `History` watches | ✅ |
| Two edits inside 700 ms under one label are one step | ✅ (and one `UndoManager` action) | ✅ |
| Switching clips is navigation, never a step | ✅ | ✅ |
| A restore re-derives the open clip's trim handles | ✅ | ✅ |
| A sheet with its own draft owns the keys while up | ✅ | ✅ |

## The inspector (`Inspector/StudioInspector.swift`, `StudioInspectorDrawer.swift`, `StudioFoldSection.swift`)

| Web | Native | |
|---|---|---|
| Five tabs: Overlay · Style · Grade · Info · Export | ✅ segmented at the top of the column | ✅ |
| Phone: the tabs in the shell's bottom bar (`PanelHost`), the panel a sheet | a DOCKED DRAWER under the stage (0.28 · 0.4 · 0.6) and the tabs as its own strip — the app's tab bar hides inside the editor | ≠ — what the inspector changes is what is watched |
| Picking an element scrolls its settings into view (keyed on the tab too) | ✅ `ScrollViewReader` | ✅ |
| Add an element: a CONTROLLED fold, open only on an empty deck | ✅ `StudioFoldSection` | ✅ |
| The intro scene's section, its window as badge | ✅ | ✅ |
| Outro: Add an outro, or its panel | ✅ | ✅ |
| Elements: the count, Default deck / Reset deck (confirmed) / Keep, the list capped and scrolling | ✅ | ✅ |
| Element style + Timing for the selection | ✅ | ✅ |
| Guides | ✅ | ✅ |
| Reorder the deck (draw order) | a native addition (`ElementListView`'s move) | ≠ |
| Style: one Title style section | ✅ | ✅ |
| Grade: the media's DEVELOP settled row first, then the grade stack | ✅ `DevelopSettledRow` + `GradeStackView` (the still handed to the look gallery's scene) | ✅ |
| Info: the media's facts and the telemetry under the playhead | ✅ `InfoPanelView` | ✅ |
| Export: Output · Variants · Export (+ Send the finals home) | ✅ `Export/StudioExportPanel.swift` — its own table below | ✅ |

## The Export tab (`Export/StudioExportPanel.swift`, `StudioVariantRow.swift`, `StudioFinalsPanel.swift`, `StudioExportModel.swift`, `StudioVariantExport.swift`)

| Web (`StudioEditor.tsx`'s Export tab and the modules it drives) | Native | |
|---|---|---|
| Output · File name, the media's base name as placeholder, kept in `exportPrefs.fileName` | ✅ written through the funnel (a step of undo); the field owns the keys while it types | ✅ |
| Output · Destination: the browser's Downloads, or a folder picked once for the session (Chromium) | a folder asked for AT THE CLICK, every run — pick, then render, then write — and named after the run; a device has no Downloads | ≠ |
| Output · *Delivers* over a still an instance handed as its proxy: the decision's line and reason, then the proxy sentence (`useDeliveryRow`) | ✅ `deliveryDecision` — the one the run takes too | ✅ |
| — the render inside a proxy's RAW original, measured from a megabyte of its head | ⏳ no head probe here yet: the proxy delivers, and the row says so instead of the kernel's "read at export" | ⏳ |
| — a *Delivers* row for every other media | a native addition: the largest frame the variants write, measured against the file that will be encoded (`deliversLine`) | ≠ |
| Output · *From proxy* over a clip an instance handed as its proxy: *Render from the proxy* (For a quick look), off, its hint | ✅ wired, and reached since the Library brings an instance's media into the Studio (not yet driven against an instance) | ✅ |
| Variants · the count as badge, + Variant in the project's format | ✅ | ✅ |
| Variant N, remove (never the last) | ✅ | ✅ |
| Format: Source frame, then every preset as `9:16 — Reels · TikTok · Shorts` | ✅ (a stored id this build does not know stays on screen) | ✅ |
| Resolution: Source · 1080p · 720p; the shortfall in danger (+ "Turn off From proxy…") | ✅ `resolutionShortfall` + `shortfallHint` (a stored short side stays on screen) | ✅ |
| Frame rate (a clip): `Source (29.97 fps)` then the choices; frames duplicated above the source, said | ✅ | ✅ |
| Speed (a clip): Normal · N× · `— real time`; a re-timed row's length and silence, said | ✅ `deliveredSpeedChoices` + `speedHint` | ✅ |
| Overlays: Burn the overlays in, `W×H · file name` beside it | ✅ — and a line saying the outro rides a burnt-in variant only | ✅ |
| The row being rendered counts up (`rendering… 12 s`), one timer for the run | ✅ `TimelineView` on that row alone | ✅ |
| What a row cost (`✓ 367 KB · 16 s · 0.2× realtime`), dropped when its settings change and when another media opens | ✅ kept WITH the variant that produced it, shown only while the row still is that variant | ✅ |
| Export needs WebCodecs (a note where the browser has none) | AVFoundation encodes on every device | ≠ |
| The button: Export JPEG / 3 JPEGs / MP4 / 2 MP4s, its tooltip | ✅ `studioExportVerb` / `studioExportHelp` | ✅ |
| The preview paused before a run | ✅ | ✅ |
| The run as a task: `Exporting <base>`, `N variants`, a bar over the variants, a Cancel | ✅ `TaskCenter`, on the editor's pill; the detail names each variant's FILE where the web names its id | ✅ |
| The line over the bar: Fetching the original from … / Variant 2/3 · 46% / Exporting… 46%, and Cancel | ✅ `studioExportProgressLine` | ✅ |
| A clip's capture fetched ONCE before the first variant (unless from the proxy), a task of its own with its bytes; a failure fails the run | ✅ wired over the connection's client — reached through the Library (not yet driven against an instance) | ✅ |
| A still's original fetched only where its proxy cannot fill the largest frame; a failed fetch costs the pixels, never the delivery | ✅ wired — reached likewise | ✅ |
| A clip variant (`exportVariantVideo`): graded per SOURCE frame at the source's density (the grain's clock), cover-cropped into the variant's frame, the overlays on the source clock with the trim's in point as origin, the cut, the cadence resampled, the speed, a grained clip at more bits, the clip's sound copied | ✅ `StudioVariantExport.video` over `exportProcessedVideo` — held by the gate | ✅ |
| The outro appended as the pipeline's tail, at the variant's frame and cadence, on a burnt-in variant only | ✅ `StudioVariantExport.outroTail` — the gate reads the card after the footage | ✅ |
| The seek fallback for a clip the browser cannot decode (`exportOverlayVideoViaSeek`) | nothing to fall back from: AVFoundation decodes HEVC | ≠ |
| A still variant (`exportPhotoVariant`): graded at its own density, cover-cropped, its SETTLED deck with its one cue, a JPEG at 0.92 | ✅ `StudioVariantExport.still` — held by the gate | ✅ |
| — the still's metadata | the ORIGINAL's EXIF stamped on it (`stampExif`: the block copied whole, signed `Atelier`, an sRGB profile) — the maintainer's rule for a delivered picture; the web's Studio still leaves bare | ≠ |
| Each file delivered as it finishes, replacing a file of that name | ✅ into the chosen folder | ✅ |
| What a variant cost measured around the whole of it, delivery included; the trimmed length as the ratio's divisor; none for a still | ✅ | ✅ |
| Cancel: the encode in flight ends, no later variant starts, the run does not say Exported | ✅ — and says what it kept (`studioExportCancelledNote`) | ✅ |
| `✓ Exported` and the run's total (`describeExportRun`) | ✅ + the folder's name | ✅ |
| The error, in its own words | ✅ ("browser" read as "device") | ✅ |
| Sound or a look the file could not carry as asked | said under the run (`onAudioSkipped`, a look that will not grade here); the web's Studio passes no such callback | ≠ |
| Send the finals home (`SendFinalsPanel`): only after a finished run, only to the instance the media came from | ✅ `StudioFinalsPanel` — wired, reached through the Library (not yet driven against an instance) | ✅ |
| — not connected any more; a viewer account; the files and their weight; a foreign capture and a file over the upload limit refused before a byte moves; the notes | ✅ `finalsPlan` + `canWriteBack`, the web's sentences | ✅ |
| — one request per file with its capture's id, then one reconcile; `✓ N files sent and linked to capture #…`; `N sent, then: …` + Sign in there | ✅ each upload a task with its bytes and a Cancel on the pill | ✅ |

## Project settings (`Inspector/ProjectSettingsSheet.swift`)

| Web (`ProjectSettingsModal.tsx`) | Native | |
|---|---|---|
| Name, format | ✅ | ✅ |
| Cadence: follow the log (the measured label) / by hand, N× slower / faster; a manual figure names the clip it was set for | ✅ `cadenceDraft` / `timeScaleFromDraft` | ✅ |
| Capture-time shift: sign, hours, minutes (quarters), days, Clear | ✅ steppers | ✅ |
| The prose behind an ⓘ per legend | ✅ | ✅ |
| Export settings: the portable half from the LIVE state + the draft | ✅ through the file exporter | ✅ |
| Import a file… → inline confirmation (Replace the settings / Keep mine), Apply disabled meanwhile | ✅ | ✅ |
| House style (dev server only) | read-only words: no house style ships with this build | ≠ |

## The develop sheet (`Inspector/StudioDevelopSheet.swift`)

| Web (`DevelopSheet`) | Native | |
|---|---|---|
| Opened from the Grade tab's settled row, over a photo or the clip's frame at that instant | ✅ | ✅ |
| The preview: the draft develop FIRST, then the look, one cube; the film after it | ✅ | ✅ |
| Histogram of what is shown — the picture as delivered, never the clipping painted on it | ✅ `DevelopSheetPicture.histogram` | ✅ |
| Auto tone / colour, measured on the picture AS SHOT | ✅ | ✅ |
| Light · white balance · curve · levels · mixer · grading | ✅ the Develop panels themselves | ✅ |
| Presets: the personal book as chips, Save… | ✅ `PresetBookStore` | ✅ |
| Apply to the N other media, each under its own hash | ✅ | ✅ |
| Done writes the media's develop (hash-stamped); Cancel drops the draft; nil when as shot; Enter / Escape | ✅ `.defaultAction` / `.cancelAction` | ✅ |
| The picture side is the ONE sheet every host draws (`DevelopSheet.tsx` + the workbench blocks) | ✅ the shared `Develop/Sheet/` — `DevelopSheetFrame` over `DevelopSheetPicture`, the Studio adapting its picture (the stage's own decode), its draft and its grade (`DevelopSheetLook`: the draft develop, then the project's look, one cube, the film after) | ✅ |
| The eyedropper: one click reads the picture AS SHOT through the viewport's own draw, `whiteBalanceFor`, "picked grey · temperature n, tint n" | ✅ `DevelopSheetStage` over `StageGeometry.pointAt`, the wipe and the pan standing down while it is armed | ✅ |
| The before/after wipe (before LEFT, after RIGHT, no split is 0), ◐ hold for before | ✅ `DevelopSheetStage`; `\` holds too | ✅ |
| Always comparing | `A/B` in the bar, remembered on this device, suspended while the dropper is armed | ≠ the Develop stage's switch in the sheet too |
| The view zoom to 4000 % — wheel, pinch, `Z`, the arrows pan once zoomed; smooth ↔ pixels past 1:1 | ✅ `LookingZoom` + `StageZoomPill` (no crop row), a double tap, the Mac's wheel | ✅ |
| The loupe past the stage's 1:1 | "the stage’s pixels, magnified" said on the picture instead | ⏳ the Develop tool has none yet either |
| J paints the clipping; the pixel under the pointer said under the histogram | ✅ `J` or the histogram's end words; `readoutOf` into the `ReadoutStore` | ✅ |
| The session clipboard (Copy · Paste · As shot in the header; ⌘C / ⌘V) — one clipboard for every host | ✅ `DevelopSheetBar` + `DevelopSheetKeys` over `copyDevelop` / `pasteDevelop` | ✅ |
| The fidelity chip and its note — what the picture is, with its pixels (`pictureFidelity`), computed by the sheet | ✅ a still's decoded pixels, a clip's frame unmeasured as on the web; the renditions menu stays the Develop tool's, as on the web | ✅ |

## Deferred, and what each waits on

- ⏳ Driving an instance's media end to end against a real instance: the
  Library feeds the project, the recovery fetches back, and the Export tab's
  three instance paths (a clip's capture before the first variant, a still's
  original where its proxy falls short, the finals home) read the identity
  the Library registered — all written against the client, none run.
- ⏳ The render inside a proxy's RAW original, measured from its head (the
  web's `rawRenderOf`): the app has no session cache of originals
  (`HeldOriginals`) yet.
- ⏳ Trips' side of the hand-off: its bridge calls
  `StudioStore.shared.openHandedOver(_:)` then `shellNavigate(.studio)`.
- ⏳ The develop sheet's loupe — it comes with the Develop tool's.
- ⏳ A palette cell dragged onto the stage; the outro's own stage; the lane
  under the trim bar (not on the web either).
- ⏳ Running any of it on a device.
