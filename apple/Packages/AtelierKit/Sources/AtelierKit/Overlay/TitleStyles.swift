// Title styles — port of `src/shared/overlay/title-styles.ts`: the appearance
// system agreed with the maintainer (`docs/memory/studio.md`). A named PRESET
// is adopted as a project THEME (possibly tweaked), and each element may
// OVERRIDE individual properties — the cascade's third level.
//
// The theme carries appearance only — font, weight, italic, case, colour,
// letter-spacing, legibility, glow — never geometry (position, anchor, bound
// field, text). Size is a MULTIPLIER over the element's own size, so switching
// themes never explodes a layout. Elements saved before themes existed carry
// no `styleOverrides`, which reads as "fully themed": adopting a theme
// restyles the whole deck, the agreed behaviour.
//
// The film glow (the "bave") is ONE 0..1 amount driving four layers
// proportionally — softened core, tight bright halo, wide warm-drifting
// bleed, animated grain — with an advanced per-layer override on top. The
// preset ids (`neutral`, `or-cine`, `pixel-crt`, `plein-cadre`) and names
// ("Or ciné" is the maintainer's branding) are stored and shown as the web's.

import Foundation

// MARK: - model

/// The four glow layers, as fractions of the font size (alpha 0..1).
public struct GlowLayers: Equatable, Sendable {
    /// Softness of the letter body itself (blur radius / font size).
    public var coreBlurFrac: Double
    /// Tight bright halo hugging the strokes.
    public var haloRadiusFrac: Double
    public var haloAlpha: Double
    /// Wide bleed contaminating the image around.
    public var bleedRadiusFrac: Double
    public var bleedAlpha: Double
    /// Animated grain biting the glow region.
    public var grainAlpha: Double

    public init(coreBlurFrac: Double, haloRadiusFrac: Double, haloAlpha: Double,
                bleedRadiusFrac: Double, bleedAlpha: Double, grainAlpha: Double) {
        self.coreBlurFrac = coreBlurFrac; self.haloRadiusFrac = haloRadiusFrac; self.haloAlpha = haloAlpha
        self.bleedRadiusFrac = bleedRadiusFrac; self.bleedAlpha = bleedAlpha; self.grainAlpha = grainAlpha
    }

    static let none = GlowLayers(coreBlurFrac: 0, haloRadiusFrac: 0, haloAlpha: 0, bleedRadiusFrac: 0, bleedAlpha: 0, grainAlpha: 0)
}

/// The web's `Partial<GlowLayers>`: the advanced per-layer tuning, merged
/// over the amount-derived layers.
public struct GlowLayerOverrides: Equatable, Sendable {
    public var coreBlurFrac: Double?
    public var haloRadiusFrac: Double?
    public var haloAlpha: Double?
    public var bleedRadiusFrac: Double?
    public var bleedAlpha: Double?
    public var grainAlpha: Double?

    public init(coreBlurFrac: Double? = nil, haloRadiusFrac: Double? = nil, haloAlpha: Double? = nil,
                bleedRadiusFrac: Double? = nil, bleedAlpha: Double? = nil, grainAlpha: Double? = nil) {
        self.coreBlurFrac = coreBlurFrac; self.haloRadiusFrac = haloRadiusFrac; self.haloAlpha = haloAlpha
        self.bleedRadiusFrac = bleedRadiusFrac; self.bleedAlpha = bleedAlpha; self.grainAlpha = grainAlpha
    }
}

public struct TitleStyle: Equatable, Sendable {
    public var fontFamily: OverlayFontFamily
    public var weight: FontWeight
    public var italic: Bool
    public var uppercase: Bool
    /// Extra letter spacing in em (fraction of font size); 0 = font default.
    public var letterSpacingEm: Double
    public var color: String
    /// Multiplier over each element's own sizeFrac — never an absolute size.
    public var sizeScale: Double
    public var legibility: LegibilityStyle
    /// The one "bave" slider, 0 (matte) .. 1 (fluo).
    public var glowAmount: Double
    /// 0 = halo keeps the ink's hue, 1 = strong warm (orange) drift.
    public var glowWarmth: Double
    /// Advanced per-layer tuning; merged over the amount-derived layers.
    public var glowLayers: GlowLayerOverrides?

    public init(fontFamily: OverlayFontFamily, weight: FontWeight, italic: Bool, uppercase: Bool, letterSpacingEm: Double,
                color: String, sizeScale: Double, legibility: LegibilityStyle, glowAmount: Double, glowWarmth: Double,
                glowLayers: GlowLayerOverrides? = nil) {
        self.fontFamily = fontFamily; self.weight = weight; self.italic = italic; self.uppercase = uppercase
        self.letterSpacingEm = letterSpacingEm; self.color = color; self.sizeScale = sizeScale
        self.legibility = legibility; self.glowAmount = glowAmount; self.glowWarmth = glowWarmth
        self.glowLayers = glowLayers
    }
}

public struct TitleStylePreset: Equatable, Sendable {
    public let id: String
    /// Product name, shown as-is ("Or ciné" — the maintainer's branding).
    public let name: String
    /// One-line character description for the picker.
    public let tagline: String
    public let style: TitleStyle
}

/// A project's theme: the preset it started from plus the author's tweaks.
public struct StyleTheme: Equatable, Sendable {
    public var presetId: String
    public var style: TitleStyle
    public init(presetId: String, style: TitleStyle) { self.presetId = presetId; self.style = style }
}

/// Appearance keys an element can override individually. Stored in
/// `OverlayElement.styleOverrides` as these strings.
public enum ThemableKey: String, CaseIterable, Sendable {
    case fontFamily, weight, italic, color, legibility, uppercase, letterSpacing, glow
}

// MARK: - glow maths

/// Map the single amount to the four layers, proportionally. At 0 everything
/// is off; 0.3 ≈ the muted gold title card; 0.8+ ≈ the fluorescent CRT cards.
/// Advanced overrides are merged last.
public func glowLayersFor(_ style: TitleStyle) -> GlowLayers {
    let a = max(0, min(1, style.glowAmount))
    var g = a == 0 ? GlowLayers.none : GlowLayers(
        coreBlurFrac: a * 0.035,
        haloRadiusFrac: a * 0.12,
        haloAlpha: min(1, 0.35 + a * 0.6),
        bleedRadiusFrac: a * 0.6,
        bleedAlpha: 0.08 + a * 0.3,
        grainAlpha: a * 0.12
    )
    if let o = style.glowLayers {
        if let v = o.coreBlurFrac { g.coreBlurFrac = v }
        if let v = o.haloRadiusFrac { g.haloRadiusFrac = v }
        if let v = o.haloAlpha { g.haloAlpha = v }
        if let v = o.bleedRadiusFrac { g.bleedRadiusFrac = v }
        if let v = o.bleedAlpha { g.bleedAlpha = v }
        if let v = o.grainAlpha { g.grainAlpha = v }
    }
    return g
}

// MARK: - colour helpers (hex in, css colours out)

/// An ASCII hex digit's value — the web's `[0-9a-f]` under `/i`, nothing wider.
private func hexDigit(_ c: Character) -> Int? {
    guard c.isASCII else { return nil }
    return c.hexDigitValue
}

/// `#rgb` / `#rrggbb` → [r, g, b] 0..255; nil for anything else.
public func hexToRgb(_ hex: String) -> [Int]? {
    let chars = Array(hex)
    guard chars.first == "#" else { return nil }
    let digits = chars.dropFirst().map(hexDigit)
    guard digits.allSatisfy({ $0 != nil }) else { return nil }
    let d = digits.map { $0! }
    if d.count == 3 { return [d[0] * 17, d[1] * 17, d[2] * 17] }
    if d.count == 6 { return [d[0] * 16 + d[1], d[2] * 16 + d[3], d[4] * 16 + d[5]] }
    return nil
}

/// JS `Math.round`: halves toward +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

private func clamp255(_ n: Double) -> Int {
    Int(max(0, min(255, jsRound(n))))
}

/// JS `${n}` for the alphas written into an `rgba()`.
private func jsNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// Drift a colour toward warm halation (film print orange) by `warmth` 0..1:
/// red is preserved, green gains a little, blue collapses. On a pure red this
/// yields the rosy-orange rim of the reference cards; on gold, the amber bleed.
public func warmDrift(_ color: String, _ warmth: Double) -> [Int] {
    let rgb = hexToRgb(color) ?? [255, 255, 255]
    let w = max(0, min(1, warmth))
    let r = Double(rgb[0]), g = Double(rgb[1]), b = Double(rgb[2])
    let red = r + (255 - r) * w * 0.25
    let green = g + (max(g, 140) - g) * w * 0.5
    let blue = b * (1 - w * 0.75)
    return [clamp255(red), clamp255(green), clamp255(blue)]
}

/// `rgba()` string from a hex colour and an alpha.
public func withAlpha(_ color: String, _ alpha: Double) -> String {
    let rgb = hexToRgb(color) ?? [255, 255, 255]
    return "rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(jsNumber(alpha)))"
}

/// Brightened version of the ink for the tight halo (toward white).
public func halolight(_ color: String, _ alpha: Double) -> String {
    let rgb = (hexToRgb(color) ?? [255, 255, 255]).map { c -> Int in
        let v = Double(c)
        return clamp255(v + (255 - v) * 0.55)
    }
    return "rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(jsNumber(alpha)))"
}

// MARK: - cascade resolution

/// What the renderer needs, after preset → theme → override resolution.
public struct ResolvedStyle: Equatable, Sendable {
    public var fontFamily: OverlayFontFamily
    public var weight: FontWeight
    public var italic: Bool
    public var color: String
    public var legibility: LegibilityStyle
    public var uppercase: Bool
    public var letterSpacingEm: Double
    /// Effective size fraction (element size × theme multiplier).
    public var sizeFrac: Double
    /// Fully-derived glow layers, or nil when there is no glow at all.
    public var glow: GlowLayers?
    public var glowWarmth: Double
}

private func overridden(_ el: OverlayElement, _ key: ThemableKey) -> Bool {
    el.styleOverrides?.contains(key.rawValue) ?? false
}

/// Resolve an element's appearance under a theme. No theme (themeless
/// projects, the legacy pages): the element's own values, exactly as before
/// themes existed. A theme: its values, except for keys the element overrides.
public func resolveElementStyle(_ el: OverlayElement, _ theme: StyleTheme?) -> ResolvedStyle {
    guard let theme else {
        let amount = el.glowAmount ?? 0
        let warmth = el.glowWarmth ?? 0.5
        var glowStyle = fallbackStyle
        glowStyle.glowAmount = amount
        glowStyle.glowWarmth = warmth
        return ResolvedStyle(
            fontFamily: el.fontFamily, weight: el.weight, italic: el.italic, color: el.color, legibility: el.legibility,
            uppercase: el.uppercase ?? false, letterSpacingEm: el.letterSpacingEm ?? 0, sizeFrac: el.sizeFrac,
            glow: amount > 0 ? glowLayersFor(glowStyle) : nil, glowWarmth: warmth
        )
    }

    let t = theme.style
    let glowOwn = overridden(el, .glow)
    let glowAmount = glowOwn ? (el.glowAmount ?? 0) : t.glowAmount
    let glowWarmth = glowOwn ? (el.glowWarmth ?? 0.5) : t.glowWarmth
    var glowStyle = t
    glowStyle.glowAmount = glowAmount
    glowStyle.glowWarmth = glowWarmth
    return ResolvedStyle(
        fontFamily: overridden(el, .fontFamily) ? el.fontFamily : t.fontFamily,
        weight: overridden(el, .weight) ? el.weight : t.weight,
        italic: overridden(el, .italic) ? el.italic : t.italic,
        color: overridden(el, .color) ? el.color : t.color,
        legibility: overridden(el, .legibility) ? el.legibility : t.legibility,
        uppercase: overridden(el, .uppercase) ? (el.uppercase ?? false) : t.uppercase,
        letterSpacingEm: overridden(el, .letterSpacing) ? (el.letterSpacingEm ?? 0) : t.letterSpacingEm,
        sizeFrac: el.sizeFrac * t.sizeScale,
        glow: glowAmount > 0 ? glowLayersFor(glowStyle) : nil,
        glowWarmth: glowWarmth
    )
}

// MARK: - presets

private let noBox = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0.65)", padFrac: 0.3)

private let fallbackStyle = TitleStyle(
    fontFamily: .spaceGrotesk, weight: 600, italic: false, uppercase: false, letterSpacingEm: 0, color: "#ffffff",
    sizeScale: 1, legibility: LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.65)", padFrac: 0.3),
    glowAmount: 0, glowWarmth: 0.5
)

/// The built-in looks. "Neutral" is the themeless default made explicit; the
/// three signature presets come from the maintainer's reference imagery (gold
/// optical-print credits, CRT phosphor data cards, full-bleed red statements).
/// The web's `TITLE_STYLE_PRESETS`.
public let titleStylePresets: [TitleStylePreset] = [
    TitleStylePreset(id: "neutral", name: "Neutral", tagline: "Clean readouts, drop shadow, no glow", style: fallbackStyle),
    TitleStylePreset(id: "or-cine", name: "Or ciné", tagline: "Optical-print gold serif, muted halation", style: TitleStyle(
        fontFamily: .instrumentSerif, weight: 400, italic: false, uppercase: false, letterSpacingEm: 0.01,
        color: "#f2c230", sizeScale: 1, legibility: noBox, glowAmount: 0.35, glowWarmth: 0.7
    )),
    TitleStylePreset(id: "pixel-crt", name: "Pixel CRT", tagline: "Terminal red on phosphor, fluo bleed", style: TitleStyle(
        fontFamily: .vt323, weight: 400, italic: false, uppercase: false, letterSpacingEm: 0.02,
        color: "#e02015", sizeScale: 1.15, legibility: noBox, glowAmount: 0.75, glowWarmth: 0.35
    )),
    TitleStylePreset(id: "plein-cadre", name: "Rouge plein cadre", tagline: "Flat saturated caps, no glow, full confidence", style: TitleStyle(
        fontFamily: .spaceGrotesk, weight: 700, italic: false, uppercase: true, letterSpacingEm: -0.01,
        color: "#f01d0e", sizeScale: 1, legibility: noBox, glowAmount: 0.08, glowWarmth: 0.5
    )),
]

public func presetById(_ id: String) -> TitleStylePreset? {
    titleStylePresets.first { $0.id == id }
}

/// A fresh theme adopting `presetId` — a copy (a value), so tweaks never touch the preset.
public func themeFromPreset(_ presetId: String) -> StyleTheme? {
    guard let preset = presetById(presetId) else { return nil }
    return StyleTheme(presetId: presetId, style: preset.style)
}

// MARK: - JSON

private let glowLayerKeys = ["coreBlurFrac", "haloRadiusFrac", "haloAlpha", "bleedRadiusFrac", "bleedAlpha", "grainAlpha"]

/// A stored title style read back — nil when it is not a record; a missing
/// field takes the neutral look's value.
public func readTitleStyle(_ v: JSONValue?) -> TitleStyle? {
    guard let o = v?.objectValue else { return nil }
    typealias J = OverlayJSON
    let d = fallbackStyle
    var style = TitleStyle(
        fontFamily: J.value(o, "fontFamily", OverlayFontFamily.self) ?? d.fontFamily,
        weight: J.weight(o, "weight") ?? d.weight,
        italic: J.bool(o, "italic") ?? d.italic,
        uppercase: J.bool(o, "uppercase") ?? d.uppercase,
        letterSpacingEm: J.number(o, "letterSpacingEm") ?? d.letterSpacingEm,
        color: J.string(o, "color") ?? d.color,
        sizeScale: J.number(o, "sizeScale") ?? d.sizeScale,
        legibility: readLegibilityStyle(o["legibility"]) ?? d.legibility,
        glowAmount: J.number(o, "glowAmount") ?? d.glowAmount,
        glowWarmth: J.number(o, "glowWarmth") ?? d.glowWarmth
    )
    if let g = o["glowLayers"]?.objectValue {
        style.glowLayers = GlowLayerOverrides(
            coreBlurFrac: J.number(g, "coreBlurFrac"), haloRadiusFrac: J.number(g, "haloRadiusFrac"),
            haloAlpha: J.number(g, "haloAlpha"), bleedRadiusFrac: J.number(g, "bleedRadiusFrac"),
            bleedAlpha: J.number(g, "bleedAlpha"), grainAlpha: J.number(g, "grainAlpha")
        )
    }
    return style
}

/// A stored theme read back — nil when it is not a record or holds no style.
public func readStyleTheme(_ v: JSONValue?) -> StyleTheme? {
    guard let o = v?.objectValue, let style = readTitleStyle(o["style"]) else { return nil }
    return StyleTheme(presetId: OverlayJSON.string(o, "presetId") ?? "neutral", style: style)
}

extension TitleStyle {
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "fontFamily": .string(fontFamily.rawValue), "weight": .number(Double(weight)), "italic": .bool(italic),
            "uppercase": .bool(uppercase), "letterSpacingEm": .number(letterSpacingEm), "color": .string(color),
            "sizeScale": .number(sizeScale), "legibility": legibility.json, "glowAmount": .number(glowAmount),
            "glowWarmth": .number(glowWarmth),
        ]
        if let g = glowLayers {
            var layers: [String: JSONValue] = [:]
            let values = [g.coreBlurFrac, g.haloRadiusFrac, g.haloAlpha, g.bleedRadiusFrac, g.bleedAlpha, g.grainAlpha]
            for (key, value) in zip(glowLayerKeys, values) { OverlayJSON.put(&layers, key, value) }
            o["glowLayers"] = .object(layers)
        }
        return .object(o)
    }
}

extension StyleTheme {
    public var json: JSONValue {
        .object(["presetId": .string(presetId), "style": style.json])
    }
}
