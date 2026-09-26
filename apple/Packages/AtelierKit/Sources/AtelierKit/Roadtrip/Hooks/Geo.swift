// The geography the map-like openers share — a projection that fits located
// places into a box, the great-circle distance, its formatting, and the
// placement of names beside dots. Port of `src/shared/roadtrip/hooks/geo.ts`.
//
// Pure. The projection is equirectangular with the longitude scaled by the
// cosine of the mean latitude — honest at the scale of a country, and it
// needs no map. North is up, always. The paint that draws the names is the
// app's; WHERE each name goes (and which are dropped) is decided here.

import Foundation

/// Anything with a latitude and a longitude in degrees — the web's
/// `P extends GeoPoint` constraint (a day's median, a gazetteer row, a stop).
public protocol GeoLocated {
    var lat: Double { get }
    var lon: Double { get }
}

public struct GeoPoint: GeoLocated, Equatable, Sendable, Codable {
    public var lat: Double
    public var lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
}

/// Stored on an opener's options, so each raw value is the web's.
public enum DistanceUnit: String, CaseIterable, Codable, Sendable {
    case off
    case km
    case mi
}

/// A projection that fits every point inside `box`, aspect kept and centred.
/// North is up. A set of one spot (or none) sits in the middle.
public func fitProjection<P: GeoLocated>(_ points: [P], _ box: Rect) -> @Sendable (GeoPoint) -> Point {
    let cx = box.x + box.width / 2
    let cy = box.y + box.height / 2
    if points.isEmpty { return { _ in Point(cx, cy) } }

    let meanLat = points.reduce(0.0) { $0 + $1.lat } / Double(points.count)
    let k = cos(meanLat * Double.pi / 180)
    let xs = points.map { $0.lon * k }
    let ys = points.map { -$0.lat }
    let minX = xs.min()!, maxX = xs.max()!
    let minY = ys.min()!, maxY = ys.max()!
    let spanX = maxX - minX
    let spanY = maxY - minY
    if spanX < 1e-9 && spanY < 1e-9 { return { _ in Point(cx, cy) } }

    let byWidth = spanX > 1e-9 ? box.width / spanX : Double.infinity
    let byHeight = spanY > 1e-9 ? box.height / spanY : Double.infinity
    let scale = min(byWidth, byHeight)
    let midX = (minX + maxX) / 2
    let midY = (minY + maxY) / 2
    return { p in
        let x = cx + (p.lon * k - midX) * scale
        let y = cy + (-p.lat - midY) * scale
        return Point(x, y)
    }
}

/// The same projection, but with its scale and centre exposed — what a camera
/// that follows something needs, since it re-centres the view without
/// changing the scale.
public struct Projection: Equatable, Sendable {
    /// Pixels per degree of latitude.
    public var scale: Double
    /// The longitude's squeeze at the mean latitude.
    public var k: Double
    /// The points' middle, in projected (pre-scale) units.
    public var midX: Double
    public var midY: Double

    public init(scale: Double, k: Double, midX: Double, midY: Double) {
        self.scale = scale; self.k = k; self.midX = midX; self.midY = midY
    }

    /// Project a point about a chosen screen centre.
    public func at<P: GeoLocated>(_ p: P, _ cx: Double, _ cy: Double) -> Point {
        let x = cx + (p.lon * k - midX) * scale
        let y = cy + (-p.lat - midY) * scale
        return Point(x, y)
    }
}

/// `scale` is pixels per degree of latitude; the longitude is squeezed by
/// `k`. A set of one spot (or none) has no scale of its own and takes
/// `fallbackScale`.
public func projectionFor<P: GeoLocated>(_ points: [P], _ width: Double, _ height: Double,
                                         fallbackScale: Double = 1) -> Projection {
    let meanLat = points.isEmpty ? 0 : points.reduce(0.0) { $0 + $1.lat } / Double(points.count)
    let k = cos(meanLat * Double.pi / 180)
    let xs = points.map { $0.lon * k }
    let ys = points.map { -$0.lat }
    let minX = xs.min() ?? 0, maxX = xs.max() ?? 0
    let minY = ys.min() ?? 0, maxY = ys.max() ?? 0
    let spanX = maxX - minX
    let spanY = maxY - minY
    let byWidth = spanX > 1e-9 ? width / spanX : Double.infinity
    let byHeight = spanY > 1e-9 ? height / spanY : Double.infinity
    let fits = min(byWidth, byHeight)
    return Projection(scale: fits.isFinite ? fits : fallbackScale, k: k,
                      midX: (minX + maxX) / 2, midY: (minY + maxY) / 2)
}

/// Great-circle distance between two located places, in kilometres.
public func haversineKm<A: GeoLocated, B: GeoLocated>(_ a: A, _ b: B) -> Double {
    let r = 6371.0088
    let toRad = Double.pi / 180
    let dLat = (b.lat - a.lat) * toRad
    let dLon = (b.lon - a.lon) * toRad
    let sinLat = sin(dLat / 2)
    let sinLon = sin(dLon / 2)
    let cosProduct = cos(a.lat * toRad) * cos(b.lat * toRad)
    let s = sinLat * sinLat + cosProduct * sinLon * sinLon
    return 2 * r * asin(min(1, s.squareRoot()))
}

/// "1 240 km" / "770 mi" — a space in the thousands, one decimal under ten.
public func formatDistance(_ km: Double, _ unit: DistanceUnit) -> String {
    if unit == .off { return "" }
    let value = unit == .mi ? km * 0.621371 : km
    let text: String
    if value < 10 {
        text = TripJS.toFixed1(value)
    } else {
        let whole = TripJS.number(TripJS.round(value))
        // `\B(?=(\d{3})+(?!\d))` → ' ': a space before every third digit from the right.
        let digits = Array(whole)
        var grouped = ""
        for (i, c) in digits.enumerated() {
            let fromRight = digits.count - i
            if i > 0, fromRight % 3 == 0, digits[i - 1].isNumber, c.isNumber { grouped.append(" ") }
            grouped.append(c)
        }
        text = grouped
    }
    return "\(text) \(unit.rawValue)"
}

public enum LabelAlign: String, Sendable {
    case left, right, center
}

/// Which side of the dot the text sits on.
public enum LabelSide: String, Sendable {
    case right, left, above, below
}

public struct PlacedLabel: Equatable, Sendable {
    /// Index into the points handed in.
    public var index: Int
    public var x: Double
    public var y: Double
    public var align: LabelAlign
    public var side: LabelSide
    public init(index: Int, x: Double, y: Double, align: LabelAlign, side: LabelSide) {
        self.index = index; self.x = x; self.y = y; self.align = align; self.side = side
    }
}

/// A dot that may carry a name.
public struct LabelCandidate: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var name: String
    public var wanted: Bool
    public init(x: Double, y: Double, name: String, wanted: Bool) {
        self.x = x; self.y = y; self.name = name; self.wanted = wanted
    }
}

/// A box a label must not enter, corner to corner.
public struct LabelBox: Equatable, Sendable {
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double
    public init(x0: Double, y0: Double, x1: Double, y1: Double) { self.x0 = x0; self.y0 = y0; self.x1 = x1; self.y1 = y1 }
}

/// Where each wanted label goes, and which are left out. Labels are placed in
/// order, each tried to the right of its dot, then the left, above, below; one
/// that would overlap a label already placed, a box the caller reserved, or
/// leave the frame is DROPPED — a name over another name says neither. The
/// paint measures text with its own font; without a measure, width is
/// estimated from the font size (an average glyph is ~0.55 em wide in the
/// suite's faces, counted in UTF-16 units as the web counts `length`).
public func placeLabels(_ points: [LabelCandidate], _ fontPx: Double, _ frame: Size, _ dotRadius: Double,
                        measure: ((String) -> Double)? = nil, reserved: [LabelBox] = []) -> [PlacedLabel] {
    let widthOf = measure ?? { name in Double(max(1, name.utf16.count)) * fontPx * 0.55 }
    var placed: [PlacedLabel] = []
    var boxes = reserved
    let gap = dotRadius + fontPx * 0.45
    let lineH = fontPx * 1.2
    func overlaps(_ b: LabelBox) -> Bool {
        if b.x0 < 0 || b.y0 < 0 || b.x1 > frame.width || b.y1 > frame.height { return true }
        return boxes.contains { o in b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0 }
    }

    for (index, p) in points.enumerated() {
        let name = p.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !p.wanted || name.isEmpty { continue }
        let w = widthOf(name)
        let tries = [
            PlacedLabel(index: index, x: p.x + gap, y: p.y, align: .left, side: .right),
            PlacedLabel(index: index, x: p.x - gap, y: p.y, align: .right, side: .left),
            PlacedLabel(index: index, x: p.x, y: p.y - gap - lineH * 0.35, align: .center, side: .above),
            PlacedLabel(index: index, x: p.x, y: p.y + gap + lineH * 0.35, align: .center, side: .below),
        ]
        for t in tries {
            let x0 = t.align == .left ? t.x : t.align == .right ? t.x - w : t.x - w / 2
            let box = LabelBox(x0: x0, y0: t.y - lineH / 2, x1: x0 + w, y1: t.y + lineH / 2)
            if overlaps(box) { continue }
            boxes.append(box)
            placed.append(t)
            break
        }
    }
    return placed
}
