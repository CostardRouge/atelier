// The badge as OVERLAY ELEMENTS — port of `src/shared/roadtrip/badge-layout.ts`:
// where the block sits, how long the hook lasts, how one piece departs from
// the trip's theme, and the ONE cascaded entrance the pieces may share (as the
// trip stores them), then (`MARK: - the badge as elements`) the elements built
// for the overlay engine, the block's extent, the drag, the settle time and
// the deterministic piece ids.
//
// Rules kept:
// - The badge is ordinary `text` elements handed to the overlay engine, never
//   a second renderer: it inherits the title styles, the legibility panel and
//   the animation model, and preview and export are the same code.
// - A piece departs from the theme by writing its own value AND pinning that
//   key in `styleOverrides`; casing is applied to the STRING, with
//   `uppercase` pinned off, so a theme cannot undo a deliberate lowercase.
// - One dominant numeral: every other piece is a small RATIO of it.
// - Ids are a function of the piece (`piece:<key>`, a plate's runs
//   `piece:exif:<n>`), so a hit-test survives the repaint.
// - An EXIT needs its window to END (the hook's duration), or it never plays;
//   a piece with only an entrance keeps an open window.
// - The BLOCK moves on a drag, never one piece.
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

// MARK: - the badge as elements

/// Each piece's size as a multiple of the headline's. The numeral is 1 and
/// nothing else comes within a third of it; the WHEN line and the camera
/// credit are the quietest things on the badge on purpose.
private let badgeRatios: [BadgePiece: Double] = [
    .kicker: 0.17, .label: 0.2, .headline: 1, .counter: 0.26, .caption: 0.22, .timing: 0.16, .exif: 0.12,
]

/// Space under each piece, again as a multiple of the headline's size. The
/// last piece of the block takes no gap whatever it is.
private let badgeGapAfter: [BadgePiece: Double] = [
    .kicker: 0.1, .label: 0.04, .headline: 0.06, .counter: 0.12, .caption: 0.08, .timing: 0.06, .exif: 0,
]

/// The pieces in drawing order — `BadgePiece`'s own order.
private let badgeOrder: [BadgePiece] = BadgePiece.allCases

private let pieceIdPrefix = "piece:"

/// A piece's element id — a function of the piece, so it survives a repaint.
public func pieceElementId(_ piece: BadgePiece) -> String {
    "\(pieceIdPrefix)\(piece.rawValue)"
}

/// The piece an element id names, or nil for an id that is not a badge
/// piece's. A camera plate's runs (`piece:exif:1`…) name the piece they belong to.
public func pieceFromElementId(_ id: String) -> BadgePiece? {
    guard id.hasPrefix(pieceIdPrefix) else { return nil }
    var key = String(id.dropFirst(pieceIdPrefix.count))
    // `/:\d+$/`: one run of ASCII digits after the last colon.
    if let colon = key.lastIndex(of: ":") {
        let digits = key[key.index(after: colon)...]
        if !digits.isEmpty && digits.unicodeScalars.allSatisfy({ $0.value >= 0x30 && $0.value <= 0x39 }) {
            key = String(key[..<colon])
        }
    }
    return BadgePiece(rawValue: key)
}

/// A size expressed as a fraction of the SHORTER side, converted to a fraction
/// of the frame's HEIGHT — which is what element `y` is measured in.
public func heightFractionOf(_ sizeFrac: Double, _ aspect: Double) -> Double {
    sizeFrac * min(aspect, 1)
}

private enum BadgeRow { case top, center, bottom }

/// Vertical half of an anchor — where the block's own box sits around `y`.
private func badgeVerticalOf(_ anchor: OverlayAnchor) -> BadgeRow {
    let raw = anchor.rawValue
    if raw.hasPrefix("top-") { return .top }
    if raw.hasPrefix("bottom-") { return .bottom }
    return .center
}

/// The author's casing, applied to the string rather than to the element.
private func casedText(_ text: String, _ style: BadgePieceStyle?) -> String {
    switch style?.textCase {
    case .upper?: return text.uppercased()
    case .lower?: return text.lowercased()
    default: return text
    }
}

/// A piece's animation when it has one — neither absent nor written null.
private func animationOf(_ style: BadgePieceStyle?) -> ElementAnimation? {
    guard let style, case .some(.some(let animation)) = style.animation else { return nil }
    return animation
}

/// A doubly optional string read as JavaScript's truthiness: set and not empty.
private func setString(_ v: String??) -> String? {
    guard case .some(.some(let s)) = v, !s.isEmpty else { return nil }
    return s
}

/// Write one piece's departures onto its element and pin exactly those keys
/// against the theme (after any a plate's run arrived with).
private func applyPieceStyle(_ el: inout OverlayElement, _ style: BadgePieceStyle?, _ durationSeconds: Double) {
    var pinned = el.styleOverrides ?? []
    if let textCase = style?.textCase, textCase != .asIs {
        el.uppercase = false
        pinned.append("uppercase")
    }
    if let color = setString(style?.color) {
        el.color = color
        pinned.append("color")
    }
    if let box = setString(style?.boxColor) {
        el.legibility = LegibilityStyle(mode: .box, color: box, padFrac: style?.boxPadFrac ?? 0.3,
                                        radiusFrac: style?.boxRadiusFrac ?? 0.5,
                                        borderColor: .some(style?.borderColor ?? nil),
                                        borderWidthFrac: style?.borderWidthFrac ?? 0)
        pinned.append("legibility")
    } else if let border = setString(style?.borderColor) {
        // An outline with no fill is a legitimate look — a hairline frame.
        el.legibility = LegibilityStyle(mode: .box, color: "rgba(0,0,0,0)", padFrac: style?.boxPadFrac ?? 0.3,
                                        radiusFrac: style?.boxRadiusFrac ?? 0.5, borderColor: .some(border),
                                        borderWidthFrac: style?.borderWidthFrac ?? 0.06)
        pinned.append("legibility")
    }
    if let animation = animationOf(style) {
        el.animation = animation
        // An EXIT needs the window to END or it never plays.
        el.window = animation.outStep != nil ? TimeWindow(start: 0, end: durationSeconds) : TimeWindow(start: 0, end: nil)
    }
    el.styleOverrides = pinned
}

/// The camera plate, laid out for this badge.
private struct BadgePlate {
    var runs: PlateRuns
    /// U as a fraction of the shorter side — the credit's own size.
    var unit: Double
    var inBlock: Bool
}

/// The plate for this badge, or nil when the credit is the plain line or says nothing.
private func plateFor(_ content: BadgeContent, _ layout: BadgeLayout, _ aspect: Double) -> BadgePlate? {
    guard let plate = content.plate, content.exif != nil else { return nil }
    var align = columnOf(layout.anchor)
    if case .cell(let anchor) = plate.spec.place { align = columnOf(anchor) }
    let unit = layout.sizeFrac * (badgeRatios[.exif] ?? 0) * plate.spec.size
    // The frame's width in U: its width over its shorter side, over the unit.
    guard let runs = plateRuns(plate.facts, plate.spec, plate.words, align, max(aspect, 1) / unit) else { return nil }
    return BadgePlate(runs: runs, unit: unit, inBlock: runs.place == .badge)
}

/// The block's own metrics, shared by the layout and anything drawn under it.
private struct BlockMetrics {
    var pieces: [(key: BadgePiece, text: String)]
    var heights: [Double]
    var gaps: [Double]
    var top: Double
    var height: Double
    var plate: BadgePlate?
}

private func blockMetrics(_ content: BadgeContent, _ layout: BadgeLayout, _ aspect: Double) -> BlockMetrics {
    let plate = plateFor(content, layout, aspect)
    let pieces: [(key: BadgePiece, text: String)] = badgeOrder.compactMap { key in
        guard let text = content[key], !text.isEmpty else { return nil }
        // A plate placed in a cell of its own is no part of the block.
        if key == .exif, let plate, !plate.inBlock { return nil }
        return (key, text)
    }
    let heights = pieces.map { p -> Double in
        if p.key == .exif, let plate { return heightFraction(plate.runs.height * plate.unit, aspect) }
        return heightFractionOf(layout.sizeFrac * (badgeRatios[p.key] ?? 0), aspect)
    }
    let gaps = pieces.enumerated().map { i, p -> Double in
        i == pieces.count - 1 ? 0 : heightFractionOf(layout.sizeFrac * (badgeGapAfter[p.key] ?? 0), aspect)
    }
    let heightSum = heights.reduce(0, +)
    let gapSum = gaps.reduce(0, +)
    let height = heightSum + gapSum
    let top: Double
    switch badgeVerticalOf(layout.anchor) {
    case .top: top = layout.y
    case .bottom: top = layout.y - height
    case .center: top = layout.y - height / 2
    }
    return BlockMetrics(pieces: pieces, heights: heights, gaps: gaps, top: top, height: height, plate: plate)
}

/// Where the badge's block sits in the frame, as fractions of the height — what
/// a shade confined to the hook zone needs, derived from the layout's own
/// numbers. The anchor rides along for a shade that follows it. Nil when
/// there is nothing to draw.
public func badgeBlockExtent(_ content: BadgeContent, _ layout: BadgeLayout, _ aspect: Double) -> HookBlock? {
    let m = blockMetrics(content, layout, aspect)
    if m.pieces.isEmpty { return nil }
    return HookBlock(top: m.top, bottom: m.top + m.height, anchor: layout.anchor)
}

/// The badge's overlay elements, top to bottom. A piece that is absent is
/// skipped entirely — no placeholder, no reserved space. `aspect` is width /
/// height of the frame the badge is drawn on.
public func badgeElements(_ content: BadgeContent, _ layout: BadgeLayout, _ aspect: Double,
                          _ styles: BadgePieceStyles = [:], _ durationSeconds: Double = defaultBadgeDuration,
                          _ cascade: BadgeCascade? = nil) -> [OverlayElement] {
    let m = blockMetrics(content, layout, aspect)
    if m.pieces.isEmpty { return [] }

    let lineAnchor: OverlayAnchor
    switch columnOf(layout.anchor) {
    case .left: lineAnchor = .topLeft
    case .center: lineAnchor = .topCenter
    case .right: lineAnchor = .topRight
    }

    // The pieces' boxes in HEIGHT units, for the cascade to rank: one column,
    // a width unknown without a canvas, so `size` ranks by height.
    var boxCursor = m.top
    var boxes: [Rect] = []
    for i in m.pieces.indices {
        boxes.append(Rect(layout.x * aspect, boxCursor, 0, m.heights[i]))
        boxCursor += m.heights[i] + m.gaps[i]
    }
    let delays = cascade.map { staggerDelays(boxes, Size(aspect, 1), $0.stagger) }

    /// A piece's style, with the cascade's entrance at its delay when there is one.
    func styleAt(_ key: BadgePiece, _ delay: Double?) -> BadgePieceStyle? {
        let style = styles[key]
        guard let cascade, let delay else { return style }
        var out = style ?? BadgePieceStyle()
        var step = cascade.step
        step.delay = delay
        let exit = animationOf(style)?.outStep
        out.animation = .some(ElementAnimation(in: .some(step), out: .some(exit)))
        return out
    }
    /// A camera plate's runs, styled as the one piece they are.
    func plateAt(_ origin: PlateOrigin, _ delay: Double?) -> [OverlayElement] {
        guard let plate = m.plate else { return [] }
        let style = styleAt(.exif, delay)
        return plateElements(plate.runs, origin, plate.unit, aspect, pieceElementId(.exif)).map { run in
            var el = run
            el.text = casedText(el.text ?? "", style)
            applyPieceStyle(&el, style, durationSeconds)
            return el
        }
    }

    var cursor = m.top
    var out: [OverlayElement] = []
    for (i, piece) in m.pieces.enumerated() {
        let delay = delays?[i]
        let at = cursor
        cursor += m.heights[i] + m.gaps[i]
        if piece.key == .exif, m.plate != nil {
            out.append(contentsOf: plateAt(PlateOrigin(x: layout.x, top: at), delay))
            continue
        }
        let style = styleAt(piece.key, delay)
        var el = createTextElement(casedText(piece.text, style), id: pieceElementId(piece.key))
        el.anchor = lineAnchor
        el.x = layout.x
        el.y = at
        el.sizeFrac = layout.sizeFrac * (badgeRatios[piece.key] ?? 0)
        applyPieceStyle(&el, style, durationSeconds)
        out.append(el)
    }

    // A plate in a cell of its own comes after the block, and arrives after it.
    if let plate = m.plate, !plate.inBlock {
        var last: Double? = nil
        if let delays, let latest = delays.max() { last = latest + (cascade?.stagger.each ?? 0) }
        out.append(contentsOf: plateAt(gridOrigin(plate.runs, plate.unit, aspect), last))
    }
    return out
}

/// Where a drag lands the badge's anchor: the start plus the pointer's travel
/// as fractions of the frame, kept inside it and — unless the author holds Alt
/// — softly pulled onto an edge or the centre. The BLOCK moves, never a piece.
public func moveBlock(_ start: Point, _ dxFrac: Double, _ dyFrac: Double, _ snapping: Bool = true) -> Point {
    let x = min(1, max(0, start.x + dxFrac))
    let y = min(1, max(0, start.y + dyFrac))
    return snapping ? Point(snap(x), snap(y)) : Point(x, y)
}

/// How long the badge's animations take to settle, in seconds — what a still
/// export defaults to, so the PNG is never caught mid-slide. Zero when nothing
/// is animated; exits are ignored (a still wants the badge settled, not gone).
public func badgeSettleSeconds(_ styles: BadgePieceStyles, _ cascade: BadgeCascade? = nil) -> Double {
    if let cascade {
        // The cascade replaces every entrance: its own bound is the answer.
        return max(0, cascade.stagger.each) * Double(badgeOrder.count - 1) + max(0, cascade.step.duration)
    }
    var settled = 0.0
    for style in styles.values {
        guard let step = animationOf(style)?.inStep else { continue }
        settled = max(settled, (step.delay ?? 0) + step.duration)
    }
    return settled
}
