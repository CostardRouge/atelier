# Trips overview — parity with the web app

The trip OVERVIEW — the heading and its figures, the calendar of months, the
year map, the day panel and the phone's day strip, the Pictures view, the
day menu, the hover card, «Adjust on the calendar» — against
`src/tools/roadtrip/` (`TripOverview.tsx`, `MonthCalendar.tsx`,
`YearMap.tsx`, `DayHeatmap.tsx`, `DayStrip.tsx`, `DayPanel.tsx`,
`use-day-thumbs.ts`): map tasks tools-roadtrip-04 and -05. The stages it
hosts (`StagesPanelView`, `LegsSheetView`) are the stages task's, through
`PendingTripPanels.swift`; the dates sheet (`TripDetailsSheet`) and the
ramp (`Palette.heatmapLevel`) are the shell's (`PARITY.md` beside this
folder).

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's. Nothing here was run on a device:
this container has no Apple toolchain, so every view was written against the
SDK, parse-checked, and compiled by CI alone.

Rows: 79 ✅ · 9 ≠ · 2 ⏳

## The screen (`TripOverviewView.swift`, `TripOverviewModel.swift`)

| Web | Native | |
|---|---|---|
| Pushed by the shell on `#/roadtrip/<trip>/<day>` | `TripOverviewView(store:tripId:day:openPiece:)`, the contract `TripsTool` calls | ✅ |
| The day lives in the route; Back from a piece lands on it | the selection is written to the route's `day` binding (`TripsShell.dayBinding`); a day the route names from elsewhere is selected | ✅ |
| No day in the route → the trip's first day | `selectedDay` falls back to the first day, without writing the route | ✅ |
| Every edit goes through the tool's one change funnel, stamped | `TripsStore.change(_, label: "trip")`, `updatedAt` stamped; a new piece and a finished adjust seal their undo step | ✅ |
| The leg open follows every day clicked that a leg covers; an uncovered day leaves it | `selectDate` | ✅ |
| Opening a leg says WHICH leg (a travel day's two legs) and goes to its first day | `openStage` | ✅ |
| Compact under 820, expanded from 1180 | a phone is iOS's compact width; a wide screen measures itself, three columns and the right column from 1180 pt | ✅ |
| A narrow desktop window (< 820 px) gets the phone's layout | the Mac always draws the wide layout (one block to a row when narrow) | ≠ the phone's cells live on iOS's bottom bar, which a Mac window has not |
| The task pill, the banners, ⌘Z, the push on the way out | the shell's (`TripsTool`), never added here a second time | ✅ |
| A trip the tool no longer holds | `This trip is not here` — deleted, or moved while the screen was open | ✅ |

## The heading (`OverviewHeading.swift`)

| Web | Native | |
|---|---|---|
| The name renamed IN PLACE (click → field, selected); an emptied field gives the old name back; Escape drops the edit | `TripNameField`: a tap edits, Return or leaving the field commits, Escape (the Mac) drops | ✅ |
| Wide: serif 2xl name, the route · dates · n days · n stages line under it, which opens the dates sheet | `OverviewHeading`, the line a button to `TripDetailsSheet` | ✅ |
| The route derived from the legs, never stored | `tripRouteLabel` | ✅ |
| Three figures: `told/total` days told · published (· n drafted) · the longest silence in the accent, a link to its first day with `start → end — go there` | `OverviewFigure` ×3 | ✅ |
| The heading wraps when the figures do not fit beside the name | `ViewThatFits`: side by side, else stacked | ✅ |
| Bar (wide): history, sync pill, Rungs \| Pictures, Trip settings | the navigation bar's primary actions: undo / redo (always both drawn), `DocumentSyncPill`, the segmented toggle, `Trip settings` | ✅ |
| The page bar's title | the name is the heading's; the bar keeps it only for Back and the window's title | ≠ a native bar would print it twice |
| Trip settings → the dates, route and cover sheet | `TripDetailsSheet(trip:store:…)` (the shell's), answer written by `TripsStore.saveDetails`; the open day moves to the first day when a shorter span dropped it | ✅ |

## The phone (`OverviewPhone.swift`, `OverviewSheets.swift`)

| Web | Native | |
|---|---|---|
| One pill-high bar: back, the name, `told/total`, the Rungs \| Pictures icons, the sync pill | the navigation bar: the name (renamed in place) as its title, then the pill, `told/total` and the icon toggle | ✅ |
| One mono line: `k published · d drafted · n days of silence at most` (a link) | `OverviewPhoneLine` | ✅ |
| The calendar takes the column, its side room paid inside the scroller | `MonthCalendarView`, `gutter: 8` | ✅ |
| The day strip above the bottom bar; a tap pulls up the day sheet | `DayStripView` in the bottom safe-area inset | ✅ |
| The day sheet: `Day n / N`, the date as its hint, snaps 0.62 / 0.92 | `OverviewDaySheet`, detents `.fraction(0.62)` / `.fraction(0.92)` | ✅ |
| Stages and Trip cells on the shell's bottom bar, marked while their sheet is up | a `.bottomBar` group above the tab bar (whose first cell is the Library): Stages, Trip, and the undo pair | ≠ a native bar's buttons are not "marked"; the sheet being up says it |
| Stages → the legs sheet, `Stages` · `n legs`, snaps 0.72 / 0.92 | `OverviewLegsSheet` hosting `LegsSheetView(store:tripId:selection:)` | ✅ |
| Trip → the dates sheet | `TripDetailsSheet` | ✅ |
| History in the bar | undo / redo on the bottom bar, where a thumb reaches them | ≠ the phone's top bar has no room for a fourth group |

## The calendar (`MonthCalendarView.swift`, `CalendarWeekView.swift`, `CalendarProbe.swift`)

| Web | Native | |
|---|---|---|
| One block per month, Mo–Su columns, the whole month drawn with its trip days apart | `tripBlocks` (the kernel's), `CalendarMonthHeader` + `CalendarWeekView` | ✅ |
| ≤ 31 days: ONE block of the trip's weeks, a week either side, month marks, no year map | the kernel's `weekBlock`; `derived.short` hides the map; marks drawn on their row | ✅ |
| The cell a seventh of the column (`monthCell`, 28…56), 0.9 as tall; gaps 4 | `CalendarLayout` over the kernel's `monthCell` / `monthWidth` / `monthGap` | ✅ |
| Blocks side by side, as many as fit at 34 px, 24 between: 2 at ~1280, 3 at ~1440 | `CalendarLayout(columns:)`, `calendarFitCell`, `calendarColumnGap` | ✅ |
| One block to a row is centred | ✅ | ✅ |
| The month's name sticky while its weeks scroll, translucent, with `told/n told` | a pinned section header (the whole row of blocks' heads) | ✅ |
| The weekday letters under the name | pinned with the name | ≠ they stay in view with the month they label |
| A day outside the trip drawn, inert | a grey number, no target | ✅ |
| The rung: 0 nothing · 1 drafted · 2 published once · 3 twice · 4 more, the number's ink by rung | `CalendarRungs.level` + the shell's `Palette.heatmapLevel` | ✅ |
| Today ringed (unless selected), the selected day outlined 2 px | ✅ | ✅ |
| A cell's accessible name: `date · day n · leg · day i/j — k published, d drafts` / `— nothing told yet` | `OverviewWords.cellTitle`, the `isSelected` trait | ✅ |
| Under every week, a ribbon per leg run: one flat tint by stage index, rounded only at the leg's real ends, named where it begins / is carried over a weekend / has ≥ 3 cells; the open leg darker and bold; its title `name · start → end` | `CalendarRibbons` over the kernel's `weekRuns`; `UnevenRoundedRectangle`; `.help` | ✅ |
| The ribbon's `color-mix(in oklch, tint 30 %/55 %, paper)` | the kernel's oklch tint converted to sRGB (`OverviewLegTint`), at 30 %/55 % opacity over the paper | ≠ alpha over the paper, not an oklch mix — the same at a ribbon's size |
| A ribbon tapped opens the leg: its first day on a wide screen, the legs sheet on a phone | `openStage` / `openLegSheet` | ✅ |
| Opens on the selected day's month without animation; follows a day chosen elsewhere only when off screen | `onAppear` scroll, `follow` against the rows on screen | ✅ |
| The block on screen: the one under the viewport's upper third, a row read from its left | `CalendarProbe`, from the rows as they report | ✅ |
| That block drives the Pictures window and the ruler's span (the month and its neighbours) | `setVisible` → `windowPosts`, `TripSelection.spanFrom/spanTo` | ✅ |
| The calendar's blocks memoised, so a scroll frame redraws the map's frame and nothing else | the scroll lives in `CalendarProbe`; only the map's frame, the grips and the hover card read it | ✅ |

## The year map (`YearMapView.swift`)

| Web | Native | |
|---|---|---|
| Trips over 31 days: the whole trip as weekly columns of 4–8 px on the ramp | one `Canvas` over the kernel's `heatmapWeeks` | ✅ |
| The frame = the weeks the calendar shows, at the pixel; paper over the rest | `YearMapFrame` over the kernel's `visibleWeekSpan` | ✅ |
| A tap lands on a MONTH and brings it to the top | `onTapGesture` → the block whose columns hold the point | ✅ |
| A drag past 4 px carries the frame (grabbed inside: its offset kept; outside: by its middle) | `DragGesture(minimumDistance: 4)` | ✅ |
| The drag puts a FRACTIONAL week at the top | a whole week at the top (`scrollTo` a line) | ≠ SwiftUI's scroll reader aims at a view, not a pixel, on iOS 17 |
| The month initials under the band | ✅ | ✅ |
| VoiceOver: one button per month | `accessibilityChildren`: `Go to <month>` | ✅ |

## The Pictures view

| Web | Native | |
|---|---|---|
| ONE Rungs \| Pictures toggle for the trip, remembered by the browser (`atelier.roadtrip.calendar.view`) | `OverviewViewToggle`, UserDefaults under the web's key | ✅ |
| A told day draws the hook of a published piece first, else the first with a hook; the number on a dark strip; a count when several; accent border published, dashed draft | `OverviewActions.pictures`, `CalendarDayCell.pictureFace` | ✅ |
| A told day whose hook is not read keeps its rung | ✅ | ✅ |
| Only the month on screen and its two neighbours are read | `windowPosts` → `OverviewThumbs.want`, the rest let go | ✅ |
| Object URLs created and revoked | files decoded small (256 px) off the main actor, re-read when a hook is re-baked (`thumbsVersion`) | ✅ |

## The day (`DayPanelView.swift`, `DayStripView.swift`)

| Web | Native | |
|---|---|---|
| Card (wide): `Day n / N`, the date, the leg `name · day i/j` | `DayPanelView(variant: .card)` | ✅ |
| Sheet (phone): the leg as a row that opens the legs (`Edit ›`), `Told from this day · k published · d drafts` | `variant: .sheet`, `onEditLeg` | ✅ |
| A row per piece: the hook at its own aspect (48 px high, ≤ 96 wide, a 38 px placeholder), the kind pill accented when published, the title or `Untitled` in italics, `draft` / `published <date>` · file name | `DayPostRow` | ✅ |
| The whole row opens the piece | the row is one button; the verbs sit beside it | ✅ |
| Wide: ⧉ Duplicate, ✓ Mark published / Back to draft, × Delete (two-step), Open | round glyph buttons with their names as help and label, `Open` an ink pill | ✅ |
| Delete asks twice (Delete / Keep inline) | a confirmation dialog: `Delete` destructive, `Keep` | ≠ the native way to confirm a destructive verb |
| Phone: the three verbs behind ⋯ (`Open`, `Mark published`/`Back to draft`, `Duplicate on this day`, `Delete…`) | a `Menu` | ✅ |
| `Nothing told from this day yet.` | ✅ | ✅ |
| Tell this day: Reel / Carousel / Single photo, each makes the piece with the trip's default look for that kind and OPENS it; `It opens straight away — name it and dress it there.` | `OverviewActions.start` → `createTripPost(…, defaults: hookDefaults[kind])` → `openPiece` | ✅ |
| Duplicate on this day | the kernel's `duplicateTripPost` | ✅ |
| Deleting a piece deletes its hook | `TripsStore.deletePost` | ✅ |
| The strip: weekday + date · day n, the leg with its tint dot or `nothing told yet`, ≤ 3 hooks (accent / dashed) then `+N`, the count and ›; an empty day `+ Tell it` | `DayStripView` | ✅ |

## The day's menu and the hover card (`DayHoverCard.swift`, `TripOverviewView.swift`)

| Web | Native | |
|---|---|---|
| Right-click a day: `Tell this day` Reel / Carousel / Single photo — on the day CLICKED, opened straight away — then `Stage` (start / end / extend by the real leg's name) | `.contextMenu` (a long press on a phone), `dayStageActions` from the kernel; the touched leg opened | ✅ |
| A phone reaches a leg's adjust from its legs sheet | also from the day's own menu: `Adjust “leg” on the calendar` | ≠ added: the legs sheet is another task's, and this entry is always there |
| The hover card: `DAY n`, the date, the leg with its tint dot and `day i/j`, the kinds (`1 reel · 2 single photo`), `k published · d draft` / `draft only`, or `nothing told yet` | `DayHoverCard` on `onHover` (a Mac, an iPad's pointer), pointer-transparent, clamped to the scroller, below the cell near the top | ✅ |
| No hover card while a leg is adjusted | ✅ | ✅ |

## Adjust on the calendar (phone)

| Web | Native | |
|---|---|---|
| Entered from the legs sheet: the sheet drops, the leg opens, the calendar scrolls to it | `startAdjust`; entered from `OverviewLegsSheet`'s `Adjust on the calendar` row, from the environment's `adjustLegOnCalendar` handed to `LegsSheetView`, or from the day's menu | ✅ |
| Only that leg's ribbon, at its DRAFT dates; every other day at 34 % | `model.shown` draws the draft; `inAdjusted` fades the rest | ✅ |
| A grip on each end dragged over the cells — one cell, one day, across weeks — with a haptic on pickup | `AdjustGrip`: one layer over the scroller, so a grip survives crossing into another week; `.sensoryFeedback` on pickup; `CalendarProbe.day(at:)` | ✅ |
| A tap moves the nearer edge | the kernel's `nearerEdge` | ✅ |
| Arrived / Left steppers under the calendar, ±1 day, Shift ±7 | `AdjustSteppers`: Shift on the Mac, the button's own menu (`A week earlier/later`) on a phone | ✅ |
| The band names the leg and its draft span, Cancel / Done; Escape cancels, Enter writes | `AdjustLegBand`, `.cancelAction` / `.defaultAction` | ✅ |
| Kept inside the trip, never reversed | the kernel's `resizeStage` | ✅ |
| Not offered where the ruler is | the wide layout never enters it | ✅ |
| A grip is a VoiceOver adjustable | `accessibilityAdjustableAction` ±1 day | ✅ |

## The Library (`TripOverviewView.swift`)

| Web | Native | |
|---|---|---|
| The selected day is the media scope (the Library's instance tab lists it), `browse`, within the trip's dates | `.publishMediaScope(MediaScope(… intent: .browse, within:))` | ✅ |
| Under any picture looked at large: `start a piece on <date>` — Reel / Carousel / Single photo, one tap makes the piece on the OPEN day and opens it | `.publishMediaActions`, keyed on the trip and the day | ✅ |
| `· or locate it` and the `Locate it` verb («Situer cette photo») | ✅ the verb under any picture looked at large opens `LocatePictureSheet` (the stages task) on the Library's active picture, its file held open while the sheet reads it; an accepted edit selects the day and the leg | ✅ |
| A dropped Library picture on a day cell | — the web's overview takes no drop (only the piece's stage and a place do) | ✅ |

## Deferred

| Web | Why | |
|---|---|---|
| The open leg's card in the right column above 1180 (`StageCard` beside the day) | the card is drawn by `StagesPanelView`, hosted between the map and the calendar; the panel can hand its card to a host (`showsCard: false`, `StageCardView`), and `OverviewWide` does not take it into its right column yet | ⏳ |
| `From <instance>` / `Deduce` on the stages (timeline complete, deduce) | the Stages panel on a wide screen and the phone's legs sheet: `Deduce` (`DeduceStagesSheet`) and `From <instance>` (`TimelineImportSheet(.complete)`, asleep behind `timelineSyncEnabled` as on the web) | ✅ |
| The dates sheet's cover panel | the shell's `TripDetailsSheet` carries it | ✅ |
| Measured on a phone | nothing here has run on a device; the 624 pt budget of §8.1 is to be checked on his iPhone with the tab bar and the bottom bar both drawn | ⏳ |
