// A CSS colour string read the way a canvas reads `fillStyle` — the documents
// store colours as the web writes them (`#e2542f`, `#fff`,
// `rgba(0,0,0,0.65)`), and every painter under `Paint/` hands them to Core
// Graphics through here, never through a second vocabulary.
//
// Understood: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` with
// commas or spaces (and CSS 4's `/ alpha`), each channel a number or a
// percentage, and the three keywords a document can hold (`transparent`,
// `black`, `white`). Anything else is nil — a canvas IGNORES a colour it
// cannot parse, so a caller keeps what it had (black by default), never an
// invented colour. Components are sRGB-encoded codes, as on the web: the
// colour is built in sRGB, so an overlay pixel is the web's pixel.

import CoreGraphics
import Foundation

enum CSSColor {
    static let black = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)
    static let white = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
    static let clear = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0)

    /// The colour `string` names, or nil when a canvas would ignore it.
    static func parse(_ string: String) -> CGColor? {
        let s = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.hasPrefix("#") { return hex(String(s.dropFirst())) }
        if s.hasPrefix("rgb") { return functional(s) }
        switch s {
        case "transparent": return clear
        case "black": return black
        case "white": return white
        default: return nil
        }
    }

    /// `string` parsed, or `fallback` — what a canvas keeps on a bad string.
    static func parse(_ string: String, or fallback: CGColor) -> CGColor {
        parse(string) ?? fallback
    }

    /// The same colour at `alpha` times its own.
    static func faded(_ color: CGColor, _ alpha: Double) -> CGColor {
        color.copy(alpha: color.alpha * CGFloat(alpha)) ?? color
    }

    private static func hex(_ digits: String) -> CGColor? {
        let values = digits.map { $0.isASCII ? $0.hexDigitValue : nil }
        guard !values.isEmpty, values.allSatisfy({ $0 != nil }) else { return nil }
        let d = values.map { Double($0!) }
        switch d.count {
        case 3, 4:
            let a = d.count == 4 ? d[3] * 17 / 255 : 1
            return rgba(d[0] * 17, d[1] * 17, d[2] * 17, a)
        case 6, 8:
            let a = d.count == 8 ? (d[6] * 16 + d[7]) / 255 : 1
            return rgba(d[0] * 16 + d[1], d[2] * 16 + d[3], d[4] * 16 + d[5], a)
        default:
            return nil
        }
    }

    /// `rgb(…)` / `rgba(…)`, commas or spaces, an optional `/ alpha`.
    private static func functional(_ s: String) -> CGColor? {
        guard let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")"), open < close else { return nil }
        let name = s[s.startIndex..<open].trimmingCharacters(in: .whitespaces)
        guard name == "rgb" || name == "rgba" else { return nil }
        let inner = s[s.index(after: open)..<close]
        let separators = CharacterSet(charactersIn: ", /").union(.whitespaces)
        let parts = inner.components(separatedBy: separators).filter { !$0.isEmpty }
        guard parts.count == 3 || parts.count == 4 else { return nil }
        var channels: [Double] = []
        for part in parts.prefix(3) {
            guard let v = component(part, scale: 255) else { return nil }
            channels.append(v)
        }
        var alpha = 1.0
        if parts.count == 4 {
            guard let a = component(parts[3], scale: 1) else { return nil }
            alpha = a
        }
        return rgba(channels[0], channels[1], channels[2], alpha)
    }

    /// A number, or a percentage of `scale`.
    private static func component(_ text: String, scale: Double) -> Double? {
        if text.hasSuffix("%") {
            guard let v = Double(text.dropLast()), v.isFinite else { return nil }
            return v / 100 * scale
        }
        guard let v = Double(text), v.isFinite else { return nil }
        return v
    }

    /// Channels 0..255 and an alpha 0..1, clamped as a canvas clamps them.
    private static func rgba(_ r: Double, _ g: Double, _ b: Double, _ a: Double) -> CGColor {
        func unit(_ v: Double) -> CGFloat { CGFloat(max(0, min(255, v)) / 255) }
        return CGColor(srgbRed: unit(r), green: unit(g), blue: unit(b), alpha: CGFloat(max(0, min(1, a))))
    }
}
