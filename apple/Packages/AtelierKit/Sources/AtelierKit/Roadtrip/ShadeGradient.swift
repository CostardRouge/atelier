// The gradient a shade DRAWS — the behaviour half of
// `src/shared/roadtrip/shades.ts` that `Shades.swift` (the stored half) left
// for later: the 3×3 grid a direction is picked on, the follow modes, the
// fade's shape (falloff, core, centre), the stops and the geometry. The paint
// is the app's (`Trips/Paint/ShadePainter.swift`), which only turns these
// fractions into pixels — so the stage, the PNG deck and a burned-in clip draw
// the same darkening.
//
// Rules kept:
// - A shade that paints nothing is ABSENT (`nil`), never transparent: a
//   zero-alpha fill still costs a composite on every exported frame.
// - A MIRRORED shade (a middle band) runs edge to edge about its centre, the
//   peak in the middle: a canvas gradient holds its end colour past its
//   endpoints, and a band drawn centre→edge blacked out the whole far half
//   (measured in a browser).
// - With none of the three fade fields set, the stops are the historical
//   literal list, never a close resampling of it: a stored shade must not move
//   by a code value the day the fields ship.
// - A band moved off the middle may run PAST the frame's edge: clamping an end
//   would drag its peak off the centre it was given.
// - Following the anchor takes the badge's CELL, keeping the shade's own
//   direction underneath; no anchor to follow falls back to its own.

import Foundation

// MARK: - the vocabulary

/// One direction as a picker offers it. The web's `SHADE_DIRECTIONS` entry.
public struct ShadeDirectionEntry: Equatable, Sendable {
    public var id: ShadeDirection
    public var label: String
    public var hint: String

    public init(id: ShadeDirection, label: String, hint: String) {
        self.id = id; self.label = label; self.hint = hint
    }
}

/// Every direction, in the web's order, with its words.
public let shadeDirections: [ShadeDirectionEntry] = [
    ShadeDirectionEntry(id: .bottom, label: "From the bottom", hint: "Dark along the bottom edge"),
    ShadeDirectionEntry(id: .top, label: "From the top", hint: "Dark along the top edge"),
    ShadeDirectionEntry(id: .left, label: "From the left", hint: "Dark along the left edge"),
    ShadeDirectionEntry(id: .right, label: "From the right", hint: "Dark along the right edge"),
    ShadeDirectionEntry(id: .middleVertical, label: "Middle band ↕",
                        hint: "Dark across the middle, clearing toward top and bottom"),
    ShadeDirectionEntry(id: .middleHorizontal, label: "Middle band ↔",
                        hint: "Dark across the middle, clearing toward both sides"),
    ShadeDirectionEntry(id: .radial, label: "Radial", hint: "Dark at the centre, clearing outward"),
    ShadeDirectionEntry(id: .topLeft, label: "Top-left corner", hint: "Dark in the corner, clearing outward"),
    ShadeDirectionEntry(id: .topRight, label: "Top-right corner", hint: "Dark in the corner, clearing outward"),
    ShadeDirectionEntry(id: .bottomLeft, label: "Bottom-left corner", hint: "Dark in the corner, clearing outward"),
    ShadeDirectionEntry(id: .bottomRight, label: "Bottom-right corner", hint: "Dark in the corner, clearing outward"),
]

/// One cell of the 3×3 grid and the shapes it holds. The web's `SHADE_GRID` entry.
public struct ShadeGridCell: Equatable, Sendable {
    public var cell: OverlayAnchor
    public var shapes: [ShadeDirection]

    public init(cell: OverlayAnchor, shapes: [ShadeDirection]) {
        self.cell = cell; self.shapes = shapes
    }
}

/// The grid a direction is picked on, in reading order, cell for cell the
/// badge's own anchor grid. Every cell holds one shape except the centre,
/// which holds three: a band crosses the frame, so no single cell could stand
/// for it.
public let shadeGrid: [ShadeGridCell] = [
    ShadeGridCell(cell: .topLeft, shapes: [.topLeft]),
    ShadeGridCell(cell: .topCenter, shapes: [.top]),
    ShadeGridCell(cell: .topRight, shapes: [.topRight]),
    ShadeGridCell(cell: .centerLeft, shapes: [.left]),
    ShadeGridCell(cell: .center, shapes: [.radial, .middleVertical, .middleHorizontal]),
    ShadeGridCell(cell: .centerRight, shapes: [.right]),
    ShadeGridCell(cell: .bottomLeft, shapes: [.bottomLeft]),
    ShadeGridCell(cell: .bottomCenter, shapes: [.bottom]),
    ShadeGridCell(cell: .bottomRight, shapes: [.bottomRight]),
]

/// The grid cell a direction lives in.
public func shadeCell(_ direction: ShadeDirection) -> OverlayAnchor {
    shadeGrid.first { $0.shapes.contains(direction) }?.cell ?? .center
}

/// The direction a shade draws in the cell `anchor`: its own when that
/// already lives there (a band stays a band under a centred badge), otherwise
/// the cell's first shape.
public func directionInCell(_ anchor: OverlayAnchor, _ own: ShadeDirection) -> ShadeDirection {
    let cell = shadeGrid.first { $0.cell == anchor } ?? shadeGrid[4]
    return cell.shapes.contains(own) ? own : cell.shapes[0]
}

/// How a shade takes after the badge — nothing, its edge, or its anchor too.
public enum ShadeFollow: String, CaseIterable, Sendable {
    case none, edge, anchor
}

public func shadeFollow(_ shade: Shade) -> ShadeFollow {
    if shade.followAnchor == true { return .anchor }
    return shade.followHook ? .edge : .none
}

/// The two stored flags a follow mode writes.
public func followFlags(_ follow: ShadeFollow) -> (followHook: Bool, followAnchor: Bool) {
    (follow == .edge, follow == .anchor)
}

/// The direction a shade really draws with the badge in hand: under
/// `followAnchor`, the badge's cell; otherwise its own — and its own too when
/// there is no anchor to follow, never nothing.
public func resolvedDirection(_ shade: Shade, _ block: HookBlock?) -> ShadeDirection {
    if shade.followAnchor == true, let anchor = block?.anchor {
        return directionInCell(anchor, shade.direction)
    }
    return shade.direction
}

/// Whether the badge sets this direction's reach, so its slider does nothing:
/// only the top and bottom edges land on the block, measured vertically.
public func reachFollowsBadge(_ direction: ShadeDirection, _ follow: ShadeFollow) -> Bool {
    follow != .none && (direction == .top || direction == .bottom)
}

// MARK: - the fade's shape

/// One falloff as a picker offers it. The web's `SHADE_FALLOFFS` entry.
public struct ShadeFalloffEntry: Equatable, Sendable {
    public var id: ShadeFalloff
    public var label: String
    public var hint: String

    public init(id: ShadeFalloff, label: String, hint: String) {
        self.id = id; self.label = label; self.hint = hint
    }
}

public let shadeFalloffs: [ShadeFalloffEntry] = [
    ShadeFalloffEntry(id: .soft, label: "Soft", hint: "Falls to a third past halfway, then clears — the classic shade"),
    ShadeFalloffEntry(id: .linear, label: "Linear", hint: "An even fade from strength to clear"),
    ShadeFalloffEntry(id: .inOut, label: "Smooth", hint: "Holds, glides through the middle, settles — no visible start or end"),
    ShadeFalloffEntry(id: .inCubic, label: "Held", hint: "Stays dark most of the way, then clears quickly"),
    ShadeFalloffEntry(id: .outCubic, label: "Quick", hint: "Lets go fast, then trails off gently"),
]

/// The most of a reach a core may hold: a fade needs somewhere to happen. The web's `MAX_CORE`.
public let maxShadeCore = 0.9

/// `clamp01` with the web's fallback for a value that is not a finite number.
private func shadeUnit(_ value: Double, _ fallback: Double = 0) -> Double {
    guard value.isFinite else { return fallback }
    return min(1, max(0, value))
}

/// The falloff a shade really draws with: absent is `soft` (an unknown value
/// is already absent — the reader keeps only the five it knows).
public func shadeFalloff(_ shade: Shade) -> ShadeFalloff {
    shade.falloff ?? .soft
}

/// The core a shade really holds, clamped: absent or not a number is 0.
public func shadeCore(_ shade: Shade) -> Double {
    guard let c = shade.core, c.isFinite else { return 0 }
    return min(maxShadeCore, max(0, c))
}

/// The centre a shade is placed by, clamped to the frame: absent is the middle.
public func shadeCentre(_ shade: Shade) -> Point {
    Point(shadeUnit(shade.center?.x ?? 0.5, 0.5), shadeUnit(shade.center?.y ?? 0.5, 0.5))
}

/// Which axis of a shade's centre the author can move.
public enum ShadeCentreAxis: String, Sendable {
    case x, y, both
}

/// Which axis of a shade's centre the author can move, if any: a vertical
/// band up and down, a horizontal one sideways, a radial anywhere — unless it
/// follows the badge, which then places it. An edge and a corner ARE their
/// position.
public func centreMovable(_ direction: ShadeDirection, _ follow: ShadeFollow) -> ShadeCentreAxis? {
    switch direction {
    case .middleVertical: return .y
    case .middleHorizontal: return .x
    case .radial: return follow == .none ? .both : nil
    default: return nil
    }
}

// MARK: - the gradient

/// One stop of a gradient: where along it, and how opaque there.
public struct ShadeStop: Equatable, Sendable {
    public var at: Double
    public var alpha: Double

    public init(at: Double, alpha: Double) { self.at = at; self.alpha = alpha }
}

/// A linear gradient in FRACTIONS of the frame (0,0 top-left to 1,1).
public struct LinearShade: Equatable, Sendable {
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double
    public var stops: [ShadeStop]
}

/// A radial gradient; radii are fractions of the frame's SHORTER side, so a
/// radial keeps its shape on a 9:16 frame instead of turning into a stripe.
public struct RadialShade: Equatable, Sendable {
    public var cx: Double
    public var cy: Double
    public var r0: Double
    public var r1: Double
    public var stops: [ShadeStop]
}

/// What a shade draws. The web's `ShadeGradient` union.
public enum ShadeGradient: Equatable, Sendable {
    case linear(LinearShade)
    case radial(RadialShade)

    public var stops: [ShadeStop] {
        switch self {
        case .linear(let g): return g.stops
        case .radial(let g): return g.stops
        }
    }
}

/// Stops across the fade: a curve a canvas draws between them is linear.
private let shadeFadeSamples = 16

/// How much of the strength has GONE at `u` (0..1) through the fade. `soft`
/// is the historical three-stop shape written as a curve — 65 % gone at its
/// knee, 0.55 of an edge's run and 0.5 of a band's half.
private func shadeFadeGone(_ falloff: ShadeFalloff, _ u: Double, _ mirrored: Bool) -> Double {
    if falloff == .soft {
        let knee = mirrored ? 0.5 : 0.55
        return u <= knee ? (u / knee) * 0.65 : 0.65 + ((u - knee) / (1 - knee)) * 0.35
    }
    return min(1, max(0, curveOf(falloff.rawValue).at(u, nil)))
}

/// The strength at `t` along a shade's run, from where it is darkest to where
/// it clears. Inverted, the run is read from the other end.
private func shadeStrengthAt(_ s: Double, _ t: Double, _ invert: Bool, _ mirrored: Bool,
                             _ falloff: ShadeFalloff, _ core: Double) -> Double {
    let r = invert ? 1 - t : t
    if r <= core { return s }
    let u = (r - core) / (1 - core)
    return s * (1 - shadeFadeGone(falloff, u, mirrored))
}

/// The run's sample points, dark end first: 0, the core's end and
/// `shadeFadeSamples` points across the fade — distinct and ascending, and
/// mirrored end for end when inverted.
private func shadeRunPoints(_ core: Double, _ invert: Bool) -> [Double] {
    var points: [Double] = [0]
    for j in 0...shadeFadeSamples {
        points.append(core + ((1 - core) * Double(j)) / Double(shadeFadeSamples))
    }
    let unique = Array(Set(points)).sorted()
    return invert ? Array(Set(unique.map { 1 - $0 })).sorted() : unique
}

private func shadeSampledStops(_ s: Double, _ invert: Bool, _ mirrored: Bool, _ falloff: ShadeFalloff,
                               _ core: Double) -> [ShadeStop] {
    let points = shadeRunPoints(core, invert)
    func alpha(_ t: Double) -> Double { shadeStrengthAt(s, t, invert, mirrored, falloff, core) }
    if !mirrored { return points.map { ShadeStop(at: $0, alpha: alpha($0)) } }
    // A band runs EDGE TO EDGE about its centre: the run laid out twice from
    // 0.5, the left half reversed, the centre shared.
    let right = points.map { ShadeStop(at: 0.5 + $0 / 2, alpha: alpha($0)) }
    let left = points.filter { $0 > 0 }.map { ShadeStop(at: 0.5 - $0 / 2, alpha: alpha($0)) }.reversed()
    return Array(left) + right
}

/// The stops a shade fades through: opaque end, an eased middle, clear end —
/// the historical literal list for a soft shade with no core.
private func shadeStops(_ strength: Double, _ invert: Bool, _ mirrored: Bool, _ falloff: ShadeFalloff,
                        _ core: Double) -> [ShadeStop] {
    let s = shadeUnit(strength)
    if falloff != .soft || core > 0 { return shadeSampledStops(s, invert, mirrored, falloff, core) }

    if mirrored {
        let peak = invert ? 0 : s
        let ends = invert ? s : 0
        return [
            ShadeStop(at: 0, alpha: ends),
            ShadeStop(at: 0.25, alpha: s * 0.35),
            ShadeStop(at: 0.5, alpha: peak),
            ShadeStop(at: 0.75, alpha: s * 0.35),
            ShadeStop(at: 1, alpha: ends),
        ]
    }
    let ramp = [
        ShadeStop(at: 0, alpha: s),
        ShadeStop(at: 0.55, alpha: s * 0.35),
        ShadeStop(at: 1, alpha: 0),
    ]
    if !invert { return ramp }
    // Inverted: clear at the anchor, opaque at the far end of the reach.
    return ramp.map { ShadeStop(at: 1 - $0.at, alpha: $0.alpha) }.reversed()
}

/// A corner's radial, as a fraction of the shorter side at full reach.
private let shadeCornerRadius = 1.2

private func shadeCorner(_ direction: ShadeDirection) -> Point? {
    switch direction {
    case .topLeft: return Point(0, 0)
    case .topRight: return Point(1, 0)
    case .bottomLeft: return Point(0, 1)
    case .bottomRight: return Point(1, 1)
    default: return nil
    }
}

private func shadeIsMirrored(_ direction: ShadeDirection) -> Bool {
    direction == .middleVertical || direction == .middleHorizontal
}

/// Where a shade following the hook ends: the block's own edge, with a margin
/// of its height so the fade starts clear of the first line.
private func shadeHookEnd(_ block: HookBlock?, top: Bool) -> Double? {
    guard let b = block else { return nil }
    let margin = max(b.bottom - b.top, 0.02) * 0.35
    return top ? shadeUnit(b.bottom + margin) : shadeUnit(1 - max(0, b.top - margin))
}

/// Where a linear shade runs from and to, in frame fractions.
private func shadeLinearEnds(_ direction: ShadeDirection, _ reach: Double, _ block: HookBlock?,
                             _ centre: Point) -> (x0: Double, y0: Double, x1: Double, y1: Double) {
    let r = shadeUnit(reach)
    switch direction {
    case .middleVertical:
        return (0, centre.y - r / 2, 0, centre.y + r / 2)
    case .middleHorizontal:
        return (centre.x - r / 2, 0, centre.x + r / 2, 0)
    case .top:
        let to = shadeHookEnd(block, top: true) ?? r
        return (0, 0, 0, shadeUnit(to))
    case .bottom:
        let to = shadeHookEnd(block, top: false) ?? r
        return (0, 1, 0, shadeUnit(1 - to))
    case .left:
        return (0, 0, shadeUnit(r), 0)
    default:
        return (1, 0, shadeUnit(1 - r), 0)
    }
}

/// The gradient a shade draws, or nil when it would draw nothing (switched
/// off, no strength, or no reach at all).
public func shadeGradient(_ shade: Shade, _ block: HookBlock? = nil) -> ShadeGradient? {
    if shade.enabled == false { return nil }
    if shadeUnit(shade.strength) <= 0 { return nil }
    let direction = resolvedDirection(shade, block)
    let useHook = shadeFollow(shade) != .none ? block : nil
    let stops = shadeStops(shade.strength, shade.invert, shadeIsMirrored(direction), shadeFalloff(shade), shadeCore(shade))
    let centre = shadeCentre(shade)

    // A corner is a quarter of a circle centred ON the corner — a pool of
    // shade falling off like light.
    if let corner = shadeCorner(direction) {
        let reach = shadeUnit(shade.reach)
        if reach <= 0 { return nil }
        return .radial(RadialShade(cx: corner.x, cy: corner.y, r0: 0, r1: reach * shadeCornerRadius, stops: stops))
    }

    if direction == .radial {
        // Centred on the badge when it follows it; otherwise where the author
        // put it, the middle by default.
        let cx = useHook != nil ? 0.5 : centre.x
        let cy = useHook.map { shadeUnit(($0.top + $0.bottom) / 2) } ?? centre.y
        let reach = shadeUnit(shade.reach)
        if reach <= 0 { return nil }
        return .radial(RadialShade(cx: cx, cy: cy, r0: 0, r1: reach * 0.72, stops: stops))
    }

    if useHook == nil && shadeUnit(shade.reach) <= 0 { return nil }
    let ends = shadeLinearEnds(direction, shade.reach, useHook, centre)
    if ends.x0 == ends.x1 && ends.y0 == ends.y1 { return nil }
    return .linear(LinearShade(x0: ends.x0, y0: ends.y0, x1: ends.x1, y1: ends.y1, stops: stops))
}
