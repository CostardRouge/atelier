// The flight path's camera on a blank canvas — no web twin (MapLibre answers
// it there), so this pins the rules it borrows from `use-flight-map.ts` and
// `use-composer-map.ts`: padding, a zoom ceiling, a lone fix at a set zoom,
// the zoom offset and the follow.

import Foundation
import XCTest
@testable import AtelierKit

private func point(_ lat: Double, _ lon: Double, _ t: Double = 0) -> TrackPoint {
    TrackPoint(lon: lon, lat: lat, t: t, alt: nil)
}

final class TrackCameraTests: XCTestCase {
    /// A path of a few hundred metres, wider than tall.
    private let track = [point(16.0560, -61.7500), point(16.0570, -61.7480), point(16.0565, -61.7460)]

    func testNoFixIsNoCamera() {
        XCTAssertNil(fitTrackCamera([], viewport: Size(400, 300), padding: 48, maxZoom: 17, singleZoom: 16))
    }

    func testAFittedTrackTouchesThePaddingOnItsLongAxisAndStaysInside() {
        let size = Size(400, 300)
        guard let camera = fitTrackCamera(track, viewport: size, padding: 48, maxZoom: 22, singleZoom: 16) else {
            return XCTFail("a camera")
        }
        let points = track.map { camera.point(lat: $0.lat, lon: $0.lon, in: size) }
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        assertClose(xs.min()!, 48, 6)
        assertClose(xs.max()!, 352, 6)
        XCTAssertGreaterThanOrEqual(ys.min()!, 48 - 1e-6)
        XCTAssertLessThanOrEqual(ys.max()!, 252 + 1e-6)
        // North is up: the northernmost fix is the highest on screen.
        XCTAssertLessThan(points[1].y, points[0].y)
    }

    func testTheZoomCeilingHoldsAShortHopBack() {
        let hop = [point(16.05600, -61.75000), point(16.05601, -61.75001)]
        guard let camera = fitTrackCamera(hop, viewport: Size(400, 300), padding: 48, maxZoom: 17, singleZoom: 16) else {
            return XCTFail("a camera")
        }
        assertClose(camera.zoom, 17, 9)
    }

    func testALoneFixSitsInTheMiddleAtItsOwnZoom() {
        let size = Size(400, 300)
        let lone = [point(48.8566, 2.3522), point(48.8566, 2.3522)]
        guard let camera = fitTrackCamera(lone, viewport: size, padding: 48, maxZoom: 17, singleZoom: 16) else {
            return XCTFail("a camera")
        }
        assertClose(camera.zoom, 16, 9)
        let p = camera.point(lat: 48.8566, lon: 2.3522, in: size)
        assertClose(p.x, 200, 9)
        assertClose(p.y, 150, 9)
    }

    func testAZoomOffsetDoublesTheScalePerLevelAndFollowRecentres() {
        let size = Size(400, 300)
        guard let camera = fitTrackCamera(track, viewport: size, padding: 40, maxZoom: 16, singleZoom: 15) else {
            return XCTFail("a camera")
        }
        let closer = camera.zoomed(by: 1)
        assertClose(closer.projection.scale, camera.projection.scale * 2, 6)
        assertClose(closer.zoom, camera.zoom + 1, 9)
        let followed = closer.centred(lat: track[2].lat, lon: track[2].lon)
        let p = followed.point(lat: track[2].lat, lon: track[2].lon, in: size)
        assertClose(p.x, 200, 9)
        assertClose(p.y, 150, 9)
    }

    func testTheScaleOfAZoomIsMapLibresWorld() {
        // Zoom 0 at the equator: the 512 px world is 360 degrees wide.
        assertClose(trackScale(zoom: 0, k: 1), 512.0 / 360.0, 12)
        assertClose(trackScale(zoom: 3, k: 0.5), 512.0 * 8 / 180.0, 9)
    }
}
