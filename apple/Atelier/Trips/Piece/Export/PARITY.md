# Trips piece editor — the EXPORT tab and the Studio bridge, parity with the web

Map task tools-roadtrip-20: `src/tools/roadtrip/panels/ExportTab.tsx` and
`src/tools/roadtrip/StudioLink.tsx`, over the landed exports
(`Trips/Export/TripPieceExport.swift`) and the kernel's `Roadtrip/ExportPlan.swift`,
`Roadtrip/HookScene.swift` and `Develop/DeliverySource.swift`.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's ("this browser" reads "this device").
Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK, parse-checked, and is compiled by CI
alone.

Rows: 54 ✅ · 8 ≠ · 2 ⏳

Files: `ExportTabView.swift` (the tab, the plan, the formats, the words),
`PieceDeliversRow.swift`, `PieceDelivery.swift` (where the files go, and the
model's `requestExport` / `folderPicked` / `handOnDelivered`),
`PieceStudioBridge.swift` (the bridge's logic), `PieceStudioLinkView.swift`
(its view).

## What goes out (`ExportTab.tsx`, first section)

| Web | Native | |
|---|---|---|
| The plan LEADS: one line per slide, `01 · still` / `02 · 4.0s 2×`, then the file | `PiecePlanList` over the kernel's `exportPlan` — deciding nothing, reading the deck | ✅ |
| ` · silent` after a re-timed clip's name; the whole name in the tooltip | a muted suffix; `.help` | ✅ |
| A blocked line struck through, never hidden | `.strikethrough`, faint | ✅ |
| The blockers, each once, in red | `plan.blockers` | ✅ |
| The section's badge: `3 files · 2 images and 1 clip` | `describePlan` as the section's tag | ✅ |
| The hook's reason spelled out under the list | `PieceExportWords.reasonSentence` (the web's `reasonSentence` from `SlideDelivery.tsx`, kept private to this tab so the Content tab's port owns its own) | ✅ |
| The last export's note at the head | `exports.note`, selectable | ✅ |
| ⓘ: each slide leaves in the format it IS; originals only where the proxy falls short | the section's info — its originals sentence says this device does not fetch one for a piece yet | ✅ |
| *Delivers*: what the OPEN picture gives the deck's 1920 frame, the calculator's sentence | `PieceDeliversRow` over `fixedFrameDelivery` / `deliversLine` | ✅ |
| Measured only while the Export tab is up | the row lives in the tab; `.task(id:)` on the file | ✅ |
| Never for a collage (each cell is a fraction of the frame) | "—" and the web's hint | ✅ |
| A picture that moves is measured at its DEEPEST zoom | `deepestFraming(cellFraming, cellMotion)` | ✅ |
| "measured for the picture on screen, once it is in the Library" while nothing is | the same hint | ✅ |
| A RAW measured through the render inside it (`viaRawPreview` → `Camera render`) | `PictureDecoder` (render first, lazy image: nothing decoded to learn a size) | ✅ |
| *Delivers* names the original by its FILE where `Auto` would fetch it | the line stays the file in hand's; the hint names the original and says the proxy is what leaves here | ≠ this device's export does not fetch originals yet (row below) — a line naming a file the run will not read would lie |
| An original FETCHED where the proxy would upscale (`deliveryFor`), held for the session | — | ⏳ the export's resolver (`TripExportInputs.resolve`) taking `deliveryFor` with the Library's `MediaOrigin` and a Winnow fetch |
| A proxy over a RAW: the render inside the original read from its head | said: "this device does not read that render's size yet — the proxy is what leaves" | ⏳ the same, with `rawRenderFrom` over a head fetch |
| *Everything as images* — the one override; the medium changes, the reason never | `OverlayPanelToggle` → `exportPlan(imagesOnly:)`, view state as on the web | ✅ |
| *Export the piece*, disabled while running or when nothing can be written | `PieceExportRun` (`files == 0`) | ✅ |
| Its running line in place of its word | `exports.exporting` as the label | ✅ |
| Cancel on the task pill | also a Cancel beside the running button, as Develop's and the Studio's tabs carry | ✅ |
| "This browser cannot encode video…" blocker | `canEncode: true` — AVFoundation always writes H.264 | ≠ evaporates |
| An HEVC clip the browser cannot decode → `TranscodeControl` (ffmpeg.wasm) | nothing to transcode: this device decodes H.265 as it is; said in the ⓘ | ≠ evaporates |

## Where the files go (`use-post-exports.ts` + `deliver-files.ts`, as the tab drives them)

| Web | Native | |
|---|---|---|
| ONE folder, asked for AT THE CLICK, before a pixel is rendered | `PieceDelivery`: the verb asks, the tab's `.fileImporter([.folder])` answers, the run starts from the answer | ✅ |
| A file of the same name in that folder is replaced (`replace: true`) | `PieceDelivery.copy` removes, then copies | ✅ |
| "n files written · k failed to write" | the export's note, then `into <folder>`, then one red line per file that failed | ✅ |
| Where no directory picker exists, each file is DOWNLOADED | *Into: A folder · Share* — the share sheet holds the files (Photos, AirDrop, Files, another app) until Done | ≠ a device has no download folder; the share sheet is its other way. A device choice (`UserDefaults`, `atelier.trips.exportInto`), never on the document; Share by default on iPhone/iPad, a folder on the Mac |
| "No folder was chosen — nothing was rendered." on a dismissed picker | a dismissed picker runs nothing and says nothing | ≠ the dismissal is not reported reliably without `onCancellation`, and a sentence guessed from a binding could follow a real pick |
| "No folder could be chosen" when the picker itself fails | `PieceDelivery.refused` | ✅ |
| Every export asks the same way — the header's word and the tab's escapes | `requestExport(_:)`; the header's Export goes through it too (the tab raised to ask on a folder) | ✅ |
| The header's Export switches to the Export tab, where its report is written | `exportPiece()` sets the tab; a Share run raises the tab on its files | ✅ |
| The run's temporary folder let go once handed on | `discard()` after the copy, or on Done | ✅ |
| A run started around the delivery | falls back to the workbench's file mover (unchanged) | ✅ |

## One format at a time (second section)

| Web | Native | |
|---|---|---|
| "All n slides as PNGs" / "The slide as a PNG" | `requestExport(.deck)` | ✅ |
| "As a video · n.ns" only when the HOOK SLIDE is a video — the slide's medium, never the file's type | `slides.first?.medium == .video` | ✅ |
| Its length clamped to the clip in hand | `model.hookLength` (`hookSecondsWithin`) | ✅ |
| Both disabled while an export runs | also while the files are being written into the folder | ✅ |
| ⓘ: the hook from its in point, audio copied / re-timed silent / painted silent, or "Give the hook a picture…" | `formatsSentence` | ✅ |
| …and which grade: each picture's own, the piece's, the trip's, or none | the HOOK's grade and rung, and `countOwnGrades` | ✅ |

## Studio (`StudioLink.tsx`, third section)

| Web | Native | |
|---|---|---|
| ⓘ: an intro scene + the outro; a resend replaces; the shades' shape stays | the section's info | ✅ |
| Linked: the project as a card — its thumbnail, its name, "hook in the project" / "no hook sent yet" | `PieceProjectCard` (the Studio's baked `thumbnail`) | ✅ |
| "Send the hook and open the Studio" / "Update the hook and open the Studio", the busy word in its place | the prominent button | ✅ |
| The badge sent as the `roadtrip-hook` intro scene, replacing the last (`hookInjection` → `withHook`), named after the piece or "Trip hook" | `PieceStudioBridge.send` | ✅ |
| The badge exactly as the stage draws it | `badgeElements` over the model's `content` | ✅ |
| The shades cross as ONE flat scrim (`scrimFromShades`) | inside `hookInjection` | ✅ |
| The closing card into the OUTRO when the piece closes on it; unticked takes a sent card back out | `ctaOutro` → `withCtaOutro` | ✅ |
| An outro the author composed is never overwritten — "The closing card stayed here…" | `withCtaOutro` nil → the sentence | ✅ |
| The hook picture's develop, marked `via: roadtrip`; the author's own stays — "The picture’s correction stayed here…" | `withHookDevelop` | ✅ |
| "Send without leaving" → "Sent. Open the Studio to export." or "Sent. <what stayed>" | the same | ✅ |
| "Open the project" → `#/studio/open/<id>` | `StudioStore.openHandedOver` then `shellNavigate(.studio)`; the phone's sheet let down first so it does not cover the Studio | ✅ |
| Unlink: the hook and the sent card (and the sent develop) back out; the link dropped | `withoutCtaOutro(withoutHook)`; no write when there was nothing to take | ✅ |
| No badge → the sends disabled, "There is no badge to send — the trip’s dates cannot be read." | the same | ✅ |
| What a send carries, in one line | `carries` | ✅ |
| Which grade a reel from the project uses; "Give the project <the trip’s / this piece’s / this picture’s> grade" when it has none and this does | `gradeBox` over the HOOK's grade and rung | ✅ |
| …never over a grade the project has — "…it was left as it is." | `pushGrade` | ✅ |
| The grade given: the layers and the output transform | the same — the film texture does not cross, as on the web | ✅ |
| Not linked: every project with its thumbnail, name and date; a click links | `PieceProjectRow`, a list that scrolls past four | ✅ |
| "+ Create a project for this clip" / "+ Or create one for this clip" — named after the piece, the file or "Day <date>"; no folder, no media | `create` (`createProjectDoc`, `ProjectMedia.empty`) | ✅ |
| "No Studio projects in this browser yet." | "No Studio projects on this device yet." | ✅ |
| A linked project gone → "That project is gone from this browser. Link another one.", the link dropped | the same, device words | ✅ |
| "The browser refused to save the project." | "The project could not be saved on this device." | ≠ words: a device write fails for a reason, not a refusal |
| The project read and written through `getProject` / `putProject` (IndexedDB) | through the Studio's own store — `StudioStore.stored`, `.saved` (a project kept on an instance goes dirty and is pushed there), `documents.put` for a new one | ✅ |
| — | a write to the project OPEN in the Studio flushes its editor's owed save, closes it, writes, and opens it again from the new copy | ≠ native only: the Studio keeps its editor alive while a project is open, and its next autosave would write its own copy back over the send; the web's Studio re-reads the project on arrival |
| — | the project list re-read on appearing and when the link changes | ≠ the web lists once per mount; this also catches a project made in the Studio meanwhile |

## Edits outside this folder

- `Trips/Piece/PendingTabs.swift` — the EXPORT stand-in block deleted.
- `Trips/Piece/PieceEditorModel.swift` — one stored property, `let delivery = PieceDelivery()`, beside `exports`.
- `Trips/Piece/PieceEditorView.swift` — the header's Export calls `requestExport(.piece(imagesOnly: false))`; the workbench's `handOn()` asks `handOnDelivered()` first and keeps its file mover as the fallback.
