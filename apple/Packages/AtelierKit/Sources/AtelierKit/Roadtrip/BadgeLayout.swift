// The badge's PLACEMENT and its per-piece departures, as the trip document
// stores them — port of the stored half of `src/shared/roadtrip/badge-layout.ts`:
// where the block sits, how long the hook lasts, how one piece departs from
// the trip's theme, and the ONE cascaded entrance the pieces may share.
//
// Types + reader only; the behaviour of `badge-layout.ts` (the elements built
// for the overlay engine, the ratios, the block's extent, the drag, the settle
// time, the deterministic piece ids) is ported later INTO THIS FILE.
//
// Rules kept:
// - Every field of a piece's style is optional, and "absent" and "null" are
//   kept apart where the web writes both (an ink, a panel, an outline, an
//   animation reset to the theme's), so a style reads back as it was written.
// - A cascade is null unless it holds a step; its step is read by this
//   module's OWN `readAnimStep`, which differs on purpose from
//   `AnimStep(json:)` (`Overlay/Animation.swift`): junk lands as a plain half-
//   second fade on `out`, and neither a delay nor `inside` is read — a
//   cascade's delays are derived on every build, never stored.
// - A new hook lasts 2 s (the maintainer's call, 2026-09-24); a stored badge
//   that never said its duration READS as the old 4 s, so no composed piece is
//   re-timed.

import Foundation

/// Where the block sits and how big its numeral is.
public struct BadgeLayout: Equatable, Sendable {
    public var anchor: OverlayAnchor
    /// Anchor position in normalised frame coordinates.
    public var x: Double
    public var y: Double
    /// The HEADLINE's size, as a fraction of the frame's shorter side.
    public var sizeFrac: Double

    public init(anchor: OverlayAnchor, x: Double, y: Double, sizeFrac: Double) {
        self.anchor = anchor; self.x = x; self.y = y; self.sizeFrac = sizeFrac
    }

    public var json: JSONValue {
        .object(["anchor": .string(anchor.rawValue), "x": .number(x), "y": .number(y), "sizeFrac": .number(sizeFrac)])
    }
}

/// How long the hook lasts, in seconds — what an exit animation is laid against.
public let defaultBadgeDuration = 2.0

/// What a stored badge that never said its duration READS as.
public let legacyBadgeDuration = 4.0

/// The web's `DEFAULT_BADGE_LAYOUT`.
public let defaultBadgeLayout = BadgeLayout(anchor: .bottomLeft, x: 0.07, y: 0.9, sizeFrac: 0.17)

/// A stored layout read back; a missing or junk field takes the default's.
public func readBadgeLayout(_ raw: JSONValue?) -> BadgeLayout {
    let o = raw?.objectValue ?? [:]
    let d = defaultBadgeLayout
    return BadgeLayout(
        anchor: o["anchor"]?.stringValue.flatMap(OverlayAnchor.init(rawValue:)) ?? d.anchor,
        x: o["x"]?.finiteNumber ?? d.x,
        y: o["y"]?.finiteNumber ?? d.y,
        sizeFrac: o["sizeFrac"]?.finiteNumber ?? d.sizeFrac
    )
}

/// `as-is` follows the theme's own casing; the other two force it.
public enum BadgeTextCase: String, CaseIterable, Sendable {
    case asIs = "as-is"
    case upper
    case lower
}

/// How one piece departs from the trip's theme. Every field is optional; a
/// doubly optional one is absent (`.none`), written null (`.some(nil)`), or set.
public struct BadgePieceStyle: Equatable, Sendable {
    public var textCase: BadgeTextCase?
    /// Ink. Null or absent = the theme's colour.
    public var color: String??
    /// Panel fill behind the text. Null or absent = no panel.
    public var boxColor: String??
    /// Panel padding, as a fraction of the piece's font size.
    public var boxPadFrac: Double?
    /// Corner radius as a fraction of the padding (0 square, large = pill).
    public var boxRadiusFrac: Double?
    /// Panel outline. Null or absent = no outline.
    public var borderColor: String??
    public var borderWidthFrac: Double?
    /// Entrance and exit. Absent or null = the piece simply is there.
    public var animation: ElementAnimation??

    public init(textCase: BadgeTextCase? = nil, color: String?? = .none, boxColor: String?? = .none,
                boxPadFrac: Double? = nil, boxRadiusFrac: Double? = nil, borderColor: String?? = .none,
                borderWidthFrac: Double? = nil, animation: ElementAnimation?? = .none) {
        self.textCase = textCase; self.color = color; self.boxColor = boxColor; self.boxPadFrac = boxPadFrac
        self.boxRadiusFrac = boxRadiusFrac; self.borderColor = borderColor; self.borderWidthFrac = borderWidthFrac
        self.animation = animation
    }

    /// The style as the document holds it: only the keys it has, nulls as nulls.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        if let textCase { o["textCase"] = .string(textCase.rawValue) }
        putNullable(&o, "color", color.map { $0.map(JSONValue.string) })
        putNullable(&o, "boxColor", boxColor.map { $0.map(JSONValue.string) })
        if let boxPadFrac { o["boxPadFrac"] = .number(boxPadFrac) }
        if let boxRadiusFrac { o["boxRadiusFrac"] = .number(boxRadiusFrac) }
        putNullable(&o, "borderColor", borderColor.map { $0.map(JSONValue.string) })
        if let borderWidthFrac { o["borderWidthFrac"] = .number(borderWidthFrac) }
        putNullable(&o, "animation", animation.map { $0.map(\.json) })
        return .object(o)
    }
}

/// Every piece's departures, keyed by piece. The web's `BadgePieceStyles`.
public typealias BadgePieceStyles = [BadgePiece: BadgePieceStyle]

private func putNullable(_ o: inout [String: JSONValue], _ key: String, _ value: JSONValue??) {
    switch value {
    case .none: break
    case .some(.none): o[key] = .null
    case .some(.some(let v)): o[key] = v
    }
}

/// Absent, null, or a string — anything else is read as absent.
private func nullableString(_ raw: JSONValue?) -> String?? {
    guard let raw else { return .none }
    if raw.isNull { return .some(nil) }
    guard let s = raw.stringValue else { return .none }
    return .some(s)
}

/// A stored piece style read back — only what it holds, junk dropped.
public func readBadgePieceStyle(_ raw: JSONValue?) -> BadgePieceStyle {
    let o = raw?.objectValue ?? [:]
    var style = BadgePieceStyle()
    style.textCase = o["textCase"]?.stringValue.flatMap(BadgeTextCase.init(rawValue:))
    style.color = nullableString(o["color"])
    style.boxColor = nullableString(o["boxColor"])
    style.boxPadFrac = o["boxPadFrac"]?.finiteNumber
    style.boxRadiusFrac = o["boxRadiusFrac"]?.finiteNumber
    style.borderColor = nullableString(o["borderColor"])
    style.borderWidthFrac = o["borderWidthFrac"]?.finiteNumber
    if let a = o["animation"] {
        if a.isNull {
            style.animation = .some(nil)
        } else if let animation = ElementAnimation(json: a) {
            style.animation = .some(animation)
        }
    }
    return style
}

/// A stored record of piece styles read back; a key that names no piece, or a
/// value that is not a record, is left out.
public func readBadgePieceStyles(_ raw: JSONValue?) -> BadgePieceStyles {
    var out: BadgePieceStyles = [:]
    for (key, value) in raw?.objectValue ?? [:] {
        guard let piece = BadgePiece(rawValue: key), value.objectValue != nil else { continue }
        out[piece] = readBadgePieceStyle(value)
    }
    return out
}

/// The piece styles as the document holds them.
public func badgePieceStylesJSON(_ styles: BadgePieceStyles) -> JSONValue {
    var o: [String: JSONValue] = [:]
    for (piece, style) in styles { o[piece.rawValue] = style.json }
    return .object(o)
}

/// ONE entrance for every piece, spread over time by where the pieces sit
/// (`Overlay/Stagger.swift`). It replaces each piece's own entrance while it
/// is set; a piece's EXIT stays its own.
public struct BadgeCascade: Equatable, Sendable {
    public var step: AnimStep
    public var stagger: Stagger

    public init(step: AnimStep, stagger: Stagger) {
        self.step = step
        self.stagger = stagger
    }

    public var json: JSONValue {
        .object(["step": step.json, "stagger": stagger.json])
    }
}

/// Read an animation step out of anything; junk lands as a plain fade. The
/// badge's (and the collage's) own reading — `AnimStep(json:)` is the overlay
/// element's, and they differ on purpose: here an unknown preset fades, a
/// missing duration is half a second, an unknown curve is `out`, and neither a
/// delay nor `inside` is read.
func readAnimStep(_ v: JSONValue?) -> AnimStep {
    let s = v?.objectValue ?? [:]
    var out = AnimStep(
        preset: s["preset"]?.stringValue.flatMap(AnimPreset.init(rawValue:)) ?? .fade,
        duration: max(0, s["duration"]?.finiteNumber ?? 0.5),
        easing: s["easing"]?.stringValue.flatMap(EasingId.init(rawValue:)) ?? .out
    )
    out.direction = s["direction"]?.stringValue.flatMap(AnimDirection.init(rawValue:))
    out.distanceFrac = s["distanceFrac"]?.finiteNumber
    out.scaleFrom = s["scaleFrom"]?.finiteNumber
    out.steps = s["steps"]?.finiteNumber
    return out
}

/// Read a cascade out of anything — nil unless it holds a step.
public func readCascade(_ v: JSONValue?) -> BadgeCascade? {
    guard let c = v?.objectValue, let step = c["step"], step.objectValue != nil || step.arrayValue != nil else { return nil }
    return BadgeCascade(step: readAnimStep(step), stagger: normaliseStagger(c["stagger"]))
}

/// The cascade a badge starts on when the author turns it on.
public func defaultCascade() -> BadgeCascade {
    BadgeCascade(
        step: AnimStep(preset: .slide, duration: 0.5, easing: .outCubic, direction: .up, distanceFrac: 0.05),
        stagger: Stagger(each: 0.12, order: .sequence)
    )
}
