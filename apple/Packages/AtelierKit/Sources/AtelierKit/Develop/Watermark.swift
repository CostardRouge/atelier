// A WATERMARK — a line of text drawn on a delivered file. Port of
// `src/shared/develop/watermark.ts` (audit item 28, `docs/memory/develop-output.md`).
//
// The STYLE is the roll's (`RollExport.watermark`), one look for a set;
// WHETHER it is drawn is each target's (`ExportTarget.watermark`), because the
// copy that goes online is signed and the one kept for the archive is not.
//
// The text is a template over the identity the files are already signed with:
// `{creator}`, `{year}` — the CAPTURE's year, as the copyright line reads it —
// and `{title}`, the picture's own. A token with nothing to say is dropped
// with the words around it collapsing; a line that names `{creator}` while no
// name is set, or is left with nothing but punctuation, is not drawn at all: a
// lone "© 2025" in a corner signs nothing. Size is a % of the file's SHORT
// side, so every target carries the same mark; the line is drawn AFTER the
// screen sharpening (a mark is not detail) and on both halves of an Ultra HDR
// file, so its gain stays flat where the text is.
//
// Pure: the placement arithmetic is here, the drawing (a font, a shadow of the
// opposite tone) is the app's.

import Foundation

public enum WatermarkPosition: String, CaseIterable, Sendable {
    case bottomRight = "bottom-right"
    case bottomLeft = "bottom-left"
    case bottom = "bottom"
    case topRight = "top-right"
    case topLeft = "top-left"
}

public enum WatermarkTone: String, CaseIterable, Sendable {
    case light, dark
}

public struct Watermark: Equatable, Sendable {
    /// A template: `{creator}`, `{year}`, `{title}`.
    public var text: String
    public var position: WatermarkPosition
    /// The text's height, as a percentage of the file's SHORT side — so a web copy and a full one carry the same mark.
    public var size: Double
    /// 0.1..1.
    public var opacity: Double
    public var tone: WatermarkTone

    public init(text: String, position: WatermarkPosition, size: Double, opacity: Double, tone: WatermarkTone) {
        self.text = text; self.position = position; self.size = size; self.opacity = opacity; self.tone = tone
    }

    public static let `default` = Watermark(text: "© {year} {creator}", position: .bottomRight, size: 2.5, opacity: 0.7, tone: .light)
}

/// The positions in the panel's order — the web's `WATERMARK_POSITIONS`.
public let watermarkPositions: [WatermarkPosition] = WatermarkPosition.allCases

public enum WatermarkLimits {
    public static let size = (min: 1.0, max: 8.0)
    public static let opacity = (min: 0.1, max: 1.0)
}

/// The record read back safely: junk falls back, a number is clamped, a text is cut at 120.
public func readWatermark(_ raw: JSONValue?) -> Watermark {
    guard let src = raw?.objectValue else { return .default }
    let fallback = Watermark.default
    var out = fallback
    if let text = src["text"]?.stringValue { out.text = String(text.prefix(120)) }
    if let name = src["position"]?.stringValue, let position = WatermarkPosition(rawValue: name) { out.position = position }
    let size = src["size"]?.finiteNumber ?? fallback.size
    out.size = clamp(size, WatermarkLimits.size.min, WatermarkLimits.size.max)
    let opacity = src["opacity"]?.finiteNumber ?? fallback.opacity
    out.opacity = clamp(opacity, WatermarkLimits.opacity.min, WatermarkLimits.opacity.max)
    out.tone = src["tone"]?.stringValue == "dark" ? .dark : .light
    return out
}

public func sameWatermark(_ a: Watermark, _ b: Watermark) -> Bool {
    a.text == b.text && a.position == b.position && a.size == b.size && a.opacity == b.opacity && a.tone == b.tone
}

extension Watermark {
    /// The record as the roll stores it — the five keys the web writes.
    public var json: JSONValue {
        .object([
            "text": .string(text), "position": .string(position.rawValue), "size": .number(size),
            "opacity": .number(opacity), "tone": .string(tone.rawValue),
        ])
    }
}

// MARK: - the line

/// JavaScript's `\s`: Unicode White_Space less NEL, plus the BOM.
private func isJsSpace(_ scalar: Unicode.Scalar) -> Bool {
    (scalar.properties.isWhitespace && scalar.value != 0x85) || scalar.value == 0xFEFF
}

/// The web's `.trim()`.
private func jsTrim(_ s: String) -> String {
    let scalars = s.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isJsSpace($0) }) else { return "" }
    var last = scalars.endIndex
    while last > first {
        let before = scalars.index(before: last)
        if !isJsSpace(scalars[before]) { break }
        last = before
    }
    return String(scalars[first..<last])
}

/// The web's `.replace(/\s+/g, ' ').trim()` in one pass.
private func collapseSpaces(_ s: String) -> String {
    var out = String.UnicodeScalarView()
    var pending = false
    for scalar in s.unicodeScalars {
        if isJsSpace(scalar) {
            pending = true
            continue
        }
        if pending && !out.isEmpty { out.append(" ") }
        pending = false
        out.append(scalar)
    }
    return String(out)
}

/// The web's `/[\p{L}\p{N}]/u`: a letter or a number anywhere in the line.
private func hasLetterOrNumber(_ s: String) -> Bool {
    s.unicodeScalars.contains { scalar in
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }
}

/// The line one picture carries, or "" for none. A token with nothing behind
/// it goes, and so do the spaces it leaves; a line with no letter or digit
/// left in it is not drawn.
public func resolveWatermarkText(_ template: String, creator: String? = nil, year: Int? = nil, title: String? = nil) -> String {
    // A line that names its author and has none is not drawn — "© 2025" signs
    // nothing — the rule `resolveRights` keeps for the copyright.
    let name = creator.map(jsTrim) ?? ""
    if template.contains("{creator}") && name.isEmpty { return "" }
    let yearText = (year ?? 0) != 0 ? String(year ?? 0) : ""
    let line = template
        .replacingOccurrences(of: "{creator}", with: name)
        .replacingOccurrences(of: "{year}", with: yearText)
        .replacingOccurrences(of: "{title}", with: title.map(jsTrim) ?? "")
    let collapsed = collapseSpaces(line)
    return hasLetterOrNumber(collapsed) ? collapsed : ""
}

// MARK: - where it sits

public enum WatermarkAlign: String, Sendable {
    case left, right, center
}

public enum WatermarkBaseline: String, Sendable {
    case top, bottom
}

/// Where the line sits on a `w × h` file: its anchor, its alignment, its height in pixels.
public struct WatermarkLayout: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var fontPx: Double
    public var align: WatermarkAlign
    public var baseline: WatermarkBaseline

    public init(x: Double, y: Double, fontPx: Double, align: WatermarkAlign, baseline: WatermarkBaseline) {
        self.x = x; self.y = y; self.fontPx = fontPx; self.align = align; self.baseline = baseline
    }
}

/// JavaScript's `Math.round`: the nearest integer, a half rounding towards +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// The line's place: `size` % of the short side tall, inset from its corner by
/// one line height (never less than 2 % of the short side), so it sits the
/// same on a 1080 px copy and on the full picture.
public func watermarkLayout(_ w: Double, _ h: Double, position: WatermarkPosition, size: Double) -> WatermarkLayout {
    let short = min(w, h)
    let fontPx = max(6, jsRound((short * size) / 100))
    let inset = jsRound(max(fontPx, short * 0.02))
    let top = position.rawValue.hasPrefix("top")
    let align: WatermarkAlign
    if position.rawValue.hasSuffix("left") {
        align = .left
    } else if position.rawValue.hasSuffix("right") {
        align = .right
    } else {
        align = .center
    }
    let x: Double
    switch align {
    case .left: x = inset
    case .right: x = w - inset
    case .center: x = w / 2
    }
    return WatermarkLayout(x: x, y: top ? inset : h - inset, fontPx: fontPx, align: align, baseline: top ? .top : .bottom)
}

public func watermarkLayout(_ w: Double, _ h: Double, _ mark: Watermark) -> WatermarkLayout {
    watermarkLayout(w, h, position: mark.position, size: mark.size)
}
