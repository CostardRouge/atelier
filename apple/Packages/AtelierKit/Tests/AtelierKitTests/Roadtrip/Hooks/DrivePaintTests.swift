// One frame of Virée — the layout arithmetic of
// `src/shared/roadtrip/hooks/drive-paint.ts`, which has no web spec (it draws
// on a canvas); these pin the rules its header names: a frame is a reading of
// `DrivePlan.at(t)`, the paper ground covers the picture and the picture
// ground does not, the car sits where the plan says, the prints keep the
// names off them, and nothing is drawn once the reveal has faded the map.

import XCTest
@testable import AtelierKit

private let drivePaintFrame = FrameBox(width: 1080, height: 1920)

private let drivePaintStages: [HookStage] = [
    HookStage(startDate: "2025-03-01", endDate: "2025-03-10", label: "Perth → Kalbarri", places: [
        HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
        HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]),
    HookStage(startDate: "2025-03-11", endDate: "2025-03-15", label: "Coral Bay", places: [
        HookStagePlace(name: "Coral Bay", lat: -23.14, lon: 113.77),
    ]),
]

private let drivePaintCalendar: [HookDay] = (1...15).map { n in
    HookDay(date: String(format: "2025-03-%02d", n), dayNumber: n)
}

private let coralBayPicture = HookPickedPicture(ref: SavedMediaRef(name: "cb.jpg", size: 1, lastModified: 0),
                                                date: "2025-03-12", coords: GeoPoint(lat: -23.14, lon: 113.77))

/// A drive to Coral Bay on day 12, with a picture waiting there.
private func drivePaintDrawing(_ change: (inout DriveOptions) -> Void = { _ in },
                               pictures: [String: HookPicture]? = nil) throws -> DriveDrawing {
    var o = DriveOptions.defaults
    o.picked = [coralBayPicture]
    change(&o)
    let route = driveRoute(drivePaintStages, drivePaintCalendar, "2025-03-12", o)
    let plan = try XCTUnwrap(drivePlan(route, o))
    let decoded = pictures ?? [hookPictureKey(coralBayPicture.ref): HookPicture(width: 1200, height: 800)]
    return DriveDrawing(plan: plan, pictures: decoded, car: .default)
}

final class DrivePaintFrameTests: XCTestCase {
    func testDrawsNothingOnAFrameWithNoAreaOrOnceTheRevealHasFadedTheMap() throws {
        let drawing = try drivePaintDrawing()
        XCTAssertNil(drawing.frame(at: 0, FrameBox(width: 0, height: 1920)))
        XCTAssertNil(drawing.frame(at: drawing.plan.schedule.total + 1, drivePaintFrame))
        let halfway = try XCTUnwrap(drawing.frame(at: drawing.plan.schedule.revealAt + driveRevealSeconds / 2,
                                                  drivePaintFrame))
        assertClose(halfway.alpha, 0.5, 6)
        XCTAssertEqual(try XCTUnwrap(drawing.frame(at: 0, drivePaintFrame)).alpha, 1)
        // On `stay` the map never goes.
        let staying = try drivePaintDrawing { $0.end = .stay }
        XCTAssertEqual(staying.frame(at: staying.plan.schedule.total + 5, drivePaintFrame)?.alpha, 1)
    }

    func testCoversThePictureWithPaperOnlyOnThePaperGround() throws {
        let onPaper = try XCTUnwrap(try drivePaintDrawing().frame(at: 0, drivePaintFrame))
        XCTAssertEqual(onPaper.paper, HookInk("#e8e2d4", 1))
        XCTAssertNotNil(onPaper.vignette)
        XCTAssertFalse((onPaper.graticule?.xs ?? []).isEmpty && (onPaper.graticule?.ys ?? []).isEmpty)
        XCTAssertEqual(onPaper.road?.ink, HookInk("#3a332a", 0.6))
        let onPicture = try XCTUnwrap(try drivePaintDrawing { $0.ground = .picture }.frame(at: 0, drivePaintFrame))
        XCTAssertNil(onPicture.paper)
        XCTAssertNil(onPicture.graticule)
        XCTAssertNil(onPicture.vignette)
        XCTAssertEqual(onPicture.road?.ink, HookInk("#ffffff", 0.55))
        XCTAssertEqual(onPicture.dots.first?.halo.ink, HookInk("#000000", 0.55))
    }

    func testPutsTheCarWhereThePlanSaysNoseAlongTheRoadOverItsShadow() throws {
        let drawing = try drivePaintDrawing()
        let t = drawing.plan.schedule.arrivals[1] / 2
        let frame = try XCTUnwrap(drawing.frame(at: t, drivePaintFrame))
        let m = drawing.plan.at(t)
        let at = applyView(frame.view, m.point)
        assertClose(frame.car.pose.x, at.x, 9)
        assertClose(frame.car.pose.y, at.y, 9)
        // The plan's y runs down the frame; the pose's north runs up it.
        assertClose(frame.car.pose.fx, m.heading.x, 9)
        assertClose(frame.car.pose.fy, -m.heading.y, 9)
        assertClose(frame.car.pose.tilt, 58 * Double.pi / 180, 9)
        XCTAssertFalse(frame.car.faces.isEmpty)
        XCTAssertEqual(frame.car.shadow.ellipses.last?.alpha, 0.28)
        // The trail ends under the car.
        XCTAssertEqual(frame.trail.count, 2)
        XCTAssertEqual(frame.trail[1].points.last, at)
        XCTAssertEqual(frame.trail[1].ink, HookInk("#d9442a", 1))
    }

    func testLeavesNoTrailBeforeTheCarHasMovedAndFillsTheDotsItHasPassed() throws {
        let drawing = try drivePaintDrawing()
        let start = try XCTUnwrap(drawing.frame(at: 0, drivePaintFrame))
        XCTAssertEqual(start.trail, [])
        XCTAssertEqual(start.dots.map { $0.fill.ink.color }, ["#d9442a", "#e8e2d4", "#e8e2d4"])
        let end = try XCTUnwrap(drawing.frame(at: drawing.plan.schedule.arrivedAt, drivePaintFrame))
        XCTAssertEqual(end.dots.map { $0.fill.ink.color }, ["#d9442a", "#d9442a", "#d9442a"])
    }

    func testRipplesWhereTheCarHaltsAndPopsThePrintBesideItInsideTheFrame() throws {
        let drawing = try drivePaintDrawing()
        // Coral Bay is the last stop: its picture pops as the car arrives.
        let arrived = drawing.plan.schedule.arrivedAt
        let frame = try XCTUnwrap(drawing.frame(at: arrived + 0.1, drivePaintFrame))
        XCTAssertNotNil(frame.ripple)
        let card = try XCTUnwrap(frame.cards.first)
        XCTAssertEqual(card.key, hookPictureKey(coralBayPicture.ref))
        let half = hypot(card.paper.width, card.paper.height) / 2
        XCTAssertGreaterThanOrEqual(card.center.x - half, 0)
        XCTAssertLessThanOrEqual(card.center.x + half, 1080)
        // A landscape picture: its long edge is the print's width, drawn whole.
        assertClose(card.picture.width, 190, 9)
        assertClose(card.picture.height, 190 * 800 / 1200, 9)
        XCTAssertEqual(card.shadows.count, 3)
        // Before it pops there is nothing, and once it has settled it is whole.
        XCTAssertEqual(try XCTUnwrap(drawing.frame(at: arrived - 0.01, drivePaintFrame)).cards, [])
        let settled = try XCTUnwrap(drawing.frame(at: arrived + driveCardPopSeconds, drivePaintFrame)).cards[0]
        assertClose(settled.scale, 1, 9)
        XCTAssertEqual(settled.alpha, 1)
    }

    func testKeepsTheNamesOffThePrints() throws {
        let drawing = try drivePaintDrawing()
        let frame = try XCTUnwrap(drawing.frame(at: drawing.plan.schedule.arrivedAt + 0.5, drivePaintFrame))
        let card = try XCTUnwrap(frame.cards.first)
        let half = hypot(card.paper.width, card.paper.height) / 2
        let fontPx = 24.0
        for label in frame.labels {
            let width = Double(label.text.utf16.count) * fontPx * 0.55
            let x0 = label.align == .left ? label.at.x : label.align == .right ? label.at.x - width : label.at.x - width / 2
            let overlaps = x0 < card.center.x + half && x0 + width > card.center.x - half
                && label.at.y - fontPx * 0.6 < card.center.y + half && label.at.y + fontPx * 0.6 > card.center.y - half
            XCTAssertFalse(overlaps, label.text)
        }
    }

    func testFillsTheFrameOverEverythingOrLaysThePictureBehindTheMap() throws {
        let arrivedAt = try drivePaintDrawing().plan.schedule.arrivedAt
        let fill = try XCTUnwrap(try drivePaintDrawing { $0.pictures = .fill }.frame(at: arrivedAt + 0.5, drivePaintFrame))
        XCTAssertEqual(fill.fill.map(\.key), [hookPictureKey(coralBayPicture.ref)])
        XCTAssertEqual(fill.backdrop, [])
        XCTAssertEqual(fill.cards, [])
        let behind = try XCTUnwrap(try drivePaintDrawing { $0.pictures = .backdrop }.frame(at: arrivedAt + 0.5,
                                                                                         drivePaintFrame))
        XCTAssertEqual(behind.backdrop.map(\.key), [hookPictureKey(coralBayPicture.ref)])
        XCTAssertEqual(behind.fill, [])
        // A picture the shell could not decode shows nothing.
        let missing = try XCTUnwrap(try drivePaintDrawing({ $0.pictures = .fill }, pictures: [:])
            .frame(at: arrivedAt + 0.5, drivePaintFrame))
        XCTAssertEqual(missing.fill, [])
    }

    func testSaysTheScaleAndTheDistanceTheCarHasCovered() throws {
        let drawing = try drivePaintDrawing()
        let t = drawing.plan.schedule.arrivals[1]
        let frame = try XCTUnwrap(drawing.frame(at: t, drivePaintFrame))
        let bar = scaleBar(drawing.plan.geo.scale * frame.view.scale, frame.box.width * 0.26, .km)
        XCTAssertEqual(frame.scaleBar?.label.text, bar.label)
        XCTAssertEqual(frame.scaleBar?.bracket.points.count, 4)
        XCTAssertEqual(frame.distance?.text, formatDistance(drawing.plan.kmAt(drawing.plan.at(t).s), .km))
        XCTAssertEqual(frame.distance?.align, .right)
        let bare = try XCTUnwrap(try drivePaintDrawing { $0.scaleBar = false; $0.distance = .off; $0.compass = false }
            .frame(at: t, drivePaintFrame))
        XCTAssertNil(bare.scaleBar)
        XCTAssertNil(bare.distance)
        XCTAssertNil(bare.compass)
    }

    func testDrawsTheCompassRoseInTheTopRightCorner() throws {
        let frame = try XCTUnwrap(try drivePaintDrawing().frame(at: 0, drivePaintFrame))
        let compass = try XCTUnwrap(frame.compass)
        XCTAssertEqual(compass.star.count, 8)
        // The north point is the star's first, straight up from the centre.
        assertClose(compass.star[0].x, 1080 - 30 - 22, 9)
        assertClose(compass.star[0].y, 30 + 30 - 22, 9)
        XCTAssertEqual(compass.north.first, compass.star[0])
        XCTAssertEqual(compass.letter.text, "N")
    }

    func testFitsTheRouteIntoItsBoxAtEveryPosition() {
        let middle = driveBox(1080, 1920, .middle, 1)
        assertClose(middle.width, 864, 9)
        assertClose(middle.height, min(1920 * 0.52, 1080 * 1.15), 9)
        assertClose(middle.y, (1920 - middle.height) / 2, 9)
        assertClose(driveBox(1080, 1920, .top, 1).y, 192, 9)
        let bottom = driveBox(1080, 1920, .bottom, 0.5)
        assertClose(bottom.y + bottom.height, 1920 * 0.92, 9)
    }
}
