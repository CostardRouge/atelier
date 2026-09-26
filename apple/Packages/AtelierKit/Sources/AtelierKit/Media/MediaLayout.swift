// Several pictures in one frame — the pure geometry. Port of
// `src/shared/media/media-layout.ts`.
//
// A frame is cut into CELLS by a template of one of three kinds:
//
// - `tracks`: a grid of weighted columns and rows with CSS-grid-style `areas`
//   (`'a a b / a a c / d d c'`), which is what a plain grid, a stack and a
//   bento all are — one solver, three shelves in the picker;
// - `inset`: one full-frame cell with framed cells laid over its corners;
// - `free`: prints scattered on the frame, each with its own tilt, that the
//   author may drag (`CellPlace`).
//
// Spacing is given in fractions of the frame's SHORTER side: the 720 px stage
// and the 2160 px export resolve to the same cells, so a crop made on one
// holds on the other. A template's letter order IS its cell order, and the
// letters are the only thing that decide which picture lands where: a
// non-rectangular area is refused rather than guessed, because a guess would
// move a picture the author had placed.
//
// The painter (the web's `cell-paint.ts`) is the app's: it draws each picture
// through its own `Framing` inside the cell it is given here, and the stage
// hit-tests the same rects (`cellAt`).

import Foundation

/// Gap, padding and corner radius, all as fractions of the shorter side.
public struct LayoutSpacing: Equatable, Sendable {
    public var gap: Double
    public var padding: Double
    public var radius: Double
    public init(gap: Double, padding: Double, radius: Double) { self.gap = gap; self.padding = padding; self.radius = radius }

    public var json: JSONValue {
        .object(["gap": .number(gap), "padding": .number(padding), "radius": .number(radius)])
    }
}

public let defaultLayoutSpacing = LayoutSpacing(gap: 0.012, padding: 0.016, radius: 0.016)

private let spacingMax = LayoutSpacing(gap: 0.1, padding: 0.2, radius: 0.2)

/// A framed cell laid over the full one — `width` a fraction of the short side.
public struct InsetSpec: Equatable, Sendable {
    public var corner: Corner
    public var width: Double
    /// Width over height of the inset itself.
    public var aspect: Double
    public init(corner: Corner, width: Double, aspect: Double) { self.corner = corner; self.width = width; self.aspect = aspect }
}

/// A print scattered on the frame: its centre as fractions of the frame's own
/// width and height, its width as a fraction of the short side, its tilt in
/// degrees clockwise.
public struct PrintSpec: Equatable, Sendable {
    public var cx: Double
    public var cy: Double
    public var width: Double
    public var aspect: Double
    public var rotation: Double
    public init(cx: Double, cy: Double, width: Double, aspect: Double, rotation: Double) {
        self.cx = cx; self.cy = cy; self.width = width; self.aspect = aspect; self.rotation = rotation
    }
}

public enum LayoutTemplateKind: String, Sendable {
    case tracks, inset, free
}

public enum LayoutTemplate: Equatable, Sendable {
    case tracks(cols: [Double], rows: [Double], areas: String)
    case inset(insets: [InsetSpec])
    case free(prints: [PrintSpec])

    public var kind: LayoutTemplateKind {
        switch self {
        case .tracks: return .tracks
        case .inset: return .inset
        case .free: return .free
        }
    }
}

/// Where the author moved a print from its template place — offsets as
/// fractions of the frame's width and height, an extra tilt in degrees. Only a
/// `free` template reads it; on any other it is carried and ignored.
public struct CellPlace: Equatable, Sendable {
    public var dx: Double
    public var dy: Double
    public var rotation: Double
    public init(dx: Double, dy: Double, rotation: Double) { self.dx = dx; self.dy = dy; self.rotation = rotation }

    public var json: JSONValue {
        .object(["dx": .number(dx), "dy": .number(dy), "rotation": .number(rotation)])
    }
}

public let defaultCellPlace = CellPlace(dx: 0, dy: 0, rotation: 0)

/// How far a print may be dragged from its template place, in frame fractions.
public let maxPlaceOffset = 0.4
public let maxPlaceTilt = 30.0

/// What the painter wraps around a cell's picture.
public enum CellMount: String, Sendable {
    case none, print, stroke
}

/// One resolved cell, in the pixels of the frame it was resolved for — the
/// web's `CellRect extends Rect`, flat fields plus the rect they make.
public struct CellRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    /// Degrees clockwise about the cell's centre. Only prints ever turn.
    public var rotation: Double
    public var mount: CellMount

    public init(x: Double, y: Double, width: Double, height: Double, rotation: Double, mount: CellMount) {
        self.x = x; self.y = y; self.width = width; self.height = height; self.rotation = rotation; self.mount = mount
    }

    public var rect: Rect { Rect(x, y, width, height) }
}

/// One named area of a `tracks` template, in track indices, both ends inclusive.
public struct AreaBox: Equatable, Sendable {
    public var id: String
    public var r0: Int
    public var r1: Int
    public var c0: Int
    public var c1: Int
    public init(id: String, r0: Int, r1: Int, c0: Int, c1: Int) { self.id = id; self.r0 = r0; self.r1 = r1; self.c0 = c0; self.c1 = c1 }
}

private struct CountedBox {
    var box: AreaBox
    var count: Int
}

/// Parse `'a a b / a a c / d d c'` into boxes, in the order the letters first
/// appear — reading order, which is the cell order. A `.` is an empty track
/// cell. Returns nil for ragged rows, an empty string, or a letter whose
/// cells do not form one rectangle: a layout that cannot be drawn as written
/// is refused, never repaired.
public func parseAreas(_ areas: String) -> [AreaBox]? {
    let rows: [[String]] = areas.components(separatedBy: "/").map { row in
        row.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
    }
    guard let first = rows.first, !first.isEmpty else { return nil }
    let width = first.count
    if rows.contains(where: { $0.count != width }) { return nil }

    var index: [String: Int] = [:]
    var order: [CountedBox] = []
    for (r, row) in rows.enumerated() {
        for (c, id) in row.enumerated() {
            if id == "." { continue }
            let i: Int
            if let known = index[id] {
                i = known
            } else {
                i = order.count
                index[id] = i
                order.append(CountedBox(box: AreaBox(id: id, r0: r, r1: r, c0: c, c1: c), count: 0))
            }
            order[i].box.r0 = min(order[i].box.r0, r)
            order[i].box.r1 = max(order[i].box.r1, r)
            order[i].box.c0 = min(order[i].box.c0, c)
            order[i].box.c1 = max(order[i].box.c1, c)
            order[i].count += 1
        }
    }
    if order.isEmpty { return nil }
    for entry in order {
        let b = entry.box
        if entry.count != (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) { return nil }
    }
    return order.map(\.box)
}

/// How many cells a template resolves to. 0 for a `tracks` template that does not parse.
public func cellCount(_ template: LayoutTemplate) -> Int {
    switch template {
    case .tracks(_, _, let areas):
        return parseAreas(areas)?.count ?? 0
    case .inset(let insets):
        return 1 + insets.count
    case .free(let prints):
        return prints.count
    }
}

/// Track starts and ends along one axis, weights shared out over what gap and padding leave.
private func tracks(_ weights: [Double], _ length: Double, _ pad: Double, _ gap: Double) -> (starts: [Double], ends: [Double]) {
    let sum = weights.reduce(0) { $0 + max(0, $1) }
    let total = sum == 0 || sum.isNaN ? 1 : sum
    let available = max(0, length - 2 * pad - gap * Double(weights.count - 1))
    var starts: [Double] = []
    var ends: [Double] = []
    var at = pad
    for w in weights {
        let size = (available * max(0, w)) / total
        starts.append(at)
        ends.append(at + size)
        at += size + gap
    }
    return (starts, ends)
}

/// `array[i]`, or nil past either end — what JavaScript reads as `undefined`.
private func element<T>(_ array: [T], _ i: Int) -> T? {
    i >= 0 && i < array.count ? array[i] : nil
}

/// The cells of `template` in a `frameW`×`frameH` frame. Spacing and sizes are
/// fractions, so the result scales exactly with the frame. A `places` entry
/// moves the print at that index (free templates only); an index the template
/// does not have is ignored, so a list kept from a bigger layout is harmless.
public func resolveLayout(_ template: LayoutTemplate, _ frameW: Double, _ frameH: Double,
                          _ spacing: LayoutSpacing = defaultLayoutSpacing,
                          _ places: [CellPlace?]? = nil) -> [CellRect] {
    let short = min(frameW, frameH)
    let gap = spacing.gap * short
    let pad = spacing.padding * short

    switch template {
    case .tracks(let colWeights, let rowWeights, let areas):
        guard let boxes = parseAreas(areas) else { return [] }
        let cols = tracks(colWeights, frameW, pad, gap)
        let rows = tracks(rowWeights, frameH, pad, gap)
        return boxes.map { b in
            let c1 = min(b.c1, cols.ends.count - 1)
            let r1 = min(b.r1, rows.ends.count - 1)
            let x = element(cols.starts, min(b.c0, c1)) ?? 0
            let y = element(rows.starts, min(b.r0, r1)) ?? 0
            let right = element(cols.ends, c1) ?? x
            let bottom = element(rows.ends, r1) ?? y
            return CellRect(x: x, y: y, width: max(0, right - x), height: max(0, bottom - y), rotation: 0, mount: .none)
        }

    case .inset(let insets):
        var cells: [CellRect] = [
            CellRect(x: pad, y: pad, width: frameW - 2 * pad, height: frameH - 2 * pad, rotation: 0, mount: .none),
        ]
        // An inset keeps clear of the edge by at least a little more than the gap,
        // or it reads as a cell of the grid rather than a picture laid over one.
        let margin = pad + max(gap, short * 0.035)
        for inset in insets {
            let w = inset.width * short
            let h = w / (inset.aspect > 0 ? inset.aspect : 1)
            let x = inset.corner == .tl || inset.corner == .bl ? margin : frameW - margin - w
            let y = inset.corner == .tl || inset.corner == .tr ? margin : frameH - margin - h
            cells.append(CellRect(x: x, y: y, width: w, height: h, rotation: 0, mount: .stroke))
        }
        return cells

    case .free(let prints):
        return prints.enumerated().map { i, p in
            var w = p.width * short
            var h = w / (p.aspect > 0 ? p.aspect : 1)
            // A print never takes more than a third of the frame's height, whatever
            // its shape: a pile is several pictures, or it is not a pile.
            let cap = 0.36 * frameH
            if h > cap {
                w *= cap / h
                h = cap
            }
            let place = clampedPlace(places.flatMap { element($0, i) } ?? nil)
            let x = p.cx * frameW + place.dx * frameW - w / 2
            let y = p.cy * frameH + place.dy * frameH - h / 2
            return CellRect(x: x, y: y, width: w, height: h, rotation: p.rotation + place.rotation, mount: .print)
        }
    }
}

private func num(_ v: JSONValue?, _ fallback: Double) -> Double {
    v?.finiteNumber ?? fallback
}

/// Read a spacing out of anything — a stored document, an imported file, nil.
public func normaliseSpacing(_ v: JSONValue?) -> LayoutSpacing {
    let s = v?.objectValue ?? [:]
    return LayoutSpacing(
        gap: clamp(num(s["gap"], defaultLayoutSpacing.gap), 0, spacingMax.gap),
        padding: clamp(num(s["padding"], defaultLayoutSpacing.padding), 0, spacingMax.padding),
        radius: clamp(num(s["radius"], defaultLayoutSpacing.radius), 0, spacingMax.radius)
    )
}

/// Read a print's place out of anything; a missing one is the template's own.
public func normaliseCellPlace(_ v: JSONValue?) -> CellPlace {
    let p = v?.objectValue ?? [:]
    return clampedPlace(CellPlace(dx: num(p["dx"], 0), dy: num(p["dy"], 0), rotation: num(p["rotation"], 0)))
}

/// The same clamp over a place the caller already holds typed (a non-finite
/// number falls back the way the reader's does).
private func clampedPlace(_ p: CellPlace?) -> CellPlace {
    let dx = p?.dx ?? 0
    let dy = p?.dy ?? 0
    let rotation = p?.rotation ?? 0
    return CellPlace(
        dx: clamp(dx.isFinite ? dx : 0, -maxPlaceOffset, maxPlaceOffset),
        dy: clamp(dy.isFinite ? dy : 0, -maxPlaceOffset, maxPlaceOffset),
        rotation: clamp(rotation.isFinite ? rotation : 0, -maxPlaceTilt, maxPlaceTilt)
    )
}

/// Which cell a point (frame pixels) lands in — the LAST drawn wins, since a
/// later print lies over an earlier one. -1 for none, as on the web.
public func cellAt(_ cells: [CellRect], _ x: Double, _ y: Double) -> Int {
    for i in stride(from: cells.count - 1, through: 0, by: -1) {
        let c = cells[i]
        let a = (-c.rotation * Double.pi) / 180
        let dx = x - (c.x + c.width / 2)
        let dy = y - (c.y + c.height / 2)
        let lx = dx * cos(a) - dy * sin(a)
        let ly = dx * sin(a) + dy * cos(a)
        if abs(lx) <= c.width / 2 && abs(ly) <= c.height / 2 { return i }
    }
    return -1
}
