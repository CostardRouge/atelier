// Virée's variant (`src/shared/roadtrip/hooks/drive.tsx`'s non-UI half) has
// no web spec of its own; these pin what it declares and what `prepare`
// hands back — the rules its header names.

import XCTest
@testable import AtelierKit

private let vireeStages: [HookStage] = [
    HookStage(startDate: "2025-03-01", endDate: "2025-03-10", label: "Perth → Kalbarri", places: [
        HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
        HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]),
    HookStage(startDate: "2025-03-11", endDate: "2025-03-15", label: "Coral Bay", places: [
        HookStagePlace(name: "Coral Bay", lat: -23.14, lon: 113.77),
    ]),
]

private let vireeCalendar: [HookDay] = (1...15).map { n in
    let told = n == 3
    return HookDay(date: String(format: "2025-03-%02d", n), dayNumber: n, told: told, legStart: n == 1 || n == 11,
                   pieces: told ? [HookDayPiece(id: "p3", media: SavedMediaRef(name: "p3.jpg", size: 1, lastModified: 0))] : [])
}

private func vireeCtx(car: CarSpec? = nil) -> HookContext {
    HookContext(aspect: 9.0 / 16, durationSeconds: 4, date: "2025-03-12",
                content: BadgeContent(label: "Day", headline: "12", caption: "Coral Bay"),
                calendar: vireeCalendar, stages: vireeStages, car: car)
}

private func vireeOptions(_ change: (inout DriveOptions) -> Void = { _ in }) -> HookOptions {
    var o = DriveOptions.defaults
    change(&o)
    return o.json
}

final class DriveVariantDeclarationTests: XCTestCase {
    func testIsRegisteredBetweenDefileAndTheItinerary() {
        XCTAssertEqual(hookVariantById("drive")?.name, "Virée")
        XCTAssertEqual(hookVariants.map(\.id).firstIndex(of: "drive"), 2)
    }

    func testOwnsTheFrameAndKeepsItsPicturesOutOfAHouseStyle() {
        XCTAssertEqual(driveVariant.owns, .frame)
        XCTAssertEqual(driveVariant.contentKeys, ["picked"])
        XCTAssertEqual(driveVariant.needs, HookNeeds(coverage: true, stages: true, places: true, media: .day))
        XCTAssertEqual(driveOptions(driveVariant.defaults), DriveOptions.defaults)
    }

    func testIsNeverUnmetAndHasNoBoxToGrab() {
        XCTAssertNil(hookUnmet(driveVariant, vireeCtx()))
        XCTAssertNil(driveVariant.frameBox)
        XCTAssertNil(driveVariant.moveBy)
    }
}

final class DriveVariantPrepareTests: XCTestCase {
    func testPlaysNothingWhereThereIsNothingToDrive() {
        let render = driveVariant.prepare(vireeOptions(), HookContext(aspect: 1, durationSeconds: 4, date: "2025-03-12"))
        XCTAssertEqual(render.seconds, 0)
        XCTAssertNil(render.drawing)
    }

    func testLastsAsLongAsItsPlanAndDrawsTheTripsCarOrTheDefault() throws {
        let render = driveVariant.prepare(vireeOptions(), vireeCtx())
        let drawing = try XCTUnwrap(render.drawing as? DriveDrawing)
        XCTAssertEqual(render.seconds, drawing.plan.seconds)
        XCTAssertEqual(drawing.car, CarSpec.default)
        XCTAssertEqual(drawing.plan.route.stops.map(\.name), ["Perth", "Kalbarri", "Coral Bay"])
        var red = CarSpec.default
        red.color = "#cc0000"
        let owned = try XCTUnwrap(driveVariant.prepare(vireeOptions(), vireeCtx(car: red)).drawing as? DriveDrawing)
        XCTAssertEqual(owned.car.color, "#cc0000")
    }

    func testNamesTheLastStopPassedWhileItDrivesAndGivesTheBadgeItsOwnPlaceBackOnArrival() throws {
        let render = driveVariant.prepare(vireeOptions { $0.captionFollows = true }, vireeCtx())
        let content = try XCTUnwrap(render.content)
        let plan = try XCTUnwrap(render.drawing as? DriveDrawing).plan
        XCTAssertEqual(content(0), [.caption: .text("Perth")])
        XCTAssertEqual(content(plan.schedule.arrivals[1] + 0.01), [.caption: .text("Kalbarri")])
        XCTAssertEqual(content(plan.schedule.arrivedAt), [:])
        XCTAssertNil(driveVariant.prepare(vireeOptions(), vireeCtx()).content)
        // On the pictures' own positions the stops are `Day N`, never a place.
        let onPictures = driveVariant.prepare(vireeOptions {
            $0.captionFollows = true
            $0.stopsOn = .pictures
            $0.picked = [HookPickedPicture(ref: SavedMediaRef(name: "a.jpg", size: 1, lastModified: 0), date: "2025-03-02",
                                           coords: GeoPoint(lat: -31.95, lon: 115.86))]
        }, vireeCtx())
        XCTAssertNil(onPictures.content)
    }

    func testScoresOnlyWithTheSoundOnAndMixesOnlyWhenAsked() {
        let sounding = driveVariant.prepare(vireeOptions(), vireeCtx())
        XCTAssertNotNil(sounding.score)
        XCTAssertFalse(sounding.mixWithSource)
        XCTAssertNil(driveVariant.prepare(vireeOptions { $0.sound = false }, vireeCtx()).score)
        XCTAssertTrue(driveVariant.prepare(vireeOptions { $0.mixWithClip = true }, vireeCtx()).mixWithSource)
    }

    func testAsksForTheToldDaysPicturesTheRouteShows() {
        let wants = driveVariant.wantsPictures?(vireeOptions(), vireeCtx()) ?? []
        XCTAssertEqual(wants.map(\.ref.name), ["p3.jpg"])
        XCTAssertEqual(wants.first?.shape, .own)
    }
}
