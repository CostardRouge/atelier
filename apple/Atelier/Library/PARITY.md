# Library — parity with the web app

The shell's LIBRARY, shared by every tool: the web's
`src/shared/library/` (`AssetLibraryContext.tsx`, `asset-drag.ts`,
`use-asset-drag.ts`, `use-active-asset.ts`), `src/app/AssetSidebar.tsx`,
`DayPicker.tsx`, `WinnowScopeGrid.tsx`, `WinnowLightbox.tsx`,
`WinnowBrowser.tsx`, the Library's place in `App.tsx`,
`src/shared/sources/media-scope.tsx` + `scope-override.ts`,
`src/shared/sources/winnow/WinnowThumb.tsx` + `cache-heal.ts`,
`src/shared/ui/MediaLightbox.tsx` + `use-media-viewer.ts` +
`MediaActionRow.tsx` (decisions in `docs/memory/architecture.md`,
`frontend.md`, `renditions-build.md` R6) against this folder. ✅ built ·
⏳ deferred (why, and what it waits on) · ≠ built differently on purpose (why).
Nothing here has run on a device: every ✅ is written and reasoned, compiled by
CI; the pure halves are the kernel's (`Library/*`, `Sources/MediaScope.swift`,
`Sources/ScopeOverride.swift`, `Sources/Winnow/*`) and are held by its specs.

Where things are:

| File | Holds |
| --- | --- |
| `LibraryStore.swift` | the pool: entries, assets by base name, selection, active, covers, adding (files, folders, Photos, fetched), removing, hashing, the bookmark file |
| `LibraryFiles.swift` | `LibraryLocation` (bookmark · folder + path · session copy), opening under scope, the head / hash readers, a cover |
| `SessionOriginals.swift` | a lightbox chip's fetched file, held for the session under the kernel's byte ceiling |
| `MediaPublications.swift` | the bus a tool publishes on: `MediaScope`, `MediaActions`, `.publishMediaScope`, `.publishMediaActions` |
| `ActiveAsset.swift` | `activeState(kinds)`, `.followsActiveAsset(kinds)`, `stepActive` — `use-active-asset.ts` |
| `AssetDragging.swift` | `AssetDragItem`, `DroppedAsset`, `.assetDragSource`, `.libraryDropDestination` |
| `LibraryInstanceModel.swift` | the instance tab: span, override, rows, pick, the days beside |
| `LibraryView.swift` | the panel (docked column or sheet body): tabs, add, filter, rows / tiles, the instance's controls, footer |
| `LibraryTiles.swift` | a row, a sheet tile, an instance tile |
| `LibraryDayStepper.swift` | `‹ day ›`, its line, the month (strip or calendar) |
| `LibraryDock.swift` | the dock (column or rail), the phone's `LibrarySheet`, `\.openLibrary`, `LibraryButton`, the instruments' bridge |
| `WinnowThumbView.swift` | the thumbnail that retries, `LibraryHeal` |
| `WinnowCullMark.swift` | Winnow's culling, read: the mark and the filter line |
| `MediaLightbox.swift` | the ONE lightbox: deck, zoom, gestures, keys, chips |
| `LibraryLightboxes.swift` | its two callers: the pool's files, an instance's rows |
| `MediaActionRow.swift` | the verbs a tool published, under a picture |
| `WinnowBrowserModel.swift`, `WinnowBrowserSheet.swift` | "browse all" |
| `LibraryFixtures.swift` | the previews' pool, instance and lightbox |

## The pool — `AssetLibraryContext.tsx`

| Web | Native | |
| --- | --- | --- |
| ONE pool every tool reads, filtered to what it accepts (`usableAssets`) | `LibraryStore.shared`, in the environment from `RootView`; `usable(_:)` | ✅ |
| Files grouped by base name: clip + `.srt` one `video+telemetry` asset, a RAW's image slot yields to its JPEG and the RAW is KEPT as a sibling | the kernel's `buildAssets` over every entry's ref | ✅ |
| `addFiles`: a duplicate (same name, size, date) ignored; what lands is SELECTED | `add(urls:)`, `add(photos:)`, `addFetched(_:)` → `insert` | ✅ |
| Add files · add a folder (every depth) · drop files or a folder | `.fileImporter` (files, or `.folder`), `.dropDestination(for: URL.self)` on the panel and the rail; a folder listed with `LibraryFiles.listFolder`, hidden files and packages left out | ✅ |
| — | Photos (`PhotosPicker`, `.current` encoding so a RAW stays a RAW), copied for the session — the one way a pick has bytes | ✅ native addition |
| The pool is a tab's memory: a reload empties it | what the person POINTED AT (a file, a folder) is kept by security-scoped bookmark (`library/library.v1.json`) and back at launch; what was COPIED or FETCHED is the session's, its folder emptied at the next launch | ≠ an app is launched and ended by iOS at will; a pool forgetting every folder at each launch would be the worst of both. Bytes are still never cached |
| Handles, never bytes: covers read lazily when a row asks, three at a time, newest first | `ensureCover` over the kernel's `DecodeQueue(slots: 3)`, detached reads | ✅ |
| A cover: thumbnail, pixel size, duration, `RAW`/`JPEG`…, the `.srt`'s cadence | `LibraryCovers.read`: ImageIO thumbnail at 320 (a RAW through its render), size as SHOWN, AVFoundation poster + duration + size as it PLAYS, `TelemetryTrack(text:).reading` | ✅ |
| HEVC a browser cannot decode goes through the transcode store | nothing: the device decodes HEVC | ≠ nothing to work around |
| Media identity by content: the web hashes a file when a tool stores it (`hashedMediaRefs`) | each file's `partialHash` computed off the main actor as it lands, kept on its ref, so a roll or a piece names it by content at once; a fetched file is vouched for with the ORIGINAL's hash and never hashed on its own bytes | ≠ earlier, same hash |
| `remove(id)` — the capture leaves with ALL its files (`assetFiles`) | `remove(_:)` | ✅ |
| `removeFile(file)` (the telemetry page detaching a sidecar) · `clear()` | `removeFile(_:)`, `clear()` — no caller yet (the instruments keep their own shelf) | ✅ |
| `toggle`, `select(ids, on)`, "all / none" per tab | `toggle`, `select(_:on:)`, the filter row's ALL / NONE | ✅ |
| `activeId`, `setActive`; a click activates AND selects | `activate(_:)`, `setActive(_:)` | ✅ |
| — | `activations`: bumped by every putting to work (`activate`), a second tap on the active row included, never by an echo — what a tool keeping its own working set follows (the Studio) | ✅ native addition |
| `useActiveAsset(kinds)`: the usable selection, the effective active one echoed back, its cover asked, ‹ › | `activeState(_:)`, `.followsActiveAsset(_:)`, `stepActive(_:by:)` | ✅ |

## Where it lives — `App.tsx`, `frontend.md`

| Web | Native | |
| --- | --- | --- |
| Docked at the LEFT everywhere but a phone | `.libraryDocked(…)` on the sidebar's detail (iPad regular, Mac) | ✅ |
| Collapsed to its rail by default below 1180 px, the choice remembered PER SIZE (`atelier.library.collapsed`, `…collapsed.medium`) | `LibraryDock`, `modeForWidth` on the window's measured width, the same two keys | ✅ |
| An empty Library with no instance starts as the rail; opening it once is the wish, the first file lets the preference rule again | `peeked` | ✅ |
| The rail: expand, an Add menu (files, a folder, Connect a Winnow while none is), the count, `LIBRARY` upright | `LibraryRail` (+ From Photos) | ✅ |
| A phone: a SHEET at its tallest rest, opened from the bottom bar's cell — ONE bottom menu, the Library's cell FIRST on every screen | the `TabView`'s first item, a cell that opens `LibrarySheet` (`.large`) and is never the selected tab | ✅ |
| The bar is drawn on every tool screen, so the Library is always one tap away | a phone's editor HIDES the tab bar (Develop's workbench): `LibraryButton` in its own bar opens the same sheet (`\.openLibrary`) | ≠ one bottom menu is the tab bar; an editor with a docked drawer has no room for a second |
| The sheet closes when the tool or the layout changes | it lives on the phone's `TabView`, and a verb that moves to a tool closes it (`shellNavigate`) | ✅ |
| A tool's SECTIONS in the thumb zone (`SectionRail`) | not the Library's: a tool's sections are its drawer's strip (`Develop/Inspector/InspectorDrawer.swift`) | ⏳ each tool's own screens |
| The instrument pages read the one Library | an asset put to work while an instrument is on screen is handed to the instruments' shelf (`LibraryShelfBridge`) | ≠ the instruments were ported with their own shelf; the bridge feeds it rather than rewriting them |

## The panel — `AssetSidebar.tsx`

| Web | Native | |
| --- | --- | --- |
| `Library` + `COLLAPSE ⟨` (docked only) | `LibraryPanel.header` | ✅ |
| Two tabs that never mix, `Local` and the instance (short host, counts, the full host in its hint), a cog to Sources; remembered (`atelier.library.tab`); no instance, no second tab | `tabs`, `@AppStorage("atelier.library.tab")` | ✅ |
| No instance: the cog, "or connect a Winnow" | ✅ (a phone's sheet says `SOURCES` beside the cog) | ✅ |
| The add zone: "Drop files or a folder", Add files / a folder, the notice when nothing could be read | `addRow`; a phone's sheet one line (`ADD files · a folder · photos`) — dropping is a desktop gesture | ✅ |
| Filter by file name, `Filter N assets…` | `filterRow` | ✅ |
| A ROW: tick, an 80×56 cover that is its own target (looking and putting to work are two verbs), name, facts (`JPEG + DNG · 20.7 MB`, the cadence), kind chip, ✕ under the pointer, `+DNG` / cadence / fps chips on the cover | `LibraryAssetRow` | ✅ |
| ✕ under the pointer | on a Mac under the pointer; on a touch screen the row's context menu (Look · Use in this tool · Remove) | ≠ no hover on glass |
| A TILE on the sheet: the picture SETS it, ⤢ in a corner looks at it, the name on the tile, `+DNG` | `LibraryAssetTile` (66 pt, a pixel height) | ✅ |
| A tool that cannot use an asset: dimmed, not activatable, not draggable | `usable` | ✅ |
| On the instance's tab, the pool's assets from it that the span does not list: "Also in the library" | `outOfScope` | ✅ |
| Footer: `N selected · M usable by <tool>`, ⓘ (handles / proxies) | `footerLine` (docked) | ✅ |

## The instance tab — `media-scope.tsx`, `scope-override.ts`, `DayPicker.tsx`, `WinnowScopeGrid.tsx`, `use-scope-rows.ts`, `use-pick.ts`, `use-neighbour-days.ts`

| Web | Native | |
| --- | --- | --- |
| A VIEW of what the instance holds for the SPAN the active tool publishes (`usePublishMediaScope`), else a day picked here | `MediaPublications.scope` → `LibraryInstanceModel.published`; `manualDay` | ✅ |
| Its eyebrow: `<label> · <publisher>`, or `A day` | `instanceControls` | ✅ |
| The stepper `‹ day ›`: looks BESIDE the tool's day without moving it (an override anchored to it, dropped when the tool opens another), worn in the accent with `↺ <the tool's day>`; from a span's edges; nothing after today | `LibraryDayStepper`, the kernel's `viewedSpan` / `overrideTo` / `stepOut` | ✅ |
| Its line: where against the anchor or today · what the instance answered, a dot that PULSES while asking | `stepperWhere`, `stepperCount`, `LibraryAskingDot` | ✅ |
| The month: a STRIP (a bar a day, a floor) or a CALENDAR, remembered (`atelier.library.month-view`); the tool's days and its span marked underneath; one request in the tab's half | `LibraryMonthPanel` in a popover | ✅ |
| `All · Incoming · Gallery`, SENT to the instance (a local filter would run after the cap), remembered (`atelier.library.winnow.half`) | `halfPicker`, `setHalf` | ✅ |
| Rows asked LIVE (400 at most), re-asked when the span or the half changes, the last answer forgotten first; never while the tab is closed | `rowsKey` / `loadRows` in a `.task(id:)` | ✅ |
| Skeleton tiles while asking; "Nothing here matches the filter."; a problem line with "Sign in there" and "ask again" | `instanceGrid`, `LibraryProblemLine` | ✅ |
| The empty day is said by the stepper, not by the grid (`announce: false`) | ✅ | ✅ |
| A tile: the thumbnail, `▶ srt`, ✓ in the library, the active ring — two facts drawn independently — and `fetching…` | `LibraryInstanceTile` | ✅ |
| — | the row's fetch as a hairline on the tile's edge (`TaskEdge`, scope `<host>/<id>`) | ✅ native addition |
| A click means what the TOOL says (`MediaScope.intent`): `pick` fetches and activates, else it opens large | `looks` | ✅ |
| One picture per click: the PROXY, its `.srt` alongside, vouched for with the original's hash, dated at the CAPTURE; one already in the pool is activated, never fetched twice | `pick(_:)` over the kernel's `materialize(fidelity: .proxy)` | ✅ |
| `materialize` REGISTERS each file's identity (`registerMediaIdentity`), so every tool reads its origin, its original's hash and URL (`mediaOrigin`, `knownIdentity`) | `addFetched` registers each file as it lands in the pool | ✅ |
| The fetch is a task with its bytes and a Cancel (`trackedFetch`) | `TaskCenter.tracked(materializeTaskLabel(row, .proxy), scope:)` | ✅ |
| Multi-instance: the FIRST connection only, deferred ("on verra ça après") | `connections.first` / `firstClient` | ⏳ his call; the agreed shape is a tab per instance |

### Winnow's culling, read (`culling.ts`, the web's `CullMark` + `CullLine`)

| Web | Native | |
| --- | --- | --- |
| Develop's filmstrip shows Winnow's pick / reject / stars / label and filters on them, never writes them (`lightroom-gaps.md` item 33) | the instance tab's tiles, the browser's tiles and the lightbox's facts carry `WinnowCullMark`; the tab's `Winnow · 2 picks, 1 rejected · show picks ▾ (2 shown)` line filters what the grid draws AND what the lightbox pages (`atelier.library.winnow.cull`); drawn only where a row answered | ✅ native addition: the rows the Library lists carry the same three wire values |

## Browse all — `WinnowBrowser.tsx`

| Web | Native | |
| --- | --- | --- |
| `browse all` beside the eyebrow opens the browser | `WinnowBrowserSheet` | ✅ |
| By day · by folder · by leg (disabled, and said, without a timeline) | `viewTab` | ✅ |
| One row of filters — half, type, extension, device, each value with its count from `/api/facets` — narrowing all three; `clear` | `halfMenu`, `facetMenu` | ✅ |
| The month: arrows, a year-grouped picker, the calendar with a count per day (an empty day disabled), `<month> · media from … to …`; the first answer jumps to the newest month with media | `monthPane`, `monthOptions`; the jump guarded when that month is already on screen | ✅ |
| Folders (name, days, count, device; the path in the hint) · legs (label, days, count, clips; the route in the hint) | `sessionFactsLine`, `chapterLabel`, `chapterFactsLine`, `chapterRoute` (kernel) | ✅ |
| The rows: a tile per row, TICKED, never fetched; `▶`, `srt`; "proxy not ready" in the hint; all / none; the leg's note on a day it shares with the next | `pictureGrid`, `legNote` | ✅ |
| `bring proxies · originals`, the line saying what it costs (`148 MB to download`) | `bringChoice`, `browseFidelityLine` | ✅ |
| "Add N to library": one row after another, `2/12 · DJI_0101.JPG`; a failure stops and keeps what landed | `WinnowBrowserModel.add()` — each row a task scoped to it, landing in the pool at once | ✅ |
| — | the sheet's own Cancel beside the progress (`TaskCancelLink`), since the pill is behind it; a Cancel keeps what arrived and says so | ✅ native addition (`tasks.md`: a modal sheet carries its own Cancel) |
| The place remembered per instance (view, filters, month, the open day / folder / leg, the fidelity) under `atelier.sources.winnow.browse.v1`; the ticks never | `WinnowBrowserMemory`, the kernel's `readBrowseState` / `writeBrowseState` | ✅ |
| Forgetting a connection forgets its place (`forgetBrowseState`) | `WinnowBrowserMemory.forget(_:)` | ⏳ `ConnectionStore.forget` (Sources/) should call it — not edited here |
| `reconnect` → `#/connect?instance=` | → Sources proposing the instance's address (`AppLinks.propose`): filled in, "A link asked to connect …", Allow or Not now | ✅ |
| Esc cancels, Enter adds | `.cancelAction`, `.defaultAction` | ✅ |
| Under 820 px ONE pane at a time, with a way back (`‹ <month>`, `‹ folders`, `‹ legs`) | `compact` | ✅ |

## Thumbnails — `WinnowThumb.tsx`, `cache-heal.ts`

| Web | Native | |
| --- | --- | --- |
| ONE component every grid uses | `WinnowThumbView` (the tab, the browser) | ✅ |
| It RETRIES: attempt 0 the plain URL; its failure HEALS the entry (one request past the cache) and asks again, or `?retry=N` at once when the heal says the instance is not answering; later failures wait `attempt × 400 ms`; past three it draws its label | the kernel's `thumbAfterFailure` / `thumbAfterHeal` / `thumbGaveUp`; `LibraryHeal` (`reloadCache: true`), once per URL per session | ✅ |
| The heal cures a derivative cached WITHOUT its CORS headers | URLSession has no CORS: it cures a stale or truncated entry — the same one request | ≠ same mechanism, different disease |
| — | decoded thumbnails kept for the session (`WinnowThumbCache`, 600) | ✅ native addition |

## The lightbox — `MediaLightbox.tsx`, `use-media-viewer.ts`, `WinnowLightbox.tsx`, the sidebar's own

| Web | Native | |
| --- | --- | --- |
| ONE lightbox for every source; only the pixels' origin and the footer differ | `MediaLightbox` under `PoolLightbox` and `InstanceLightbox` | ✅ |
| A deck of three slots moved as one; the neighbours LOADED while hidden; a clip's player mounted only in the middle | `slots`, `LightboxSlot`, `LightboxVideo` | ✅ |
| Fit to 8×, every zoom keeping the point under the hand (`zoomAbout`) | `LightboxZoom` over the kernel's `PanZoom` | ✅ |
| A drag PANS once zoomed and SWIPES at the fit (far or fast enough, `swipeCommit`); a lone media rubber-bands | `dragGesture` | ✅ |
| A pinch; a double tap and `Z` toggle; at the fit the arrows page, zoomed they pan (40, 200 with ⇧) — `zoom-keys.ts` | `pinchGesture`, `SpatialTapGesture(count: 2)`, `handle(_:)` | ✅ |
| The wheel zooms; a sideways trackpad sweep PAGES the moment it crosses its line and swallows its momentum (`sweepCommit`, `sweepRestarts`) | `WheelCatcher` on the Mac (`LightboxZoom` is a `ZoomTarget`) | ✅ |
| The cheap still at once, the full picture fading in over it; a hairline while it comes | `still` / `full`, `LibrarySweepBar` | ✅ |
| — | an instance's proxy fetched as a task scoped to its row, its bar the deck's edge (the web's `<img>` fetches it itself) | ≠ a native fetch is one |
| Heal an image that errors | the client already replays a failed read once past the cache | ≠ nothing left to heal |
| Title, `n / m` (edge cards not counted), facts, the exposure line (`reading exposure…`), a zoom pill on a wide screen, `CLOSE ✕` | `header`, `exposureLine`, `zoomPill` | ✅ |
| The capture's FILES as chips — `Proxy · DJI_0202.JPG · DJI_0202.DNG`, a RAW through its render — VIEW state that writes nothing; `↓` before a fetch, `…` during; the fetch a task on the deck's edge with the sheet's own Cancel; held for the session | `files`, `chip`, `CaptureFileFetch`, `SessionOriginals` (R6) | ✅ |
| Esc closes; Enter does the caller's one action | `.cancelAction`, `onConfirm` | ✅ |
| The pool's: `USE IN <tool>` or the tool's verbs, "read from … — nothing uploaded"; the exposure read from the file under what its source vouched for | `PoolLightbox` (`readEffectiveExif`) | ✅ |
| An instance's: `ADD TO LIBRARY` / `✓ IN THE LIBRARY`, `OPEN IN WINNOW ↗` (its session — no route opens one asset), a verb run only once the picture landed | `InstanceLightbox.footer` | ✅ |
| Past the day's last picture, the NEXT DAY WITH MEDIA: two edge cards (a 62-day window, then the rest to the library's bounds, in the tab's half); landing on one in its direction moves the tab's day and reopens on its first picture, or its last going back | `edge`, `moved`, `follow`, `onRoll` | ✅ |

## The verbs — `MediaActions`, `MediaActionRow.tsx`

| Web | Native | |
| --- | --- | --- |
| A tool PUBLISHES what it can start from a picture; the shell draws it under one looked at large | `.publishMediaActions(_:)`, `MediaActionRow` in both lightboxes | ✅ |
| `run` is called with the media already in the Library and ACTIVE, handed the file of the capture on screen (`MediaView.rendition`) | the lightbox activates, then `run(MediaView(rendition: viewedRendition(…)))` | ✅ |
| Buttons first, the heading after them as a sentence; a lone verb is the ink pill | `lead` | ✅ |
| A publication withdrawn when its screen leaves | a token per screen; the one that appeared LAST is read | ≠ a React context written by the mounted tool; SwiftUI screens overlap as they come and go |

## Drag — `asset-drag.ts`, `use-asset-drag.ts`

| Web | Native | |
| --- | --- | --- |
| Any row or instance tile is the handle of a drag; the item lives in memory with a `resolve()` that fetches an instance's tile on drop | `.assetDragSource`, `AssetDragRegistry`; the drag carries `atelier-asset:<key>` (kernel) | ✅ |
| A target says where it will land and that it landed | `.libraryDropDestination(isTargeted:onAsset:onFiles:)`; the filmstrip's dashed ring; the roll's notice (`fetching X from host…`) | ✅ |
| Targets light up the moment a drag STARTS (`subscribeAssetDrag`); the page ends a drag whose source vanished | a target lights up while under the pointer | ≠ SwiftUI tells a `.draggable` source nothing of its drag's life |

## Who takes a Library picture

| Web | Native | |
| --- | --- | --- |
| Develop's filmstrip accepts a picture dragged from the Library (fetched first when an instance holds it) and files from the desktop | `FilmstripView.libraryDropDestination` → `RollEditor.addDragged` / `addFiles` | ✅ |
| Develop's editor verb `Develop` (on <roll>): add the picture — one already on the roll is OPENED, never added twice — opened on the file that was on screen, a RAW base set aside | `RollWorkbench.developOffer` → `RollEditor.addFromLibrary(_:rendition:)` | ✅ |
| Develop's gallery verb `Develop` (starts a new roll with this picture) | `RollGallery.developOffer` | ≠ also carries the file on screen onto the new roll (the web's gallery drops the view) |
| A Library file put on a roll by what it IS: bookmark, folder + path, or — a session copy — copied into the container, its ref (hash, asset id) kept | `RollStore.add(_:to:)`, `addPicture(to:url:ref:)`, `addPicture(to:data:ref:)` | ✅ |
| Trips publishes its piece's / its overview's day (`MediaScope`) and its three verbs; a collage cell takes a drop | the API is here (`.publishMediaScope`, `.publishMediaActions`, `.libraryDropDestination`, `.followsActiveAsset`) | ⏳ Trips' screens |
| The Studio reads the active clip or still (`useActiveAsset(STUDIO_KINDS)`) | `.followsActiveAsset(Tool.studio.accepts)` on the editor; what is put to work while it is on screen (`activations`) joins the project and opens (`StudioLibraryLink`, `StudioEditor.take`) | ≠ the project keeps a working set of its own (below) |
| The Studio's stage takes a Library drag | `.libraryDropDestination(onAsset:onFiles:)` on the editor — an instance's tile fetched first | ✅ |
| The Studio's instance media lost to a reload | fetched back from the ref's `assetId` when the project opens — from the pool when it still holds the capture, else from its instance when connected, else said (`StudioStore+Recovery.swift`) | ✅ |
| — | the Studio publishes its open media's capture day as the scope (`14 Mar 2025 · Studio`, measured or absent) | ✅ native addition: the web's Studio publishes none |

### How the Studio takes a Library asset

The editor carries `.followsActiveAsset(Tool.studio.accepts)`, and on the
Library's `activations` moving while it is ON SCREEN it takes the asset
ACTIVATED (never the first usable one the Library would fall back on):
every file of it (`assetFiles(asset.parts)`, each through
`library.entry(for:)`) goes to `StudioLibrary.adopt` — a `.bookmark` as
`add(urls: [resolved])`, a `.folder(bookmark, path)` as that same `.folder`
locator, a `.session` Photos copy as `add(receivedCopy:ref:)` (copied into
the container under its own name and date), a `.session` file an instance
handed over (its ref carries an `assetId`) held for the session only
(`addFetched`, a link beside the pool's copy, fetched back next launch) —
then `setActive(asset.id)`: the ids agree, both group by `buildAssets`. The
Library's `ref` (hash, asset id) is kept, which is what lets `ProjectMedia`
name the clip by content; and the identity `addFetched` registered is what
wakes the Studio's capture fetch, a still's original and the finals home.
The same path takes a drag onto the stage. The other way, the media on the
stage is set back as the Library's active one whenever the Library's
selection holds it.

Following the gesture rather than `activeId` is the one departure: the web's
project IS the Library's selection, so its Studio shows whatever is active;
here a project keeps its own working set, a phone keeps every tab's stack
alive, and the Library settling its active asset (an echo, a removal) or a
tap made for Develop must never add a clip to a project.

**Counts**: 102 rows — 85 ✅ (7 of them native additions), 4 ⏳, 13 ≠ (built
differently on purpose).
