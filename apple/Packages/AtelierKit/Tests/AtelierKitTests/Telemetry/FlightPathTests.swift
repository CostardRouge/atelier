// Port of `src/shared/telemetry/flight-path.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// Minimal cue builder — only the fields the flight path reads. A field the
/// web left `undefined` is simply absent here.
private func cue(_ start: Double, _ latitude: String? = nil, _ longitude: String? = nil, _ relAlt: String? = nil) -> Cue {
    var data: [String: String] = [:]
    if let latitude { data["latitude"] = latitude }
    if let longitude { data["longitude"] = longitude }
    if let relAlt { data["rel_alt"] = relAlt }
    return Cue(start: start, end: start + 0.033, frame: nil, timestamp: nil, data: data)
}

final class ParsePositionTests: XCTestCase {
    func testReturnsLonLatForAValidFix() {
        XCTAssertEqual(parsePosition(cue(0, "37.7749", "-122.4194")), LonLat(lon: -122.4194, lat: 37.7749))
    }

    func testRejectsANullIslandFixAndOutOfRangeOrMissingValues() {
        XCTAssertNil(parsePosition(cue(0, "0", "0")))
        XCTAssertNil(parsePosition(cue(0, "200", "10")))
        XCTAssertNil(parsePosition(cue(0, nil, nil)))
        XCTAssertNil(parsePosition(cue(0, "nan", "nan")))
    }
}

final class ExtractTrackTests: XCTestCase {
    private let track = extractTrack([
        cue(0, "0", "0"), // pre-lock, dropped
        cue(1, "48.8566", "2.3522", "12.5"),
        cue(2, "48.8570", "2.3530", "20"),
        cue(3, "nan", "nan"), // garbage, dropped
    ])

    func testKeepsOnlyLocatedCuesInOrderWithTimeAndAltitude() {
        XCTAssertEqual(track.count, 2)
        XCTAssertEqual(track[0], TrackPoint(lon: 2.3522, lat: 48.8566, t: 1, alt: 12.5))
        XCTAssertEqual(track[1].t, 2)
        XCTAssertEqual(track[1].alt, 20)
    }

    func testRecordsAltitudeAsNilWhenAbsent() {
        let t = extractTrack([cue(0, "48.0", "2.0")])
        XCTAssertNil(t[0].alt)
    }
}

final class TrackBoundsTests: XCTestCase {
    private let track = extractTrack([
        cue(0, "48.8566", "2.3522"),
        cue(1, "48.8600", "2.3500"),
    ])

    func testComputesTheBoundingBoxAsLonLat() {
        XCTAssertEqual(trackBounds(track), TrackBounds(min: LonLat(lon: 2.35, lat: 48.8566), max: LonLat(lon: 2.3522, lat: 48.86)))
    }

    func testReturnsNilBoundsForAnEmptyTrack() {
        XCTAssertNil(trackBounds([]))
    }

    func testProducesGeoJsonLonLatCoordinates() {
        XCTAssertEqual(lineCoordinates(track), [LonLat(lon: 2.3522, lat: 48.8566), LonLat(lon: 2.35, lat: 48.86)])
    }
}
