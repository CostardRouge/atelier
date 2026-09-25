// The kernel's plane geometry — the types every ported module shares instead
// of CoreGraphics (which Linux has no part of): a point, a size, a rectangle,
// in Doubles. Names mirror what the web's modules pass around as `{ x, y }`,
// `{ w, h }` / `{ width, height }` and `{ x, y, w, h }`.

import Foundation

public struct Point: Equatable, Sendable, Codable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
    public static let zero = Point(0, 0)
}

public struct Size: Equatable, Sendable, Codable {
    public var width: Double
    public var height: Double
    public init(width: Double, height: Double) { self.width = width; self.height = height }
    public init(_ width: Double, _ height: Double) { self.width = width; self.height = height }
    public static let zero = Size(0, 0)
    public var aspect: Double { height == 0 ? 0 : width / height }
}

public struct Rect: Equatable, Sendable, Codable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public init(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public init(origin: Point, size: Size) {
        self.init(x: origin.x, y: origin.y, width: size.width, height: size.height)
    }
    public static let zero = Rect(0, 0, 0, 0)
    public var origin: Point { Point(x, y) }
    public var size: Size { Size(width, height) }
    public var minX: Double { x }
    public var minY: Double { y }
    public var maxX: Double { x + width }
    public var maxY: Double { y + height }
    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }
    public var isEmpty: Bool { width <= 0 || height <= 0 }

    public func contains(_ p: Point) -> Bool {
        p.x >= minX && p.x < maxX && p.y >= minY && p.y < maxY
    }

    public func intersects(_ r: Rect) -> Bool {
        minX < r.maxX && r.minX < maxX && minY < r.maxY && r.minY < maxY
    }

    public func intersection(_ r: Rect) -> Rect {
        let x0 = max(minX, r.minX), y0 = max(minY, r.minY)
        let x1 = min(maxX, r.maxX), y1 = min(maxY, r.maxY)
        return x1 <= x0 || y1 <= y0 ? .zero : Rect(x0, y0, x1 - x0, y1 - y0)
    }

    public func union(_ r: Rect) -> Rect {
        if isEmpty { return r }
        if r.isEmpty { return self }
        let x0 = min(minX, r.minX), y0 = min(minY, r.minY)
        let x1 = max(maxX, r.maxX), y1 = max(maxY, r.maxY)
        return Rect(x0, y0, x1 - x0, y1 - y0)
    }

    public func insetBy(dx: Double, dy: Double) -> Rect {
        Rect(x + dx, y + dy, width - 2 * dx, height - 2 * dy)
    }

    public func offsetBy(dx: Double, dy: Double) -> Rect {
        Rect(x + dx, y + dy, width, height)
    }
}

/// `min(max(v, lo), hi)` — the web's `clamp`.
@inlinable public func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    min(max(v, lo), hi)
}

/// `clamp(v, 0, 1)`.
@inlinable public func clamp01(_ v: Double) -> Double {
    min(max(v, 0), 1)
}

/// Linear interpolation, `a + (b − a) × t`.
@inlinable public func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double {
    a + (b - a) * t
}
