// Port of `src/shared/roadtrip/timeline-import.test.ts`, case for case. The
// web's `toBe` (the very same trip) is value equality here, and its
// "does not share structure" cases hold by construction — every record is a
// value — so they are kept as written, mutating the copy.

import Foundation
import XCTest
@testable import AtelierKit

private let source = "winnow.example"
private let options = ImportOptions(sourceId: source, importedAt: 1_700_000_000_000)

private func chapter(_ id: String, title: String? = nil, startDate: String? = "2025-11-02",
                     endDate: String? = "2025-11-04", places: [TimelinePlace] = [],
                     revision: String? = nil) -> TimelineChapter {
    TimelineChapter(id: id, title: title, startDate: startDate, endDate: endDate, places: places, revision: revision)
}

private func place(_ name: String, _ region: String? = nil, lat: Double? = nil, lon: Double? = nil) -> TimelinePlace {
    TimelinePlace(name: name, region: region, lat: lat, lon: lon)
}

/// Three legs of the Australian trip, as a timeline would send them.
private func australia() -> [TimelineChapter] {
    [
        chapter("1", title: "Perth", startDate: "2025-11-02", endDate: "2025-11-04",
                places: [place("Perth", "Western Australia", lat: -31.95, lon: 115.86)]),
        chapter("2", title: "Kalbarri", startDate: "2025-11-05", endDate: "2025-11-08",
                places: [place("Kalbarri", "Western Australia")]),
        chapter("3", title: "Alice Springs → Uluru", startDate: "2025-11-12", endDate: "2025-11-15",
                places: [place("Alice Springs", "Northern Territory"), place("Uluru", "Northern Territory")],
                revision: "r7"),
    ]
}

private func imported(_ chapters: [TimelineChapter], _ opts: ImportOptions = options) -> TimelineImport {
    importTimeline(chapters, opts)
}

final class TimelineImportMappingTests: XCTestCase {
    func testTurnsEachChapterIntoAStageInLivedOrderWithItsOrigin() {
        let r = imported(australia())
        XCTAssertEqual(r.warnings, [])
        XCTAssertEqual(r.stages.map(\.startDate), ["2025-11-02", "2025-11-05", "2025-11-12"])
        XCTAssertEqual(r.stages[0].origin, StageOrigin(sourceId: source, chapterId: "1", importedAt: options.importedAt))
        XCTAssertEqual(r.stages[2].origin?.revision, "r7")
    }

    func testNeverReusesTheChapterIdAsTheStageId() {
        let stages = imported(australia()).stages
        XCTAssertFalse(stages.map(\.id).contains("1"))
        XCTAssertEqual(Set(stages.map(\.id)).count, 3)
    }

    func testCarriesThePlacesInOrderRegionOnThePlaceCoordinatesOnlyWhenSound() {
        let stages = imported(australia()).stages
        XCTAssertEqual(stages[2].places.map(\.name), ["Alice Springs", "Uluru"])
        XCTAssertEqual(stages[0].places[0].coords, GeoPoint(lat: -31.95, lon: 115.86))
        XCTAssertNil(stages[1].places[0].coords)
        XCTAssertEqual(stages[0].places[0].region, "Western Australia")
        // The stage's own region stays empty: it derives from what the places agree on.
        XCTAssertEqual(stages[0].region, "")
        XCTAssertEqual(stageRegionLabel(stages[2]), "Northern Territory")
    }

    func testDropsAPlaceWithNoNameAPointNobodyCanSayIsNotAPlace() {
        let stages = imported([chapter("x", places: [place("  ", lat: 1, lon: 2), place("Broome")])]).stages
        XCTAssertEqual(stages[0].places.map(\.name), ["Broome"])
    }

    func testRefusesCoordinatesOffTheGlobeRatherThanStoringThem() {
        let stages = imported([chapter("x", places: [place("Nowhere", lat: 91, lon: 10)])]).stages
        XCTAssertNil(stages[0].places[0].coords)
    }

    func testYieldsAStageWithASpanAndNoPlaceWhenTheChapterHasNone() {
        let stages = imported([chapter("x", title: nil, places: [])]).stages
        XCTAssertEqual(stages.count, 1)
        XCTAssertEqual(stages[0].places, [])
        XCTAssertEqual(stageLabel(stages[0]), "")
    }
}

final class TimelineImportEmptyMeansDerivedTests: XCTestCase {
    func testLeavesTheNameEmptyWhenTheTitleOnlySaysTheRoute() {
        let stages = imported(australia()).stages
        XCTAssertEqual(stages[0].name, "")
        XCTAssertEqual(stages[2].name, "")
        XCTAssertEqual(stageLabel(stages[2]), "Alice Springs → Uluru")
    }

    func testRecognisesTheRouteWhateverTheInstanceJoinedItWith() {
        for title in ["Alice Springs - Uluru", "alice springs to uluru", "Alice Springs -> Uluru"] {
            var c = australia()[2]
            c.title = title
            XCTAssertEqual(imported([c]).stages[0].name, "", title)
        }
    }

    func testKeepsATitleThatSaysMoreThanTheRoute() {
        var c = australia()[2]
        c.title = "The Red Centre"
        let stage = imported([c]).stages[0]
        XCTAssertEqual(stage.name, "The Red Centre")
        XCTAssertEqual(stageLabel(stage), "The Red Centre")
    }

    func testKeepsATitleWhenThereIsNoPlaceToDeriveFrom() {
        XCTAssertEqual(imported([chapter("x", title: "Day at sea", places: [])]).stages[0].name, "Day at sea")
    }
}

final class TimelineImportDatesTests: XCTestCase {
    func testRefusesAnInstantRatherThanSlicingADayOutOfIt() {
        // 07:00 in Perth is the 12th on the wall and the 11th in UTC; whichever
        // day a slice picked, it would be a guess the client made.
        let r = imported([chapter("x", startDate: "2026-02-11T23:00:00Z", endDate: "2026-02-12")])
        XCTAssertEqual(r.stages, [])
        XCTAssertEqual(r.warnings.count, 1)
        XCTAssertEqual(r.warnings[0].kind, .notADate)
        XCTAssertEqual(r.warnings[0].chapterId, "x")
        XCTAssertTrue(r.warnings[0].message.contains("2026-02-11T23:00:00Z"))
    }

    func testLeavesOutAChapterWithNoDatedMediaAndSaysSo() {
        let r = imported([chapter("x", title: "Odd", startDate: nil, endDate: nil)])
        XCTAssertEqual(r.stages, [])
        XCTAssertEqual(r.warnings[0].kind, .noDates)
        XCTAssertEqual(r.warnings[0].chapterId, "x")
        XCTAssertTrue(r.warnings[0].message.contains("Odd"))
    }

    func testTreatsOneMissingDateLikeNoneHalfASpanIsNotASpan() {
        let r = imported([chapter("x", startDate: "2025-11-02", endDate: nil)])
        XCTAssertEqual(r.stages, [])
        XCTAssertEqual(r.warnings[0].kind, .notADate)
    }

    func testSwapsAReversedSpanAndSaysItDid() {
        let r = imported([chapter("x", startDate: "2025-11-08", endDate: "2025-11-05")])
        XCTAssertEqual(r.stages[0].startDate, "2025-11-05")
        XCTAssertEqual(r.stages[0].endDate, "2025-11-08")
        XCTAssertEqual(r.warnings[0].kind, .reversedSpan)
    }

    func testKeepsTheFirstOfTwoChaptersSharingAnId() {
        let r = imported([chapter("x", title: "First"), chapter("x", title: "Second")])
        XCTAssertEqual(r.stages.count, 1)
        XCTAssertEqual(r.warnings[0].kind, .duplicateId)
        XCTAssertEqual(r.warnings[0].chapterId, "x")
    }
}

final class TimelineImportSpanTests: XCTestCase {
    func testDerivesTheSpanFromTheFirstStartToTheLastEnd() {
        XCTAssertEqual(imported(australia()).span, TripSpan(startDate: "2025-11-02", endDate: "2025-11-15"))
    }

    func testHasNoSpanWhenNothingDatedCameIn() {
        let r = imported([chapter("x", startDate: nil, endDate: nil)])
        XCTAssertNil(r.span)
        XCTAssertEqual(r.uncovered, [])
        XCTAssertEqual(r.destination, "")
    }

    func testSaysWhichDaysBelongToNoLegInsteadOfQuietlyProducingHoles() {
        XCTAssertEqual(imported(australia()).uncovered, [Gap(start: "2025-11-09", end: "2025-11-11", length: 3)])
    }

    func testNamesAnOverlapAndSaysWhichLegABadgeWouldName() throws {
        let r = imported([
            chapter("a", startDate: "2025-11-02", endDate: "2025-11-05", places: [place("Perth")]),
            chapter("b", startDate: "2025-11-05", endDate: "2025-11-08", places: [place("Kalbarri")]),
        ])
        XCTAssertEqual(r.warnings.count, 1)
        XCTAssertEqual(r.warnings[0].kind, .overlap)
        XCTAssertEqual(r.warnings[0].chapterId, "b")
        XCTAssertEqual(r.warnings[0].message, "“Perth” and “Kalbarri” share 1 day; on those, a badge names the later one.")
        // …which is what the trip will really do with them.
        let trip = try XCTUnwrap(tripFromTimeline("Australie", r))
        XCTAssertEqual(stageLabel(try XCTUnwrap(stageAt(trip, "2025-11-05"))), "Kalbarri")
    }

    func testOrdersBySpanEvenWhenTheTimelineArrivesOutOfOrder() {
        let all = australia()
        let r = imported([all[2], all[0], all[1]])
        XCTAssertEqual(r.stages.map { $0.origin!.chapterId }, ["1", "2", "3"])
        XCTAssertEqual(r.warnings, [])
    }

    func testComposesTheDestinationTheWayTheNewTripModalDoes() {
        XCTAssertEqual(imported(australia()).destination, "Perth → Uluru")
    }
}

final class TimelineImportTripFromTimelineTests: XCTestCase {
    func testCreatesATripWithTheSpanAndTheStagesAndNoPostAtAll() throws {
        let trip = try XCTUnwrap(tripFromTimeline("Australie", imported(australia())))
        XCTAssertEqual(trip.name, "Australie")
        // The route is not stored on the trip: it derives from the legs.
        XCTAssertEqual(tripRouteLabel(trip), "Perth → Uluru")
        XCTAssertEqual(trip.startDate, "2025-11-02")
        XCTAssertEqual(trip.endDate, "2025-11-15")
        XCTAssertEqual(trip.stages.count, 3)
        XCTAssertEqual(trip.posts, [])
    }

    func testStartsWithTheFactoryVoiceASourceHasNoOpinionAboutHowATripIsTold() throws {
        let trip = try XCTUnwrap(tripFromTimeline("A", imported(australia())))
        let fresh = createTripDoc("A", "2025-11-02", "2025-11-15")
        XCTAssertEqual(trip.badgeWords, fresh.badgeWords)
        XCTAssertEqual(trip.theme, fresh.theme)
        XCTAssertEqual(trip.cta, fresh.cta)
        XCTAssertEqual(trip.hookDefaults, [:])
    }

    func testLivesInThisBrowserNotOnTheInstanceTheTimelineCameFrom() throws {
        let trip = try XCTUnwrap(tripFromTimeline("A", imported(australia())))
        XCTAssertEqual(trip.sourceId, "local")
        XCTAssertEqual(trip.stages[0].origin?.sourceId, source)
    }

    func testMakesNothingFromAnEmptyTimeline() {
        XCTAssertNil(tripFromTimeline("A", imported([])))
    }

    func testDoesNotShareStructureWithTheImport() throws {
        let r = imported(australia())
        var trip = try XCTUnwrap(tripFromTimeline("A", r))
        trip.stages[0].name = "changed"
        XCTAssertEqual(r.stages[0].name, "")
    }
}

private func seeded() -> TripDoc {
    tripFromTimeline("Australie", imported(australia()))!
}

final class TimelineImportDiffTests: XCTestCase {
    func testFindsNothingToDoWhenTheTimelineHasNotMoved() {
        let entries = diffTimeline(seeded(), imported(australia()), source)
        XCTAssertEqual(entries.map(\.kind), [.unchanged, .unchanged, .unchanged])
        XCTAssertTrue(entries.allSatisfy { $0.matchedBy == .id })
    }

    func testProposesToAddALegTheTimelineGained() throws {
        let chapters = australia() + [chapter("4", startDate: "2025-11-09", endDate: "2025-11-11", places: [place("Exmouth")])]
        let entries = diffTimeline(seeded(), imported(chapters), source)
        let add = try XCTUnwrap(entries.first { $0.kind == .add })
        XCTAssertEqual(add.incoming?.origin?.chapterId, "4")
        XCTAssertNil(add.existing)
        XCTAssertEqual(add.key, "chapter:4")
    }

    func testReportsARenameAsAChangeAndSaysWhichFieldsMoved() throws {
        var chapters = australia()
        chapters[2].title = "The Red Centre"
        let entries = diffTimeline(seeded(), imported(chapters), source)
        let changed = try XCTUnwrap(entries.first { $0.kind == .changed })
        XCTAssertEqual(changed.existing?.origin?.chapterId, "3")
        XCTAssertEqual(changed.changes, [.name])
    }

    func testReportsAReClusteredSpanAndAChangedRoute() throws {
        var chapters = australia()
        chapters[1].endDate = "2025-11-10"
        chapters[1].places = [place("Kalbarri"), place("Shark Bay")]
        let entries = diffTimeline(seeded(), imported(chapters), source)
        let changed = try XCTUnwrap(entries.first { $0.kind == .changed })
        // The title "Kalbarri" still names the leg on both sides, so the name
        // did not move — only what the timeline actually changed is listed.
        XCTAssertEqual(changed.changes, [.span, .places])
    }

    func testProposesToDropASeededLegWhoseChapterIsGoneAndNeverAHandMadeOne() throws {
        var trip = seeded()
        trip.stages.append(createTripStage("Brittany detour", "", "2025-11-20", "2025-11-22",
                                           places: [createTripPlace("Brest")]))
        let entries = diffTimeline(trip, imported(Array(australia().prefix(2))), source)
        let dropped = entries.filter { $0.kind == .dropped }
        XCTAssertEqual(dropped.count, 1)
        XCTAssertEqual(dropped[0].existing?.origin?.chapterId, "3")
        XCTAssertEqual(dropped[0].key, "stage:\(try XCTUnwrap(dropped[0].existing).id)")
        XCTAssertFalse(entries.contains { $0.existing?.name == "Brittany detour" })
    }

    func testLeavesALegSeededFromAnotherInstanceAlone() {
        var trip = seeded()
        trip.stages[0].origin?.sourceId = "other.example"
        let entries = diffTimeline(trip, imported(Array(australia().dropFirst())), source)
        XCTAssertFalse(entries.contains { $0.kind == .dropped })
    }

    func testMeetsAHandDrawnStageByItsSpanWhenIdsAreUseless() throws {
        var trip = createTripDoc("Australie", "2025-11-01", "2025-11-30")
        trip.stages = [createTripStage("", "", "2025-11-05", "2025-11-08", places: [createTripPlace("Kalbarri")])]
        let entries = diffTimeline(trip, imported(australia()), source)
        let met = try XCTUnwrap(entries.first { $0.incoming?.origin?.chapterId == "2" })
        XCTAssertEqual(met.kind, .unchanged)
        XCTAssertEqual(met.matchedBy, .span)
        XCTAssertEqual(entries.filter { $0.kind == .add }.count, 2)
    }

    func testMeetsAReClusteredChapterByItsFirstPlaceAndAnOverlappingSpan() throws {
        let trip = seeded()
        // Nightly re-clustering: new ids, Kalbarri now a day longer.
        var chapters = australia().enumerated().map { i, c -> TimelineChapter in
            var next = c
            next.id = "new-\(i)"
            return next
        }
        chapters[1].endDate = "2025-11-09"
        let entries = diffTimeline(trip, imported(chapters), source)
        let kalbarri = try XCTUnwrap(entries.first { $0.incoming?.origin?.chapterId == "new-1" })
        XCTAssertEqual(kalbarri.matchedBy, .place)
        XCTAssertEqual(kalbarri.kind, .changed)
        XCTAssertEqual(kalbarri.changes, [.span])
        // Same span → matched by span, before the place fallback is tried.
        XCTAssertEqual(entries.first { $0.incoming?.origin?.chapterId == "new-0" }?.matchedBy, .span)
        XCTAssertFalse(entries.contains { $0.kind == .dropped })
    }

    func testListsEntriesInLivedOrder() {
        let chapters = [chapter("late", startDate: "2025-11-20", endDate: "2025-11-21")] + australia()
        let entries = diffTimeline(seeded(), imported(chapters), source)
        XCTAssertEqual(entries.map { ($0.incoming ?? $0.existing)!.startDate },
                       ["2025-11-02", "2025-11-05", "2025-11-12", "2025-11-20"])
    }
}

private func seededWithWork() -> TripDoc {
    var trip = seeded()
    trip.posts = [createTripPost(.reel, "2025-11-06", "Cliffs")]
    trip.theme = nil
    trip.stages[1].region = "WA (typed)"
    return trip
}

private func moved() -> TimelineImport {
    var chapters = australia() + [chapter("4", startDate: "2025-11-18", endDate: "2025-11-20", places: [place("Cairns")])]
    chapters[1].title = "Kalbarri gorges"
    return imported(Array(chapters.dropFirst()), ImportOptions(sourceId: source, importedAt: 2))
}

final class TimelineImportApplyTests: XCTestCase {
    func testChangesNothingWhenNothingWasAcceptedTheSameTripComesBack() {
        let trip = seededWithWork()
        let entries = diffTimeline(trip, moved(), source)
        let result = applyTimelineDiff(trip, entries, [String]())
        XCTAssertEqual(result.trip, trip)
        XCTAssertFalse(result.spanWidened)
    }

    func testAddsAnAcceptedLegAndWidensTheSpanToHoldItSayingSo() throws {
        let trip = seededWithWork()
        let entries = diffTimeline(trip, moved(), source)
        let add = try XCTUnwrap(entries.first { $0.kind == .add })
        let result = applyTimelineDiff(trip, entries, [add.key], now: 5)
        XCTAssertEqual(result.trip.stages.map { $0.origin?.chapterId }, ["1", "2", "3", "4"])
        XCTAssertEqual(result.trip.endDate, "2025-11-20")
        XCTAssertEqual(result.trip.startDate, "2025-11-02")
        XCTAssertTrue(result.spanWidened)
        XCTAssertEqual(result.trip.updatedAt, 5)
    }

    func testTakesAChangeOntoTheSameStageKeepingItsIdAndTheTypedRegion() throws {
        let trip = seededWithWork()
        let before = trip.stages[1]
        let entries = diffTimeline(trip, moved(), source)
        let changed = try XCTUnwrap(entries.first { $0.kind == .changed })
        let after = applyTimelineDiff(trip, entries, [changed.key], now: 9).trip.stages[1]
        XCTAssertEqual(after.id, before.id)
        XCTAssertEqual(after.name, "Kalbarri gorges")
        XCTAssertEqual(after.region, "WA (typed)")
        XCTAssertEqual(after.origin, StageOrigin(sourceId: source, chapterId: "2", importedAt: 9))
    }

    func testRemovesAnAcceptedDrop() throws {
        let trip = seededWithWork()
        let entries = diffTimeline(trip, moved(), source)
        let dropped = try XCTUnwrap(entries.first { $0.kind == .dropped })
        let result = applyTimelineDiff(trip, entries, [dropped.key])
        XCTAssertEqual(result.trip.stages.map { $0.origin?.chapterId }, ["2", "3"])
        // The span never shrinks: the days are still the trip's, told or not.
        XCTAssertEqual(result.trip.startDate, "2025-11-02")
        XCTAssertFalse(result.spanWidened)
    }

    func testStampsTheOriginOntoAHandMadeStageItMetWhenThatIsAccepted() throws {
        var trip = createTripDoc("Australie", "2025-11-01", "2025-11-30")
        trip.stages = [createTripStage("", "", "2025-11-05", "2025-11-08", places: [createTripPlace("Kalbarri")])]
        let entries = diffTimeline(trip, imported(australia()), source)
        let met = try XCTUnwrap(entries.first { $0.matchedBy == .span })
        let after = applyTimelineDiff(trip, entries, [met.key], now: 3).trip
        XCTAssertEqual(after.stages[0].origin, StageOrigin(sourceId: source, chapterId: "2", importedAt: 3))
        XCTAssertEqual(after.stages[0].id, trip.stages[0].id)
    }

    func testNeverTouchesThePostsTheWordsTheThemeTheCallToActionOrTheDefaults() {
        let trip = seededWithWork()
        let entries = diffTimeline(trip, moved(), source)
        let result = applyTimelineDiff(trip, entries, entries.map(\.key))
        XCTAssertEqual(result.trip.posts, trip.posts)
        XCTAssertEqual(result.trip.badgeWords, trip.badgeWords)
        XCTAssertNil(result.trip.theme)
        XCTAssertEqual(result.trip.cta, trip.cta)
        XCTAssertEqual(result.trip.hookDefaults, trip.hookDefaults)
        XCTAssertEqual(result.trip.id, trip.id)
    }

    func testDoesNotMutateTheTripItWasGiven() {
        let trip = seededWithWork()
        let snapshot = trip
        let entries = diffTimeline(trip, moved(), source)
        _ = applyTimelineDiff(trip, entries, entries.map(\.key))
        XCTAssertEqual(trip, snapshot)
    }
}

// No web case: a chapter the instance's client normalised is handed over
// unchanged, the field names being the import's own.
final class TimelineImportFromWinnowTests: XCTestCase {
    func testImportsAWinnowChapterAsItsOwnShape() throws {
        let wire = WinnowChapter(id: "k1", title: nil, startDate: "2025-11-05", endDate: "2025-11-08",
                                 places: [WinnowChapterPlace(name: "Kalbarri")], revision: "a|b|3", assetCount: 3,
                                 coverId: nil, tzOffsetHours: 8, placeInferred: false, authored: false)
        let r = importTimeline([wire], options)
        XCTAssertEqual(r.stages.count, 1)
        XCTAssertEqual(stageLabel(r.stages[0]), "Kalbarri")
        XCTAssertEqual(r.stages[0].origin, StageOrigin(sourceId: source, chapterId: "k1", revision: "a|b|3",
                                                       importedAt: options.importedAt))
    }
}
