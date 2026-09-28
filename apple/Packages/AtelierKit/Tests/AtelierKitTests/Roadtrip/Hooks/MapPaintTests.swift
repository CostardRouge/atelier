// One frame of the Itinerary — the layout arithmetic of
// `src/shared/roadtrip/hooks/map-paint.ts`, which has no web spec (it draws on
// a canvas); these pin the rules its header names: everything is measured
// from the map's box and one projection, a stop with no picture draws
// nothing, the line ahead is the bed the pen fills, a pin never hides another
// stop and a name never sits on a pin.

import XCTest
@testable import AtelierKit

private let paintFrame = FrameBox(width: 1080, height: 1920)

private func paintPicture(_ name: String) -> HookPickedPicture {
    HookPickedPicture(ref: SavedMediaRef(name: name, size: 1, lastModified: 0), date: "2025-03-04")
}

/// Perth → Kalbarri → Coral Bay; the middle stop holds no picture.
private func paintOptions(_ change: (inout MapOptions) -> Void = { _ in }) -> MapOptions {
    var o = MapOptions.defaults
    o.stops = [
        MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86, picture: paintPicture("perth.jpg")),
        MapStop(id: "b", name: "Kalbarri", lat: -27.71, lon: 114.16),
        MapStop(id: "c", name: "Coral Bay", lat: -23.14, lon: 113.77, picture: paintPicture("coral.jpg")),
    ]
    change(&o)
    return o
}

private func paintPictures(_ o: MapOptions) -> [String: HookPicture] {
    var out: [String: HookPicture] = [:]
    for stop in o.stops { if let key = stopPictureKey(stop) { out[key] = HookPicture(width: 1200, height: 800) } }
    return out
}

private func paint(_ o: MapOptions, at t: Double, pictures: [String: HookPicture]? = nil) -> (MapFrame, MapTiming)? {
    let timing = mapTiming(planarHops(o.stops), o)
    guard let frame = mapFrame(o, timing, [], pictures ?? paintPictures(o), t, paintFrame) else { return nil }
    return (frame, timing)
}

final class MapPaintFrameTests: XCTestCase {
    func testDrawsNothingOnAFrameWithNoAreaOrWithNoStop() {
        let o = paintOptions()
        let timing = mapTiming(planarHops(o.stops), o)
        XCTAssertNil(mapFrame(o, timing, [], nil, 0, FrameBox(width: 0, height: 1920)))
        XCTAssertNil(mapFrame(MapOptions.defaults, mapTiming([], MapOptions.defaults), [], nil, 0, paintFrame))
    }

    func testMeasuresEverythingFromTheMapsBoxSoADragMovesItAll() throws {
        let (still, _) = try XCTUnwrap(paint(paintOptions(), at: 0))
        let (moved, _) = try XCTUnwrap(paint(moveMap(paintOptions(), 0.1, 0), at: 0))
        XCTAssertEqual(still.box, mapBox(1080, 1920, paintOptions()))
        assertClose(moved.box.x - still.box.x, 108, 9)
        for (a, b) in zip(still.dots, moved.dots) {
            assertClose(b.disc.center.x - a.disc.center.x, 108, 6)
            assertClose(b.disc.center.y, a.disc.center.y, 9)
        }
    }

    func testTheLineAheadIsTheBedThePenFills() throws {
        let o = paintOptions { $0.underlay = false }
        let timing = mapTiming(planarHops(o.stops), o)
        // Half-way along the first hop.
        let t = (timing.arrivals[0] + timing.arrivals[1]) / 2
        let (frame, _) = try XCTUnwrap(paint(o, at: t))
        let ahead = frame.arcs.filter { !$0.dash.isEmpty }
        let drawn = frame.arcs.filter { $0.dash.isEmpty }
        // The rest of the first hop and the whole second, dashed; the first hop's drawn part, solid.
        XCTAssertEqual(ahead.count, 2)
        XCTAssertEqual(drawn.count, 1)
        assertClose(ahead[0].start.x, drawn[0].end.x, 9)
        assertClose(ahead[0].start.y, drawn[0].end.y, 9)
        XCTAssertEqual(drawn[0].ink, HookInk(o.pathColor, 1))
        XCTAssertEqual(ahead[0].ink, HookInk(o.aheadColor, 0.85 * 0.5))
        // Ahead hidden: only what the pen drew.
        let hidden = try XCTUnwrap(paint(paintOptions { $0.underlay = false; $0.aheadStyle = .hidden }, at: t)).0
        XCTAssertEqual(hidden.arcs.count, 1)
        // Every stroke gets its underlay first when asked.
        let under = try XCTUnwrap(paint(paintOptions(), at: t)).0
        XCTAssertEqual(under.arcs.count, 6)
        XCTAssertEqual(under.arcs[0].ink.color, "#000000")
    }

    func testAStopWithNoPictureDrawsNothingAndOnlyReachedStopsArePinned() throws {
        let o = paintOptions()
        let timing = mapTiming(planarHops(o.stops), o)
        // On Kalbarri, which holds none: Perth's pin only.
        let (onKalbarri, _) = try XCTUnwrap(paint(o, at: timing.arrivals[1] + 0.3))
        XCTAssertEqual(onKalbarri.pins.map(\.key), ["name:perth.jpg:1"])
        // At rest: Perth and Coral Bay, never a stand-in for Kalbarri.
        let (atRest, _) = try XCTUnwrap(paint(o, at: 99))
        XCTAssertEqual(atRest.pins.map(\.key), ["name:perth.jpg:1", "name:coral.jpg:1"])
        XCTAssertEqual(atRest.stems.count, 2)
        // A picture the shell could not decode draws nothing either.
        let (missing, _) = try XCTUnwrap(paint(o, at: 99, pictures: [:]))
        XCTAssertEqual(missing.pins, [])
    }

    func testAPinNeverHidesAnotherStopAndANameNeverSitsOnAPin() throws {
        let (frame, _) = try XCTUnwrap(paint(paintOptions { $0.labels = .all }, at: 99))
        // A pin sits a gap away from its own dot, so NO dot may fall inside a
        // pin's box grown by a dot's radius.
        for pin in frame.pins {
            for dot in frame.dots {
                let r = dot.disc.radius
                let c = dot.disc.center
                let inside = c.x > pin.rect.x - r && c.x < pin.rect.x + pin.rect.width + r
                    && c.y > pin.rect.y - r && c.y < pin.rect.y + pin.rect.height + r
                XCTAssertFalse(inside, "dot \(dot.index) under \(pin.key)")
            }
        }
        XCTAssertEqual(frame.pins.count, 2)
        let fontPx = 26.0
        for label in frame.labels {
            let width = Double(label.text.utf16.count) * fontPx * 0.55
            let x0 = label.align == .left ? label.at.x : label.align == .right ? label.at.x - width : label.at.x - width / 2
            for pin in frame.pins {
                let overlaps = x0 < pin.rect.x + pin.rect.width && x0 + width > pin.rect.x
                    && label.at.y - fontPx * 0.6 < pin.rect.y + pin.rect.height && label.at.y + fontPx * 0.6 > pin.rect.y
                XCTAssertFalse(overlaps, label.text)
            }
        }
        XCTAssertFalse(frame.labels.isEmpty)
    }

    func testNumbersTheDotsInTheMapsOwnInk() throws {
        let (frame, _) = try XCTUnwrap(paint(paintOptions { $0.numbers = true }, at: 99))
        XCTAssertEqual(frame.dots.compactMap(\.numeral?.text), ["1", "2", "3"])
        XCTAssertEqual(frame.dots[0].numeral?.ink.color, "#1c1a17")
        assertClose(frame.dots[0].disc.radius, 7 * 2.1, 9)
    }

    func testHoldsTheDotsAheadBackAndHidesThemWithTheLineAhead() throws {
        let (onFirst, _) = try XCTUnwrap(paint(paintOptions(), at: 0))
        XCTAssertEqual(onFirst.dots.map { $0.disc.ink.alpha }, [1, 0.8 * 0.55, 0.8 * 0.55])
        let (hidden, _) = try XCTUnwrap(paint(paintOptions { $0.aheadStyle = .hidden }, at: 0))
        XCTAssertEqual(hidden.dots.map(\.index), [0])
    }

    func testFliesAPlaneNoseFirstAlongTheHop() throws {
        let o = paintOptions { $0.pen = .plane }
        let timing = mapTiming(planarHops(o.stops), o)
        let (frame, _) = try XCTUnwrap(paint(o, at: (timing.arrivals[0] + timing.arrivals[1]) / 2))
        guard case .plane(let points, _)? = frame.pen else { return XCTFail("a plane on the hop") }
        XCTAssertEqual(points.count, 4)
        // Perth → Kalbarri runs north: the nose is the highest point.
        XCTAssertEqual(points.map(\.y).min(), points[0].y)
        XCTAssertNil(try XCTUnwrap(paint(o, at: 99)).0.pen)
    }

    func testCrossFadesTheCardAndCaptionsItWithTheStopsName() throws {
        let o = paintOptions { $0.media = .card; $0.mediaFade = 0.4 }
        let timing = mapTiming(planarHops(o.stops), o)
        let (landing, _) = try XCTUnwrap(paint(o, at: timing.arrivals[2] + 0.2))
        // Kalbarri holds none, so only Coral Bay's card fades in — nothing stands in for the stop before.
        XCTAssertEqual(landing.card.map(\.caption), ["Coral Bay"])
        assertClose(landing.card[0].alpha, 0.5, 9)
        let (onKalbarri, _) = try XCTUnwrap(paint(o, at: timing.arrivals[1] + 1))
        XCTAssertEqual(onKalbarri.card, [])
    }

    func testVeilsABackdropOnlyWhereAPictureWasLaid() throws {
        let o = paintOptions { $0.media = .backdrop }
        let timing = mapTiming(planarHops(o.stops), o)
        let (first, _) = try XCTUnwrap(paint(o, at: 0))
        XCTAssertEqual(first.backdrop?.layers.map(\.key), ["name:perth.jpg:1"])
        assertClose(first.backdrop?.veil ?? 0, o.mediaDim, 9)
        let (onKalbarri, _) = try XCTUnwrap(paint(o, at: timing.arrivals[1] + 1))
        XCTAssertEqual(onKalbarri.backdrop?.layers, [])
        XCTAssertEqual(onKalbarri.backdrop?.veil, 0)
    }

    func testLaysTheStripOutAsASetVeilingWhatIsAheadAndRingingTheLastReached() throws {
        let o = paintOptions { $0.media = .strip }
        let (frame, _) = try XCTUnwrap(paint(o, at: 0))
        XCTAssertEqual(frame.strip.map(\.tile.key), ["name:perth.jpg:1", "name:coral.jpg:1"])
        XCTAssertNil(frame.strip[0].veil)
        XCTAssertNotNil(frame.strip[0].ring)
        assertClose(frame.strip[1].veil?.ink.alpha ?? 0, 0.62, 9)
        XCTAssertNil(frame.strip[1].ring)
        // Along the top edge unless the map sits there.
        XCTAssertGreaterThan(frame.strip[0].tile.rect.y, 1920 / 2)
        let (low, _) = try XCTUnwrap(paint(paintOptions { $0.media = .strip; $0.position = .bottom }, at: 0))
        assertClose(low.strip[0].tile.rect.y, 26, 9)
    }

    func testSaysTheDistanceThePenHasCoveredUnderTheMap() throws {
        let o = paintOptions { $0.distance = .km }
        let (frame, timing) = try XCTUnwrap(paint(o, at: 99))
        let fractions = drawnFractions(timing, o.easing, 99, 2)
        XCTAssertEqual(frame.distance?.text, formatDistance(drawnKm(hopKms(o.stops), fractions), .km))
        XCTAssertEqual(frame.distance?.align, .left)
        XCTAssertEqual(frame.distance?.at.x, frame.box.x)
        XCTAssertNil(try XCTUnwrap(paint(paintOptions(), at: 99)).0.distance)
    }

    func testDrawsThePlateTheGraticuleTheContextAndTheCompassOnlyWhenAsked() throws {
        let (plain, _) = try XCTUnwrap(paint(paintOptions(), at: 0))
        XCTAssertNil(plain.plate)
        XCTAssertNil(plain.graticule)
        XCTAssertNil(plain.compass)
        XCTAssertEqual(plain.context, [])
        let o = paintOptions { $0.plate = true; $0.graticule = true; $0.compass = true; $0.context = true }
        let timing = mapTiming(planarHops(o.stops), o)
        let frame = try XCTUnwrap(mapFrame(o, timing, [MapPlace(name: "Exmouth", lat: -21.93, lon: 114.12)],
                                           paintPictures(o), 0, paintFrame))
        XCTAssertEqual(frame.plate?.ink, HookInk(o.plateColor, o.plateOpacity))
        XCTAssertEqual(frame.graticule?.clip, frame.box)
        XCTAssertFalse(frame.graticule?.lines.isEmpty ?? true)
        XCTAssertEqual(frame.compass?.letter.text, "N")
        XCTAssertEqual(frame.context.count, 1)
    }
}
