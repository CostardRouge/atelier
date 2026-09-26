// The Trips render gate: every opener and the badge painted at TWO sizes, the
// larger resampled down to the smaller, and the two held to agree — the web's
// "the export IS the preview resampled" (`roadtrip.md`, `badge-render.ts`):
// everything these painters draw is a fraction of the frame (a 1080-wide
// frame's unit `u`), so a stage at 540 px and a 1080×1920 export must be one
// picture. Plus the rules only a real Core Graphics context can show: Défilé
// goes dark on a stop with nothing to flash, Virée's reveal composites the
// whole map ONCE at its alpha, a shade darkens its own edge, a hook's
// thumbnail is never upscaled, and the store keeps a trip and its hooks.

import AtelierKit
import CoreGraphics
import CoreImage
import ImageIO
import XCTest
@testable import Atelier

// MARK: - fixtures

private let red = PaintRaster.solid(1200, 800, 220, 40, 30)
private let blue = PaintRaster.solid(800, 1200, 30, 60, 210)

private func tripsCalendar(_ total: Int, _ told: [Int], _ legs: [Int] = [1]) -> [HookDay] {
    (0..<total).map { i in
        let isTold = told.contains(i + 1)
        let pieces = isTold
            ? [HookDayPiece(id: "p\(i + 1)", media: SavedMediaRef(name: "p\(i + 1).jpg", size: 1, lastModified: 0))]
            : []
        return HookDay(date: addDays("2025-03-01", i)!, dayNumber: i + 1, told: isTold,
                       legStart: legs.contains(i + 1), pieces: pieces)
    }
}

private func tripsPicked(_ name: String, _ date: String, _ lat: Double? = nil, _ lon: Double? = nil) -> HookPickedPicture {
    HookPickedPicture(ref: SavedMediaRef(name: name, size: 1, lastModified: 0), date: date,
                      coords: lat.flatMap { la in lon.map { GeoPoint(lat: la, lon: $0) } })
}

private let tripsStages: [HookStage] = [
    HookStage(startDate: "2025-03-01", endDate: "2025-03-10", label: "Perth → Kalbarri", places: [
        HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
        HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16),
    ]),
    HookStage(startDate: "2025-03-11", endDate: "2025-03-15", label: "Coral Bay", places: [
        HookStagePlace(name: "Coral Bay", lat: -23.14, lon: 113.77),
    ]),
]

// MARK: - the comparison

/// A `width`×`height` frame painted by `draw`, as an image.
private func paintedImage(_ width: Int, _ height: Int, _ draw: (PaintCanvas) -> Void) -> CGImage? {
    OverlayRaster.image(width: width, height: height) { cg, size in
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        draw(c)
        c.finish()
    }
}

/// A frame painted straight into a readable raster.
private func paintedRaster(_ width: Int, _ height: Int, _ draw: (PaintCanvas) -> Void) -> PaintRaster {
    PaintRaster.render(width, height) { cg, size in
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        draw(c)
        c.finish()
    }
}

/// `image` resampled into a `width`×`height` raster, smoothed as a preview is.
private func resampled(_ image: CGImage, _ width: Int, _ height: Int) -> PaintRaster {
    paintedRaster(width, height) { c in
        c.imageSmoothing = .high
        c.drawImage(image, 0, 0, Double(width), Double(height))
    }
}

/// The mean absolute difference per channel, in 8-bit codes.
private func meanDifference(_ a: PaintRaster, _ b: PaintRaster) -> Double {
    guard a.width == b.width, a.height == b.height, !a.bytes.isEmpty else { return .infinity }
    var total = 0.0
    for i in 0..<a.bytes.count { total += abs(Double(a.bytes[i]) - Double(b.bytes[i])) }
    return total / Double(a.bytes.count)
}

/// The share of pixels anything was painted on.
private func coverage(_ r: PaintRaster) -> Double {
    guard r.width > 0, r.height > 0 else { return 0 }
    return Double(r.points { $0.a > 8 }.count) / Double(r.width * r.height)
}

final class TripsRenderGateTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Brand.registerFonts()
    }

    /// Paint at 540×960 and at 1080×1920; the large one resampled must be
    /// the small one, within a hair of anti-aliasing.
    private func assertScales(_ label: String, tolerance: Double = 4, minCoverage: Double = 0.01,
                              _ draw: (PaintCanvas) -> Void, file: StaticString = #filePath, line: UInt = #line) {
        let small = paintedRaster(540, 960, draw)
        guard let big = paintedImage(1080, 1920, draw) else {
            XCTFail("\(label): the large frame could not be painted", file: file, line: line)
            return
        }
        let down = resampled(big, 540, 960)
        XCTAssertGreaterThan(coverage(small), minCoverage, "\(label) painted something", file: file, line: line)
        let diff = meanDifference(small, down)
        XCTAssertLessThan(diff, tolerance, "\(label): the export resampled is the preview (mean Δ \(diff))",
                          file: file, line: line)
    }

    // MARK: Défilé

    private func scrubDrawing(pictured: Bool) -> (ScrubDrawing, ScrubPlan)? {
        let cal = tripsCalendar(30, [3, 8, 14, 20], [1, 14])
        var o = scrubDefaults
        o.sweepSeconds = 2
        guard let plan = scrubPlan(cal, cal[26].date, o) else { return nil }
        var pictures: [String: HookPicture] = [:]
        if pictured {
            for day in cal where day.told {
                if let ref = day.pieces.first?.media { pictures[hookPictureKey(ref)] = HookBitmap.picture(red) }
            }
        }
        return (ScrubDrawing(plan: plan, options: o, pictures: pictures), plan)
    }

    func testDefileDrawsTheSameSweepAtTwoSizes() throws {
        let (drawing, plan) = try XCTUnwrap(scrubDrawing(pictured: true))
        let t = plan.stops[1].at + 0.1
        assertScales("Défilé mid-sweep", minCoverage: 0.9) { c in
            HookPaint.paint(c, drawing, t, AtelierKit.Size(width: c.width, height: c.height))
        }
        // At rest the tape alone is drawn over the piece's own picture.
        assertScales("Défilé at rest", minCoverage: 0.001) { c in
            HookPaint.paint(c, drawing, plan.endSeconds + 1, AtelierKit.Size(width: c.width, height: c.height))
        }
    }

    func testDefileGoesDarkOnAStopWithNothingToFlash() throws {
        let (drawing, plan) = try XCTUnwrap(scrubDrawing(pictured: false))
        let t = plan.stops[1].at + 0.1
        let r = paintedRaster(270, 480) { c in
            HookPaint.paint(c, drawing, t, AtelierKit.Size(width: c.width, height: c.height))
        }
        // `scrubEmptyDayColor`, #0c0b09 — never a stand-in picture.
        let centre = r.pixel(135, 120)
        XCTAssertEqual(centre.a, 255)
        XCTAssertLessThan(centre.r, 20)
        XCTAssertLessThan(centre.b, 20)
    }

    // MARK: the Itinerary

    private func mapDrawing(_ change: (inout MapOptions) -> Void = { _ in }) -> (MapDrawing, MapTiming) {
        var o = MapOptions.defaults
        o.stops = [
            MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86, picture: tripsPicked("perth.jpg", "2025-03-02")),
            MapStop(id: "b", name: "Kalbarri", lat: -27.71, lon: 114.16),
            MapStop(id: "c", name: "Coral Bay", lat: -23.14, lon: 113.77, picture: tripsPicked("coral.jpg", "2025-03-12")),
        ]
        o.labels = .all
        o.numbers = true
        o.compass = true
        o.distance = .km
        change(&o)
        var pictures: [String: HookPicture] = [:]
        for stop in o.stops {
            if let key = stopPictureKey(stop) { pictures[key] = HookBitmap.picture(stop.id == "a" ? red : blue) }
        }
        let timing = mapTiming(planarHops(o.stops), o)
        return (MapDrawing(options: o, timing: timing, context: [], pictures: pictures), timing)
    }

    func testTheItineraryDrawsTheSameMapAtTwoSizes() {
        for media in [MapMedia.pin, .card, .strip, .backdrop] {
            let (drawing, timing) = mapDrawing { $0.media = media }
            let t = timing.total * 0.6
            assertScales("Itinerary · \(media.rawValue)", tolerance: 5, minCoverage: 0.002) { c in
                c.setFill("#101010")
                c.fillRect(0, 0, c.width, c.height)
                HookPaint.paint(c, drawing, t, AtelierKit.Size(width: c.width, height: c.height))
            }
        }
    }

    // MARK: Virée

    private func driveDrawing(_ change: (inout DriveOptions) -> Void = { _ in }) throws -> DriveDrawing {
        let cal: [HookDay] = (1...15).map { HookDay(date: String(format: "2025-03-%02d", $0), dayNumber: $0) }
        var o = DriveOptions.defaults
        o.picked = [tripsPicked("cb.jpg", "2025-03-12", -23.14, 113.77)]
        change(&o)
        let route = driveRoute(tripsStages, cal, "2025-03-12", o)
        let plan = try XCTUnwrap(drivePlan(route, o))
        let pictures = [hookPictureKey(o.picked[0].ref): HookBitmap.picture(red)]
        return DriveDrawing(plan: plan, pictures: pictures, car: .default)
    }

    func testVireeDrawsTheSameDriveAtTwoSizes() throws {
        let drawing = try driveDrawing()
        let t = drawing.plan.schedule.total * 0.45
        assertScales("Virée on paper", tolerance: 5, minCoverage: 0.9) { c in
            HookPaint.paint(c, drawing, t, AtelierKit.Size(width: c.width, height: c.height))
        }
        let ground = try driveDrawing { $0.ground = .picture }
        assertScales("Virée on the picture", tolerance: 5, minCoverage: 0.001) { c in
            HookPaint.paint(c, ground, t, AtelierKit.Size(width: c.width, height: c.height))
        }
    }

    func testVireesRevealIsTheWholeMapAtOneAlpha() throws {
        let drawing = try driveDrawing()
        let t = drawing.plan.schedule.revealAt + driveRevealSeconds / 2
        let frame = try XCTUnwrap(drawing.frame(at: t, AtelierKit.Size(width: 270, height: 480)))
        let r = paintedRaster(270, 480) { c in
            HookPaint.paint(c, drawing, t, AtelierKit.Size(width: c.width, height: c.height))
        }
        // The paper, a corner no stroke reaches: ONE composite at the frame's
        // alpha, not the paper's alpha times each stroke's.
        let corner = r.pixel(2, 240)
        XCTAssertEqual(Double(corner.a), 255 * frame.alpha, accuracy: 3)
    }

    // MARK: the badge

    private func badgeTrip() -> (TripDoc, TripPost) {
        var trip = createTripDoc("Australia", "2025-03-01", "2025-03-30", now: 1_000, id: "t1")
        var post = createTripPost(.photo, "2025-03-12", "Coral Bay", now: 1_000)
        post.media = SavedMediaRef(name: "cb.jpg", size: 1, lastModified: 0)
        post.badge.shades = [createShade(id: "s", direction: .bottom, reach: 0.6, strength: 0.7)]
        trip.posts = [post]
        return (trip, post)
    }

    func testTheBadgeDrawsTheSameAtTwoSizes() throws {
        let (trip, post) = badgeTrip()
        let renderer = SlideRenderer(trip: trip, post: post, today: "2026-09-26")
        let slide = try XCTUnwrap(renderer.slides.first)
        let source = BadgeSource(image: CIImage(cgImage: blue, options: [.colorSpace: NSNull()]))
        let sources = SlideSources(lead: source)
        let t = renderer.stillSeconds(slide, hookSeconds: post.badge.durationSeconds)
        assertScales("the hook badge", tolerance: 5, minCoverage: 0.99) { c in
            renderer.draw(slide, sources, at: t, on: c)
        }
        // The badge painted over the picture, measured where it paints.
        let boxes = renderer.measure(slide, at: t, size: CGSize(width: 540, height: 960))
        XCTAssertFalse(boxes.isEmpty, "the badge's pieces can be pointed at")
    }

    func testTheClosingCardIsDrawnNeverGraded() throws {
        var (trip, post) = badgeTrip()
        trip.cta.headline = "Follow the road"
        post.includeCta = true
        trip.posts = [post]
        let renderer = SlideRenderer(trip: trip, post: post, today: "2026-09-26")
        let card = try XCTUnwrap(renderer.slides.last)
        guard card.kind == .cta else { return }
        XCTAssertNil(renderer.looks.cube(card, trip, post), "the closing card carries no picture to grade")
        assertScales("the closing card", tolerance: 5, minCoverage: 0.99) { c in
            renderer.draw(card, .empty, at: 0, on: c)
        }
    }

    // MARK: the shades

    func testAShadeDarkensItsOwnEdge() {
        let shade = createShade(id: "s", direction: .bottom, reach: 0.5, strength: 0.8)
        let r = paintedRaster(200, 400) { c in
            c.setFill("#ffffff")
            c.fillRect(0, 0, c.width, c.height)
            ShadePainter.paintShades(c, c.width, c.height, [shade], nil)
        }
        XCTAssertEqual(r.pixel(100, 10).r, 255, "clear at the far end")
        XCTAssertLessThan(r.pixel(100, 398).r, 80, "dark at its edge")
        XCTAssertGreaterThan(r.pixel(100, 300).r, r.pixel(100, 398).r, "and fading between")
    }

    // MARK: the thumbnail and the store

    func testAHooksThumbnailIsThumbSizedAndNeverUpscaled() throws {
        let frame = try XCTUnwrap(paintedImage(720, 1280) { c in
            c.setFill("#336699")
            c.fillRect(0, 0, c.width, c.height)
        })
        let jpeg = try XCTUnwrap(TripThumbs.jpeg(from: frame))
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let decoded = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(decoded.width, 360)
        XCTAssertEqual(decoded.height, 640)
        let small = try XCTUnwrap(paintedImage(120, 150) { $0.fillRect(0, 0, 1, 1) })
        let kept = try XCTUnwrap(TripThumbs.jpeg(from: small))
        let back = try XCTUnwrap(CGImageSourceCreateImageAtIndex(try XCTUnwrap(CGImageSourceCreateWithData(kept as CFData, nil)), 0, nil))
        XCTAssertEqual(back.width, 120)
    }

    @MainActor
    func testTheStoreKeepsATripAndItsHooksAndPrunesThemWithTheirPosts() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-trips-\(UUID().uuidString)", isDirectory: true)
        let sync = DocumentSync<TripDoc>(store: DocumentStore<TripDoc>(root: root), remoteFor: { _ in nil })
        let store = TripsStore(root: root, sync: sync)
        let (trip, post) = badgeTrip()
        XCTAssertTrue(store.documents.put(trip))
        store.reload()
        await store.openTrip(trip)
        var renamed = trip
        renamed.name = "Australie"
        renamed.updatedAt = 2_000
        store.change(renamed)
        XCTAssertEqual(store.open?.name, "Australie", "on screen at once")
        await store.flush()
        XCTAssertEqual(store.documents.get(trip.id)?.name, "Australie", "on disk after the flush")
        XCTAssertTrue(store.canUndo)

        store.putThumb(post.id, jpeg: Data([0xFF, 0xD8, 0xFF]))
        XCTAssertNotNil(store.thumb(post.id))
        store.deletePost(post.id)
        XCTAssertNil(store.thumb(post.id), "the hook goes with its post")
        XCTAssertEqual(store.open?.posts.count, 0)

        store.putThumb("orphan", jpeg: Data([0xFF]))
        store.sweepThumbs()
        XCTAssertNil(store.thumb("orphan"), "a hook no post names is pruned")
        try? FileManager.default.removeItem(at: root)
    }
}
