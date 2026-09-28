// A spec of its own for `StageScreens.swift` — the web keeps these rules inside
// its components (`StageRuler.tsx`, `StagesPanel.tsx`, `LegsSheet.tsx`,
// `StageDiffList.tsx`, `TimelineImportPanel.tsx`, `DeduceStagesPanel.tsx`,
// `LocatePicturePanel.tsx`), which have no spec; this one pins what they draw
// and write, from the web's own words.

import Foundation
import XCTest
@testable import AtelierKit

private func leg(_ start: String, _ end: String, _ name: String = "", places: [String] = []) -> TripStage {
    createTripStage(name, "", start, end, places: places.map { createTripPlace($0) })
}

private func trip(_ stages: [TripStage] = [], from: String = "2025-03-01", to: String = "2025-03-20") -> TripDoc {
    var doc = createTripDoc("Test", from, to)
    doc.stages = stages
    return doc
}

private func seeded(_ stage: TripStage, _ chapter: String) -> TripStage {
    var s = stage
    s.origin = StageOrigin(sourceId: "w.example", chapterId: chapter, importedAt: 0)
    return s
}

final class StageScreensRulerTests: XCTestCase {
    private let s = leg("2025-03-05", "2025-03-10")

    func testASlideKeepsTheLengthAndStopsAtTheTripsEdge() {
        let moved = applyRulerDelta(trip(), .move, s, 3)
        XCTAssertEqual([moved.startDate, moved.endDate], ["2025-03-08", "2025-03-13"])
        let pushed = applyRulerDelta(trip(), .move, s, 40)
        XCTAssertEqual([pushed.startDate, pushed.endDate], ["2025-03-15", "2025-03-20"])
    }

    func testAnEdgeMovesAloneAndCollapsesRatherThanReverses() {
        XCTAssertEqual(applyRulerDelta(trip(), .start, s, -2).startDate, "2025-03-03")
        XCTAssertEqual(applyRulerDelta(trip(), .end, s, 4).endDate, "2025-03-14")
        let collapsed = applyRulerDelta(trip(), .start, s, 9)
        XCTAssertEqual([collapsed.startDate, collapsed.endDate], ["2025-03-14", "2025-03-14"])
    }

    func testAnEdgeDraggedPastTheTripStopsThere() {
        XCTAssertEqual(applyRulerDelta(trip(), .start, s, -30).startDate, "2025-03-01")
    }

    func testThePinSaysTheMovedEdgeOrTheWholeSpanAndTheLength() {
        XCTAssertEqual(rulerPinText(.start, s), "5 Mar 2025 · 6 days")
        XCTAssertEqual(rulerPinText(.end, s), "10 Mar 2025 · 6 days")
        XCTAssertEqual(rulerPinText(.move, s), "5 Mar 2025 → 10 Mar 2025 · 6 days")
        XCTAssertEqual(rulerPinText(.end, leg("2025-03-05", "2025-03-05")), "5 Mar 2025 · 1 day")
    }

    func testABarSaysItsDaysAndItsPlacesAndItsTitleNamesTheSpan() {
        XCTAssertEqual(rulerBarDetail(s), "6 d")
        XCTAssertEqual(rulerBarDetail(leg("2025-03-05", "2025-03-06", places: ["Perth"])), "2 d · 1 place")
        XCTAssertEqual(rulerBarDetail(leg("2025-03-05", "2025-03-06", places: ["Perth", ""])), "2 d · 2 places")
        XCTAssertEqual(rulerBarTitle(s), "Unnamed stage · 5 Mar 2025 → 10 Mar 2025 · 6 days")
        XCTAssertEqual(rulerBarTitle(leg("2025-03-05", "2025-03-05", places: ["Perth", "Kalbarri"])),
                       "Perth → Kalbarri · 5 Mar 2025 → 5 Mar 2025 · 1 day")
    }

    func testANewLegStartsOnTheFirstUncoveredDayOfTheSpanOnScreen() {
        let doc = trip([leg("2025-03-01", "2025-03-04"), leg("2025-03-08", "2025-03-20")])
        XCTAssertEqual(newStageDay(doc), "2025-03-05")
        let span = TripSpan(startDate: "2025-03-08", endDate: "2025-03-20")
        XCTAssertEqual(newStageDay(doc, span: span), "2025-03-20", "a covered span: its end")
        XCTAssertEqual(newStageDay(trip()), "2025-03-01")
    }

    func testTheLegendNamesTheSpanOnScreenElseTheLegs() {
        XCTAssertEqual(stagesLegend(trip([s]), span: nil), "Stages · 1 leg")
        XCTAssertEqual(stagesLegend(trip(), span: nil), "Stages · 0 legs")
        XCTAssertEqual(stagesLegend(trip(), span: TripSpan(startDate: "2025-03-01", endDate: "2025-03-14")),
                       "On screen · 1 Mar 2025 → 14 Mar 2025 · 14 days")
    }
}

final class StageScreensCardTests: XCTestCase {
    func testTheHeadingCountsFromOne() {
        XCTAssertEqual(stageCardHeading(leg("2025-03-05", "2025-03-08"), index: 1), "Stage 2 · 4 days")
    }

    func testTheLineSaysTheProblemFirst() {
        let outside = leg("2025-02-20", "2025-03-02")
        let line = stageCardLine(trip(), outside)
        XCTAssertTrue(line.problem)
        XCTAssertEqual(line.text, "That stage starts before the trip does.")
    }

    func testElseTheLabelAndTheSpanAndOnlyTheSpanWhenNothingIsNamed() {
        XCTAssertEqual(stageCardLine(trip(), leg("2025-03-05", "2025-03-06", places: ["Perth", "Kalbarri"])).text,
                       "Perth → Kalbarri · 5 Mar 2025 → 6 Mar 2025")
        XCTAssertEqual(stageCardLine(trip(), leg("2025-03-05", "2025-03-06")).text, "5 Mar 2025 → 6 Mar 2025")
    }
}

final class StageScreensLegsSheetTests: XCTestCase {
    func testRowsAreLegsAndGapsInLivedOrder() {
        let a = leg("2025-03-10", "2025-03-20", "B")
        let b = leg("2025-03-01", "2025-03-03", "A")
        let rows = legsSheetRows(trip([a, b]))
        XCTAssertEqual(rows.count, 3)
        guard case .leg(let first, let firstIndex) = rows[0], case .gap(let gap) = rows[1],
              case .leg(let last, let lastIndex) = rows[2] else { return XCTFail("\(rows)") }
        XCTAssertEqual([first.name, last.name], ["A", "B"])
        XCTAssertEqual([firstIndex, lastIndex], [1, 0], "the index is the leg's place in the list — its tint")
        XCTAssertEqual([gap.startDate, gap.endDate, String(gap.length)], ["2025-03-04", "2025-03-09", "6"])
    }

    func testTheSummaryCountsCoveredDays() {
        XCTAssertEqual(legsSheetSummary(trip([leg("2025-03-01", "2025-03-05")])), "1 leg · 5/20 days covered")
        XCTAssertEqual(legsSheetSummary(trip()), "0 legs · 0/20 days covered")
        XCTAssertEqual(legsGapLine(RulerGap(from: 0, length: 1, startDate: "2025-03-01", endDate: "2025-03-01")),
                       "1 day without a stage")
    }

    func testTheBarcodeSamplesALongLegSoItStaysOneRowWide() {
        XCTAssertEqual(legBarcodeDays(leg("2025-03-01", "2025-03-04")).count, 4)
        let year = legBarcodeDays(createTripStage("", "", "2025-01-01", "2025-12-31"))
        XCTAssertLessThanOrEqual(year.count, legsBarcodeBars)
        XCTAssertEqual(year.first, "2025-01-01")
        XCTAssertEqual(year[1], "2025-01-16", "one day every ceil(365 / 26) = 15")
    }
}

final class StageScreensTintTests: XCTestCase {
    func testTheFourTintsAreTheWebsOklchInSrgb() {
        let want: [(Double, Double, Double)] = [
            (0.515077, 0.660634, 0.813158),
            (0.523168, 0.695762, 0.555320),
            (0.767206, 0.611657, 0.463239),
            (0.723709, 0.591220, 0.753845),
        ]
        for (i, w) in want.enumerated() {
            let got = stageTintSrgb(i)
            assertTriple((got.red, got.green, got.blue), w, 5)
        }
        let wrapped = stageTintSrgb(4)
        let first = stageTintSrgb(0)
        XCTAssertEqual(wrapped.red, first.red)
    }
}

final class StageScreensDiffTests: XCTestCase {
    private let kalbarri = leg("2025-03-05", "2025-03-08", places: ["Kalbarri"])

    private func entry(_ kind: DiffKind, incoming: TripStage? = nil, existing: TripStage? = nil,
                       matchedBy: TimelineMatchedBy? = nil, changes: [ChangedField] = [],
                       key: String = "k") -> DiffEntry {
        DiffEntry(key: key, kind: kind, incoming: incoming, existing: existing, matchedBy: matchedBy, changes: changes)
    }

    func testTheSpanIsDatesAndDays() {
        XCTAssertEqual(diffSpanText("2025-11-05", "2025-11-08"), "5 Nov 2025 → 8 Nov 2025 · 4 days")
        XCTAssertEqual(diffSpanText("2025-11-05", "2025-11-05"), "5 Nov 2025 · 1 day")
        XCTAssertEqual(diffSpanText("x", "y"), "x → y")
    }

    func testEachKindIsOneSentenceNamingTheRealLeg() {
        XCTAssertEqual(describeDiffEntry(entry(.add, incoming: kalbarri)), "Add “Kalbarri” · 5 Mar 2025 → 8 Mar 2025 · 4 days")
        XCTAssertEqual(describeDiffEntry(entry(.add, incoming: leg("2025-03-05", "2025-03-05"))),
                       "Add “an unnamed leg” · 5 Mar 2025 · 1 day")
        XCTAssertEqual(describeDiffEntry(entry(.dropped, existing: kalbarri)),
                       "Drop “Kalbarri” · 5 Mar 2025 → 8 Mar 2025 · 4 days — it is no longer there")
        XCTAssertEqual(describeDiffEntry(entry(.unchanged, incoming: kalbarri, existing: seeded(kalbarri, "c1"))),
                       "“Kalbarri” · unchanged")
        XCTAssertEqual(describeDiffEntry(entry(.unchanged, incoming: kalbarri, existing: kalbarri)),
                       "“Kalbarri” matches one of these legs — link it, so the next run finds it")
    }

    func testAChangeSaysEveryFieldThatMoved() {
        let incoming = leg("2025-03-06", "2025-03-09", places: ["Kalbarri", "Geraldton"])
        let e = entry(.changed, incoming: incoming, existing: kalbarri, changes: [.name, .span, .places])
        XCTAssertEqual(describeDiffEntry(e),
                       "“Kalbarri” · now called “Kalbarri → Geraldton” · now 6 Mar 2025 → 9 Mar 2025 · 4 days"
                       + " · route now Kalbarri → Geraldton")
        let emptied = entry(.changed, incoming: leg("2025-03-05", "2025-03-08"), existing: kalbarri,
                            changes: [.name, .places])
        XCTAssertEqual(describeDiffEntry(emptied), "“Kalbarri” · now called “nothing” · route now no place")
    }

    func testALinkedUnchangedRowIsInertAndNeverTicked() {
        let linked = entry(.unchanged, incoming: kalbarri, existing: seeded(kalbarri, "c1"), key: "a")
        let unlinked = entry(.unchanged, incoming: kalbarri, existing: kalbarri, key: "b")
        XCTAssertTrue(isInertDiffEntry(linked))
        XCTAssertFalse(isInertDiffEntry(unlinked))
        XCTAssertEqual(actionableDiffEntries([linked, unlinked]).map(\.key), ["b"])
        XCTAssertEqual(defaultAcceptedDiff([linked, unlinked]), ["b"])
    }

    func testADropIsNeverTickedByDefaultAndTheProducersDoubtIsHeldBack() {
        let entries = [
            entry(.add, incoming: kalbarri, key: "add"),
            entry(.changed, incoming: kalbarri, existing: kalbarri, changes: [.span], key: "changed"),
            entry(.dropped, existing: seeded(kalbarri, "c9"), key: "dropped"),
        ]
        XCTAssertEqual(defaultAcceptedDiff(entries), ["add", "changed"])
        XCTAssertEqual(defaultAcceptedDiff(entries, holdBack: ["add"]), ["changed"])
        XCTAssertEqual(tickedActionableCount(entries, ["add", "dropped", "ghost"]), 2)
    }

    func testTheTagSaysLinkForAMatchAndHowItWasPairedWhenNotById() {
        XCTAssertEqual(diffEntryTag(entry(.unchanged, incoming: kalbarri, existing: kalbarri, matchedBy: .span)),
                       "link · matched by span")
        XCTAssertEqual(diffEntryTag(entry(.unchanged, incoming: kalbarri, existing: seeded(kalbarri, "c"), matchedBy: .id)),
                       "unchanged")
        XCTAssertEqual(diffEntryTag(entry(.changed, incoming: kalbarri, existing: kalbarri, matchedBy: .place)),
                       "changed · matched by place")
        XCTAssertEqual(diffEntryTag(entry(.add, incoming: kalbarri)), "add")
    }

    func testAlreadyMatchingIsSaidForEachProducer() {
        XCTAssertEqual(alreadyMatchesSentence(1, deduced: false),
                       "Your trip already matches the timeline — 1 leg, nothing to change.")
        XCTAssertEqual(alreadyMatchesSentence(3, deduced: true),
                       "Your trip already matches what the days say — 3 legs, nothing to change.")
    }
}

final class StageScreensTimelineTests: XCTestCase {
    private func chapter(_ id: String, title: String? = nil, places: [String] = [], start: String? = "2025-11-05",
                         end: String? = "2025-11-08", tz: Double? = 8, inferred: Bool = false) -> WinnowChapter {
        WinnowChapter(id: id, title: title, startDate: start, endDate: end,
                      places: places.map { WinnowChapterPlace(name: $0) }, revision: nil, assetCount: 12,
                      coverId: nil, tzOffsetHours: tz, placeInferred: inferred, authored: false)
    }

    func testAChapterIsCalledByItsTitleElseItsEndsElseItsId() {
        XCTAssertEqual(timelineChapterName(chapter("1", title: " Red Centre ")), "Red Centre")
        XCTAssertEqual(timelineChapterName(chapter("1", places: ["Perth", "", "Cairns"])), "Perth → Cairns")
        XCTAssertEqual(timelineChapterName(chapter("1", places: ["Perth", "Perth"])), "Perth")
        XCTAssertEqual(timelineChapterName(chapter("7")), "chapter 7")
    }

    func testAChaptersLineSaysWhatWasNotMeasured() {
        XCTAssertEqual(timelineChapterLine(chapter("1")), "5 Nov 2025 → 8 Nov 2025 · 4 days · 12 media")
        XCTAssertEqual(timelineChapterLine(chapter("1", places: ["Perth"], tz: nil, inferred: true)),
                       "5 Nov 2025 → 8 Nov 2025 · 4 days · 12 media · place guessed from the legs around it · days read at UTC")
        XCTAssertEqual(timelineChapterLine(chapter("1", start: nil, end: nil, tz: nil, inferred: true)), "undated · 12 media")
    }

    func testALinksPreselectionWinsOnlyWhenItNamesRealLegs() {
        let chapters = [chapter("a"), chapter("b"), chapter("c")]
        XCTAssertEqual(seedPreselection(chapters, []), ["a", "b", "c"])
        XCTAssertEqual(seedPreselection(chapters, ["b", "zzz"]), ["b"])
        XCTAssertEqual(seedPreselection(chapters, ["zzz"]), ["a", "b", "c"])
    }

    func testTheUncoveredDaysAreSaidOnce() {
        let imported = TimelineImport(stages: [], span: TripSpan(startDate: "2025-11-01", endDate: "2025-11-10"),
                                      uncovered: [Gap(start: "2025-11-04", end: "2025-11-06", length: 3),
                                                  Gap(start: "2025-11-09", end: "2025-11-09", length: 1)],
                                      destination: "", warnings: [])
        XCTAssertEqual(uncoveredSentence(imported), "4 days belong to no leg: 4 Nov 2025 → 6 Nov 2025, 9 Nov 2025.")
        var covered = imported
        covered.uncovered = []
        XCTAssertNil(uncoveredSentence(covered))
    }

    func testAReadsFailureIsSaidInTheInstancesTerms() {
        let client = WinnowClient(config: WinnowConfig(baseUrl: "https://w.example", auth: .cookie),
                                  transport: { _ in throw CancellationError() })
        let signIn = timelineReadProblem(WinnowError(.unauthenticated, "401"), client)
        XCTAssertEqual(signIn, StageReadProblem(text: "Not signed in to https://w.example.", loginUrl: "https://w.example/login"))
        XCTAssertEqual(timelineReadProblem(WinnowError(.notfound, "404"), client).text,
                       "https://w.example does not serve a timeline — it has no legs to read.")
        XCTAssertEqual(geoDaysReadProblem(WinnowError(.notfound, "404"), client).text,
                       "https://w.example cannot answer for a day's position yet — it is too old for this.")
        XCTAssertEqual(geoDaysReadProblem(WinnowError(.unreachable, "No answer."), client).text, "No answer.")
        XCTAssertNil(geoDaysReadProblem(WinnowError(.unreachable, "No answer."), client).loginUrl)
    }

    func testAWidenedTripIsSaidWithItsNewDates() {
        XCTAssertEqual(spanWidenedSentence(trip()),
                       "The trip now runs 2025-03-01 → 2025-03-20: its dates grew to hold a leg you accepted.")
    }
}

final class StageScreensDeduceTests: XCTestCase {
    func testNothingStoredIsTheDefaults() {
        XCTAssertEqual(readDeduceSettings(nil), .default)
        XCTAssertEqual(readDeduceSettings("junk"), .default)
    }

    func testEachFieldIsClampedTheWayTheWebReadsIt() {
        let read = readDeduceSettings([
            "radiusKm": 40, "minNights": 2.6, "shortLegs": "merge", "bridgeBlind": false, "interpolateMoves": true,
        ])
        XCTAssertEqual(read, SegmentOptions(radiusKm: 40, minNights: 3, shortLegs: .merge, bridgeBlind: false,
                                            interpolateMoves: true))
        let junk = readDeduceSettings([
            "radiusKm": -5, "minNights": 0, "shortLegs": "fold", "bridgeBlind": "no", "interpolateMoves": "yes",
        ])
        XCTAssertEqual(junk, .default, "a switch is off only when stored OFF, on only when stored ON")
    }

    func testWhatIsWrittenReadsBack() {
        let options = SegmentOptions(radiusKm: 65, minNights: 4, shortLegs: .merge, bridgeBlind: false, interpolateMoves: true)
        XCTAssertEqual(readDeduceSettings(deduceSettingsJSON(options)), options)
        XCTAssertEqual(deduceSettingsKey, "atelier.roadtrip.deduce")
    }

    func testTheSummaryAndTheEmptyStates() {
        XCTAssertEqual(deduceSummary(totalDays: 45, placed: 38, blind: 2, hasCities: true),
                       "45 days · 38 placed · 2 with media and no position")
        XCTAssertEqual(deduceSummary(totalDays: 1, placed: 0, blind: 0, hasCities: false),
                       "1 day · 0 placed · 0 with media and no position · no city index, so legs arrive unnamed")
        XCTAssertEqual(deduceEmptySentence(placed: 0),
                       "No day of this trip carries a position, so there is no itinerary to work out.")
        XCTAssertEqual(deduceEmptySentence(placed: 3), "These settings produce no leg — try a wider radius.")
    }

    func testTheHeldKeysAreTheDiffsOwnKeysForTheDoubtfulLegs() {
        let leg = TrackLeg(startDate: "2025-11-01", endDate: "2025-11-01", centroid: GeoPoint(lat: -27.7, lon: 114.2),
                           dayCount: 1, bridged: 0, count: 3, inferred: false, short: true, absorbed: 0)
        let proposed = trackChapters([leg], [])
        XCTAssertEqual(deduceHeldKeys(proposed), ["chapter:track:2025-11-01"])
    }
}

final class StageScreensLocateTests: XCTestCase {
    private let kalbarriCity = GazetteerCity(name: "Kalbarri", country: "AU", lat: -27.7105, lon: 114.165,
                                             population: 2602, section: false)

    func testTheDayIsSaidWithWhereItCameFrom() {
        XCTAssertEqual(captureDayWords(CaptureDate(date: "2025-11-03", source: .exif)), "the camera’s own record")
        XCTAssertEqual(captureDayWords(CaptureDate(date: "2025-11-03", source: .source, via: "w.example")),
                       "as w.example read it")
        XCTAssertEqual(captureDayWords(CaptureDate(date: "2025-11-03", source: .source)),
                       "as the instance it came from read it")
        XCTAssertEqual(captureDayWords(CaptureDate(date: "2025-11-03", source: .file)),
                       "the file’s own date — a weak guess, rewritten by any copy or re-grade")
    }

    func testTheCityLineNamesTheCountryAndTheDistance() {
        XCTAssertEqual(locateCityLine(PictureLocation(city: kalbarriCity, km: 0.25)), "Kalbarri (AU), 0.3 km away")
        XCTAssertNil(locateCityLine(PictureLocation()))
    }

    func testEverySilenceIsASentence() {
        let doc = trip(from: "2025-11-01", to: "2025-11-30")
        XCTAssertTrue(locateSilenceWords(doc, PictureLocation(silence: .noPosition)).hasPrefix("This picture carries no position"))
        XCTAssertTrue(locateSilenceWords(doc, PictureLocation(silence: .nullIsland)).hasPrefix("Its position reads 0, 0"))
        XCTAssertEqual(locateSilenceWords(doc, PictureLocation(date: "2026-01-02", silence: .outsideTrip)),
                       "2 Jan 2026 is not a day of this trip (1 Nov 2025 → 30 Nov 2025), so nothing is offered here.")
        XCTAssertEqual(locateSilenceWords(doc, PictureLocation(silence: .noName)),
                       "Nothing in the city index is within 90 km of that position, so there is no name to offer. The leg keeps its dates.")
        let named = createTripStage("", "", "2025-11-01", "2025-11-05", places: [createTripPlace("Kalbarri")])
        XCTAssertEqual(locateSilenceWords(doc, PictureLocation(city: kalbarriCity, stage: named, silence: .already)),
                       "“Kalbarri” already names Kalbarri. Nothing to add.")
        XCTAssertEqual(locateSilenceWords(doc, PictureLocation(silence: .already)),
                       "That place is already on the leg of this day.")
        XCTAssertEqual(locateSilenceWords(doc, PictureLocation()), "")
    }
}
