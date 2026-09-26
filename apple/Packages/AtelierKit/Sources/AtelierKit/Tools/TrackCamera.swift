// Where a flight path sits on a screen with no map under it — the camera the
// Flight Map and the Composer frame a DJI track with. New logic for the app,
// with no web module of its own: on the web MapLibre answers it
// (`map/use-flight-map.ts`: `fitBounds` with 48 px of padding up to zoom 17,
// a lone fix at zoom 16; `composer/use-composer-map.ts`: `cameraForBounds`
// with 40 px up to zoom 16, a lone fix at 15, plus the author's zoom offset
// and a camera that follows the aircraft). The native app draws the path on
// a BLANK canvas by default, so the camera is arithmetic it owns.
//
// The projection is the kernel's own (`Roadtrip/Hooks/Geo.swift`):
// equirectangular with the longitude squeezed by the cosine of the mean
// latitude, which at a drone's scale — a few hundred metres — is Web
// Mercator to well under a pixel. Zoom levels are MapLibre's, a world
// `512 × 2^zoom` px wide, so "zoom 17" means here what it means on the web.

import Foundation

/// MapLibre's world width at zoom 0, in px (its tiles are 512 wide).
public let trackMapWorldPx = 512.0

/// A camera over a track: the projection's scale and squeeze, and the point
/// (in projected units, pre-scale) the screen centre looks at.
public struct TrackCamera: Equatable, Sendable {
    public var projection: Projection
    /// The screen centre, in the projection's own units (`lon × k`, `−lat`).
    public var centerX: Double
    public var centerY: Double

    public init(projection: Projection, centerX: Double, centerY: Double) {
        self.projection = projection
        self.centerX = centerX
        self.centerY = centerY
    }

    /// Where a fix lands in a viewport of `size`, top-left origin.
    public func point(lat: Double, lon: Double, in size: Size) -> Point {
        let x = size.width / 2 + (lon * projection.k - centerX) * projection.scale
        let y = size.height / 2 + (-lat - centerY) * projection.scale
        return Point(x, y)
    }

    /// The MapLibre zoom this scale stands for.
    public var zoom: Double {
        let pxPerDegreeLon = projection.scale * projection.k
        guard pxPerDegreeLon > 0 else { return 0 }
        return log2(pxPerDegreeLon * 360 / trackMapWorldPx)
    }

    /// The same camera `offset` zoom levels further in (negative: out) — the
    /// Composer's "Map zoom" slider.
    public func zoomed(by offset: Double) -> TrackCamera {
        var next = self
        next.projection.scale *= pow(2, offset)
        return next
    }

    /// The same scale, looking at `lat`/`lon` — the Composer's "Follow".
    public func centred(lat: Double, lon: Double) -> TrackCamera {
        var next = self
        next.centerX = lon * projection.k
        next.centerY = -lat
        return next
    }
}

/// The projection scale (px per degree of latitude) of a MapLibre zoom at a
/// squeeze `k`.
public func trackScale(zoom: Double, k: Double) -> Double {
    let squeeze = k > 0 ? k : 1
    return trackMapWorldPx * pow(2, zoom) / (360 * squeeze)
}

/// Frame a track in a viewport: fitted inside `padding` on every side, never
/// closer than `maxZoom`; a track that is one spot sits at `singleZoom`. Nil
/// for a track with no fix at all — there is nothing to frame.
public func fitTrackCamera(_ track: [TrackPoint], viewport: Size, padding: Double,
                           maxZoom: Double, singleZoom: Double) -> TrackCamera? {
    guard !track.isEmpty else { return nil }
    let points = track.map { GeoPoint(lat: $0.lat, lon: $0.lon) }
    let inner = Size(max(1, viewport.width - 2 * padding), max(1, viewport.height - 2 * padding))
    var projection = projectionFor(points, inner.width, inner.height, fallbackScale: 0)
    let single = trackBounds(track).map { $0.min == $0.max } ?? true
    if single || !(projection.scale > 0) || !projection.scale.isFinite {
        projection.scale = trackScale(zoom: singleZoom, k: projection.k)
    } else {
        projection.scale = min(projection.scale, trackScale(zoom: maxZoom, k: projection.k))
    }
    return TrackCamera(projection: projection, centerX: projection.midX, centerY: projection.midY)
}
