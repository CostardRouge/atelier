// SHADES — the darkening laid over a picture so type stays readable on it, as
// the trip document stores them. Port of the stored half of
// `src/shared/roadtrip/shades.ts`: one shade's record, its factory, the
// classic vignette, and the reader/writer.
//
// Types + reader only; the behaviour of `shades.ts` (the 3×3 grid, the follow
// modes, the stops and the sampled fades, the gradient a shade draws) is
// `ShadeGradient.swift`.
//
// Rules kept:
// - One model for what used to be a vignette and a scrim: a DIRECTION, how
//   far it REACHES, how strong, what colour, whether INVERTED, whether it
//   follows the badge.
// - Every field added after the first shades were stored is OPTIONAL and its
//   absence draws exactly what was drawn before: `followAnchor` and `enabled`
//   (absent = off and ON — read `enabled != false`, never `!enabled`), and the
//   2026-09-23 FADE — `falloff` (absent = `soft`, the three historical stops),
//   `core` (absent = 0) and `center` (absent = the middle of the frame).
//   The reader keeps absent absent, so a stored shade writes back as it was.
// - A key this port does not know is CARRIED through untouched.

import Foundation

/// Where a shade is anchored, and which way it travels.
public enum ShadeDirection: String, CaseIterable, Sendable {
    /// Opaque at that edge, fading inward.
    case top, bottom, left, right
    /// Opaque across the middle, fading to both top and bottom.
    case middleVertical = "middle-vertical"
    /// Opaque across the middle, fading to both left and right.
    case middleHorizontal = "middle-horizontal"
    /// Opaque at the centre, fading outward in a circle.
    case radial
    /// Opaque in that corner, fading outward in a quarter circle.
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"
}

/// The curve a shade's fade follows. `soft` is the historical shape; the
/// others are ids of the suite's one curve registry (`Motion/Easing.swift`).
public enum ShadeFalloff: String, CaseIterable, Sendable {
    case soft
    case linear
    case inOut = "in-out"
    case inCubic = "in-cubic"
    case outCubic = "out-cubic"
}

public struct Shade: Equatable, Sendable {
    public var id: String
    public var direction: ShadeDirection
    /// How far the fade travels, as a fraction of the frame.
    public var reach: Double
    /// Peak opacity, 0..1.
    public var strength: Double
    public var color: String
    /// Dark at the FAR end of the reach instead of at the anchor.
    public var invert: Bool
    /// Take the reach (and, for a radial, the centre) from the badge block.
    public var followHook: Bool
    /// Take the position from the badge's anchor as well. Absent = off.
    public var followAnchor: Bool?
    /// Off keeps the shade in the stack but skips it. Absent = ON.
    public var enabled: Bool?
    /// How the shade fades from its strength to clear. Absent = `soft`.
    public var falloff: ShadeFalloff?
    /// The part of the reach held at FULL strength, 0..0.9. Absent = 0.
    public var core: Double?
    /// Where a band or a radial is centred, in frame fractions. Absent = the middle.
    public var center: Point?
    /// Keys this port does not know, written back verbatim.
    public var carried: [String: JSONValue]

    public init(id: String, direction: ShadeDirection = .bottom, reach: Double = 0.55, strength: Double = 0.65,
                color: String = "#000000", invert: Bool = false, followHook: Bool = false,
                followAnchor: Bool? = nil, enabled: Bool? = nil, falloff: ShadeFalloff? = nil,
                core: Double? = nil, center: Point? = nil, carried: [String: JSONValue] = [:]) {
        self.id = id; self.direction = direction; self.reach = reach; self.strength = strength; self.color = color
        self.invert = invert; self.followHook = followHook; self.followAnchor = followAnchor; self.enabled = enabled
        self.falloff = falloff; self.core = core; self.center = center; self.carried = carried
    }

    /// The shade as the document holds it: the optional fields only when set.
    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["direction"] = .string(direction.rawValue)
        o["reach"] = .number(reach)
        o["strength"] = .number(strength)
        o["color"] = .string(color)
        o["invert"] = .bool(invert)
        o["followHook"] = .bool(followHook)
        if let followAnchor { o["followAnchor"] = .bool(followAnchor) }
        if let enabled { o["enabled"] = .bool(enabled) }
        if let falloff { o["falloff"] = .string(falloff.rawValue) }
        if let core { o["core"] = .number(core) }
        if let center { o["center"] = .object(["x": .number(center.x), "y": .number(center.y)]) }
        return .object(o)
    }
}

/// More than a handful stops being a treatment and starts being a paint job.
public let maxShades = 4

/// A fresh shade: from the bottom, a little over half the frame, 65 %, black,
/// following nothing, on. Every argument overrides one field, the web's
/// `createShade({ … })`.
public func createShade(id: String = newTripId(), direction: ShadeDirection = .bottom, reach: Double = 0.55,
                        strength: Double = 0.65, color: String = "#000000", invert: Bool = false,
                        followHook: Bool = false, followAnchor: Bool? = false, enabled: Bool? = true,
                        falloff: ShadeFalloff? = nil, core: Double? = nil, center: Point? = nil) -> Shade {
    Shade(id: id, direction: direction, reach: reach, strength: strength, color: color, invert: invert,
          followHook: followHook, followAnchor: followAnchor, enabled: enabled, falloff: falloff, core: core, center: center)
}

/// The classic corner vignette: a radial, inverted, reaching the corners.
public func vignetteShade(_ strength: Double, color: String = "#000000", id: String = newTripId()) -> Shade {
    createShade(id: id, direction: .radial, reach: 1, strength: strength, color: color, invert: true)
}

private let shadeKeys: Set<String> = [
    "id", "direction", "reach", "strength", "color", "invert", "followHook",
    "followAnchor", "enabled", "falloff", "core", "center",
]

/// A stored shade read back, or nil when it is not a record. A reach or a
/// strength that is not a finite number is 0 — what the web DRAWS for one
/// (`clamp01`'s fallback), so a junk shade draws nothing here either; any
/// other missing or junk field takes the factory's value; an optional one
/// stays absent; a shade with no id is given one.
public func readShade(_ raw: JSONValue?, makeId: () -> String = newTripId) -> Shade? {
    guard let o = raw?.objectValue else { return nil }
    var shade = Shade(id: o["id"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? makeId())
    shade.direction = o["direction"]?.stringValue.flatMap(ShadeDirection.init(rawValue:)) ?? .bottom
    shade.reach = o["reach"]?.finiteNumber ?? 0
    shade.strength = o["strength"]?.finiteNumber ?? 0
    shade.color = o["color"]?.stringValue ?? "#000000"
    shade.invert = o["invert"]?.boolValue == true
    shade.followHook = o["followHook"]?.boolValue == true
    shade.followAnchor = o["followAnchor"]?.boolValue
    shade.enabled = o["enabled"]?.boolValue
    shade.falloff = o["falloff"]?.stringValue.flatMap(ShadeFalloff.init(rawValue:))
    shade.core = o["core"]?.finiteNumber
    if let c = o["center"]?.objectValue {
        shade.center = Point(c["x"]?.finiteNumber ?? 0.5, c["y"]?.finiteNumber ?? 0.5)
    }
    for (key, value) in o where !shadeKeys.contains(key) { shade.carried[key] = value }
    return shade
}

/// A stored stack read back; anything that is not a shade is left out.
public func readShades(_ raw: JSONValue?, makeId: () -> String = newTripId) -> [Shade] {
    (raw?.arrayValue ?? []).compactMap { readShade($0, makeId: makeId) }
}

/// The badge block's vertical extent, in fractions of the frame's height —
/// what a shade following the hook ends at (`badgeBlockExtent` measures it).
public struct HookBlock: Equatable, Sendable {
    public var top: Double
    public var bottom: Double
    /// The badge's grid anchor, what `followAnchor` places a shade by.
    public var anchor: OverlayAnchor?

    public init(top: Double, bottom: Double, anchor: OverlayAnchor? = nil) {
        self.top = top; self.bottom = bottom; self.anchor = anchor
    }
}
