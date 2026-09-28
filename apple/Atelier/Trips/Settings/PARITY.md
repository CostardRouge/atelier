# ⚙ Trip and the garage — parity with the web

Web: `src/tools/roadtrip/TripSettingsModal.tsx`, `CtaPanel.tsx`,
`CarGaragePanel.tsx`, `CarGarageModal.tsx`, `CarTurntable.tsx`,
`HouseStylePanel.tsx` (map task tools-roadtrip-08). Native:
`apple/Atelier/Trips/Settings/`, over the kernel's `TripTypes`, `DayBadge`,
`TimeAgo`, `CameraPlate`, `CtaSlide`, `CarSpec`, `CarRegistry`, `CarModel`,
`Mesh3D`, `TripFile`, `HouseStyle`, and the new `Roadtrip/Hooks/Turntable.swift`
(the turntable's arithmetic, specced in `TurntableTests`).

The contract the piece editor calls: `TripSettingsSheet(store:tripId:section:)`
— plus an optional `postId:` (the piece in hand: the kind a default is filed
under, the frame the closing card is previewed in) — and
`CarGarageSheet(store:tripId:)`. `section` is a pane's name (`words`, `cta`,
`defaults`, `car`, `house`) or a closing-card line (`cta:<role>`, or the
element id `cta:<role>:<line>` a tap on the card hands over).

✅ built · ⏳ deferred (why, what it waits on) · ➕ native addition

## The sheet (`TripSettingsSheet`)

| | Web | Native |
|---|---|---|
| ✅ | Opened from the piece bar's ⚙ on a section | `section` string; re-opened on the asked pane when it changes while up |
| ✅ | Sections in order: Words · Closing card · New pieces · Car (· House style, dev only) | Same order in the rail; House style drawn read-only (below) |
| ✅ | Rail + ONE pane; under 820px a full-screen drill-down (rail, then pane, "‹ All settings") | `NavigationSplitView`: two columns on iPad (page-sized sheet on iOS 18) and Mac, a push on iPhone opening on the asked pane; the system back button returns to the rail |
| ✅ | Rail eyebrow "Shared by the whole trip"; header line `name · n days · n pieces` | Rail section header, same words |
| ✅ | Every write on each keystroke through `onChangeTrip` | `store.change(_, label: "trip:<pane>")`: one undo step per burst, never merged across panes |
| ✅ | "↓ Back up the trip" → `.roadtrip.json` download | Footer verb → `.fileExporter` of `serializeTripFile(toTripFile(trip))`, named `tripFileName(name)`; a failed write is said in the footer |
| ✅ | Done closes; Enter = done, Escape = close | Footer Done (`.defaultAction` → Return on the Mac), `onExitCommand` (Escape) on the Mac, swipe down on iOS |
| ✅ | 80rem × 54rem on a desktop | Mac min 820 × 580 (ideal ×1.3); `.presentationSizing(.page)` on iOS 18+ |
| ➕ | — | A trip that is not the open one says nothing is written (writes land on the open trip only); a trip gone from the device says so |

## Words (`TripWordsPane`)

| | Web | Native |
|---|---|---|
| ✅ | Legend "Words" with its ⓘ (two paragraphs, `{n}` / `{date}`) | `TripSettingsLegend` (DevelopInfoDot + DevelopNote), closed by default |
| ✅ | English / Français presets | Pills writing `defaultBadgeWords` / `frenchBadgeWords` (English carries no camera words, as on the web) |
| ✅ | The five badge words (`WORD_FIELDS`) | `wordFields`, label column 104pt, adaptive grid (1 → 2+ columns) |
| ✅ | "Time" — the ten temporal words (`TIME_AGO_WORD_FIELDS`) | `timeAgoWordFields` |
| ✅ | "Camera credit" — Shot on + one tag per `CAMERA_FIELDS`, blanks kept as typed | Same; the drawing reads a blank as the default (`cameraWordsOf`) |
| ✅ | 16px inputs under 820px so iOS does not zoom | Native fields; no capital forced, no autocorrect (a badge word is typed as it is) |
| ➕ | Camera names are edited one alias at a time in a piece's Camera panel | "Camera names": every body the trip renamed, its name edited or forgotten (×); a blank name is kept and credits the body as its files do |

## Closing card (`TripCtaPane`, `CtaPanelView`, `CtaCardPreview`)

| | Web | Native |
|---|---|---|
| ✅ | Legend with its ⓘ | Same words |
| ✅ | Headline, Body (3 rows, grows), Link (`https://…`) | TextFields; Body is vertical, 3–8 lines; Link on the URL keyboard |
| ✅ | "n/213 characters a QR code can hold", red past it (UTF-8 bytes of the trimmed link) | `utf8.count` of the trimmed link against the kernel's `qrMaxBytes` |
| ✅ | "Show a QR code for the link" | Switch |
| ✅ | The QR problem (from `ctaLayout(...).qrProblem`) in danger ink | Same, read from the card as laid out at the piece's aspect |
| ✅ | Ground and Ink colour wells + the contrast note | `OverlayPanelColourWell`s writing `#rrggbb` + the note |
| ✅ | A click on a card line on the stage opens the sheet at that line and focuses its field (`ctaFieldRefs`) | `section: "cta:<role>[:<line>]"` → `@FocusState` on that field once it is up |
| ➕ | — (the card is judged on the stage behind the sheet) | A live preview of the card beside its fields, painted by `slideRender` + `BadgeRenderer` + `QRPainter` at the deck's still second — what a PNG deck delivers |

## New pieces (`NewPiecesPane`)

| | Web | Native |
|---|---|---|
| ✅ | Legend "New pieces · <kind>" + ⓘ | Same |
| ✅ | Save this piece as the default (`hookDefaultsFrom`) | Same |
| ✅ | Apply it to this piece — keeping its day, clip frame and text overrides | `defaultPostBadge(kind, saved)` with `referenceDate`, `videoTimeSeconds`, `textOverrides` kept; the piece's `camera` kept when the default has none and its `carried` keys kept (the web's spread over the badge); written through `store.updatePost` |
| ✅ | Forget it | Same |
| ✅ | "Nothing saved yet — new pieces start from the factory look." | Same |
| ➕ | — (the sheet always has a piece) | Opened with no `postId`: each kind's state listed with Forget, and a line saying a look is saved from a piece |

## Car (`CarGaragePanelView`, `CarTurntableView`) and the garage sheet (`CarGarageSheet`)

| | Web | Native |
|---|---|---|
| ✅ | ONE controlled panel, two homes: ⚙ Trip → Car writes live; the modal from a piece holds a DRAFT written on Done | Same: the Car pane writes through `store.change`; `CarGarageSheet` keeps a draft, Done writes once (nothing for an unchanged car), Cancel / Escape / swipe down leave it |
| ✅ | Legend "Car" with its two paragraphs | Same, as the panel's header |
| ✅ | Side by side past 44rem (car column 1.2fr, choices ≥ 19rem scrolling), stacked below | Measured on the panel's own width: ≥ 704pt side by side, choices `max(304, w/2.2)`; stacked and scrolling as one below |
| ✅ | Turntable: the drive's renderer (`renderOrder` + `paintMesh` + ground shadow, `carLight`, `carPalette`), paper ground, a foreshortened disc | Kernel `Turntable.frame` (the drive's own steps) painted by `DrivePainter.paintCar`; the disc by `GraphicsContext` in the `lineStrong` token — never SceneKit |
| ✅ | Turns on its own, ~25 s a lap; not under reduced motion | `TimelineView(.animation)` paused while still or under Reduce Motion; the spin is folded into the stored angle, never accumulated per frame |
| ✅ | A drag turns (a full width = one lap); a mouse also tilts 35°–90°; a finger only turns and the sheet still scrolls | `DragGesture`: a mouse tilts on the Mac; on iOS the drag is simultaneous with the scroll and turns only |
| ✅ | Arrows: ←/→ 15°, ↑/↓ 5°; resumes 1.5 s after a gesture | `onKeyPress` (focusable, own focus ring); `Turntable.resumeAfter` timer |
| ✅ | The angle is a look: never stored, never a piece's camera | View state only |
| ✅ | `aria-label` = `describeCar`; title "Drag to turn the car; the arrow keys turn and tilt it" | Accessibility label + `.help`; ➕ VoiceOver's adjustable action turns it |
| ✅ | The describeCar sentence under the turntable | Same |
| ✅ | Model select, hint = the series | Menu over `carModels`, hint `series` |
| ✅ | Colour: the named swatches (J120 range + his two), selected ringed; a coating preset sets the finish; a custom well; hint = name — note, or "A colour of your own." | Same; a selection haptic |
| ✅ | Finish: Gloss / Matte with their hints | Segmented picker, same hints |
| ✅ | Gear switches grouped Front / Roof / Body with hints; a dependent row hidden while its parent is off, its flag kept | Same groups, rows and hints (`OverlayPanelSwitch`) |
| ✅ | "Back to the default car", disabled at the default, its title | Same |
| ✅ | Modal header "Garage" + trip name (title = describeCar); footer "Every Virée of this trip drives this car."; Cancel / Done | Principal title + trip name (`.help` = describeCar), footer sentence, Cancel (`.cancelAction`) / Done (`.defaultAction`) |
| ⏳ | Tilt with a pen or an iPad pointer | A `DragGesture` does not say which pointer moved it; on iOS every drag turns only (a finger's rule). Waits on reading the pointer kind (`UIHoverGestureRecognizer`-level input) if it is ever missed |
| ⏳ | The outline and ring floors (0.9, 1) in device pixels | Here in points — a hair thicker on a 2× screen; measured nowhere yet, nothing has run on a device |

## House style (`HouseStylePane`)

| | Web | Native |
|---|---|---|
| ⏳ | Dev server only: "Save as house style" writes `src/shared/roadtrip/house-style.json` into the repository | NOT ported — the app has no repository to write into. The pane SAYS so and shows, read-only, the rows the web's panel draws (`houseStyleFrom` → title style, words, closing card, new pieces per kind, grade, car) and what an uploaded look would leave out |

## Counts

Built ✅ 42 · native additions ➕ 5 (four rows, and VoiceOver's adjustable
action on the turntable) · deferred ⏳ 3 (one of them the House style writer,
not ported by decision).
