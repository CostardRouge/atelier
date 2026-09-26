// `src/shared/roadtrip/hooks/drive-plan.ts`: every case of `drive-plan.test.ts`,
// one for one, same numbers and tolerances — the options, the route on the
// legs' places and on the pictures' own positions, the pictures asked for, the
// path, the schedule, the camera, the map's furniture and the score.

import XCTest
@testable import AtelierKit

/// Three legs across Western Australia; the middle one has one place only.
private let driveStages: [HookStage] = [
    HookStage(startDate: "2025-03-01", endDate: "2025-03-10", label: "Perth → Kalbarri", places: [
        HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
        HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]),
    HookStage(startDate: "2025-03-11", endDate: "2025-03-15", label: "Coral Bay", places: [
        HookStagePlace(name: "Coral Bay", lat: -23.14, lon: 113.77),
    ]),
    HookStage(startDate: "2025-03-16", endDate: "2025-03-30", label: "Karijini → Broome", places: [
        HookStagePlace(name: "Karijini", lat: -22.37, lon: 118.28),
        HookStagePlace(name: "Broome", lat: -17.96, lon: 122.24),
    ]),
]

/// A trip of `total` days starting 2025-03-01, told on the given day numbers.
private func driveCalendar(_ total: Int, told: [Int] = [], legs: [Int] = [1, 11, 16]) -> [HookDay] {
    (0..<total).map { i in
        let n = i + 1
        let isTold = told.contains(n)
        let pieces: [HookDayPiece] = isTold
            ? [HookDayPiece(id: "p\(n)", title: "", published: false,
                            media: SavedMediaRef(name: "p\(n).jpg", size: 1, lastModified: 0), videoSeconds: 0)]
            : []
        return HookDay(date: String(format: "2025-03-%02d", n), dayNumber: n, told: isTold,
                       legStart: legs.contains(n), pieces: pieces)
    }
}

private let driveCal = driveCalendar(30)
private func driveDateOf(_ n: Int) -> IsoDate { driveCal[n - 1].date }

private func driveOpts(_ change: (inout DriveOptions) -> Void = { _ in }) -> DriveOptions {
    var o = DriveOptions.defaults
    change(&o)
    return o
}

private func drivePic(_ name: String, _ day: Int, _ coords: GeoPoint? = nil, _ takenAt: Double = 0) -> HookPickedPicture {
    HookPickedPicture(ref: SavedMediaRef(name: name, size: 1, lastModified: 0), date: driveDateOf(day),
                      takenAt: takenAt, coords: coords)
}

private func names(_ stop: DriveStop?) -> [String] {
    stop?.pictures.map(\.want.ref.name) ?? []
}

final class DrivePlanOptionsTests: XCTestCase {
    func testFillsWhatADocumentNeverStored() {
        XCTAssertEqual(driveOptions([:]), DriveOptions.defaults)
    }

    func testClampsNumbersRefusesColoursItCannotPaintAndIdsItDoesNotKnow() {
        let o = driveOptions(["driveSeconds": 99, "tilt": 10, "stopsOn": "moon", "camera": "drone", "picked": "all",
                              "followZoom": -1])
        XCTAssertEqual(o.driveSeconds, driveLimits.driveSeconds.max)
        XCTAssertEqual(o.tilt, driveLimits.tilt.min)
        XCTAssertEqual(o.stopsOn, .places)
        XCTAssertEqual(o.camera, .whole)
        XCTAssertEqual(o.picked, [])
        XCTAssertEqual(o.followZoom, driveLimits.followZoom.min)
    }

    func testIgnoresTheCarKeysAPieceOnceCarriedTheCarIsTheTripsNow() {
        let o = driveOptions(["carColor": "#ff0000", "spare": false, "rack": true, "mirrors": false])
        XCTAssertEqual(o, DriveOptions.defaults)
        for key in ["carColor", "spare", "rack", "mirrors"] { XCTAssertNil(o.json[key], key) }
    }

    func testReadsAPickedPictureWithItsPosition() {
        let o = driveOptions(["picked": [[
            "ref": ["name": "a.jpg", "size": 1, "lastModified": 0], "date": "2025-03-02", "coords": ["lat": 1, "lon": 2],
        ]]])
        XCTAssertEqual(o.picked[0].coords, GeoPoint(lat: 1, lon: 2))
    }
}

final class DrivePlanRouteOnPlacesTests: XCTestCase {
    func testDrivesTheTripSoFarAndArrivesAtTheEndOfThisDaysLeg() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(12), driveOpts { $0.includePieces = false })
        XCTAssertEqual(route.stops.map(\.name), ["Perth", "Kalbarri", "Coral Bay"])
        XCTAssertEqual(route.currentLeg, 2)
        XCTAssertEqual(route.stops.map(\.accent), [true, false, true])
        XCTAssertTrue(route.named)
    }

    func testDrivesEveryLegWhenNoLegCoversTheDay() {
        let route = driveRoute(driveStages, driveCal, "2031-01-01", driveOpts { $0.includePieces = false })
        XCTAssertEqual(route.stops.count, 5)
        XCTAssertNil(route.currentLeg)
    }

    func testPutsALocatedPictureAtTheNearestPlaceAndADatedOneAtItsLegsEnd() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(20), driveOpts {
            $0.includePieces = false
            $0.picked = [
                drivePic("near-kalbarri.jpg", 5, GeoPoint(lat: -27.6, lon: 114.2)),
                drivePic("no-gps-leg1.jpg", 4),
                drivePic("no-gps-leg2.jpg", 12),
            ]
        })
        var byName: [String: [String]] = [:]
        for stop in route.stops { byName[stop.name] = names(stop) }
        XCTAssertEqual(byName["Kalbarri"], ["no-gps-leg1.jpg", "near-kalbarri.jpg"])
        XCTAssertEqual(byName["Coral Bay"], ["no-gps-leg2.jpg"])
        XCTAssertEqual(byName["Perth"], [])
    }

    func testCountsWhatItCannotPlaceRatherThanGuessingASpot() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(8), driveOpts {
            $0.includePieces = false
            $0.picked = [drivePic("later.jpg", 12), drivePic("day1.jpg", 1), drivePic("no-leg.jpg", 8)]
        })
        // Day 12 is after the piece; days 1 and 8 ARE on leg 1 (days 1–10), so
        // both land at Kalbarri, in shot order.
        XCTAssertEqual(route.leftOut.after, 1)
        XCTAssertEqual(names(route.stops.first { $0.name == "Kalbarri" }), ["day1.jpg", "no-leg.jpg"])
        var short = driveStages[0]
        short.startDate = "2025-03-01"
        short.endDate = "2025-03-05"
        let homeless = driveRoute([short], driveCal, driveDateOf(8), driveOpts {
            $0.includePieces = false
            $0.picked = [drivePic("no-leg.jpg", 8)]
        })
        XCTAssertEqual(homeless.leftOut.homeless, 1)
        var foreign = drivePic("x.jpg", 1)
        foreign.date = "2019-01-01"
        let outside = driveRoute(driveStages, driveCal, driveDateOf(8), driveOpts {
            $0.includePieces = false
            $0.picked = [foreign]
        })
        XCTAssertEqual(outside.leftOut.outside, 1)
    }

    func testRidesTheToldDaysPicturesAlongAtTheEndOfTheirLegOnceEach() {
        let cal = driveCalendar(30, told: [3, 5, 12])
        let route = driveRoute(driveStages, cal, driveDateOf(20), driveOpts { $0.picked = [drivePic("p3.jpg", 3)] })
        let kalbarri = route.stops.first { $0.name == "Kalbarri" }
        // p3 was picked (and lands on leg 1 by its date), p5 rides along; p3 is not doubled.
        XCTAssertEqual(names(kalbarri).sorted(), ["p3.jpg", "p5.jpg"])
        XCTAssertEqual(names(route.stops.first { $0.name == "Coral Bay" }), ["p12.jpg"])
        let without = driveRoute(driveStages, cal, driveDateOf(20), driveOpts { $0.includePieces = false })
        XCTAssertTrue(without.stops.allSatisfy { $0.pictures.isEmpty })
    }

    func testNeverShowsThePicturesOfDaysAfterThisOneNorThePiecesOwnDay() {
        let cal = driveCalendar(30, told: [12, 25])
        let route = driveRoute(driveStages, cal, driveDateOf(12), driveOpts())
        XCTAssertEqual(route.stops.flatMap(\.pictures).count, 0)
    }

    func testShowsAtMostAHandfulPerStopAndCountsTheRest() {
        let many = (0..<(driveMaxPicturesPerStop + 3)).map { drivePic("k\($0).jpg", 5, GeoPoint(lat: -27.7, lon: 114.2)) }
        let route = driveRoute(driveStages, driveCal, driveDateOf(8), driveOpts {
            $0.includePieces = false
            $0.picked = many
        })
        XCTAssertEqual(route.stops.first { $0.name == "Kalbarri" }?.pictures.count, driveMaxPicturesPerStop)
        XCTAssertEqual(route.leftOut.crowded, 3)
    }

    func testDropsEveryPictureWhenNoneIsToBeShown() {
        let route = driveRoute(driveStages, driveCalendar(30, told: [3]), driveDateOf(8), driveOpts {
            $0.pictures = .none
            $0.picked = [drivePic("a.jpg", 3)]
        })
        XCTAssertEqual(route.stops.flatMap(\.pictures).count, 0)
    }
}

final class DrivePlanRouteOnPicturesTests: XCTestCase {
    private let perth = GeoPoint(lat: -31.95, lon: 115.86)
    private let kalbarri = GeoPoint(lat: -27.71, lon: 114.16)

    func testStopsOncePerLocatedPictureInShotOrderARunWithinAStonesThrowJoiningOneStop() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(10), driveOpts {
            $0.stopsOn = .pictures
            $0.picked = [
                drivePic("b.jpg", 2, kalbarri, 20),
                drivePic("a.jpg", 2, perth, 10),
                drivePic("a2.jpg", 2, GeoPoint(lat: perth.lat + 0.0005, lon: perth.lon), 11),
                drivePic("c.jpg", 4, GeoPoint(lat: -25, lon: 114), 5),
            ]
        })
        XCTAssertEqual(route.stops.map(names), [["a.jpg", "a2.jpg"], ["b.jpg"], ["c.jpg"]])
        XCTAssertEqual(route.stops.map(\.name), ["Day 2", "Day 2", "Day 4"])
        XCTAssertEqual(route.stops.map(\.accent), [true, false, true])
        XCTAssertEqual(route.stops[0].kind, .picture)
        XCTAssertNil(route.currentLeg)
    }

    func testLetsAPictureWithoutAPositionRideWithTheStopShotBeforeIt() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(10), driveOpts {
            $0.stopsOn = .pictures
            $0.picked = [
                drivePic("first-no-gps.jpg", 2, nil, 1), drivePic("a.jpg", 2, perth, 10),
                drivePic("after.jpg", 2, nil, 11), drivePic("b.jpg", 3, kalbarri, 5),
            ]
        })
        XCTAssertEqual(route.stops.map(names), [["first-no-gps.jpg", "a.jpg", "after.jpg"], ["b.jpg"]])
    }

    func testHasNothingToDriveWhenNoPictureIsLocatedAndSaysHowMany() {
        let route = driveRoute(driveStages, driveCal, driveDateOf(10), driveOpts {
            $0.stopsOn = .pictures
            $0.picked = [drivePic("a.jpg", 2), drivePic("b.jpg", 3)]
        })
        XCTAssertEqual(route.stops.count, 0)
        XCTAssertEqual(route.leftOut.unlocated, 2)
    }

    func testMergesByDistanceNotByDay() {
        XCTAssertLessThan(driveMergeKm, 1)
        let route = driveRoute(driveStages, driveCal, driveDateOf(10), driveOpts {
            $0.stopsOn = .pictures
            $0.picked = [drivePic("a.jpg", 2, perth, 1),
                         drivePic("b.jpg", 3, GeoPoint(lat: perth.lat + 0.0002, lon: perth.lon), 1)]
        })
        XCTAssertEqual(route.stops.count, 1)
        XCTAssertEqual(route.stops[0].pictures.count, 2)
    }
}

final class DrivePlanWantsTests: XCTestCase {
    func testAsksForEveryPictureOnceWholeForCardsAndToTheFrameForAFill() {
        let route = driveRoute(driveStages, driveCalendar(30, told: [3]), driveDateOf(8), driveOpts {
            $0.picked = [drivePic("a.jpg", 4, GeoPoint(lat: -27.7, lon: 114.2))]
        })
        let cards = driveWants(route, driveOpts())
        XCTAssertEqual(cards.map(\.ref.name).sorted(), ["a.jpg", "p3.jpg"])
        XCTAssertTrue(cards.allSatisfy { $0.shape == .own })
        XCTAssertTrue(driveWants(route, driveOpts { $0.pictures = .fill }).allSatisfy { $0.shape == .frame })
        XCTAssertTrue(driveWants(route, driveOpts { $0.pictures = .backdrop }).allSatisfy { $0.shape == .frame })
        XCTAssertEqual(driveWants(route, driveOpts { $0.pictures = .none }), [])
    }
}

final class DrivePlanPathTests: XCTestCase {
    private let square = [Point(0, 0), Point(100, 0), Point(100, 100)]

    func testPassesThroughEveryStopCurvedOrStraightAndMeasuresItsLength() {
        for kind in [DrivePath.curved, .straight] {
            let path = buildPath(square, kind)
            XCTAssertEqual(path.stopS.count, 3)
            XCTAssertEqual(path.stopS[0], 0)
            assertClose(path.stopS[2], path.length, 9)
            for i in square.indices {
                let p = pointAt(path, path.stopS[i]).point
                assertClose(p.x, square[i].x, 6)
                assertClose(p.y, square[i].y, 6)
            }
        }
        assertClose(buildPath(square, .straight).length, 200, 9)
        XCTAssertGreaterThan(buildPath(square, .curved).length, 200)
    }

    func testInterpolatesAlongAStraightPathByArcLength() {
        let path = buildPath(square, .straight)
        XCTAssertEqual(pointAt(path, 50).point, Point(50, 0))
        XCTAssertEqual(pointAt(path, 150).point, Point(100, 50))
        XCTAssertEqual(pointAt(path, -5).point, square[0])
        XCTAssertEqual(pointAt(path, 999).point, square[2])
    }

    func testHeadsAlongTheSegmentAndTurnsAcrossACornerInsteadOfSnapping() {
        let path = buildPath(square, .straight)
        XCTAssertEqual(headingAt(path, 20, 10), Point(1, 0))
        XCTAssertEqual(headingAt(path, 150, 10), Point(0, 1))
        let near = headingAt(path, 97, 10)
        XCTAssertGreaterThan(near.x, 0.5)
        XCTAssertGreaterThan(near.y, 0.1)
        let after = headingAt(path, 103, 10)
        XCTAssertGreaterThan(after.y, 0.5)
        XCTAssertGreaterThan(after.x, 0.1)
    }

    func testIsACentripetalSplineTheMiddleOfASegmentSitsBetweenItsEnds() {
        let mid = catmullRom(Point(-100, 0), Point(0, 0), Point(100, 0), Point(200, 0), 0.5)
        assertClose(mid.x, 50, 6)
        XCTAssertLessThan(abs(mid.y), 1e-9)
    }

    func testCopesWithOneStopAndNone() {
        XCTAssertEqual(buildPath([], .curved).length, 0)
        let one = buildPath([Point(3, 4)], .curved)
        XCTAssertEqual(one.stopS, [0])
        XCTAssertEqual(pointAt(one, 5).point, Point(3, 4))
        XCTAssertEqual(headingAt(one, 0), Point(0, -1))
    }

    func testPlansInAFixedBoxWhateverTheFrame() {
        let points = planPoints([GeoPoint(lat: -31.95, lon: 115.86), GeoPoint(lat: -17.96, lon: 122.24)]).points
        for p in points {
            XCTAssertGreaterThanOrEqual(p.x, -1e-6)
            XCTAssertLessThanOrEqual(p.x, drivePlanSize + 1e-6)
            XCTAssertGreaterThanOrEqual(p.y, -1e-6)
            XCTAssertLessThanOrEqual(p.y, drivePlanSize + 1e-6)
        }
        // North is up: Broome, further north, sits higher (smaller y).
        XCTAssertLessThan(points[1].y, points[0].y)
    }
}

final class DrivePlanScheduleTests: XCTestCase {
    private func route(_ o: DriveOptions, _ pictures: [HookPickedPicture] = []) -> DriveRoute {
        var patched = o
        patched.includePieces = false
        patched.picked = pictures
        return driveRoute(driveStages, driveCal, driveDateOf(20), patched)
    }

    func testHoldsRunsThroughStopsThatDoNotHaltHaltsWhereThereArePicturesArrivesReveals() throws {
        let o = driveOpts { $0.delaySeconds = 0.5; $0.driveSeconds = 4; $0.secondsPerPicture = 1; $0.arriveSeconds = 0.5 }
        let r = route(o, [drivePic("cb.jpg", 12, GeoPoint(lat: -23.14, lon: 113.77))])
        let plan = try XCTUnwrap(drivePlan(r, o))
        let kinds = plan.schedule.phases.map(\.kind)
        // Perth → Kalbarri → Coral Bay (halt, one picture) → Karijini → Broome.
        XCTAssertEqual(kinds, [.hold, .run, .halt, .run, .arrive, .reveal])
        let runs = plan.schedule.phases.filter { $0.kind == .run }
        assertClose(runs[0].end - runs[0].start + (runs[1].end - runs[1].start), 4, 9)
        XCTAssertEqual(plan.schedule.phases[2].end - plan.schedule.phases[2].start, 1)
        assertClose(plan.schedule.total, 0.5 + 4 + 1 + 0.5 + driveRevealSeconds, 9)
        assertClose(plan.schedule.revealAt, plan.schedule.total - driveRevealSeconds, 9)
        XCTAssertEqual(plan.seconds, plan.schedule.total)
    }

    func testReachesEveryStopInOrderTheFirstAtZeroAndTheLastWhenItArrives() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.driveSeconds = 3; $0.arriveSeconds = 0 }
        let plan = try XCTUnwrap(drivePlan(route(o), o))
        let arrivals = plan.schedule.arrivals
        XCTAssertEqual(arrivals.count, 5)
        XCTAssertEqual(arrivals[0], 0)
        for i in 1..<arrivals.count { XCTAssertGreaterThan(arrivals[i], arrivals[i - 1]) }
        assertClose(arrivals[4], plan.schedule.arrivedAt, 9)
        assertClose(plan.schedule.arrivedAt, 3, 9)
    }

    func testPutsTheCarExactlyOnAStopAtTheMomentItIsReached() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.driveSeconds = 3; $0.arriveSeconds = 0; $0.easing = .easeInOut }
        let plan = try XCTUnwrap(drivePlan(route(o), o))
        for (i, at) in plan.schedule.arrivals.enumerated() {
            let m = plan.at(at)
            assertClose(m.s, plan.path.stopS[i], 6)
            XCTAssertEqual(m.reached, i)
        }
    }

    func testGivesAShortRunAFloorSoAStopNextDoorStillReadsAsADrive() throws {
        let o = driveOpts {
            $0.delaySeconds = 0; $0.driveSeconds = 2; $0.arriveSeconds = 0; $0.stopsOn = .pictures
            $0.secondsPerPicture = 0.5
        }
        var withPictures = o
        withPictures.picked = [
            drivePic("a.jpg", 2, GeoPoint(lat: -31.95, lon: 115.86), 1),
            drivePic("b.jpg", 2, GeoPoint(lat: -31.9, lon: 115.86), 2),
            drivePic("c.jpg", 3, GeoPoint(lat: -20, lon: 120), 3),
        ]
        let r = driveRoute(driveStages, driveCal, driveDateOf(20), withPictures)
        let plan = try XCTUnwrap(drivePlan(r, o))
        let runs = plan.schedule.phases.filter { $0.kind == .run }
        XCTAssertGreaterThanOrEqual(runs[0].end - runs[0].start, 0.35)
    }

    func testPopsAStopsPicturesOneBeatApartAndLetsThemLeaveWithTheCarOrStay() throws {
        let o = driveOpts {
            $0.delaySeconds = 0; $0.driveSeconds = 2; $0.secondsPerPicture = 0.5; $0.arriveSeconds = 0
            $0.cardsStay = false
        }
        let r = route(o, [drivePic("cb1.jpg", 12, GeoPoint(lat: -23.14, lon: 113.77), 1),
                          drivePic("cb2.jpg", 12, GeoPoint(lat: -23.14, lon: 113.77), 2)])
        let plan = try XCTUnwrap(drivePlan(r, o))
        let halt = try XCTUnwrap(plan.schedule.phases.first { $0.kind == .halt })
        XCTAssertEqual(plan.schedule.pops.map(\.at), [halt.start, halt.start + 0.5])
        XCTAssertEqual(plan.showing(halt.start - 0.01).count, 0)
        assertClose(plan.showing(halt.start + 0.1)[0].rise, 0.1 / driveCardPopSeconds, 9)
        XCTAssertEqual(plan.showing(halt.end + 0.1).count, 2)
        XCTAssertLessThan(plan.showing(halt.end + 0.1)[0].fade, 1)
        XCTAssertEqual(plan.showing(halt.end + 1).count, 0)
        var staying = o
        staying.cardsStay = true
        let stay = try XCTUnwrap(drivePlan(r, staying))
        XCTAssertEqual(stay.showing(halt.end + 1).count, 2)
    }

    func testHaltsNowhereWithoutPicturesUnlessAskedToPauseEverywhere() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.arriveSeconds = 0 }
        XCTAssertEqual(try XCTUnwrap(drivePlan(route(o), o)).schedule.phases.filter { $0.kind == .halt }.count, 0)
        var pausing = o
        pausing.pauseEverywhere = true
        pausing.secondsPerPicture = 0.4
        let halts = try XCTUnwrap(drivePlan(route(pausing), pausing)).schedule.phases.filter { $0.kind == .halt }
        // The first stop and the three in between; the last stop's pause is the arrival.
        XCTAssertEqual(halts.count, 4)
        XCTAssertEqual(halts.map(\.stop), [0, 1, 2, 3])
        assertClose(halts[0].end - halts[0].start, 0.4, 9)
    }

    func testFadesTheMapAwayAtTheEndOnRevealKeepsItOnStayAndRestsPastTheEnd() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.driveSeconds = 2; $0.arriveSeconds = 0 }
        let plan = try XCTUnwrap(drivePlan(route(o), o))
        XCTAssertEqual(plan.at(plan.schedule.revealAt).mapAlpha, 1)
        assertClose(plan.at(plan.schedule.revealAt + driveRevealSeconds / 2).mapAlpha, 0.5, 6)
        let after = plan.at(plan.schedule.total + 5)
        XCTAssertTrue(after.over)
        XCTAssertEqual(after.mapAlpha, 0)
        assertClose(after.s, plan.path.length, 9)
        var staying = o
        staying.end = .stay
        let stay = try XCTUnwrap(drivePlan(route(staying), staying))
        XCTAssertFalse(stay.schedule.phases.contains { $0.kind == .reveal })
        XCTAssertEqual(stay.at(stay.schedule.total + 5).mapAlpha, 1)
        XCTAssertEqual(stay.at(stay.schedule.total + 5).at, 4)
    }

    func testCountsTheKilometresTheCarHasCoveredNotTheRoads() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.arriveSeconds = 0 }
        let plan = try XCTUnwrap(drivePlan(route(o), o))
        XCTAssertEqual(plan.kmAt(0), 0)
        let perthKalbarri = plan.kmAtStop[1]
        XCTAssertGreaterThan(perthKalbarri, 490)
        XCTAssertLessThan(perthKalbarri, 510)
        assertClose(plan.kmAt(plan.path.stopS[1] / 2), perthKalbarri / 2, 6)
        assertClose(plan.kmAt(plan.path.length), plan.kmAtStop[4], 6)
    }

    func testIsNothingWithNoStopOrOneStopAndNothingToShowAParkedCarWithPicturesStillPlays() throws {
        let o = driveOpts { $0.stopsOn = .pictures }
        XCTAssertNil(drivePlan(driveRoute(driveStages, driveCal, driveDateOf(5), o), o))
        var oneBare = o
        oneBare.picked = [drivePic("a.jpg", 2, GeoPoint(lat: -31.95, lon: 115.86))]
        oneBare.pictures = .none
        XCTAssertNil(drivePlan(driveRoute(driveStages, driveCal, driveDateOf(5), oneBare), oneBare))
        var oneShown = o
        oneShown.picked = [drivePic("a.jpg", 2, GeoPoint(lat: -31.95, lon: 115.86))]
        let parked = try XCTUnwrap(drivePlan(driveRoute(driveStages, driveCal, driveDateOf(5), oneShown), oneShown))
        XCTAssertGreaterThan(parked.seconds, 0)
        XCTAssertEqual(parked.schedule.phases.map(\.kind), [.hold, .arrive, .reveal])
        XCTAssertEqual(parked.schedule.pops.count, 1)
    }

    func testReadsItsEasingOffTheSharedTable() throws {
        let o = driveOpts { $0.delaySeconds = 0; $0.driveSeconds = 2; $0.arriveSeconds = 0; $0.easing = .linear }
        let plan = try XCTUnwrap(drivePlan(route(o), o))
        assertClose(plan.at(1).progress, hookEasings[.linear]!.ease(0.5), 6)
    }
}

final class DrivePlanCameraTests: XCTestCase {
    private let box = Rect(x: 0, y: 100, width: 400, height: 600)

    private func plan() throws -> DrivePlan {
        let o = driveOpts { $0.delaySeconds = 0; $0.arriveSeconds = 0; $0.includePieces = false }
        return try XCTUnwrap(drivePlan(driveRoute(driveStages, driveCal, driveDateOf(20), o), o))
    }

    func testFitsTheWholeRouteInsideTheBoxLessTheMarginWhateverTheMoment() throws {
        let plan = try plan()
        let a = viewAt(plan, box, 20, (camera: .whole, followZoom: 0.5), plan.at(0))
        let b = viewAt(plan, box, 20, (camera: .whole, followZoom: 0.5), plan.at(2))
        XCTAssertEqual(a, b)
        for p in plan.path.points {
            let s = applyView(a, p)
            XCTAssertGreaterThanOrEqual(s.x, box.x + 20 - 1e-6)
            XCTAssertLessThanOrEqual(s.x, box.x + box.width - 20 + 1e-6)
            XCTAssertGreaterThanOrEqual(s.y, box.y + 20 - 1e-6)
            XCTAssertLessThanOrEqual(s.y, box.y + box.height - 20 + 1e-6)
        }
    }

    func testFollowsTheCarAtTheBoxsCentreZoomedInByTheShare() throws {
        let plan = try plan()
        let whole = viewAt(plan, box, 20, (camera: .whole, followZoom: 0.5), plan.at(0))
        let m = plan.at(1.3)
        let follow = viewAt(plan, box, 20, (camera: .follow, followZoom: 0.5), m)
        assertClose(follow.scale, whole.scale * 2, 9)
        let car = applyView(follow, m.point)
        assertClose(car.x, box.x + box.width / 2, 9)
        assertClose(car.y, box.y + box.height / 2, 9)
    }
}

final class DrivePlanFurnitureTests: XCTestCase {
    func testSpacesTheGraticuleSoLinesNeverCrowd() {
        XCTAssertEqual(graticuleStep(10, 90), 10)
        XCTAssertEqual(graticuleStep(1000, 90), 0.1)
        XCTAssertEqual(graticuleStep(0.001, 90), 45)
    }

    func testPicksARoundScaleBarThatFits() {
        // 100 px per degree of latitude ≈ 0.9 px per km: 200 km fits in 200 px, 500 does not.
        let bar = scaleBar(100, 200, .km)
        XCTAssertEqual(bar.value, 200)
        XCTAssertLessThanOrEqual(bar.px, 200)
        XCTAssertEqual(bar.label, "200 km")
        XCTAssertEqual(scaleBar(100, 200, .mi).label, "100 mi")
        XCTAssertEqual(scaleBar(100_000, 200, .km).label, "200 m")
    }

    func testLabelsTheEndsAllOrNone() {
        XCTAssertTrue(wantsStopLabel(.ends, 0, 5))
        XCTAssertFalse(wantsStopLabel(.ends, 2, 5))
        XCTAssertTrue(wantsStopLabel(.all, 2, 5))
        XCTAssertFalse(wantsStopLabel(.none, 0, 5))
    }

    func testPlacesACardBesideItsStopInsideTheFrameTiltedTheSameWayEveryTime() {
        let frame = Size(width: 1080, height: 1920)
        let card = Size(width: 300, height: 200)
        let a = cardPlacement(Point(540, 960), 0, "k", card, frame, 60)
        let b = cardPlacement(Point(540, 960), 0, "k", card, frame, 60)
        XCTAssertEqual(a, b)
        XCTAssertLessThan(a.y, 960)
        let edge = cardPlacement(Point(1075, 10), 1, "k", card, frame, 60)
        XCTAssertLessThanOrEqual(edge.x + hypot(300, 200) / 2, 1080)
        XCTAssertGreaterThanOrEqual(edge.y - hypot(300, 200) / 2, 0)
        XCTAssertGreaterThanOrEqual(jitter("a"), -1)
        XCTAssertLessThanOrEqual(jitter("a"), 1)
        XCTAssertNotEqual(jitter("a"), jitter("b"))
    }
}

final class DrivePlanScoreTests: XCTestCase {
    private let o = driveOpts {
        $0.delaySeconds = 0; $0.driveSeconds = 3; $0.arriveSeconds = 0; $0.includePieces = false; $0.kit = .wood
        $0.secondsPerPicture = 0.5
    }

    private func plan() throws -> DrivePlan {
        var withPicture = o
        withPicture.picked = [drivePic("cb.jpg", 12, GeoPoint(lat: -23.14, lon: 113.77))]
        let r = driveRoute(driveStages, driveCal, driveDateOf(20), withPicture)
        return try XCTUnwrap(drivePlan(r, o))
    }

    func testTicksAtEveryStopReachedDeeperWhereALegStartsTheSeatOnArrivalAShutterPerPicture() throws {
        let plan = try plan()
        let score = driveScore(plan, o)
        let kit = TickKit.wood.spec
        let voices = score.map(\.voice)
        XCTAssertEqual(voices.filter { $0 == "click" }.count, 1)
        XCTAssertEqual(voices.filter { $0 == kit.seat.rawValue }.count, 1)
        // Kalbarri (plain), Coral Bay (leg start), Karijini (leg start), Broome (seat).
        let landings = score.filter { $0.voice != "click" }
        XCTAssertEqual(landings.count, 4)
        XCTAssertEqual(landings[0].rate, 1)
        assertClose(landings[1].rate ?? .nan, kit.leg.rate, 9)
        for i in 1..<score.count { XCTAssertGreaterThanOrEqual(score[i].at, score[i - 1].at) }
        assertClose(score[score.count - 1].at, plan.schedule.arrivedAt, 9)
    }

    func testIsSilentAtVolumeZeroAndWithoutTheShutter() throws {
        let plan = try plan()
        var quiet = o
        quiet.tickVolume = 0
        XCTAssertEqual(driveScore(plan, quiet), [])
        var noShutter = o
        noShutter.shutter = false
        XCTAssertFalse(driveScore(plan, noShutter).contains { $0.voice == "click" })
    }

    func testScalesEveryGainWithTheVolume() throws {
        let plan = try plan()
        var louder = o
        louder.tickVolume = 2
        let loud = driveScore(plan, louder)
        let plain = driveScore(plan, o)
        for (i, e) in loud.enumerated() { assertClose(e.gain ?? .nan, (plain[i].gain ?? 0) * 2, 9) }
    }
}

final class DrivePlanScheduleAloneTests: XCTestCase {
    func testIsEmptyWithNoStop() {
        let s = buildSchedule([], buildPath([], .curved), driveOpts())
        XCTAssertEqual(s.total, 0)
        XCTAssertEqual(s.phases, [])
    }
}
