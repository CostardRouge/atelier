// CSS approximations of the title style for the small previews in the
// inspector — port of `src/shared/overlay/style-preview.ts`.
//
// The real rendering is the overlay painter — four layered fills. Reproducing
// that in a 2rem thumbnail would be absurd, so the halation collapses into a
// two-stop shadow (bright halo + warm bleed), radii in EM so one helper serves
// any preview size. The strings are the web's, kept for parity (and for a
// preview a web view might draw); the app's SwiftUI previews read the same
// numbers straight off `PreviewAppearance` — the two stops, their radii in em
// and their alphas — rather than parsing CSS.

import Foundation

/// Canvas family → CSS stack. The web's `PREVIEW_FONT_STACK`.
public let previewFontStack: [OverlayFontFamily: String] = [
    .spaceGrotesk: "'Space Grotesk', sans-serif",
    .jetBrainsMono: "'JetBrains Mono', monospace",
    .instrumentSerif: "'Instrument Serif', serif",
    .vt323: "'VT323', monospace",
    .arial: "Arial, sans-serif",
    .georgia: "Georgia, serif",
    .courierNew: "'Courier New', monospace",
]

/// The appearance a preview needs. A `ResolvedStyle` gives one as-is; a
/// `TitleStyle` needs only its glow layers derived.
public struct PreviewAppearance: Equatable, Sendable {
    public var fontFamily: OverlayFontFamily
    public var weight: FontWeight
    public var italic: Bool
    public var uppercase: Bool
    public var letterSpacingEm: Double
    public var color: String
    public var glow: GlowLayers?
    public var glowWarmth: Double

    public init(fontFamily: OverlayFontFamily, weight: FontWeight, italic: Bool, uppercase: Bool,
                letterSpacingEm: Double, color: String, glow: GlowLayers?, glowWarmth: Double) {
        self.fontFamily = fontFamily; self.weight = weight; self.italic = italic; self.uppercase = uppercase
        self.letterSpacingEm = letterSpacingEm; self.color = color; self.glow = glow; self.glowWarmth = glowWarmth
    }

    /// A resolved element style, as the web passes it structurally.
    public init(_ s: ResolvedStyle) {
        self.init(fontFamily: s.fontFamily, weight: s.weight, italic: s.italic, uppercase: s.uppercase,
                  letterSpacingEm: s.letterSpacingEm, color: s.color, glow: s.glow, glowWarmth: s.glowWarmth)
    }

    /// A title style with its glow layers (nil for none).
    public init(_ s: TitleStyle, glow: GlowLayers?) {
        self.init(fontFamily: s.fontFamily, weight: s.weight, italic: s.italic, uppercase: s.uppercase,
                  letterSpacingEm: s.letterSpacingEm, color: s.color, glow: glow, glowWarmth: s.glowWarmth)
    }
}

/// JS `${n}` for a finite number.
private func jsNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// Two-stop halation as a `text-shadow`, or `none` when there is no glow.
public func previewTextShadow(_ a: PreviewAppearance) -> String {
    guard let glow = a.glow, !(glow.haloAlpha == 0 && glow.bleedAlpha == 0) else { return "none" }
    let rgb = warmDrift(a.color, a.glowWarmth)
    let halo = "0 0 \(ExifText.toFixed(glow.haloRadiusFrac, 2))em rgba(255,255,255,\(ExifText.toFixed(glow.haloAlpha * 0.6, 2)))"
    let bleedAlpha = ExifText.toFixed(min(1, glow.bleedAlpha * 2), 2)
    let bleed = "0 0 \(ExifText.toFixed(glow.bleedRadiusFrac, 2))em rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(bleedAlpha))"
    return [halo, bleed].joined(separator: ", ")
}

/// The same halation for a shape preview (SVG), where `text-shadow` does
/// nothing. Nil when there is no glow.
public func previewGlowFilter(_ a: PreviewAppearance) -> String? {
    guard let glow = a.glow, glow.bleedAlpha != 0 else { return nil }
    let rgb = warmDrift(a.color, a.glowWarmth)
    let radius = ExifText.toFixed(glow.haloRadiusFrac * 8, 2)
    let alpha = ExifText.toFixed(min(1, glow.bleedAlpha * 2), 2)
    return "drop-shadow(0 0 \(radius)px rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(alpha)))"
}

/// The inline style of a text preview — the web's `CSSProperties`, field by field.
public struct PreviewTextStyle: Equatable, Sendable {
    public var fontFamily: String
    public var fontWeight: FontWeight
    public var fontStyle: String
    public var textTransform: String
    public var letterSpacing: String
    public var color: String
    public var textShadow: String
    public var fontSize: String
}

/// Inline style for a text preview at `fontSize` (any CSS length).
public func previewTextStyle(_ a: PreviewAppearance, _ fontSize: String) -> PreviewTextStyle {
    PreviewTextStyle(
        fontFamily: previewFontStack[a.fontFamily] ?? a.fontFamily.rawValue,
        fontWeight: a.weight,
        fontStyle: a.italic ? "italic" : "normal",
        textTransform: a.uppercase ? "uppercase" : "none",
        letterSpacing: "\(jsNumber(a.letterSpacingEm))em",
        color: a.color,
        textShadow: previewTextShadow(a),
        fontSize: fontSize
    )
}
