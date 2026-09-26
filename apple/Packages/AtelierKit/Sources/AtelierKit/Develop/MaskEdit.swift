// The stage's HAND on a layer's mask — what a tap, a stroke or a handle's
// drag WRITES, as pure functions over `Mask.swift`'s records. The web's half
// of it lives inside `PictureWorkbench.tsx` (the paint seam: a tap adds or
// removes a subject point or a colour sample, a drag lays a stroke) and
// `LayersPanel.tsx` (`MaskView`, `nextMaskView`); the native stage adds
// HANDLES for the two gradients, which the web places with numbers only —
// so their arithmetic (the guides a gradient is drawn with, and what a drag
// on each one writes) is new here, and pinned by its own spec.
//
// The rules it keeps:
// - every point is in the SOURCE frame's shares, `[0,1]` from the top left —
//   the frame a mask is sampled in (`render-layers.md`); every distance that
//   means a shape (a feather, a radius) is in the CENTRED space `framePoint`
//   defines, the corner at radius 1, so a handle drawn here is exactly where
//   `maskAt` reads 0.5, 1 or 0;
// - a tap on a marker REMOVES it, anywhere else ADDS one (`subjectHitRadius`,
//   the web's `SUBJECT_HIT_RADIUS`) — the click-a-marker-to-unpick gesture;
// - a stroke is VECTORS: its first point starts it, later points closer than
//   `strokeStep` of the radius are dropped (they add nothing the brush does
//   not already cover), and the cap is `maxStrokes`;
// - a value a handle writes stays inside what the panel's slider can show
//   (a centre in 0…1, a feather in 0…1.5, a radius in 0.02…1.5), and is
//   rounded so a document diffs cleanly.

import Foundation

// MARK: - how the open layer's mask is shown

/// How the open layer's mask is shown on the picture — the web's `MaskView`.
public enum MaskView: String, CaseIterable, Sendable {
    case off, outline, fill

    /// The segmented control's words.
    public var label: String {
        switch self {
        case .off: return "Hidden"
        case .outline: return "Outline"
        case .fill: return "Fill"
        }
    }
}

/// What `M` steps to: hidden → outline → fill → hidden.
public func nextMaskView(_ v: MaskView) -> MaskView {
    switch v {
    case .off: return .outline
    case .outline: return .fill
    case .fill: return .off
    }
}

// MARK: - the brush

/// What the NEXT stroke is painted with — the web's `BrushTool`. Kept beside
/// the layer rather than on it: a brush is a tool, and each stroke keeps the
/// settings it was made with, so a soft edge and a hard one live in one mask.
public struct BrushTool: Equatable, Sendable {
    /// Half-width, as a fraction of the half-diagonal.
    public var radius: Double
    /// 0 is a soft edge, 1 a hard one.
    public var hardness: Double
    /// The next stroke takes coverage away.
    public var erase: Bool

    public init(radius: Double = defaultBrushRadius, hardness: Double = defaultBrushHardness, erase: Bool = false) {
        self.radius = radius; self.hardness = hardness; self.erase = erase
    }

    /// The web's `DEFAULT_BRUSH_TOOL`.
    public static let `default` = BrushTool()
}

/// The Size slider's reach — the web's `0.01…0.8`, step `0.005`.
public let brushRadiusLimits = (min: 0.01, max: 0.8)

/// How far the hand must move before a stroke takes another point: closer
/// points add nothing the radius does not already cover, and every one of
/// them is rasterised again. The web's `Math.max(0.004, radius * 0.12)`,
/// compared in the frame's shares as the web does.
public func strokeStep(_ radius: Double) -> Double {
    max(0.004, radius * 0.12)
}

/// A press on the picture starts a stroke of the tool's settings — nil when
/// the mask already holds `maxStrokes`.
public func beginStroke(_ mask: BrushMask, at p: Point, tool: BrushTool) -> BrushMask? {
    if mask.strokes.count >= maxStrokes { return nil }
    var out = mask
    out.strokes.append(BrushStroke(points: [p], radius: tool.radius, hardness: tool.hardness, erase: tool.erase))
    return out
}

/// The hand moved: the LAST stroke grows by `p` — nil when there is no stroke
/// or the point is closer than `strokeStep` to the last one (nothing to write).
public func continueStroke(_ mask: BrushMask, to p: Point) -> BrushMask? {
    guard var live = mask.strokes.last, let last = live.points.last else { return nil }
    if hypot(p.x - last.x, p.y - last.y) < strokeStep(live.radius) { return nil }
    live.points.append(p)
    var out = mask
    out.strokes[out.strokes.count - 1] = live
    return out
}

/// "Undo stroke": the last one taken off.
public func withoutLastStroke(_ mask: BrushMask) -> BrushMask {
    BrushMask(strokes: Array(mask.strokes.dropLast()))
}

// MARK: - taps: a subject's points, a colour range's samples

/// How near a marker a tap must land to take it off, in the frame's shares —
/// the web's `SUBJECT_HIT_RADIUS`.
public let subjectHitRadius = 0.04

/// The first marker within `subjectHitRadius` of `p`, or nil.
public func markHit(_ marks: [Point], _ p: Point) -> Int? {
    marks.firstIndex { hypot($0.x - p.x, $0.y - p.y) < subjectHitRadius }
}

/// The points a mask shows on the stage — a subject's taps, a colour range's
/// samples — or nil for a kind that has none.
public func maskMarks(_ mask: Mask?) -> [Point]? {
    switch mask {
    case .subject(let s)?: return s.points
    case .colour(let c)?: return c.samples.map { Point($0.x, $0.y) }
    default: return nil
    }
}

/// A tap on a subject: on a point, that point comes off (how a subject is
/// narrowed after the model took in too much); anywhere else, a point is added.
public func tapSubject(_ mask: SubjectMask, at p: Point) -> SubjectMask {
    var out = mask
    if let hit = markHit(mask.points, p) {
        out.points.remove(at: hit)
    } else {
        out.points.append(p)
    }
    return out
}

/// A tap on a colour range: on a sample, it comes off; anywhere else the
/// colour there (`rgb`, ENCODED 0…1, as the layer sees it) is added — nil
/// when nothing changes (no colour could be read, or the range is full).
public func tapColour(_ mask: ColourMask, at p: Point, rgb: (Double, Double, Double)?) -> ColourMask? {
    let marks = mask.samples.map { Point($0.x, $0.y) }
    if let hit = markHit(marks, p) {
        var out = mask
        out.samples.remove(at: hit)
        return out
    }
    guard let rgb, mask.samples.count < maxColourSamples else { return nil }
    var out = mask
    out.samples.append(ColourSample(x: clamp01(p.x), y: clamp01(p.y), r: clamp01(rgb.0), g: clamp01(rgb.1), b: clamp01(rgb.2)))
    return out
}

/// One marker taken off, by index — the stage's marker answering its own press.
public func unmark(_ mask: Mask, _ index: Int) -> Mask {
    switch mask {
    case .subject(var s):
        if s.points.indices.contains(index) { s.points.remove(at: index) }
        return .subject(s)
    case .colour(var c):
        if c.samples.indices.contains(index) { c.samples.remove(at: index) }
        return .colour(c)
    default:
        return mask
    }
}

/// A brightness band moved to sit ON a luma the author tapped, its width kept
/// and the band kept inside 0…1 — sampling a tone off the picture.
public func centreLumaBand(_ mask: LumaMask, on luma: Double) -> LumaMask {
    let width = max(0, min(1, mask.to - mask.from))
    let from = max(0, min(1 - width, clamp01(luma) - width / 2))
    var out = mask
    out.from = roundTo(from, 100)
    out.to = roundTo(min(1, from + width), 100)
    return out
}

// MARK: - the centred space

/// A point of the frame's shares in the centred space every shape is measured
/// in — `framePoint`, as a `Point`.
public func maskCentred(_ p: Point, _ aspectRatio: Double) -> Point {
    let (x, y) = framePoint(p.x, p.y, aspectRatio)
    return Point(x, y)
}

/// The other way: a centred point back in the frame's shares.
public func maskShares(_ c: Point, _ aspectRatio: Double) -> Point {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let d = hypot(ar, 1)
    return Point((c.x * d) / (2 * ar) + 0.5, (c.y * d) / 2 + 0.5)
}

private func roundTo(_ v: Double, _ per: Double) -> Double {
    let r = (v * per).rounded() / per
    return r == 0 ? 0 : r
}

private func degrees(_ radians: Double) -> Double {
    radians * 180 / Double.pi
}

private func radians(_ degrees: Double) -> Double {
    degrees * Double.pi / 180
}

/// A bearing in −180…180, rounded to a tenth of a degree.
private func bearing(_ deg: Double) -> Double {
    var a = deg.truncatingRemainder(dividingBy: 360)
    if a > 180 { a -= 360 }
    if a < -180 { a += 360 }
    return roundTo(a, 10)
}

// MARK: - a linear gradient's guides

/// How far a guide line runs each way from its centre, in centred units — past
/// the frame's corners (radius 1) whatever the angle, so the view only clips.
public let maskGuideReach = 3.0

/// Where the turn handle and the feather bars sit off a gradient's centre, in
/// centred units: far enough apart for a finger, near enough to read as one tool.
public let maskHandleOffset = 0.18

/// A linear mask as the stage draws it, every point in the frame's shares:
/// the FULL line (the mask reads 1 from there on, the covered side), the MID
/// line (0.5, where the angle is measured), the NONE line (0 from there),
/// and the handles — the centre moves it, the turn handle on the mid line
/// turns it, a bar on each edge line sets the feather.
public struct LinearGuides: Equatable, Sendable {
    public var centre: Point
    public var fullFrom: Point
    public var fullTo: Point
    public var midFrom: Point
    public var midTo: Point
    public var noneFrom: Point
    public var noneTo: Point
    public var turn: Point
    public var fullHandle: Point
    public var noneHandle: Point
}

/// Which handle of a gradient the hand holds.
public enum MaskHandle: String, Sendable, CaseIterable {
    case centre, turn, full, none, radiusX, radiusY, feather
}

public func linearGuides(_ m: LinearMask, _ aspectRatio: Double) -> LinearGuides {
    let c = maskCentred(Point(m.x, m.y), aspectRatio)
    let a = radians(m.angle)
    // The covered side's direction (a compass bearing: 0 is UP the frame) and
    // the line's own direction across it.
    let dir = Point(sin(a), -cos(a))
    let along = Point(cos(a), sin(a))
    let half = max(m.feather, 0) / 2
    let reach = maskGuideReach
    func at(_ d: Double, _ t: Double) -> Point {
        let x = c.x + dir.x * d + along.x * t
        let y = c.y + dir.y * d + along.y * t
        return maskShares(Point(x, y), aspectRatio)
    }
    let off = maskHandleOffset
    return LinearGuides(
        centre: Point(m.x, m.y),
        fullFrom: at(half, -reach), fullTo: at(half, reach),
        midFrom: at(0, -reach), midTo: at(0, reach),
        noneFrom: at(-half, -reach), noneTo: at(-half, reach),
        turn: at(0, off),
        fullHandle: at(half, -off),
        noneHandle: at(-half, -off)
    )
}

/// A handle of a linear mask dragged to `p` (the frame's shares): the turn
/// handle sets the angle to point the mid line at the hand; an edge bar sets
/// the feather to twice the hand's distance from the mid line along the
/// covered direction (never negative). The centre is `moveMask`'s.
public func dragLinear(_ m: LinearMask, _ handle: MaskHandle, to p: Point, _ aspectRatio: Double) -> LinearMask {
    let c = maskCentred(Point(m.x, m.y), aspectRatio)
    let q = maskCentred(p, aspectRatio)
    let dx = q.x - c.x
    let dy = q.y - c.y
    var out = m
    switch handle {
    case .turn:
        guard hypot(dx, dy) > 1e-6 else { return m }
        out.angle = bearing(degrees(atan2(dy, dx)))
    case .full, .none:
        let a = radians(m.angle)
        let across = dx * sin(a) + dy * -cos(a)
        let signed = handle == .full ? across : -across
        out.feather = roundTo(min(1.5, max(0, 2 * signed)), 1000)
    default:
        return m
    }
    return out
}

// MARK: - a radial mask's guides

/// A radial mask as the stage draws it, in the frame's shares: the ELLIPSE
/// (fully affected inside), the feather RING (the mask reaches 0 there, the
/// ellipse scaled by 1 + feather), and the handles — the centre, one on each
/// half-axis, one on the ring, and the turn handle past the top of the ring.
public struct RadialGuides: Equatable, Sendable {
    public var centre: Point
    public var ellipse: [Point]
    public var ring: [Point]
    public var radiusX: Point
    public var radiusY: Point
    public var feather: Point
    public var turn: Point
}

public func radialGuides(_ m: RadialMask, _ aspectRatio: Double, segments: Int = 72) -> RadialGuides {
    let c = maskCentred(Point(m.x, m.y), aspectRatio)
    let a = radians(m.angle)
    let cosA = cos(a)
    let sinA = sin(a)
    let rx = max(m.radiusX, 1e-6)
    let ry = max(m.radiusY, 1e-6)
    let grow = 1 + max(m.feather, 0)
    // The ellipse's own frame back into the centred space: `maskAt`'s turn, undone.
    func local(_ lx: Double, _ ly: Double) -> Point {
        let x = c.x + lx * cosA - ly * sinA
        let y = c.y + lx * sinA + ly * cosA
        return maskShares(Point(x, y), aspectRatio)
    }
    let n = max(8, segments)
    var ellipse: [Point] = []
    var ring: [Point] = []
    ellipse.reserveCapacity(n + 1)
    ring.reserveCapacity(n + 1)
    for i in 0...n {
        let t = Double(i) / Double(n) * 2 * Double.pi
        ellipse.append(local(rx * cos(t), ry * sin(t)))
        ring.append(local(rx * grow * cos(t), ry * grow * sin(t)))
    }
    let diagonal = 1 / 2.0.squareRoot()
    return RadialGuides(
        centre: Point(m.x, m.y),
        ellipse: ellipse,
        ring: ring,
        radiusX: local(rx, 0),
        radiusY: local(0, ry),
        feather: local(rx * grow * diagonal, ry * grow * diagonal),
        turn: local(0, -(ry * grow + maskHandleOffset))
    )
}

/// A handle of a radial mask dragged to `p` (the frame's shares): a half-axis
/// handle sets that radius to the hand's distance along the ellipse's own
/// axis; the ring handle sets the feather to how far past the ellipse the
/// hand is (in the ellipse's own measure, `maskAt`'s); the turn handle turns
/// the ellipse so its top points at the hand.
public func dragRadial(_ m: RadialMask, _ handle: MaskHandle, to p: Point, _ aspectRatio: Double) -> RadialMask {
    let c = maskCentred(Point(m.x, m.y), aspectRatio)
    let q = maskCentred(p, aspectRatio)
    let ox = q.x - c.x
    let oy = q.y - c.y
    let a = radians(m.angle)
    let lx = ox * cos(a) + oy * sin(a)
    let ly = -ox * sin(a) + oy * cos(a)
    var out = m
    switch handle {
    case .radiusX:
        out.radiusX = roundTo(min(1.5, max(0.02, abs(lx))), 1000)
    case .radiusY:
        out.radiusY = roundTo(min(1.5, max(0.02, abs(ly))), 1000)
    case .feather:
        let e = hypot(lx / max(m.radiusX, 1e-6), ly / max(m.radiusY, 1e-6))
        out.feather = roundTo(min(1.5, max(0, e - 1)), 1000)
    case .turn:
        guard hypot(ox, oy) > 1e-6 else { return m }
        out.angle = bearing(degrees(atan2(ox, -oy)))
    default:
        return m
    }
    return out
}

/// A gradient's centre moved by `du`, `dv` of the frame, held inside it (the
/// panel's Across / Down sliders read 0…1). Every other kind is returned as it is.
public func moveMask(_ mask: Mask, du: Double, dv: Double) -> Mask {
    switch mask {
    case .linear(var m):
        m.x = roundTo(clamp01(m.x + du), 1000)
        m.y = roundTo(clamp01(m.y + dv), 1000)
        return .linear(m)
    case .radial(var m):
        m.x = roundTo(clamp01(m.x + du), 1000)
        m.y = roundTo(clamp01(m.y + dv), 1000)
        return .radial(m)
    default:
        return mask
    }
}

/// A gradient's handle dragged — `dragLinear` or `dragRadial` by the mask's kind.
public func dragMaskHandle(_ mask: Mask, _ handle: MaskHandle, to p: Point, _ aspectRatio: Double) -> Mask {
    switch mask {
    case .linear(let m): return .linear(dragLinear(m, handle, to: p, aspectRatio))
    case .radial(let m): return .radial(dragRadial(m, handle, to: p, aspectRatio))
    default: return mask
    }
}

// MARK: - the list: a copy, a name

/// The longest name a layer keeps — `normaliseLayer`'s cap.
public let layerNameLimit = 80

/// A layer's name as the list writes it: trimmed, capped; empty means "describe the mask".
public func renameLayer(_ layers: [AdjustLayer]?, _ id: String, _ name: String) -> [AdjustLayer] {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return patchLayer(layers, id) { $0.name = String(trimmed.prefix(layerNameLimit)) }
}

/// A layer COPIED, placed just above the one it copies — a new id, the same
/// mask, develop and opacity, named after what it copies so the two rows are
/// told apart. Capped at `maxLayers`; nil when there is no room or no layer.
public func duplicateLayer(_ layers: [AdjustLayer]?, _ id: String, newId: String = newLayerId()) -> (layers: [AdjustLayer], id: String)? {
    var list = layers ?? []
    guard list.count < maxLayers, let at = list.firstIndex(where: { $0.id == id }) else { return nil }
    var copy = list[at]
    copy.id = newId
    let label = layerLabel(list[at], list)
    copy.name = String("\(label) copy".prefix(layerNameLimit))
    list.insert(copy, at: at + 1)
    return (list, newId)
}
