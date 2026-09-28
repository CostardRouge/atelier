# Trips piece editor — the openers' own views, parity with the web app

Each OPENER's face — its picker sketch, its options panel, its picture
chooser — and the loading half that feeds it, against
`src/shared/roadtrip/hooks/` (`badge.tsx`, `scrub.tsx`, `map.tsx`,
`map-field.tsx`, `drive.tsx`, `panel-ui.tsx`) and `src/tools/roadtrip/`
(`HookPicturesModal.tsx`, `use-hook-pictures.ts`): map task tools-roadtrip-16
plus the UI halves of the variants. The Look tab (`Look/OpenerPickerView.swift`)
hosts the three views by name, owns the cards and presents the chooser; the
arithmetic is the kernel's (`Roadtrip/Hooks/*`), the strokes the landed
painters (`Trips/Paint/*`).

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's, but for the few a gesture changes:
"Click" is "Tap" on a phone, and "this computer" is "this device" there.
Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK and compiled by CI alone.

Rows: 87 ✅ · 8 ≠ · 3 ⏳

## The picker's sketches (`OpenerSketchView.swift`)

| Web | Native | |
|---|---|---|
| One sketch per variant, on the card's frame-coloured box | `OpenerSketchView(variantId:)`, filling the Look tab's 74 × 35 box | ✅ |
| The badge: a word, a numeral that dominates, a place | two hairlines and "27", drawn | ✅ |
| Défilé: a CSS tape whose head sweeps (keyframes) | the kernel's plan painted by `ScrubPainter` on a 12-day fixture, the head sweeping and resting | ≠ drawn by the opener's own painter, so a card never promises a drawing the opener does not make |
| The Itinerary: an SVG of three hops and a card | the kernel's plan painted by `MapPainter`: the pen travelling four stops | ≠ the same reason |
| Virée: a dotted road on paper, a car glyph travelling it | the kernel's plan painted by `DrivePainter`: the car driving three legs of a paper map | ≠ the same reason |
| No motion under reduced motion (`motion-safe:`) | the rest frame alone under Reduce Motion | ✅ |
| Hidden from assistive technology | `accessibilityHidden` | ✅ |
| Not a render of THIS piece | prepared once on a fixture trip, never the document, the Library or an instance | ✅ |

## The shared panel grammar (`OpenerPanelKit.swift`)

| Web (`panel-ui.tsx`) | Native | |
|---|---|---|
| The panel indented behind a rule, groups under a mono legend | `OpenerPanelFrame`, `OpenerGroup` | ✅ |
| "Moved · +12%, −4%" and "Put it back" after a drag on the stage | `OpenerMovedRow` | ✅ |
| A panel writes its own options, never the trip | `writeOpenerOptions` through the piece's funnel, one undo step | ✅ |
| A key a newer build wrote beside the known ones survives a write | the typed record laid OVER the stored options | ✅ |
| How the pictures are coming — three wordings, one per panel | `OpenerPictureLine` keeps each panel's own | ✅ |
| `HookPictureStatus.pending`, counted down picture by picture | `openerPictureStatus`: a want neither drawn nor refused | ≠ the model lands a pass whole, so the count drops at its end, not per picture |
| RangeField, Segmented, SelectField, ToggleField, SwitchRow, colour inputs | `DevelopRangeSlider` (with a ↺ to the variant's default), segmented `Picker`, menu `Picker`, the Studio's overlay rows, `ColorPicker` | ✅ |

## Défilé's options (`ScrubOptionsPanel.swift`)

| Web (`scrub.tsx`) | Native | |
|---|---|---|
| The summary: stops, from day, what flashes (told days, pictured ones, picked), seconds, the hold | `ScrubReading.sentence` | ✅ |
| "No picture picked yet…" / "This is the first day of the trip…" | the same | ✅ |
| The hook's screen time cuts the sweep: said | ✅ | ✅ |
| Under three frames a stop: "…ms a stop — a flicker…" | ✅ | ✅ |
| Stops on: Pieces' days · Picked pictures, with each one's hint | segmented | ✅ |
| Starts (At day 1 · A few days back), Days back 2–30, Most stops ≤ 3–16 | ✅ | ✅ |
| The stop strip: each stop's picture cover-cropped once decoded, else its day on a dark tile, a leg's start dotted, a failing one ringed red with why | `ScrubStopTile` (read-only, as the web's) | ✅ |
| Choose pictures… / Change pictures…, "n picked" | through the host's chooser; "The picture chooser is not available here." without one | ✅ |
| Shot after this piece's day / outside the trip — left out | `partitionPicked`, said | ✅ |
| More than 40 in reach: spread evenly | said | ✅ |
| The pictures' line | ✅ | ✅ |
| Flash each stop's picture | switch | ✅ |
| Sweep: Length 0.8–4 s, Motion (the easings with their hints), Hold first | ✅ | ✅ |
| Tape: Runs, Width, From edge, Moved, Colours + Reset, Opacity, Height, Spacing (fine/normal/coarse), Head, Glow, Track, Band + depth, Ends | ✅ | ✅ |
| Sound: the switch, Voice (the kits), Pitch (semitones), Drift, Volume (0% writes no track), Mix in | ✅ | ✅ |
| Under another counter the numeral keeps its reading: said | ✅ | ✅ |

## The Itinerary's options (`MapOptionsPanel.swift`, `MapStopsSection.swift`, `MapFieldView.swift`)

| Web (`map.tsx`, `map-field.tsx`) | Native | |
|---|---|---|
| The summary: stops · with a picture · distance · seconds or "still"; the empty and single-stop sentences | ✅ | ✅ |
| The hook's screen time cuts the journey: said | ✅ | ✅ |
| The picking map: the export's projection run backwards, a graticule, the trip's places as hollow rings, the bowed hops, numbered accent stops, a ring on the selected one, a corner mark for a stop holding a picture | `MapFieldView` over `fitMapProjection` / `unproject` / `arcControl`, drawn in a `Canvas` | ✅ |
| No tiles, no basemap, no request | ✅ | ✅ |
| A press on the ground drops a stop on release if it stayed within 4 px | ✅ (4 points) | ✅ |
| A press on a ring adopts that place | ✅ | ✅ |
| A stop pressed is selected and dragged | ✅ | ✅ |
| While dragged, the map refits under the pointer | the projection frozen from the press, refit on release; the grip kept, so a tap never nudges | ≠ the web's refit slides the stop out from under the pointer |
| Take the trip's n places (no stops yet, two places or more) | ✅ | ✅ |
| The trip's other places as "+ name" chips (twelve at most) | wrapped chips | ✅ |
| The stop list: number, name or "Unnamed stop", photo / — | ✅ | ✅ |
| 24 stops is as many as one opener draws: said | ✅ | ✅ |
| The stop in hand: name with the opt-in place search, Latitude / Longitude, its picture (Pick… / Change… / Remove picture), ↑ Earlier / ↓ Later / Remove stop | `PlaceSearchFieldView` (the stages'), number fields, the host's chooser | ✅ |
| A stop's chooser opens on the piece's own day and keeps a later picture | `includeThisDay`, `keepsLater` | ✅ |
| A pick of several fills the stops after it that have none, and the rest is counted | `assignPictures`, the spread line | ✅ |
| Pictures: Shown as (five modes, each with its hint), none held yet, the pen ends on an empty stop, Size, Arrival, Mount, Pins, Stem, Dim | ✅ | ✅ |
| Frame: Where, Align, Size, Moved, Plate + depth + colour, Grid | ✅ | ✅ |
| Path: Width, Bow, Colours + Reset, Ahead, Underlay | ✅ | ✅ |
| Places: Dots, Dot size, Numbers, Names (five), Name size, Trip's places | ✅ | ✅ |
| Motion: Travel the itinerary, Travel, Wait, Motion (" — on every hop"), Hold first, Pen | ✅ | ✅ |
| Extras: Compass, Distance, In the badge | ✅ | ✅ |
| Sound: the switch (its hint when not travelling), Voice, Pitch, Volume, Mix in | ✅ | ✅ |
| The map's `role="img"` label | an image element with the same words | ✅ |

## Virée's options (`DriveOptionsPanel.swift`)

| Web (`drive.tsx`) | Native | |
|---|---|---|
| The summary: stops, where it arrives (leg n — the place) or "in the order the pictures were shot", pictures on the way, seconds, distance; the four no-road sentences | `DriveReading.sentence` | ✅ |
| Left out: after · outside · no position · no leg · past the six a stop can show | `DriveReading.leftOutLine` | ✅ |
| The hook's screen time cuts the drive: said | ✅ | ✅ |
| Road: Stops (with how many picked carry a position), Path, Ahead, Trail, Colours + Reset, Width | ✅ | ✅ |
| Pictures: Shown as (Prints · Fill · Behind · None), the chooser, the told days' pictures, Per picture, Print size, Afterwards, Pauses | ✅ | ✅ |
| Car: `describeCar`'s sentence, Configure the car…, Size, Camera 35°–90° | `model.configureCar()` → the garage sheet | ✅ |
| Map: Ground, Paper · ink + Reset, graticule, vignette, Where, Size, Dots, Names (+ size), compass, scale bar, Distance | ✅ | ✅ |
| Motion: Driving, Motion, Hold first, At the end, Then, Camera, Zoom, the badge's place follows the car | ✅ | ✅ |
| Sound: the switch, Voice, Shutter, Pitch, Volume, Mix in | ✅ | ✅ |

## The picture chooser (`OpenerPicturesSheet.swift`, `OpenerPicturesModel.swift`, `OpenerPictureGrid.swift`)

| Web (`HookPicturesModal.tsx`) | Native | |
|---|---|---|
| The picker hosts the chooser a panel asks for, with what to tick and how to open | the panel leaves its request (`OpenerPictureAsk`), then calls the Look tab's `\.chooseOpenerPictures`; the sheet takes it, else the opener's whole list | ≠ the host's verb carries nothing, so the request waits beside it |
| "Pictures for the sweep" and its paragraph | ✅ | ✅ |
| The Library's photographs dated from their EXIF, four heads at a time, once per file for the session | `readCapture` over the file's head, off the main actor | ✅ |
| The instance's media for the span, asked once per span, forgotten on a new one | `allAssets`, 400 at most | ✅ |
| One picture in both is offered once, from the Library | `mergePool` | ✅ |
| Photos only; "n clips left out — photos only" | ✅ | ✅ |
| The dates bounded by the whole trip, opening on `defaultSpan`; moving one end past the other drags it along | two date pickers in UTC | ✅ |
| Quick spans, widest first, the current one marked | chips | ✅ |
| A piece dated outside its trip: said, and nothing can be kept | ✅ | ✅ |
| Everything ticked to start, a held list ticking only what it names, a widened span taken whole | `initialExclusions`, `absorb` | ✅ |
| "n of m photos", "shot after this piece's day — the opener leaves them off", all / none, "reading n dates…" / "asking host…" | ✅ | ✅ |
| Add from this computer… (a picker; clips and RAWs refused; they join the Library, the span never hides them, they arrive ticked) | Add from Photos… and Add from Files… | ≠ a device has two places pictures live |
| "Not signed in to host." with Sign in there | with "Ask again" beside it | ✅ |
| Day groups: Day n and the date, n/m, the day's all / none, "left off" | ✅ | ✅ |
| Tiles on pixel rows; the whole tile ticks; the corner looks; the caption ("◇", "left off ·") | ✅ | ✅ |
| The instance's thumbnails, the Library's covers read as they show | `WinnowThumbView`, `ensureCover` | ✅ |
| Nothing found / Looking… with what to do next | ✅ | ✅ |
| Looking at one large, the tick in the footer | `MediaLightbox` | ✅ |
| The footer's sentence; Cancel; "Use n pictures" / "Use no picture" / "Keeping…" | ✅ | ✅ |
| Escape cancels, Enter keeps | `.cancelAction`, `.defaultAction` | ✅ |
| A kept Library file carries its content hash | read on confirm when the Library has not yet | ✅ |
| Full screen under 820 px | a large sheet | ✅ |

## The pictures an opener draws (`OpenerPictureFetch.swift`, `Trips/Paint/HookPictureLoader.swift`)

| Web (`use-hook-pictures.ts`) | Native | |
|---|---|---|
| Asked for by REF (`wantsPictures`), never the thumbs store | ✅ (landed) | ✅ |
| Found in the Library by name, then by content hash | `findInPool` | ✅ |
| Else the connected instance's editing rendition, ONE request, never added to the pool | `OpenerPictureFetch.previewStill`, a task scoped to the piece | ✅ |
| A clip not in the Library is said as such, never fetched | ✅ | ✅ |
| "Not signed in to host." | ✅ | ✅ |
| Cropped to the frame at decode inside one shared pixel budget, graded with the piece's look | ✅ (landed) | ✅ |
| A picture kept across passes while its file, shape, budget share and look are unchanged | `HookPictureHeld`, the two most recent pieces | ✅ |
| Fetched bytes held in memory for the pass only | kept for the session in a temporary folder, 120 at most, emptied at the next launch | ≠ a pass decodes again without asking anyone twice; the Library's own rule for what it fetched |
| A burst of changes (a slider dragged) coalesced into one pass (180 ms) | each change that moves the wants starts a pass; kept pictures make it cheap | ⏳ a settle delay on the model's pass (`refreshOpener`, the core's) |
| A proxy of a RAW decoded as what it is | a photograph decoded by its FILE's name, so the WebP proxy of a DNG is read as WebP | ✅ |

## Deferred

| What | Why | |
|---|---|---|
| The ticks heard while the opener plays | the band's `PieceHookSound` (`Band/PARITY.md`, «The opener's sound»): the kernel's `renderBed` over the score from the clock, off by default, `M` or the transport's ticks pill; never yet heard on a device | ✅ |
| Pictures appearing one by one as a pass decodes | the model lands a pass whole (`refreshOpener`, the core's) | ⏳ |
| Verified on a device: the fetch against a real instance, the chooser's EXIF on real files, a sketch's frame rate | nothing here runs Apple code | ⏳ |
