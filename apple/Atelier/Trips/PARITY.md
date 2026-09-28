# Trips shell — parity with the web app

The Trips tool's SHELL — where you are, the gallery, the creation and dates
sheet, the cover chooser — against `src/tools/roadtrip/` (`RoadTripTool.tsx`,
`TripGallery.tsx`, `TripDetailsModal.tsx`, `TripCoverModal.tsx`,
`CoverPanel.tsx`, `use-cover-thumbs.ts`, `heatmap-ramp.ts`): map tasks
tools-roadtrip-02 and -03. The overview (`TripOverviewView`) and the piece
editor (`PieceEditorView`) are their own tasks, pushed here through the
contract in `PendingScreens.swift`; the store and the painters are
`PARITY-paint.md`'s.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's, "this browser" read as "this device".
Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK and compiled by CI alone.

Rows: 83 ✅ · 6 ≠ · 4 ⏳

## Where you are (`TripsTool.swift`, `TripsShell.swift`, `App/Tool.swift`)

| Web (`RoadTripTool.tsx`) | Native | |
|---|---|---|
| The hash route `#/roadtrip/<trip>/<day>/<piece>` | ONE `NavigationStack` whose path is `[TripsRoute]`: the gallery at its root, `.trip(id:day:)` pushed on it, `.piece(tripId:day:postId:)` on the overview | ✅ |
| Back from a piece lands on the day you were on | the overview's open day is kept per trip in `TripsShell` (`dayBinding`), and `openPiece` records the day it was opened from | ✅ |
| A day change rewrites the route | the day is held BESIDE the path, so selecting a day never replaces the overview it happens on | ≠ a path element rewritten in place would rebuild the screen |
| Opening a trip from the gallery lands on no particular day (the overview chooses) | `open(_:)` pushes `.trip(id, day: nil)` and forgets the day held for it | ✅ |
| A tool switch returns to the gallery with the trip still open ("Resume") | the path lives in `TripsShell.shared`: coming back to Trips finds the screen you left, on the phone's tab bar and in the Mac's sidebar alike | ≠ what a native tab does, and the same on every platform |
| `/roadtrip/home` redirect, `isWithinRoute`, the consumed-link guard | — a path value has no stray states to redirect from | ✅ |
| A link to a trip this device no longer has → home | `atelier://roadtrip/<trip>/<day>/<piece>` (`App/AppLinks.swift` → `TripsShell.follow`): the trip by its reference (a rename keeps the link), on the day, the piece pushed when the trip holds it; a trip not here is the gallery. The pill's "Delete here" (`onDeleted`) empties the path; a replaced trip leaves a piece it no longer holds (`onReplaced`) | ✅ |
| `/roadtrip/new?source=` and `/roadtrip/<trip>/import?source=` links (Winnow's verbs) | `atelier://roadtrip/new?source=…&chapters=…`, `atelier://roadtrip/<trip>/import?source=…`, read by the kernel's `parseRoadtripPath` and decided by `timelineLinkLanding`. The switch is OFF as on the web, so a link is consumed and lands on the ordinary screen (the gallery, or the trip) and no instance is asked; turned on, a host not connected goes to Sources and comes back, a connected one opens `TimelineImportSheet` over the ordinary screen | ✅ |
| Only the shell knows documents and persistence | `TripsStore` (landed) + `TripsShell`; `TripsTool` puts both in the environment | ✅ |
| One store for the tool | `TripsShell.shared.store` — one `TripsStore` for the whole app | ✅ |
| ⌘Z / the history control | the window's `UndoManager` handed to the store at the stack's root, so every step of the trip's history is native | ✅ |
| A trip left mid-edit keeps its last 800 ms; a remote trip pushes on leaving / when the tab hides | `documentSyncLifecycle(store.sync)` on the tool's stack: leaving the tool or the foreground flushes and pushes | ✅ |
| The trip being left is written before another opens | `store.openTrip` flushes; `create` flushes first too, so a debounced write never lands on the new trip | ✅ |
| Reopening the trip already open keeps its history (resume runs once per trip) | `open(_:)` does not re-open the trip already in the store | ✅ |
| "This trip could not be saved — the browser refused storage…" over every screen | the same banner over every screen of the tool (`tripsBanners`), in the device's words | ✅ |
| The span note after a timeline / deduce apply, with its × | `TripsShell.spanNote`, drawn over the overview and the piece, dismissed by ×; set by the sheets of task -07 | ✅ |
| `requestPersistentStorage` | — an app's container is not evicted | ✅ |
| The task pill in the masthead | `.taskPill()` on the gallery and on each pushed screen (the pushed screens must not add their own) | ✅ |
| Seeding a trip from a Winnow timeline (`TimelineImportPanel` seed) | ⏳ the creation sheet draws the row when handed `onSeedFrom`; the sheet is task -07's and the switch is off | ⏳ |
| Completing / deducing the legs from the overview | ⏳ task -07 (the overview carries the buttons) | ⏳ |

## The gallery (`Gallery/`)

| Web (`TripGallery.tsx`) | Native | |
|---|---|---|
| Trips grouped by source, `local` first, one group even with one source | `DocumentGalleryModel<TripDoc>.groups`, `source: … · N trips` | ✅ |
| A source this session does not know: `not connected — showing what this device holds` | ✅ | ✅ |
| The instance's list: `checking…`, a failure with its sentence and Sign in | ✅ | ✅ |
| A trip only there: greyed, `not here yet` on its cover, pulled on open | `openRemote` mirrors (`mirrorRemote`), then opens | ✅ |
| An instance whose bucket keeps no trip is said, never dropped in silence | `AbsentSourceNotes` over the model's `absent` (it probes a stale sheet first) | ✅ |
| `Nothing kept here yet.` for an empty group | ✅ | ✅ |
| Loading: `Loading trips…`; empty: `No trips yet` + the sentence + Create the first one | ✅ (`ContentUnavailableView`) | ✅ |
| Cards (default) or Bands, a localStorage preference | `TripGalleryMode`, UserDefaults `atelier.roadtrip.gallery.view` — the web's key | ✅ |
| The Segmented pair `Cards` / `Bands` with their titles | a segmented `Picker` in the heading row, the title as its help | ✅ |
| The masthead says Trips; the page's own heading is for a wide screen, with the count | `Trips` + count on a wide screen; the navigation bar's title on a phone | ✅ |
| Phone: two columns of cards, never Bands | ✅ | ✅ |
| Phone: New trip and Import in the shell's bottom bar | a `.bottomBar` toolbar group above the tab bar | ✅ |
| Wide: Import + New trip in the heading row | the navigation bar's primary actions (⌘N on an iPad; the Mac's ⌘N is the File menu's) | ≠ the bar is where a native app keeps them |
| The WHOLE card opens the trip; the ⋯ keeps its own click | `onTapGesture` on the card, the `Menu` inside; VoiceOver's Open action | ✅ |
| `open` on the trip open, `last opened` when none is — never both | `TripWhereTag`; `last opened` is UserDefaults `atelier.roadtrip.lastOpened` | ✅ |
| Cover art per the trip's layout: Mosaic (3), Cover (1), Rhythm, None (compact card) | `TripCoverArt` over the kernel's `coverTiles` — a mosaic of one is a cover, of none the rhythm | ✅ |
| 168 px cover, 112 on a phone | ✅ | ✅ |
| The caption on a picture cover: `day n`, or the date for a piece the span no longer reaches | ✅ | ✅ |
| Rhythm band: `n days, none told yet` / `g days never told · date` / `t of n days told`, bars rising from a ruler on the five-rung ramp | `TripRhythmBand`, bars scaled to the strip's height | ✅ |
| Remote-only with no picture: `pictures live on <instance>` | ✅ | ✅ |
| Only the cover CANDIDATES' thumbnails are read, never a trip's 250 pieces | `TripCoverThumbs` over `coverCandidateIds`, re-read when a hook is re-baked (`thumbsVersion`) | ✅ |
| Object URLs revoked after the new set is drawn | — files, decoded off the main actor; the new set replaces the old in one assignment | ✅ |
| Dates → dates · route derived from the legs | `formatIsoDate` + `tripRouteLabel` | ✅ |
| The progress bar of days told; `t / n days told · p published · g of silence` (silence at 3+ days, something told) | `TripProgressBar`, `TripProgressLine` | ✅ |
| A busy sentence while a move, a delete or a cover is under way | the model's `busy` + the shell's own (a cover being pushed) | ✅ |
| Bands: the resume band (the open trip, else the last opened) — picture or strip, name, dates · n days, tag, Resume/Open, the told sentence with the silence since | `TripResumeBand` | ✅ |
| Bands: rows with name, dates · route, a strip of at most 62 cells, the progress line, ⋯ | `TripBandRow`, `TripDayBars` (`rhythmBuckets(max: min(62, days))`) | ✅ |
| A strip cell's title `date → date · told/days told` | `.help` on each cell | ✅ |
| Row hover | `onHover` tint | ✅ |
| The rhythm's 49 bars at 2 px gaps on a phone card | 1 pt gaps on a phone | ≠ 49 bars do not fit a half-width card at 2 px |

## A trip's verbs (`Gallery/TripActionsMenu.swift`)

| Web (`TripActions`) | Native | |
|---|---|---|
| Open / Resume / Open here | ✅ | ✅ |
| Choose a cover… | opens `TripCoverSheet` | ✅ |
| Export the trip file (`.roadtrip.json`, the whole document minus ids, timestamps, source, projectIds) | `serializeTripFile(toTripFile(_))` through a file exporter, named `tripFileName` | ✅ |
| …of the OPEN trip, with edits the debounce holds | the open copy is exported, not the listed one | ✅ |
| Keep on <other source>… — confirm; pictures never travel | `gallery.moveTo`; the open trip is flushed first and takes the moved copy after | ✅ |
| Delete this trip… — confirm: days, stages and pieces go for good | `gallery.remove` (there first, refused while unreachable) then `store.deleteLocal` (the hooks go too) | ✅ |
| One component for card, row and band | ✅ | ✅ |

## Import (`TripsShell.importFile`)

| Web | Native | |
|---|---|---|
| A trip file always becomes a NEW trip, never an overwrite | `parseTripFile` → `tripDocFromFile` (fresh id and stamps) → `createOn` | ✅ |
| Asks where only when there are several sources (`ImportDocumentModal`) | a confirmation dialog with the web's sentence | ✅ |
| A target that cannot hold a trip falls back to this device | ✅ | ✅ |
| A trip with no name is named after the file (`.roadtrip.json` / `.json` stripped), else `Imported trip` | `TripsShell.nameFromFile` | ✅ |
| A parse error is a notice | the kernel's `TripFileError.message` | ✅ |
| Drop a file on the page | — the web's trip gallery takes none | ✅ |

## The creation and dates sheet (`Sheets/TripDetailsSheet.swift`)

| Web (`TripDetailsModal.tsx`) | Native | |
|---|---|---|
| `New trip`: Name (placeholder `Australie`, "Short — it is what a badge says over the picture.") | ✅ focused on open | ✅ |
| `Left on` / `Came back` date fields, each bounded by the other | `TripDateField` — a native date picker read on the user's calendar at noon, written `YYYY-MM-DD` | ✅ |
| Left on starts EMPTY, Came back on today | an empty value is a `Pick a date` button; the problem line says `Pick a start date for the trip.` | ≠ a date picker cannot be empty |
| The live `n days — badges will read “day n / N”.` or the problem, in red | `spanProblem` / `spanLength` | ✅ |
| `Keep on` only with a second document source, with its hint | ✅ | ✅ |
| `or seed it from` buttons, greyed with `has no timeline yet` | ✅ drawn when the shell hands a handler | ⏳ (task -07) |
| A new trip wears the committed house style | `applyHouseStyle(_, readHouseStyle(bundle's roadtrip-house-style.json))` — nil, the factory look, while the web commits none | ✅ |
| A remote trip is pushed on creation; nothing kept if refused, and said | `gallery.createOn(_, verb: "created")` | ✅ |
| Creating opens the trip | `store.adoptCreated` + the path | ✅ |
| `Trip dates` (editing): no name, no source | the `init(trip:store:…)` initialiser | ✅ |
| BEFORE saving: legs removed, legs trimmed, pieces outside the calendar (kept) | `spanImpact`, only when the span moved | ✅ |
| The cover panel inside the dates sheet | ✅ | ✅ |
| Save: new span, legs brought inside (`applyTripDetails`), cover pruned, stamped | `TripsStore.saveDetails(_:)` — one undo step | ✅ |
| The open day follows when it leaves the trip | ⏳ the overview's, after `saveDetails` (it owns the day) | ⏳ |
| `All of it stays editable.` + ⓘ | `DevelopInfoDot` + `DevelopNote`, the web's three paragraphs | ✅ |
| Enter saves from any field, Escape cancels | `.defaultAction` / `.cancelAction` shortcuts; Return in the name field | ✅ |
| Two date fields side by side, one per line on a phone | `ViewThatFits` | ✅ |

## The cover (`Sheets/TripCoverPanel.swift`, `TripCoverSheet.swift`)

| Web (`CoverPanel.tsx`, `TripCoverModal.tsx`) | Native | |
|---|---|---|
| Four layout tiles drawn with the pictures they would use, resolved at the WIDEST layout | `TripCoverLayoutPreview` over `coverTiles(…, limit: 3)` | ✅ |
| Bare slots when there is no picture — never an invented arrangement | ✅ | ✅ |
| Rhythm drawn from the trip's real weeks on ten bars | `rhythmBuckets(_, max: 10)` | ✅ |
| `No piece of this trip has a picture on this device yet…` | ✅ | ✅ |
| Pinned pieces: up to three, in lived order, rank and day on each, Clear pins, the sentence | `togglePin`, `dayNumberOf` | ✅ |
| `One pin points at nothing` / `n pins point at nothing` — forgotten on save | `droppedPins`; `prunePins` on Done / Save | ✅ |
| Every thumbnail of the trip read for the panel, released when it goes | `TripCoverThumbs` held by the panel | ✅ |
| `Cover` modal from the card: `How <name> shows itself in the gallery.`, Cancel / Done | `TripCoverSheet` | ✅ |
| A cover on the OPEN trip goes through the tool's funnel | `store.change` — one undo step, saved and pushed like any edit | ✅ |
| A cover on a remote trip: written there first (`saving on <host>…`), refused and said when it cannot be | `DocumentRemote.pushNew`, the record restored when refused | ✅ |
| A cover on a local trip | written, the gallery read again | ✅ |

## The heatmap ramp (`HeatmapRamp.swift`)

| Web (`heatmap-ramp.ts`, `--color-heat-*`) | Native | |
|---|---|---|
| Five rungs: bare paper · drafted · sent once · twice · more, a night ramp beside the day one | `Palette.heatmapLevels` / `heatmapLevel(_:)`, rung 0 the palette's `paper2` | ✅ |

## Also here (native)

| Native | |
|---|---|
| The open trip's sync pill in the gallery's bar, so Save now and a conflict's answers stay reachable after Back | ≠ the web's gallery draws none |

## Deferred, gathered

- The timeline seed from the creation sheet (behind the kernel's
  `timelineSyncEnabled`, off — the web draws no row either). The link routes
  are built (`App/AppLinks.swift`) and asleep behind the same switch.
- The open day following a shorter span (the overview's, over `saveDetails`).
- A bundled house style: the web commits none. When it does, bundle
  `src/shared/roadtrip/house-style.json` into the app as
  `roadtrip-house-style.json` (the Studio's twin has the same file name, so it
  cannot keep its own) — `TripsShell.houseStyle` reads it with the kernel's
  `readHouseStyle`.
- `PARITY-paint.md`'s `.roadtrip.json export / import — ⏳ screens` row is
  answered by this gallery.
