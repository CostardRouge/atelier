# Trips — the legs and the itinerary: parity with the web

The web's side is `src/tools/roadtrip/StageRuler.tsx`, `StagesPanel.tsx`
(with its `StageCard`), `PlacesEditor.tsx`, `LegsSheet.tsx`,
`TimelineImportPanel.tsx`, `DeduceStagesPanel.tsx`, `StageDiffList.tsx`,
`LocatePicturePanel.tsx`, the place search of `src/shared/map/`
(`PlaceSearchField.tsx`, `geocode.ts`, `use-place-search-pref.ts`), and the
bits of `RoadTripTool.tsx` / `TripOverview.tsx` that open and answer them
(`completeSources`, `deduceSources`, `handleApplied`, the locate read). Map
tasks `tools-roadtrip-06` and `-07`.

The arithmetic is the kernel's — `StageRuler.swift`, `StageEdit.swift`,
`TripPlaces.swift`, `TimelineImport.swift`, `DayTrack.swift`,
`SegmentTrack.swift`, `TrackChapters.swift`, `LocatePicture.swift`,
`MediaDate.swift`, `Gazetteer.swift` — plus two modules this task added:
`Roadtrip/StageScreens.swift` (what the web keeps inside these components:
the drag delta, every sentence, the rows, the stored deduce settings, the
leg tints as sRGB) and `Map/Geocode.swift` (the place search's URL and
parser), each with a spec.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on purpose (why)

## Stages panel — wide (`StagesPanelView.swift`)

| Web | Native | |
| --- | --- | --- |
| Legend `Stages · n legs`, or `On screen · <from> → <to> · n days` when the ruler follows the months on screen | `stagesLegend` over `selection.spanFrom/spanTo` (a long trip only, as the web's `spanOnScreen`) | ✅ |
| What a stage IS, and the track's gestures, behind the legend's ⓘ | `StagesLegend`'s popover (compact-adapted to a popover on a phone) | ✅ |
| `From <instance>` per connected instance with a timeline | `ConnectionStore.stagesTimelineSources` (`hasTimeline`) → the complete sheet | ✅ (dormant: `timelineSyncEnabled` is off, as on the web) |
| `Deduce` per connected instance | `stagesDeduceSources` → the deduce sheet | ✅ |
| `+ Stage` starts on the first uncovered day inside the span on screen, else its end, and opens it | `newStageDay` + `startStageAt`; the new leg opened on its first day | ✅ |
| The one-line hint until the ruler has been used once (learned per device) | `@AppStorage("atelier.learned.roadtrip.stage-ruler")` = `yes`, set by a tap, a drag, a gap filled, a leg opened | ✅ |
| Empty state: `No legs yet — add one with the + above, or right-click a day…` | the same, the calendar's gesture named per platform (right-click on the Mac, touch and hold elsewhere) | ≠ (a phone has no right-click; the web hides the clause there) |
| The open leg's card under the ruler; `hideCard` on the widest screen | `StageCardView`; `showsCard: false` lets a host draw it in its own column | ✅ |
| `onSelect` / `onOpenStage` (go to the day it began) / `onScrub` (the day and the leg covering it) | written into `TripSelection` (`stageId`, `day`) | ✅ |
| `onPanSpan` | not handed — the web's overview hands none since the calendar's scroll became the loupe | ✅ |
| The accepted-leg note `The trip now runs … : its dates grew…` with a dismiss | `StagesNote` under the panel / sheet that opened the reconcile | ✅ |

## Stage ruler (`StageRulerView.swift`)

| Web | Native | |
| --- | --- | --- |
| A bar per leg, overlapping legs stacked in lanes (`rulerBars`) | the kernel's bars, one lane per row, 34 pt bars, 4 pt apart | ✅ |
| Bar label `<name or Unnamed stage> · d d · n places` | `rulerBarDetail`; the name muted when derived nothing | ✅ |
| Tint at 22 % over the surface, the tint's border, the selected one in accent + shadow | the kernel's oklch converted (`stageTintSrgb`), 22 % over `surface` | ≠ (mixed in sRGB, the web's `color-mix` mixes in oklch — a hair's difference on a pale tint) |
| Rounded only at the leg's real ends; a clipped end has no handle | `UnevenRoundedRectangle`, handles drawn only where not clipped | ✅ |
| Edges (10 px handles) and the middle dragged in WHOLE days, clamped to the trip, collapsing rather than reversing | `applyRulerDelta` over `resizeStage` / `shiftStage`; days = round(translation / day width) | ✅ |
| A mouse picks a leg up at once; a finger only after a still hold (`LONG_PRESS_MS` 350, slop 6) | macOS: `DragGesture(minimumDistance: 2)`; iOS/iPadOS: `LongPressGesture(0.35 s, 6 pt)` sequenced before the drag | ✅ |
| A haptic on pickup (`navigator.vibrate(8)`) | `.sensoryFeedback(.impact(.medium))` (`.alignment` on the Mac) | ✅ |
| A date pin follows the pointer: `<date> · n days`, or the span when sliding | `rulerPinText`, drawn over the dragged bar, clamped to the box | ✅ |
| A drag ends without the click opening the leg | `swallowTap` after a drag that moved a day | ✅ |
| Arrow keys move a focused edge / bar one day, Shift a week | `.focusable()` + `.onKeyPress(←/→)`, Shift × 7; VoiceOver's adjust moves a day | ✅ |
| A tap anywhere on the track opens that day | `SpatialTapGesture` → `dayAtOffset` | ✅ |
| A gap ≥ 22 px offers a dashed `+` adding a leg over exactly that run, and opens it | `rulerGapButtonMinWidth`, `stageOverGap` + `insertStageInOrder` | ✅ |
| Month rules with their names; day strokes, taller on Mondays and firsts, Mondays alone once days crowd | `rulerMonths`, `rulerTicks` drawn in one `Canvas` | ✅ |
| The rung strip of what each day told, on the grid's ramp | `StagesColor.rungs` (the grid's `levelOf`) on the five-token ramp, night-aware | ✅ |
| The playhead on the open day, a focusable knob whose arrows move the day | a line + knob; ←/→ (Shift a week) and VoiceOver adjust call `onScrub` | ✅ |
| A day's width: the box's share of the span, never under 6 px; a track wider than its box scrolls | `rulerDayWidth`; a native horizontal `ScrollView` (disabled while the track fits) | ✅ |
| One gesture surface: a swipe anywhere travels the track and glides on (`useFlingPan`, `swipeIntent`) | the native scroll view where the track is wider than its box; `onPan` (weeks, with a throw) where a host drives a span | ≠ (the scroll view IS the fling; no host hands `onPan` today, as on the web) |
| A trackpad's sideways wheel / Shift + wheel pans the loupe | the scroll view's own trackpad scrolling | ≠ |
| The rail under the scale on a touch screen | drawn on iOS when `onPan` is handed | ✅ |
| Every drag one undo step | `onGestureEnd` → `store.sealHistory()` | ✅ |

## Stage card (`StageCardView.swift`)

| Web | Native | |
| --- | --- | --- |
| Tint dot, `Stage n · d days`, two-step Delete / Keep, close | `stageCardHeading`; Delete → Delete · Keep; ✕ clears `selection.stageId` | ✅ |
| Name and region inputs whose placeholders are the DERIVED values (`Perth → Cairns`, the region the places agree on) — else `The Red Centre` / `Western Australia` | `TextField(prompt:)` from `stageLabel` / `stageRegionLabel` of the leg with the field emptied | ✅ |
| `Arrived` / `Left`, each held inside the trip and on its side of the other | two `DatePicker`s in UTC, ranges `trip.start…stage.end` and `stage.start…trip.end`, built only when in order | ✅ |
| The problem in red, else the derived line | `stageCardLine` | ✅ |
| `Adjust on the calendar` on a phone only | drawn only when the host hands the action — the legs sheet passes the overview's `\.adjustLegOnCalendar` | ✅ |
| The places editor | `PlacesEditorView` | ✅ |
| Every keystroke writes the trip (700 ms merge) | `StagesEdit.write` through `store.change` | ✅ |

## Places editor (`PlacesEditorView.swift`, `PlaceSearchFieldView.swift`)

| Web | Native | |
| --- | --- | --- |
| Chips in lived order joined by `→`, one open at a time, `Unnamed` in italics | `StagesFlow` of chips with the badge's own arrow | ✅ |
| Drag a chip to reorder | `.draggable(place.id)` + `.dropDestination`, a dashed accent border on the target | ✅ |
| A focused chip moves with ← / → | `.onKeyPress` → `moveItem` | ✅ |
| `+ Place` adds one, opens it and focuses its name | `createTripPlace`, `fresh` → `autoFocus` | ✅ |
| The open place: name (with the lookup), region (the leg's as placeholder), two-step Delete | `PlaceFieldsView` | ✅ |
| Coordinates shown to six places with `forget` | `formatCoords` + `forget` (clears `coords`) | ✅ |
| A picked candidate fills the name and coordinates, the region only where empty | `pick(_:)` | ✅ |
| The first and last place ARE the leg's ends — no second pair of fields | as on the web | ✅ |
| Place search OFF by default; the notice and `Turn on and search` / `Keep typing by hand` before anything leaves | `@AppStorage("atelier.roadtrip.placeSearch")` (`on` / `off`, the web's key), `placeSearchNotice` | ✅ |
| One request per Return or button, never as you type; a second cancels the first; leaving cancels | `PlaceSearch.search`, one `Task`, cancelled on a new search and on disappear | ✅ |
| `Nothing found for “…”.`, the offline and 429 sentences | `placeSearchOfflineMessage`, `placeSearchRefusal` | ✅ |
| `credentials: 'omit'`, `no-referrer` | an ephemeral `URLSession`, no cookies, no cache on disk | ✅ |
| A browser cannot send an identifying User-Agent (Nominatim's policy asks for one) | the app names itself: `Atelier/<version> (<bundle id>)` | ≠ (better than the web, on purpose) |

## Legs sheet — phone (`LegsSheetView.swift`)

| Web | Native | |
| --- | --- | --- |
| `n legs · covered/total days covered`, `From`, `Deduce`, `+ Stage` | `legsSheetSummary` + the same three verbs | ✅ |
| Rows in lived order: a leg (tint dot, name or `Unnamed stage` muted, `dates · d d · n told`, a barcode of its rungs sampled to 26, `›` / `⌄`) | `legsSheetRows`, `legBarcodeDays`, the rung ramp | ✅ |
| A gap row: `n days without a stage · dates` with `+ cover` | `legsGapLine` + `stageOverGap` | ✅ |
| The open row unfolds the stage card, with `Adjust on the calendar` | `StageCardView`, the overview's `\.adjustLegOnCalendar` | ✅ |
| Empty state and the overlap note | the web's words | ✅ |
| The sheet's chrome (title, Done, detents) | the host's (`OverviewLegsSheet`), so this view is the list | ✅ |

## Adjust on the calendar

| Web | Native | |
| --- | --- | --- |
| The leg's draft ribbon, grips dragged over cells, a tap moves the nearer edge, steppers, Done / Cancel | the overview's own gesture (`Trips/Overview/*`, `TripOverviewModel.startAdjust`); this task only calls it | — (the overview's) |

## Timeline — seed and complete (`TimelineImportSheet.swift`)

| Web | Native | |
| --- | --- | --- |
| Title `New trip from <id>` / `Complete from <id>` and the sentence of what it never does | `StagesSheetFrame` | ✅ |
| `<id> has no timeline yet…` when the capability says no | `hasTimeline` | ✅ |
| ONE request on open: the chapters | `.task` → `TaskCenter.tracked("Reading <id>’s timeline")` → `client.timeline()` | ✅ |
| `Not signed in to <baseUrl>.` + `Sign in there`; 404 = `does not serve a timeline`; `asking <id>…`; `The timeline has no chapter yet.` | `timelineReadProblem`, a `Link` to the login page | ✅ |
| Seed: every chapter a tick (name, `dates · n media`, `place guessed…`, `days read at UTC`), all / none | `timelineChapterName`, `timelineChapterLine` | ✅ |
| A link's preselection wins when it names real chapters | `seedPreselection` (`TimelineImportMode.seed(preselect:)`) | ✅ |
| The summary: `n stages · span · destination`, each leg's line, the uncovered days, or `No dated leg is ticked…` | `importTimeline` held per change, `uncoveredSentence` | ✅ |
| Name field (`Australie`, `Short — it is what a badge says…`); `Create trip` makes a house-styled trip and opens it; no post | `tripFromTimeline` + `applyHouseStyle(_, TripsShell.houseStyle)` — the one bundled resource the gallery's new trip reads too (`roadtrip-house-style.json`); the web commits no house style, so a seeded trip starts from the factory look on both; written through the store's `DocumentStore`, `onSeeded` for the host to open it | ✅ |
| Complete: the diff list; `Your trip already matches the timeline — …`; `Apply n` | `diffTimeline`, `StageDiffListView`, `applyTimelineDiff` | ✅ |
| The import's warnings listed | `imported.warnings` | ✅ |
| Return runs the verb only when enabled; Escape cancels | `.keyboardShortcut(.defaultAction / .cancelAction)` | ✅ |
| Opened from a timeline link (`#/roadtrip/new?source=<host>&chapters=`) | `atelier://roadtrip/new?…` / `…/<trip>/import?…` → `App/AppLinks.swift`, which hosts this sheet over the Trips stack with the link's host and chapter ids — asleep while `timelineSyncEnabled` is off, the link then landing on the ordinary screen as the web's does | ✅ |
| A seed from the gallery's `or seed it from <instance>` | ⏳ asleep behind `timelineSyncEnabled`, as on the web (no row while it is off); the gallery hands the creation sheet no `onSeedFrom` yet, so the switch turned on brings a link's seed back (`App/AppLinks.swift`) but not this button | ⏳ |

## Deduce (`DeduceStagesSheet.swift`)

| Web | Native | |
| --- | --- | --- |
| ONE request on open (`geo?by=day` over the trip's span); settings recompute locally | `TaskCenter.tracked` → `client.geoDays`; `readDayTrack` → `segmentTrack` → `trackChapters` → `importTimeline` → `diffTimeline`, recomputed on a setting | ✅ |
| The city index loaded with it, allowed to fail | `PlaceIndex.cities` (the bundled `public/geo/cities.json`), read off the main thread | ✅ |
| `n days · p placed · b with media and no position` (`· no city index…`) | `deduceSummary` | ✅ |
| Radius 5–120 km step 5, halt 1–6 days, Shorter than that: List it / Fold it in, Cover a blind day (on), Invent the days of a move (off) | `Slider`s, a segmented `Picker`, two `Toggle`s with the web's notes | ✅ |
| Remembered per device, never on the trip; a change resets the ticks | `@AppStorage("atelier.roadtrip.deduce")`, the web's JSON and clamps (`readDeduceSettings`) | ✅ |
| Doubtful rows unticked with `left unticked — a short stop, or placed only from guessed positions` | `deduceHeldKeys` + `noteFor` | ✅ |
| `No day of this trip carries a position…` / `These settings produce no leg…` / `already matches what the days say` | `deduceEmptySentence`, `alreadyMatchesSentence` | ✅ |
| `Accept n`; the trip's dates grow to hold a leg, and the host says so | `applyTimelineDiff` → `StagesEdit.apply` (one sealed step), `spanWidenedSentence` | ✅ |
| Not signed in / 404 `cannot answer for a day's position yet` | `geoDaysReadProblem` | ✅ |

## The diff list (`StageDiffListView.swift`)

| Web | Native | |
| --- | --- | --- |
| One tick per row: `add` / `changed` (now called… · now <span> · route now…) / `link` / `dropped` | `describeDiffEntry`, `diffEntryTag` | ✅ |
| `matched by span|place` when not by id | `diffEntryTag` | ✅ |
| A linked, identical row shown INERT, never hidden | `isInertDiffEntry`, the row disabled and muted | ✅ |
| A drop never ticked by default; adds, changes and links are | `defaultAcceptedDiff` | ✅ |
| A producer's note under a row | `noteFor` | ✅ |

## Locate this picture (`LocatePictureSheet.swift`)

| Web | Native | |
| --- | --- | --- |
| Reads the picture's own EXIF on this device (`readCapture`), the index only then | `readCapture` over the file's first `exifSliceBytes` (security-scoped), `PlaceIndex.cities`, off the main thread | ✅ |
| A clip refused with the reason | `classifyPart(name) == .video` | ✅ |
| `What the picture says`: the day and where it came from; the coordinates, the city (country), km | `captureDayWords`, `formatCoords`, `locateCityLine` | ✅ |
| The ONE proposal (label + detail), or why nothing is offered | `locatePicture` → `proposal`, else `locateSilenceWords` (all six refusals) | ✅ |
| Accept writes through the stage editors, goes to that day and opens the touched leg | `proposal.apply` → `StagesEdit.write`; `onDone(LocatedLeg(day:stageId:))` for the host | ✅ |
| `Cancel` / `Close` when there is nothing to accept | as on the web | ✅ |
| Opened from `Locate it` under a picture looked at large | the overview's `Locate it` verb (`TripOverviewView`) opens `LocatePictureSheet(store:tripId:fileURL:onDone:)` on the Library's active picture | ✅ |

## Counts

✅ 85 · ⏳ 1 · ≠ 5 · — 1 (the overview's own)
