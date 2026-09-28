// `src/shared/roadtrip/hooks/map-plan.ts`: every case of `map-plan.test.ts`
// — the `mapOptions` and `readStops` readers, the projection and its inverse,
// the drag, the arcs, the clock, the pen, the pictures' timing, the score, the
// editing verbs, the trip's places and the distance — and the retired Route's
// conversion.

import XCTest
@testable import AtelierKit

final class MapPlanOptionsTests: XCTestCase {
    func testFallsBackOnEveryUnreadableValueRatherThanThrowing() {
        let o = mapOptions([
            "media": "hologram", "easing": "bounce", "pathColor": "red", "size": "big",
            "curve": 99, "dwellSeconds": -4, "kit": "orchestra",
        ])
        let d = MapOptions.defaults
        XCTAssertEqual(o.media, d.media)
        XCTAssertEqual(o.easing, d.easing)
        XCTAssertEqual(o.pathColor, d.pathColor)
        XCTAssertEqual(o.size, d.size)
        XCTAssertEqual(o.curve, 0.6)
        XCTAssertEqual(o.dwellSeconds, 0)
        XCTAssertEqual(o.kit, d.kit)
    }

    func testKeepsAColourItCanPaintLowerCased() {
        XCTAssertEqual(mapOptions(["pathColor": "#AABBCC"]).pathColor, "#aabbcc")
    }

    func testReadsTheStopsThroughTheSameDiscipline() {
        let o = mapOptions(["stops": [["id": "a", "name": "Perth", "lat": -31.95, "lon": 115.86]]])
        XCTAssertEqual(o.stops.count, 1)
        XCTAssertEqual(o.stops[0].name, "Perth")
    }

    func testReadsAStoredNumberAsJavaScriptsNumberDoes() {
        // `{ ...MAP_DEFAULTS, ...raw }` reads a key the record holds, even a null.
        let o = mapOptions(["size": nil, "drawSeconds": " 5 ", "offsetX": true, "plate": nil, "underlay": nil])
        XCTAssertEqual(o.size, 0.5)
        XCTAssertEqual(o.drawSeconds, 5)
        XCTAssertEqual(o.offsetX, 0.45)
        XCTAssertFalse(o.plate)
        XCTAssertTrue(o.underlay)
    }

    func testWritesEveryOptionAndReadsItBack() {
        var o = MapOptions.defaults
        o.stops = [MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86)]
        o.kit = .typewriter
        XCTAssertEqual(mapOptions(o.json.objectValue ?? [:]), o)
    }
}

final class MapPlanReadStopsTests: XCTestCase {
    func testDropsAnythingThatCannotBeAPointOnAMap() {
        let stops = readStops([
            ["id": "ok", "name": "Perth", "lat": -31.95, "lon": 115.86],
            ["id": "no-coords", "name": "A place typed by hand"],
            ["id": "off-world", "name": "Nowhere", "lat": 120, "lon": 0],
            "not an object",
            nil,
        ])
        XCTAssertEqual(stops.map(\.id), ["ok"])
    }

    func testKeepsAStopsPictureAndDropsOneThatCannotNameAFile() {
        let stops = readStops([
            ["id": "a", "lat": 0, "lon": 0, "picture": ["ref": ["name": "DJI_0042.JPG", "size": 12], "date": "2025-03-04"]],
            ["id": "b", "lat": 1, "lon": 1, "picture": ["ref": ["size": 12]]],
            ["id": "c", "lat": 2, "lon": 2, "picture": "a picture"],
        ])
        XCTAssertEqual(stops[0].picture?.ref.name, "DJI_0042.JPG")
        XCTAssertNil(stops[1].picture)
        XCTAssertNil(stops[2].picture)
    }

    func testNeverReadsMoreStopsThanOneOpenerDraws() {
        let many = JSONValue.array((0..<(mapMaxStops + 8)).map { i in
            ["id": .string("s\(i)"), "lat": .number(Double(i) * 0.1), "lon": 0]
        })
        XCTAssertEqual(readStops(many).count, mapMaxStops)
    }

    func testIsEmptyForAnythingThatIsNotAList() {
        XCTAssertEqual(readStops(nil), [])
        XCTAssertEqual(readStops(["a": 1]), [])
    }
}

final class MapPlanFromRouteTests: XCTestCase {
    private let places = [
        MapPlace(name: "Perth", lat: -31.95, lon: 115.86),
        MapPlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]

    func testRenamesTheRoutesOwnWordsAndStartsStraightWithNoPictures() {
        let o = mapFromRoute(["pastColor": "#FFEE00", "futureColor": "#123456", "futureStyle": "hidden", "accent": "#ff0000"], places) { "stop\($0)" }
        XCTAssertEqual(o.stops.map(\.id), ["stop0", "stop1"])
        XCTAssertEqual(o.pathColor, "#ffee00")
        XCTAssertEqual(o.aheadColor, "#123456")
        XCTAssertEqual(o.aheadStyle, .hidden)
        XCTAssertEqual(o.media, .off)
        XCTAssertEqual(o.curve, 0)
    }

    func testAnOptionTheRouteNeverWroteKeepsTheItinerarysDefault() {
        let o = mapFromRoute([:], []) { "s\($0)" }
        var expected = MapOptions.defaults
        expected.media = .off
        expected.curve = 0
        XCTAssertEqual(o, expected)
    }
}

// MARK: - the behaviour: the rest of `map-plan.test.ts`, case for case

private func mapPicture(_ name: String) -> HookPickedPicture {
    HookPickedPicture(ref: SavedMediaRef(name: name, size: 1000, lastModified: 1_741_046_400_000), date: "2025-03-04")
}

/// Perth → Kalbarri → Coral Bay, west coast of Australia.
private let mapStops: [MapStop] = [
    MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86),
    MapStop(id: "b", name: "Kalbarri", lat: -27.71, lon: 114.16),
    MapStop(id: "c", name: "Coral Bay", lat: -23.14, lon: 113.77),
]

private let mapStages: [HookStage] = [
    HookStage(startDate: "2025-03-01", endDate: "2025-03-10", label: "Perth → Kalbarri", places: [
        HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
        HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]),
    // The same place twice, and one with no coordinates at all upstream.
    HookStage(startDate: "2025-03-11", endDate: "2025-03-15", label: "Exmouth", places: [
        HookStagePlace(name: "Exmouth", lat: -21.93, lon: 114.12),
        HookStagePlace(name: "Exmouth again", lat: -21.93, lon: 114.12),
    ]),
]

final class MapPlanProjectionTests: XCTestCase {
    private let box = mapBox(1080, 1920, MapOptions.defaults)

    func testFitsEveryPointInsideTheBox() {
        let projection = fitMapProjection(mapStops, box, 8)
        for stop in mapStops {
            let at = projection.project(stop)
            XCTAssertGreaterThanOrEqual(at.x, box.x)
            XCTAssertLessThanOrEqual(at.x, box.x + box.width)
            XCTAssertGreaterThanOrEqual(at.y, box.y)
            XCTAssertLessThanOrEqual(at.y, box.y + box.height)
        }
    }

    func testRunsBackwardsAProjectedPointUnprojectsToItself() {
        let projection = fitMapProjection(mapStops, box, 8)
        for stop in mapStops {
            let back = projection.unproject(projection.project(stop))
            assertClose(back.lat, stop.lat, 6)
            assertClose(back.lon, stop.lon, 6)
        }
    }

    func testPutsNorthUp() {
        let projection = fitMapProjection(mapStops, box, 8)
        // Coral Bay is the northernmost of the three.
        XCTAssertLessThan(projection.project(mapStops[2]).y, projection.project(mapStops[0]).y)
    }

    func testShowsTheWholeWorldWhenThereIsNothingToFit() {
        let projection = fitMapProjection([MapStop](), box, 0)
        // Sampled just inside the two edges: the box's own edges sit on the
        // antimeridian, where +180 and −180 name the same line.
        let left = projection.unproject(Point(box.x + box.width * 0.02, box.y + box.height / 2))
        let right = projection.unproject(Point(box.x + box.width * 0.98, box.y + box.height / 2))
        XCTAssertLessThan(left.lon, -100)
        XCTAssertGreaterThan(right.lon, 100)
        let middle = projection.unproject(Point(box.x + box.width / 2, box.y + box.height / 2))
        assertClose(middle.lat, 0, 9)
        assertClose(middle.lon, 0, 9)
    }

    func testCentresASinglePointWithoutCollapsingItsScale() {
        let projection = fitMapProjection([GeoPoint(lat: -31.95, lon: 115.86)], box, 0)
        let at = projection.project(GeoPoint(lat: -31.95, lon: 115.86))
        assertClose(at.x, box.x + box.width / 2, 6)
        assertClose(at.y, box.y + box.height / 2, 6)
        // A first pin dropped beside it still lands somewhere real.
        let beside = projection.unproject(Point(at.x + 40, at.y))
        XCTAssertTrue(beside.lat.isFinite)
        XCTAssertGreaterThanOrEqual(abs(beside.lon - 115.86), pow(10, -3) / 2)
    }
}

final class MapPlanMovingTests: XCTestCase {
    func testSitsOnItsAnchorUntilItIsDragged() {
        let anchored = mapBox(1000, 2000, MapOptions.defaults)
        var o = MapOptions.defaults
        o.offsetX = 0.1
        o.offsetY = -0.05
        let moved = mapBox(1000, 2000, o)
        assertClose(moved.x - anchored.x, 100, 6)
        assertClose(moved.y - anchored.y, -100, 6)
        XCTAssertEqual(moved.width, anchored.width)
    }

    func testAccumulatesADragAndClampsItSoTheMapCanNeverBeLost() {
        let o = mapOptions([:])
        let once = moveMap(o, 0.2, 0.1)
        assertClose(once.offsetX, 0.2, 9)
        let twice = moveMap(once, 0.2, 0.1)
        assertClose(twice.offsetX, 0.4, 9)
        // Dragged far past the edge, in both directions.
        XCTAssertEqual(moveMap(twice, 5, 5).offsetX, mapLimits.offset.max)
        XCTAssertEqual(moveMap(twice, -5, -5).offsetY, mapLimits.offset.min)
    }

    func testSaysWhetherItHasBeenMovedSoThePanelCanOfferTheWayBack() {
        XCTAssertFalse(mapMoved(mapOptions([:])))
        XCTAssertTrue(mapMoved(moveMap(mapOptions([:]), 0, 0.01)))
    }

    func testReadsAStoredOffsetThroughTheSameClampAsEverythingElse() {
        XCTAssertEqual(mapOptions(["offsetX": 9, "offsetY": "left"]).offsetX, mapLimits.offset.max)
        XCTAssertEqual(mapOptions(["offsetY": "left"]).offsetY, 0)
    }
}

final class MapPlanArcTests: XCTestCase {
    private let a = Point(0, 0)
    private let b = Point(100, 0)

    func testIsTheStraightMidpointWithNoBow() {
        XCTAssertEqual(arcControl(a, b, 0), Point(50, 0))
    }

    func testBowsToOneSideSoAThereAndBackDrawsTwoArcs() {
        let there = arcControl(a, b, 0.2)
        let back = arcControl(b, a, 0.2)
        XCTAssertGreaterThanOrEqual(abs(there.y - back.y), pow(10, -3) / 2)
        XCTAssertEqual((there.y - 0).sign == .minus ? -1 : 1, (back.y - 0).sign == .minus ? 1 : -1)
    }

    func testSplitsIntoACurveThatEndsExactlyWhereTheWholeOneIsAtS() {
        let control = arcControl(a, b, 0.25)
        for s in [0.1, 0.5, 0.87] {
            let part = quadSplit(a, control, b, s)
            let whole = quadAt(a, control, b, s)
            assertClose(part.end.x, whole.x, 9)
            assertClose(part.end.y, whole.y, 9)
        }
    }

    func testIsTheWholeCurveAtSOne() {
        let control = arcControl(a, b, 0.3)
        let part = quadSplit(a, control, b, 1)
        XCTAssertEqual(part.control, control)
        assertClose(part.end.x, b.x, 9)
    }

    func testTheTailStartsWhereTheDrawnPartEndsAndLandsOnTheSameCurve() {
        let control = arcControl(a, b, 0.25)
        for s in [0.15, 0.5, 0.9] {
            let drawn = quadSplit(a, control, b, s)
            let tail = quadTail(a, control, b, s)
            // The two halves meet exactly — the pen's tip is one point, not a seam.
            assertClose(tail.start.x, drawn.end.x, 9)
            assertClose(tail.start.y, drawn.end.y, 9)
            XCTAssertEqual(tail.end, b)
            // And the tail IS the rest of the same arc: its own midpoint sits on
            // the whole curve, which is what makes the line ahead a bed the pen fills.
            let mid = quadAt(tail.start, tail.control, tail.end, 0.5)
            let onWhole = quadAt(a, control, b, s + (1 - s) * 0.5)
            assertClose(mid.x, onWhole.x, 9)
            assertClose(mid.y, onWhole.y, 9)
        }
    }

    func testTheTailIsTheWholeCurveWhenNothingIsDrawnYet() {
        let control = arcControl(a, b, 0.3)
        let tail = quadTail(a, control, b, 0)
        XCTAssertEqual(tail.start, a)
        XCTAssertEqual(tail.control, control)
        XCTAssertEqual(tail.end, b)
    }
}

final class MapPlanTimingTests: XCTestCase {
    private let o = mapOptions(["drawSeconds": 3, "dwellSeconds": 0.5, "delaySeconds": 0.2])

    func testSharesTheTravellingOutByDistance() {
        // Two hops, the first three times the second.
        let timing = mapTiming([300, 100], o)
        assertClose(timing.hops[0].travel, 2.25, 6)
        assertClose(timing.hops[1].travel, 0.75, 6)
    }

    func testArrivesAfterTheHoldAndWaitsAtEveryStopIncludingTheLast() {
        let timing = mapTiming([300, 100], o)
        assertClose(timing.arrivals[0], 0.2, 6)
        assertClose(timing.arrivals[1], 0.2 + 2.25, 6)
        assertClose(timing.arrivals[2], 0.2 + 2.25 + 0.5 + 0.75, 6)
        assertClose(timing.total, timing.arrivals[2] + 0.5, 6)
    }

    func testStillAdvancesWhenEveryStopIsOnOneSpot() {
        let timing = mapTiming([0, 0], o)
        assertClose(timing.hops[0].travel, 1.5, 6)
        XCTAssertGreaterThan(timing.total, 0)
    }

    func testTakesNoTimeAtAllWithTheTravellingOffAndIsWhollyArrived() {
        let timing = mapTiming([300, 100], mapOptions(["draw": false]))
        XCTAssertEqual(timing.total, 0)
        // Every stop reached at zero: the whole path drawn, every pin up, the
        // last stop the one showing — no reader downstream branches on "is it moving".
        XCTAssertEqual(timing.arrivals, [0, 0, 0])
        let pen = penAt(timing, .linear, 0)
        XCTAssertEqual(pen.stop, 2)
        XCTAssertNil(pen.hop)
        XCTAssertEqual(drawnFractions(timing, .linear, 0, 2), [1, 1])
        let media = mediaAt(timing, 0, 0.25)
        XCTAssertEqual(media.current, 2)
        XCTAssertEqual(media.mix, 1)
        XCTAssertEqual(pinAlphaAt(timing, 0, 1, 0.25), 1)
    }
}

final class MapPlanPenTests: XCTestCase {
    private let o = mapOptions(["drawSeconds": 2, "dwellSeconds": 0.5, "delaySeconds": 0.2, "easing": "linear"])
    private var timing: MapTiming { mapTiming([100, 100], o) }

    func testWaitsOnTheFirstStopThroughTheHold() {
        let pen = penAt(timing, .linear, 0.1)
        XCTAssertNil(pen.hop)
        XCTAssertEqual(pen.stop, 0)
        XCTAssertFalse(pen.moving)
    }

    func testTravelsTheFirstHop() {
        let pen = penAt(timing, .linear, 0.2 + 0.5)
        XCTAssertEqual(pen.hop, 0)
        assertClose(pen.fraction, 0.5, 6)
        XCTAssertTrue(pen.moving)
    }

    func testIsStillOnTheStopThroughTheDwell() {
        let pen = penAt(timing, .linear, 0.2 + 1 + 0.2)
        XCTAssertNil(pen.hop)
        XCTAssertEqual(pen.stop, 1)
        XCTAssertFalse(pen.moving)
    }

    func testRestsOnTheLastStopPastTheEnd() {
        let pen = penAt(timing, .linear, 99)
        XCTAssertNil(pen.hop)
        XCTAssertEqual(pen.stop, 2)
        XCTAssertFalse(pen.moving)
    }

    func testHasNowhereToGoWithOneStop() {
        let pen = penAt(mapTiming([], o), .linear, 5)
        XCTAssertNil(pen.hop)
        XCTAssertEqual(pen.stop, 0)
    }
}

final class MapPlanDrawnFractionsTests: XCTestCase {
    private let timing = mapTiming([100, 100], mapOptions(["drawSeconds": 2, "dwellSeconds": 0, "delaySeconds": 0,
                                                           "easing": "linear"]))

    func testDrawsTheHopsBehindThePenWholeAndTheOnesAheadNotAtAll() {
        XCTAssertEqual(drawnFractions(timing, .linear, 1.5, 2), [1, 0.5])
    }

    func testIsTheWholePathOnceThePenHasArrived() {
        XCTAssertEqual(drawnFractions(timing, .linear, 9, 2), [1, 1])
    }
}

final class MapPlanMediaAtTests: XCTestCase {
    private let timing = mapTiming([100, 100], mapOptions(["drawSeconds": 2, "dwellSeconds": 0, "delaySeconds": 0.4,
                                                           "easing": "linear"]))

    func testShowsTheFirstStopsPictureFromTheFirstFrameHoldIncluded() {
        XCTAssertEqual(mediaAt(timing, 0, 0.25), MediaAt(current: 0, previous: nil, mix: 1))
        XCTAssertEqual(mediaAt(timing, 0.3, 0.25), MediaAt(current: 0, previous: nil, mix: 1))
    }

    func testCrossFadesFromTheStopBeforeAsThePenLands() {
        let at = mediaAt(timing, timing.arrivals[1] + 0.125, 0.25)
        XCTAssertEqual(at.current, 1)
        XCTAssertEqual(at.previous, 0)
        assertClose(at.mix, 0.5, 6)
    }

    func testArrivesAtOnceWithNoFade() {
        XCTAssertEqual(mediaAt(timing, timing.arrivals[1], 0), MediaAt(current: 1, previous: nil, mix: 1))
    }

    func testHoldsTheLastPicturePastTheEnd() {
        let at = mediaAt(timing, 99, 0.25)
        XCTAssertEqual(at.current, 2)
        XCTAssertEqual(at.mix, 1)
    }
}

final class MapPlanPinAlphaTests: XCTestCase {
    private let timing = mapTiming([100, 100], mapOptions(["drawSeconds": 2, "dwellSeconds": 0, "delaySeconds": 0]))

    func testIsNothingBeforeTheStopIsReachedAndWholeAfterTheFade() {
        XCTAssertEqual(pinAlphaAt(timing, timing.arrivals[1] - 0.01, 1, 0.2), 0)
        assertClose(pinAlphaAt(timing, timing.arrivals[1] + 0.1, 1, 0.2), 0.5, 6)
        assertClose(pinAlphaAt(timing, timing.arrivals[1] + 0.3, 1, 0.2), 1, 6)
    }

    func testShowsTheFirstStopsPinFromTheFirstFrameLikeTheBackdrop() {
        XCTAssertEqual(pinAlphaAt(timing, 0, 0, 0.2), 1)
        XCTAssertEqual(mediaAt(timing, 0, 0.2).mix, 1)
    }
}

final class MapPlanScoreTests: XCTestCase {
    private let timing = mapTiming([100, 100], mapOptions(["drawSeconds": 2, "dwellSeconds": 0.3, "delaySeconds": 0.2]))

    func testTicksAtEveryArrivalAndSeatsOnTheLast() {
        let score = mapScore(timing, (kit: .ratchet, pitch: 1), 1)
        XCTAssertEqual(score.count, 3)
        XCTAssertEqual(score.map(\.at), timing.arrivals)
        let kit = TickKit.ratchet.spec
        XCTAssertEqual(score[2].voice, kit.seat.rawValue)
        XCTAssertEqual(score[1].voice, kit.tick.rawValue)
        XCTAssertEqual(score[0].voice, kit.leg.voice.rawValue)
    }

    func testWritesNoBedAtAllAtVolumeZeroOrWithNowhereToTravel() {
        XCTAssertEqual(mapScore(timing, (kit: .ratchet, pitch: 1), 0), [])
        XCTAssertEqual(mapScore(mapTiming([], MapOptions.defaults), (kit: .ratchet, pitch: 1), 1), [])
    }

    func testTransposesEveryEventByThePitch() {
        let score = mapScore(timing, (kit: .wood, pitch: 2), 1)
        XCTAssertEqual(score[1].rate, 2)
        assertClose(score[0].rate ?? .nan, 2 * TickKit.wood.spec.leg.rate, 6)
    }
}

final class MapPlanWantsTests: XCTestCase {
    private var stops: JSONValue {
        var first = mapStops[0]
        first.picture = mapPicture("one.jpg")
        var last = mapStops[2]
        last.picture = mapPicture("one.jpg")
        return .array([first.json, mapStops[1].json, last.json])
    }

    func testAsksForEachPictureOnceAndOnlyTheOnesAStopHolds() {
        let wants = mapWants(mapOptions(["stops": stops, "media": "pin"]))
        XCTAssertEqual(wants.count, 1)
        XCTAssertEqual(wants[0].ref.name, "one.jpg")
    }

    func testAsksForNothingAtAllWithThePicturesOff() {
        XCTAssertEqual(mapWants(mapOptions(["stops": stops, "media": "off"])), [])
    }
}

final class MapPlanEditingTests: XCTestCase {
    func testAddsAtTheEndUpToTheCap() {
        let one = addStop([], GeoPoint(lat: 1, lon: 2), name: "Here", "x")
        XCTAssertEqual(one, [MapStop(id: "x", name: "Here", lat: 1, lon: 2)])
        let full = (0..<mapMaxStops).map { MapStop(id: "s\($0)", name: "", lat: Double($0), lon: 0) }
        XCTAssertEqual(addStop(full, GeoPoint(lat: 0, lon: 0), "over").count, mapMaxStops)
    }

    func testPatchesOneStopAndKeepsItsPicture() {
        var held = mapStops[0]
        held.picture = mapPicture("one.jpg")
        let stops = [held]
        let patched = patchStop(stops, "a") { $0.lat = -30 }
        XCTAssertEqual(patched[0].lat, -30)
        XCTAssertEqual(patched[0].picture?.ref.name, "one.jpg")
        XCTAssertEqual(patchStop(stops, "missing") { $0.lat = 0 }[0].lat, mapStops[0].lat)
    }

    func testMovesAStopOnePlaceAndRefusesToWrap() {
        XCTAssertEqual(moveStop(mapStops, "c", -1).map(\.id), ["a", "c", "b"])
        XCTAssertEqual(moveStop(mapStops, "a", -1).map(\.id), ["a", "b", "c"])
        XCTAssertEqual(moveStop(mapStops, "c", 1).map(\.id), ["a", "b", "c"])
    }

    func testRemovesOne() {
        XCTAssertEqual(removeStop(mapStops, "b").map(\.id), ["a", "c"])
    }

    func testTakesTheTripsPlacesAsAnItinerary() {
        let stops = stopsFromPlaces(tripPlaces(mapStages)) { "id\($0)" }
        XCTAssertEqual(stops.map(\.name), ["Perth", "Kalbarri", "Exmouth"])
    }
}

final class MapPlanAssignPicturesTests: XCTestCase {
    func testPutsTheFirstOnTheStopItWasAskedFrom() {
        let (stops, used) = assignPictures(mapStops, 1, [mapPicture("one.jpg")])
        XCTAssertEqual(stops[1].picture?.ref.name, "one.jpg")
        XCTAssertNil(stops[0].picture)
        XCTAssertEqual(used, 1)
    }

    func testFillsTheStopsAfterItThatHaveNoneAndNeverOneThatHas() {
        var kept = mapStops[2]
        kept.picture = mapPicture("kept.jpg")
        let held = [mapStops[0], mapStops[1], kept]
        let (stops, used) = assignPictures(held, 0, [mapPicture("a.jpg"), mapPicture("b.jpg")])
        XCTAssertEqual(stops[0].picture?.ref.name, "a.jpg")
        XCTAssertEqual(stops[1].picture?.ref.name, "b.jpg")
        XCTAssertEqual(stops[2].picture?.ref.name, "kept.jpg")
        XCTAssertEqual(used, 2)
    }

    func testReportsWhatHadNowhereToGoRatherThanDroppingItInSilence() {
        let (_, used) = assignPictures(mapStops, 2, [mapPicture("a.jpg"), mapPicture("b.jpg")])
        XCTAssertEqual(used, 1)
    }

    func testTakesThePictureOffTheStopWhenNothingWasKept() {
        var held = mapStops[0]
        held.picture = mapPicture("one.jpg")
        XCTAssertNil(assignPictures([held], 0, []).stops[0].picture)
    }

    func testChangesNothingForAStopThatIsNotThere() {
        XCTAssertEqual(assignPictures(mapStops, 9, [mapPicture("a.jpg")]).stops, mapStops)
    }
}

final class MapPlanTripPlacesTests: XCTestCase {
    func testListsEachLocatedSpotOnceInTheOrderItWasLived() {
        XCTAssertEqual(tripPlaces(mapStages).map(\.name), ["Perth", "Kalbarri", "Exmouth"])
    }

    func testLeavesOutTheOnesAlreadyOnTheItinerary() {
        XCTAssertEqual(otherPlaces(mapStages, [mapStops[0]]).map(\.name), ["Kalbarri", "Exmouth"])
    }

    func testIsEmptyWithNoLegsAtAll() {
        XCTAssertEqual(tripPlaces(nil), [])
        XCTAssertEqual(otherPlaces(nil, mapStops), [])
    }
}

final class MapPlanDistanceTests: XCTestCase {
    func testMeasuresTheGreatCircleBetweenTheStops() {
        // Perth → Kalbarri is about 490 km as the crow flies.
        XCTAssertGreaterThan(haversineKm(mapStops[0], mapStops[1]), 460)
        XCTAssertLessThan(haversineKm(mapStops[0], mapStops[1]), 520)
        XCTAssertEqual(hopKms(mapStops).count, 2)
    }

    func testAHopOfNoLengthIsNoDistance() {
        XCTAssertEqual(haversineKm(mapStops[0], mapStops[0]), 0)
    }

    func testCountsOnlyWhatThePenHasDrawn() {
        assertClose(drawnKm([100, 100], [1, 0.5]), 150, 6)
        XCTAssertEqual(drawnKm([100, 100], [0, 0]), 0)
    }

    func testWritesAReadableFigure() {
        XCTAssertEqual(formatDistance(1240, .km), "1 240 km")
        XCTAssertEqual(formatDistance(1240, .mi), "771 mi")
        XCTAssertEqual(formatDistance(4.2, .km), "4.2 km")
        XCTAssertEqual(formatDistance(1240, .off), "")
    }

    func testMeasuresTheHopsInTheProjectionsOwnUnitsInTheSameOrderAsTheKilometres() {
        let hops = planarHops(mapStops)
        let kms = hopKms(mapStops)
        XCTAssertEqual(hops.count, 2)
        // The projection is one uniform scale, so the ratio between two hops is
        // the ratio between their real lengths — which is what lets the travel
        // time be shared out by planar length and still keep one pace.
        assertClose(hops[0] / hops[1], kms[0] / kms[1], 1)
    }
}

final class MapPlanWantsLabelTests: XCTestCase {
    func testNamesWhatEachSettingSaysItNames() {
        XCTAssertFalse(wantsLabel(.none, 0, 3, 0))
        XCTAssertTrue(wantsLabel(.all, 1, 3, 0))
        XCTAssertTrue(wantsLabel(.ends, 0, 3, 0))
        XCTAssertFalse(wantsLabel(.ends, 1, 3, 0))
        XCTAssertTrue(wantsLabel(.ends, 2, 3, 0))
        XCTAssertTrue(wantsLabel(.current, 2, 3, 2))
        XCTAssertFalse(wantsLabel(.current, 1, 3, 2))
    }

    func testKeepsEveryNameBehindThePenUnderPassedAndNoneAheadOfIt() {
        XCTAssertTrue(wantsLabel(.passed, 0, 4, 2))
        XCTAssertTrue(wantsLabel(.passed, 2, 4, 2))
        XCTAssertFalse(wantsLabel(.passed, 3, 4, 2))
        // On the first stop it says one name, where `all` would already say four.
        XCTAssertFalse(wantsLabel(.passed, 1, 4, 0))
    }

    func testIsAStoredValueLikeAnyOtherAnUnknownOneFallsBack() {
        XCTAssertEqual(mapOptions(["labels": "passed"]).labels, .passed)
        XCTAssertEqual(mapOptions(["labels": "shouty"]).labels, MapOptions.defaults.labels)
    }
}
