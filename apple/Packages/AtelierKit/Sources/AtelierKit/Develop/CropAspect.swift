// What a crop's ASPECT is — the vocabulary a roll stores in
// `RollPicture.aspect`, and the one place that turns it into a ratio. Port of
// `src/shared/develop/crop-aspect.ts`.
//
// Three kinds of value on one string field:
//  - `original` — the picture's own shape, whatever it was shot at;
//  - a preset id from `aspectPresets` (`4:5`, `16:9`, …) — a destination's shape;
//  - `free:<ratio>` — a FREE zone: any shape the author drew, carried as its own w/h.
//
// The free zone rides the SAME field rather than a second one, so every reader
// that asks for a ratio keeps working unchanged and a roll written before free
// crops existed still reads. What it costs is this module: one place that knows
// the spelling. The spelling is the web's to the character — four decimals, a
// whole number with none (`free:2`) — so a roll written here reads there.
//
// `isStoredAspect` lives here (it did in `Roll.swift`, without the free zone,
// which made a free crop read back as `original` and lose its shape).

import Foundation

private let freePrefix = "free:"

/// The shapes a free crop is held between. Past 5:1 a photograph is a strip:
/// the frame would be a few pixels tall on the stage and there would be nothing
/// left to judge, so the slider and the corners both stop here.
public let freeAspectMax = 5.0
public let freeAspectMin = 1 / freeAspectMax

public func clampFreeAspect(_ ratio: Double) -> Double {
    if !ratio.isFinite || ratio <= 0 { return 1 }
    return min(freeAspectMax, max(freeAspectMin, ratio))
}

/// `1.37209` → `free:1.3721`. Four decimals: finer than a pixel on a 4096 px
/// edge, and short enough that the stored roll stays readable.
public func freeAspectId(_ ratio: Double) -> String {
    let fixed = String(format: "%.4f", clampFreeAspect(ratio))
    return freePrefix + jsNumberString(Double(fixed) ?? 1)
}

/// The ratio a free aspect carries, or nil when this id is not one.
public func freeAspectRatio(_ aspect: String) -> Double? {
    guard aspect.hasPrefix(freePrefix) else { return nil }
    let ratio = jsNumber(String(aspect.dropFirst(freePrefix.count)))
    return ratio.isFinite && ratio > 0 ? clampFreeAspect(ratio) : nil
}

public func isFreeAspect(_ aspect: String) -> Bool {
    freeAspectRatio(aspect) != nil
}

/// Whether a stored string is an aspect at all — what `readRollDoc` trusts.
public func isStoredAspect(_ aspect: String) -> Bool {
    aspect == "original" || aspectPreset(aspect) != nil || isFreeAspect(aspect)
}

/// The w/h ratio a picture's crop frames into: a free zone's own shape, one of
/// the suite's aspect presets, or the picture's OWN shape while its aspect is
/// `original` (and a safe square before a source has decoded at all).
public func pictureAspectRatio(_ aspect: String, _ sourceW: Double, _ sourceH: Double) -> Double {
    if let free = freeAspectRatio(aspect) { return free }
    if aspect != "original", let preset = aspectPreset(aspect) { return preset.w / preset.h }
    return sourceW > 0 && sourceH > 0 ? sourceW / sourceH : 1
}

/// A ratio said the way a shape is read: `1.50:1`, `1:1.25`, `1:1`.
public func describeAspect(_ ratio: Double) -> String {
    let r = clampFreeAspect(ratio)
    if abs(r - 1) < 0.005 { return "1:1" }
    return r > 1 ? "\(String(format: "%.2f", r)):1" : "1:\(String(format: "%.2f", 1 / r))"
}

/// The format chip on screen: `free`, `original`, or one of the preset ids.
public typealias CropChip = String

/// Which chip a picture OPENS on.
///
/// An untouched picture opens on **Free** (2026-09-21, the maintainer's ask):
/// the Crop tab is reached in order to draw a shape, and Free is the one chip
/// that holds the zone to nothing. It changes no stored value — a picture
/// opened on it and left alone still stores `original` with an untouched
/// framing. A picture already cropped opens on the chip its stored crop names.
public func openingCropChip(_ aspect: String, untouched: Bool) -> CropChip {
    if untouched { return "free" }
    if aspect == "original" { return "original" }
    if isFreeAspect(aspect) { return "free" }
    return aspectPreset(aspect) != nil ? aspect : "free"
}

/// A handle of the crop zone: an edge or a corner, by compass point.
public enum CropHandle: String, CaseIterable, Sendable {
    case n, s, e, w, ne, nw, se, sw
}

// MARK: - JavaScript's number spelling

/// JavaScript's `Number(string)` on the strings a roll can hold: surrounding
/// white space ignored, the empty string 0, a decimal literal (sign, digits, a
/// point, an exponent) read as one, `Infinity` spelled out, and anything else
/// — `banana`, `1.5x`, Swift's own `inf` or hex floats — NaN.
private func jsNumber(_ text: String) -> Double {
    let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return 0 }
    switch s {
    case "Infinity", "+Infinity": return .infinity
    case "-Infinity": return -.infinity
    default: break
    }
    var digits = 0
    var sawPoint = false
    var sawExponent = false
    var exponentDigits = 0
    var index = s.startIndex
    if s[index] == "+" || s[index] == "-" { index = s.index(after: index) }
    while index < s.endIndex {
        let c = s[index]
        if c.isASCII, c.isNumber {
            if sawExponent { exponentDigits += 1 } else { digits += 1 }
        } else if c == "." && !sawPoint && !sawExponent {
            sawPoint = true
        } else if (c == "e" || c == "E") && !sawExponent && digits > 0 {
            sawExponent = true
            let next = s.index(after: index)
            if next < s.endIndex, s[next] == "+" || s[next] == "-" { index = next }
        } else {
            return .nan
        }
        index = s.index(after: index)
    }
    if digits == 0 || (sawExponent && exponentDigits == 0) { return .nan }
    return Double(s) ?? .nan
}

/// A number the way JavaScript prints it in a template string, for the values
/// an aspect id holds: a whole number with no decimals, else the shortest
/// spelling that reads back as the same double.
private func jsNumberString(_ v: Double) -> String {
    if v == v.rounded(), abs(v) < 1e15 { return String(Int64(v)) }
    return "\(v)"
}
