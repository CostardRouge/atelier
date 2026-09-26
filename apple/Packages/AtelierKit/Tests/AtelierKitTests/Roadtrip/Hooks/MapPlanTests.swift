// The stored half of `src/shared/roadtrip/hooks/map-plan.ts`: the `mapOptions`
// and `readStops` cases of `map-plan.test.ts` (the projection, the clock, the
// pen and the editing verbs wait for the behaviour's port), and the retired
// Route's conversion.

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
