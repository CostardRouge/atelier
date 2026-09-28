// The Composer's telemetry readout — which lines it shows, how they read, and
// where the card sits. Port of `src/tools/composer/overlay.ts` (the model)
// and of the ARITHMETIC of `draw-readout.ts` (the paint is the app's, with
// Core Graphics; only the text measurement lives there).
//
// This is not the overlay engine (`Overlay/`): the Composer draws one small
// card of its own — a few `key value` lines on a rounded box — the same way
// at preview and export size, because its font size is a share of the frame's
// HEIGHT and its position a share of the frame.
//
// Names: the web's `OverlayConfig` / `OVERLAY_FIELDS` / `DEFAULT_OVERLAY` /
// `buildLines` / `hexToRgba` are `ComposerOverlayConfig`,
// `composerOverlayFields`, `ComposerOverlayConfig.default`,
// `buildReadoutLines` and `readoutRgba` — the kernel already holds a
// `hexToRgba` (the hooks' `colour.ts`) with DIFFERENT rules (no `#rgb`, white
// on a bad value, the alpha clamped), and a module shared by a hundred ports
// cannot carry two.

import Foundation

public enum ComposerOverlayFont: String, CaseIterable, Sendable {
    case mono, sans, serif
}

public struct ComposerOverlayConfig: Equatable, Sendable {
    /// Master switch for the readout.
    public var show: Bool
    /// Which fields are active, keyed by field id.
    public var fields: [String: Bool]
    /// Prefix each value with its short label (ALT, SPD, …).
    public var labels: Bool
    public var textColor: String
    public var bgColor: String
    /// Background alpha, 0...1.
    public var bgOpacity: Double
    /// Corner radius in output px.
    public var radius: Double
    /// Multiplier on the auto font size.
    public var fontScale: Double
    public var font: ComposerOverlayFont

    public init(show: Bool, fields: [String: Bool], labels: Bool, textColor: String, bgColor: String,
                bgOpacity: Double, radius: Double, fontScale: Double, font: ComposerOverlayFont) {
        self.show = show; self.fields = fields; self.labels = labels
        self.textColor = textColor; self.bgColor = bgColor; self.bgOpacity = bgOpacity
        self.radius = radius; self.fontScale = fontScale; self.font = font
    }

    /// The web's `DEFAULT_OVERLAY`.
    public static let `default` = ComposerOverlayConfig(
        show: true,
        fields: ["altitude": true, "speed": true, "vspeed": true, "heading": false, "coords": true, "absAlt": false],
        labels: false,
        textColor: "#ffffff",
        bgColor: "#0f0e0c",
        bgOpacity: 0.55,
        radius: 0,
        fontScale: 1,
        font: .mono
    )
}

/// One field the readout can show: its id, its short label, and how it reads
/// a cue (nil when the cue says nothing about it).
public struct ComposerOverlayField: Sendable {
    public let id: String
    public let label: String
    public let get: @Sendable (Cue?) -> String?

    public init(id: String, label: String, get: @escaping @Sendable (Cue?) -> String?) {
        self.id = id
        self.label = label
        self.get = get
    }
}

/// `c?.data.x ? … : null` — an empty string is as absent as none.
private func said(_ cue: Cue?, _ key: String) -> String? {
    guard let value = cue?.data[key], !value.isEmpty else { return nil }
    return value
}

/// The web's `OVERLAY_FIELDS`, in its order.
public let composerOverlayFields: [ComposerOverlayField] = [
    ComposerOverlayField(id: "altitude", label: "ALT") { cue in said(cue, "rel_alt").map { "\($0) m" } },
    ComposerOverlayField(id: "speed", label: "SPD") { cue in formatGroundSpeed(motionAt(cue).groundSpeed) },
    ComposerOverlayField(id: "vspeed", label: "V/S") { cue in formatVerticalSpeed(motionAt(cue).verticalSpeed) },
    ComposerOverlayField(id: "heading", label: "HDG") { cue in formatHeading(motionAt(cue).heading) },
    ComposerOverlayField(id: "coords", label: "GPS") { cue in
        guard let lat = said(cue, "latitude"), let lon = said(cue, "longitude") else { return nil }
        return "\(lat), \(lon)"
    },
    ComposerOverlayField(id: "absAlt", label: "ABS") { cue in said(cue, "abs_alt").map { "\($0) m" } },
]

/// The readout's lines for a cue, honouring the active fields and the labels
/// toggle — the web's `buildLines`.
public func buildReadoutLines(_ cue: Cue?, _ cfg: ComposerOverlayConfig) -> [String] {
    var out: [String] = []
    for field in composerOverlayFields {
        guard cfg.fields[field.id] == true else { continue }
        guard let value = field.get(cue) else { continue }
        out.append(cfg.labels ? "\(field.label) \(value)" : value)
    }
    return out
}

/// The 0–255 channels of `#rrggbb` or `#rgb`, or nil for anything else (the
/// readout then paints black, as the web's does).
public func readoutHexRgb(_ hex: String) -> (r: Int, g: Int, b: Int)? {
    var h = hex.replacingOccurrences(of: "#", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
    guard h.count == 6, let n = Int(h, radix: 16) else { return nil }
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

/// `#rrggbb` (or `#rgb`) + alpha → `rgba(r,g,b,a)`; black on a bad hex — the
/// web's composer `hexToRgba`, the alpha written as JavaScript writes it.
public func readoutRgba(_ hex: String, _ alpha: Double) -> String {
    let c = readoutHexRgb(hex) ?? (0, 0, 0)
    return "rgba(\(c.r),\(c.g),\(c.b),\(ExifText.jsString(alpha)))"
}

// MARK: - the card's arithmetic (`draw-readout.ts`)

/// The sizes the card is laid out with, all derived from the frame's height.
public struct ReadoutMetrics: Equatable, Sendable {
    /// Font size in frame px.
    public var fontSize: Double
    /// Inner padding.
    public var pad: Double
    /// Line advance.
    public var lineHeight: Double

    public init(fontSize: Double, pad: Double, lineHeight: Double) {
        self.fontSize = fontSize; self.pad = pad; self.lineHeight = lineHeight
    }
}

/// `base = max(10, round(ph × 0.03))`, `fs = max(8, round(base × scale))`,
/// `pad = round(fs × 0.7)`, `lh = fs × 1.35` — so the same share of the
/// frame reads the same at preview and at export size.
public func readoutMetrics(frameHeight: Double, fontScale: Double) -> ReadoutMetrics {
    let base = max(10, ExifText.jsRound(frameHeight * 0.03))
    let fontSize = max(8, ExifText.jsRound(base * fontScale))
    let pad = ExifText.jsRound(fontSize * 0.7)
    return ReadoutMetrics(fontSize: fontSize, pad: pad, lineHeight: fontSize * 1.35)
}

/// Where the card lands and how its lines sit in it.
public struct ReadoutBox: Equatable, Sendable {
    /// The box in frame px, top-left origin (the hit area of a drag).
    public var rect: Rect
    /// The corner radius actually drawn.
    public var radius: Double
    /// The x of every line's start.
    public var textX: Double
    /// Each line's BASELINE, top to bottom.
    public var baselines: [Double]

    public init(rect: Rect, radius: Double, textX: Double, baselines: [Double]) {
        self.rect = rect; self.radius = radius; self.textX = textX; self.baselines = baselines
    }
}

/// The card for `lineCount` lines whose widest measures `maxLineWidth`, placed
/// at the normalised `pos` of a `frame` and pushed back inside it — nil when
/// there is nothing to draw.
public func readoutBox(pos: Point, frame: Size, maxLineWidth: Double, lineCount: Int,
                       metrics: ReadoutMetrics, radius: Double) -> ReadoutBox? {
    guard lineCount > 0 else { return nil }
    let fs = metrics.fontSize
    let pad = metrics.pad
    let lh = metrics.lineHeight
    let boxW = maxLineWidth + pad * 2
    let lines = Double(lineCount)
    let boxH = lines * lh + pad * 2 - (lh - fs)
    let x = min(max(0, pos.x * frame.width), max(0, frame.width - boxW))
    let y = min(max(0, pos.y * frame.height), max(0, frame.height - boxH))
    let r = min(radius, boxH / 2, boxW / 2)
    var baselines: [Double] = []
    var ty = y + pad + fs * 0.85
    for _ in 0..<lineCount {
        baselines.append(ty)
        ty += lh
    }
    return ReadoutBox(rect: Rect(x, y, boxW, boxH), radius: r, textX: x + pad, baselines: baselines)
}

/// The normalised position a drag leaves the card at: the box's new corner as
/// a share of the frame, held in 0...1 — the web's pointer-move rule.
public func readoutDragPosition(corner: Point, frame: Size) -> Point {
    guard frame.width > 0, frame.height > 0 else { return Point(0, 0) }
    return Point(clamp(corner.x / frame.width, 0, 1), clamp(corner.y / frame.height, 0, 1))
}
