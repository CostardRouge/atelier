# Trips — what the screens draw with and keep documents in: parity with the web

The web's side is `src/shared/roadtrip/trip-store.ts` + the document funnel of
`src/tools/roadtrip/RoadTripTool.tsx`, `badge-render.ts`, `hooks/scrub-paint.ts`,
`hooks/map-paint.ts`, `hooks/drive-paint.ts`, `shared/media/cell-paint.ts`
(already `Paint/CellPainter.swift`), `slide-render.ts`'s drawing half,
`deck-export.ts`, `hook-video-export.ts`, `thumbnail.ts`,
`src/tools/roadtrip/use-hook-pictures.ts`, `use-trip-grade.ts` (its render
half) and `use-post-exports.ts`. The screens themselves are the next task; this
is what they call.

✅ built · ⏳ deferred (why, and what it waits on) · — not applicable natively (why)

## The store (`Store/`)

| Web | Native | |
| --- | --- | --- |
| One document per trip, the web's JSON | `TripDoc: StoredDocument` over `DocumentStore<TripDoc>` (`trips/<id>.json`) | ✅ |
| One sync record per remote trip, beside it, never on it | `trips/<id>.sync.json` (`DocumentStore`) | ✅ |
| The wire: `toWireDoc` drops `sourceId`; `fromWireDoc` stamps id + source from the request | the kernel's `toWireDoc(_: TripDoc)` / `fromWireDoc(trip:…)` | ✅ |
| A move goes through the portable half, keeps id and birth, nulls `projectId` | `TripDoc.moved(to:now:)` | ✅ |
| One small JPEG per post — the hook as last composed | `TripThumbs` (`trips/thumbs/<post>.jpg`) | ✅ |
| `THUMB_LONG_EDGE` 640, `THUMB_QUALITY` 0.72, never upscaled | kernel `thumbSize` + `TripThumbs.jpeg(from:)` | ✅ |
| The hook taken from the stage's own frame | `TripsStore.keepThumb(_:frame:)` | ✅ |
| Thumbs pruned when a post or a trip is deleted | `deletePost`, `deleteLocal`, the pill's delete-here, `TripDiskStore.deleteTrip` | ✅ |
| (native) orphans a delete made elsewhere left | `sweepThumbs()` | ✅ |
| `listTrips` newest first, junk skipped | `DocumentStore.list()` | ✅ |
| The kernel's `TripStore` for `pushTrip` / `mirrorTrip` / `moveTrip` | `TripDiskStore` | ✅ |
| `handleChange`: on screen now, on disk after 800 ms | `TripsStore.change(_:label:)` | ✅ |
| The record dirty only once the local write landed | `flush()` → `sync.edited` | ✅ |
| A push never carries a trip older than the screen | `sync.beforeFlush = flush` | ✅ |
| "This trip could not be saved" banner | `storageFailed` (the words are the screen's) | ✅ |
| `updatePost` stamps the trip | `updatePost(_:)` | ✅ |
| Undo: whole documents, one label per screen, 700 ms merge | kernel `History`, labels `trip` / `post:<id>` | ✅ |
| ⌘Z native | the window's `UndoManager` mirrors every step | ✅ |
| A replaced document resets the history, drops the held write | `replaceOpen(_:)` | ✅ |
| Open keeps the in-memory copy when it is as new as the listed one | `openTrip(_:)` | ✅ |
| Resume on open: a clean mirror takes a newer copy silently | `DocumentSync.resume` | ✅ |
| Keep mine / take theirs / keep as local / delete here | `DocumentSync` (the pill is `Sources/SyncPill.swift`) | ✅ |
| Gallery: groups per source, create THERE first, delete there first | `DocumentGalleryModel<TripDoc>` (generic, landed) | ✅ |
| `.roadtrip.json` export / import | kernel `TripFile`; the verbs are the screens' | ⏳ screens |

## Painting (`Paint/`)

| Web | Native | |
| --- | --- | --- |
| `renderBadge` order: ground → picture or cells → opener → shades → QR → badge | `BadgeRenderer.render` | ✅ |
| Default ground `#100f0d`, the canvas cleared first | `BadgeRenderer.ground` | ✅ |
| Graded at SOURCE density, then framed | `BadgeSource.picture(grader:gradeKey:)` → `CellPainter.drawFramed` | ✅ |
| The grader is caller-owned | `SlideRenderer` owns one per look; exports make their own | ✅ |
| `holdGrades`: graded once per change, never per repaint | `BadgeSource` holds the graded picture per grade key | ✅ |
| `framingOnClock` — a moving picture on a played slide, the rest when settled | `BadgeRenderOptions.motion` / `SlideClock` | ✅ |
| Collage: `resolveCollage`, `collageCellMotions`, each cell graded with ITS develop, `framingAt` per cell under a clock | `BadgeRenderer.paintCollage`, `SlideRenderer.options` | ✅ |
| A collage's exit only on a surface with screen time | `CollageRender.seconds` (clock only) | ✅ |
| `paintShades`: linear / radial, radii vs the shorter side, `rgba()` pass-through for a non-hex colour | `ShadePainter` over the kernel's `shadeGradient` | ✅ |
| `shadeGradient` itself (grid, follow modes, falloff, core, centre) | kernel `ShadeGradient.swift`, every case of `shades.test.ts` | ✅ |
| QR under the text | `QRPainter.drawQr` | ✅ |
| `drawOverlays` with `elementsAt` at the clock, `originSeconds` 0, `ghostId` | `BadgeRenderOptions.elementsNow` / `overlayOptions` | ✅ |
| `measureBadge` — hit boxes as painted | `BadgeRenderer.measure`, `SlideRenderer.measure` | ✅ |
| `ensureOverlayFonts` + `live()` before the paint | the faces are registered at launch; a paint is synchronous | — |
| `loadBadgeSource`: upright, RAW render first, a refusal said | `BadgeSources.load` (via `PictureDecoder`) | ✅ |
| A clip SEEKS rather than re-decoding | `BadgeSource.seek(_:)` over `ClipStills` | ✅ |
| `boundSource`: a still within the stage's pixel budget, never enlarged | `BadgeSources.load(…, budget:)` | ✅ |
| `loadBadgeSource(maxWidth)` — a rail cell decoded small | `budget:` in pixels (the web's width cap ENLARGES a small picture; not copied) | ✅ |
| `fitPhotoForRender` — a still past the GPU's edge fitted first | Core Image renders in tiles | — |
| `loadCollageSources`: a missing cell is empty, never a failed slide | `BadgeSources.loadCollage` | ✅ |
| `slideRender` → what a slide is made of | kernel; `SlideRenderer.render` caches it per slide | ✅ |
| `lutFor` / `filmFor`: the grade a picture WEARS baked with its develop; the closing card never graded | `TripSlideLooks.cube` / `film` / `grader` | ✅ |
| A look this device cannot resolve is said | `TripSlideLooks.missingWords` (the render plan's resolver, `DevelopLooks`) | ✅ |
| The live editing stack (strength slider's deferred bake) for the open picture | the screens' look panel | ⏳ screens |
| Défilé: flash or the empty day's ink, the dip, band + track with a 13-stop edge fade, ticks, head in three shapes, its glow | `ScrubPainter` over `ScrubFrame` | ✅ |
| Itinerary: backdrop + veil, plate, graticule clipped to the box, path ahead / drawn over their underlay, context, stems, dots + numerals, pins, names with halos, pen (dot / plane), card, strip + veil + ring, compass, distance; round caps and joins | `MapPainter` over `MapFrame` | ✅ |
| Names measured by the canvas for the label placement | `HookPaint.labelWidth` (Core Text, label face, 600) | ✅ |
| Virée: paper, backdrop, graticule, vignette, road (dashed ahead), trail + halo, dots, ripple, names, prints with stacked shadows, the car's shadow and faces, compass, scale bar, distance, fill | `DrivePainter` over `DriveFrame` | ✅ |
| Virée's reveal: the map painted whole, laid over at a falling alpha | ONE transparency layer at `DriveFrame.alpha` | ✅ |
| A text halo: `strokeText` under `fillText`, round joins | `PaintCanvas.strokeText` + `lineJoin` (added) | ✅ |
| The opener's pictures: wants of `day` media, the budget split in steps, `coverCrop` / `wholeCrop` at decode, graded with the piece's look, one problem line per picture | `HookPictureLoader` | ✅ |
| …fetched from the instance when the Library does not hold it | the resolver's job (the Library / Winnow on native) | ⏳ Library screens |
| …kept across edits, only a changed want decoded again (`sig`) | the loader decodes the set it is given; keeping it is the screen's | ⏳ screens |
| The render gate: preview = export resampled | `AtelierTests/Trips/TripsRenderGateTests.swift` (every opener + the badge at two sizes) | ✅ |

## Deliveries (`Export/`)

| Web | Native | |
| --- | --- | --- |
| `renderDeck`: every slide settled, one long edge (1920), numbered against the WHOLE deck, a failed slide skipped | `DeckStillsExport.render` over `deckStills` | ✅ |
| PNG (lossless, text is the point) | `TripStillFormat.png` | ✅ |
| (native) JPEG on request, the name's extension following | `TripStillFormat.jpeg(quality:)` | ✅ |
| Cancel between two slides, keep what rendered | `isCancelled` | ✅ |
| `exportHookStillVideo`: a photograph painted frame by frame through the stage's render, graded ONCE (frozen grain), its bed from the score | `SlideVideoExport.painted` → `encodeFrames` | ✅ |
| …the bed rendered ahead of the AAC priming | rendered at its own time: `AVAssetWriter` keeps the priming in its edit list (`native-app.md`) | — |
| A collage slide as a painted video, sized from a nominal 4096 of the frame's shape | `SlideVideoExport.painted` | ✅ |
| `exportHookVideo`: a clip cut to `hookRange`, graded per SOURCE frame, framed, opener + shades under the badge, on the DELIVERED clock | `SlideVideoExport.clip` → `exportProcessedVideo` | ✅ |
| The clip's sound copied; re-timed ships silent; the bed a silent clip's track, mixed only on `mixWithSource` | `VideoExportOptions.bed` / `mixBed` | ✅ |
| `hookSourceProblem` said before encoding | `SlideVideoExport.clip`, `runHookClip` | ✅ |
| The hook clip no longer than the clip in hand (`hookSecondsWithin`) | `TripPieceRuns.runHookClip` | ✅ |
| A burned-in CONTENT slide's caption without the trip's title style (`theme: null`) while its still takes it | mirrored as the web does it — a web inconsistency, recorded here | ✅ |
| `exportPiece`: the plan first, stills in one pass then clips, a failed clip costs itself, cancel keeps what was made, the note's words | `TripPieceExport.exportPiece` | ✅ |
| `exportDeck`, `exportHookClip` and their notes | `TripPieceExport` | ✅ |
| Every run a TASK with its line, its ratio and a real Cancel (`piece:<id>`) | `TaskRegistry` | ✅ |
| `pixelsForStills` / `deliveryFor`: an original fetched where the proxy would be upscaled (O2 / R5) | waits on a native Winnow originals fetch | ⏳ Sources |
| The folder asked for AT THE CLICK, then written | files land in a temporary folder the screen hands on (`fileExporter`, share sheet), then `discard()` | ⏳ screens |
| `undecodable` + the ffmpeg.wasm transcode offer | AVFoundation decodes HEVC | — |
| `isEncodeSupported` | every device here has an H.264 encoder | — |
| The combined reel (one file per deck) | not built on the web either (open item) | ⏳ web first |

## Counts

Store 23 ✅ · 1 ⏳ — Painting 29 ✅ · 3 ⏳ · 2 — — Deliveries 14 ✅ · 3 ⏳ · 3 —
(78 rows: 66 ✅, 7 ⏳, 5 —).

Nothing here has run on a device. The gate runs on CI's macOS job; every file
was type-checked on Linux against stubs of the Apple frameworks before it was
committed.
