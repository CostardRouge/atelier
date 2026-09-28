// The web's canvas font stacks, resolved through Core Text — how a painter
// under `Paint/` turns `600 54px 'Space Grotesk', sans-serif` into glyphs.
//
// The rules, each the browser's:
// - A family is used when the system HAS it; the families after it form the
//   CASCADE a missing glyph falls through, and Core Text's own system cascade
//   (Apple Color Emoji included) comes after those. The memory's trap —
//   an emoji default drew NOTHING where no colour-emoji face existed — is
//   why no glyph is ever left to a single face: a character the brand faces
//   lack still draws, in whatever face has it.
// - The brand faces are the bundled files `Brand.registerFonts()` registers
//   at launch (`Theme/Theme.swift`), asked for by their PostScript names. The
//   two VARIABLE files (Space Grotesk, JetBrains Mono) take the weight on
//   their `wght` axis, exactly as `Brand` does: the web's 600 is 600, never
//   the nearest named instance.
// - A face with no such weight or no italic is SYNTHESISED, as Chrome does:
//   a bold asked of a single-weight face (Instrument Serif, VT323) is a
//   fill-and-stroke of Skia's width (1/24 of the size at 9 px, 1/32 from
//   36 px), an italic asked of an upright-only face a quarter skew.
// - The generic families are the ones a Mac browser maps them to:
//   `sans-serif` Helvetica, `serif` Times New Roman, `monospace` Courier,
//   `ui-monospace` the system's monospaced face.
//
// Measuring is the canvas's `measureText`: the ADVANCE width, letter spacing
// after every character included (Core Text's kern does exactly that), and
// the INK ascent and descent of the glyphs actually set.

import CoreGraphics
import CoreText
import Foundation
import AtelierKit

/// A canvas `font`: families in order (generics included), a pixel size, a
/// CSS weight and an italic flag.
struct PaintFont: Hashable {
    var families: [String]
    var size: Double
    var weight: Int
    var italic: Bool

    init(_ families: [String], size: Double, weight: Int = 400, italic: Bool = false) {
        self.families = families; self.size = size; self.weight = weight; self.italic = italic
    }

    /// The web's `fontString(st, px)`: the element's family, then the generic
    /// its kind of face falls back to.
    static func overlay(_ st: ResolvedStyle, _ fontPx: Double) -> PaintFont {
        PaintFont([st.fontFamily.rawValue, PaintFonts.genericFallback(st.fontFamily)],
                  size: fontPx, weight: st.weight, italic: st.italic)
    }
}

/// One line of text set in a `PaintFont`, measured.
struct PaintLine {
    let line: CTLine
    /// Advance width, letter spacing included.
    let width: Double
    /// Ink above and below the alphabetic baseline.
    let inkAscent: Double
    let inkDescent: Double
    /// The primary face's em box, split at the baseline (sums to the size):
    /// what a canvas's `top`, `middle` and `bottom` baselines are measured on.
    let emAscent: Double
    let emDescent: Double
}

enum PaintFonts {
    /// The web's `genericFallback`.
    static func genericFallback(_ family: OverlayFontFamily) -> String {
        switch family {
        case .jetBrainsMono, .courierNew, .vt323: return "monospace"
        case .instrumentSerif, .georgia: return "serif"
        default: return "sans-serif"
        }
    }

    /// The measure the kernel's layout asks for (`OverlayGeometry.Measure`):
    /// the element's own face at `fontPx`, with `spacing` after each character.
    static let overlayMeasure: OverlayGeometry.Measure = { text, style, fontPx, spacing in
        let line = PaintFonts.line(text, .overlay(style, fontPx), letterSpacing: spacing)
        return OverlayTextMetrics(width: line.width, ascent: line.inkAscent, descent: line.inkDescent)
    }

    // MARK: - lines

    /// `text` set in `font`, with `letterSpacing` pixels after every
    /// character. The colour is the context's fill at draw time.
    static func line(_ text: String, _ font: PaintFont, letterSpacing: Double = 0) -> PaintLine {
        let resolved = resolve(font)
        var attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): resolved.font,
            NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]
        if letterSpacing != 0 {
            attributes[NSAttributedString.Key(kCTKernAttributeName as String)] = NSNumber(value: letterSpacing)
        }
        if resolved.syntheticBold {
            // Negative: fill AND stroke, the stroke in percent of the size.
            attributes[NSAttributedString.Key(kCTStrokeWidthAttributeName as String)] = NSNumber(value: -fakeBoldPercent(font.size))
        }
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attributed as CFAttributedString)
        var typoAscent: CGFloat = 0
        var typoDescent: CGFloat = 0
        let width = Double(CTLineGetTypographicBounds(line, &typoAscent, &typoDescent, nil))
        let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
        var inkAscent = ink.isNull ? 0 : Double(ink.maxY)
        var inkDescent = ink.isNull ? 0 : Double(-ink.minY)
        if (ink.isNull || ink.height <= 0), width > 0, text.contains(where: { !$0.isWhitespace }) {
            // A colour glyph (an emoji) is a bitmap with no outline: its ink
            // is its line's own height, or the element could not be grabbed.
            inkAscent = Double(typoAscent)
            inkDescent = Double(typoDescent)
        }
        let ascent = Double(CTFontGetAscent(resolved.font))
        let descent = Double(CTFontGetDescent(resolved.font))
        let em = ascent + descent
        let emAscent = em > 0 ? font.size * ascent / em : font.size * 0.8
        return PaintLine(line: line, width: width, inkAscent: inkAscent, inkDescent: inkDescent,
                         emAscent: emAscent, emDescent: font.size - emAscent)
    }

    /// Skia's fake-bold outset over the size, in percent, the way Core Text's
    /// stroke width is given.
    private static func fakeBoldPercent(_ size: Double) -> Double {
        let lo = 1.0 / 24, hi = 1.0 / 32
        let t = max(0, min(1, (size - 9) / (36 - 9)))
        return 100 * (lo + (hi - lo) * t)
    }

    // MARK: - resolving a stack

    struct Resolved {
        let font: CTFont
        let syntheticBold: Bool
        /// The PostScript name of the face actually chosen — what a spec
        /// checks to know the brand face was used.
        let postScriptName: String
    }

    private static let lock = NSLock()
    private static var cache: [PaintFont: Resolved] = [:]

    /// The first family of the stack the system has, at the size, weight and
    /// slant asked for, with the rest as its cascade. Never nil: an empty or
    /// wholly missing stack is Helvetica.
    static func resolve(_ font: PaintFont) -> Resolved {
        lock.lock()
        if let hit = cache[font] { lock.unlock(); return hit }
        lock.unlock()
        let made = make(font)
        lock.lock()
        if cache.count > 512 { cache.removeAll() }
        cache[font] = made
        lock.unlock()
        return made
    }

    private static let wghtAxis = 0x77676874 // 'wght'
    /// Chrome's synthetic oblique: `skewX(-1/4)` in y-down, +1/4 in glyph space.
    private static let obliqueSkew = CGAffineTransform(a: 1, b: 0, c: 0.25, d: 1, tx: 0, ty: 0)

    /// A face the stack can land on: a CTFont at the size, and what the
    /// browser would synthesise over it.
    private struct Face {
        var font: CTFont
        var needsBold: Bool
        var needsItalic: Bool
    }

    private static func make(_ font: PaintFont) -> Resolved {
        let size = CGFloat(max(0.5, font.size))
        var chosen: Face? = nil
        var rest: [String] = []
        for (i, family) in font.families.enumerated() {
            if let found = Self.face(family, size: size, weight: font.weight, italic: font.italic) {
                chosen = found
                rest = Array(font.families[(i + 1)...])
                break
            }
        }
        let picked = chosen
            ?? Face(font: CTFontCreateWithName("Helvetica" as CFString, size, nil), needsBold: false, needsItalic: false)
        var attributes: [CFString: Any] = [:]
        let cascade = rest.compactMap { cascadeDescriptor($0, weight: font.weight, italic: font.italic) }
        if !cascade.isEmpty { attributes[kCTFontCascadeListAttribute] = cascade }
        var ctFont = picked.font
        if !attributes.isEmpty || picked.needsItalic {
            let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
            var matrix = obliqueSkew
            ctFont = withUnsafePointer(to: &matrix) { m in
                CTFontCreateCopyWithAttributes(picked.font, size, picked.needsItalic ? m : nil, descriptor)
            }
        }
        let name = CTFontCopyPostScriptName(ctFont) as String
        return Resolved(font: ctFont, syntheticBold: picked.needsBold, postScriptName: name)
    }

    /// A bundled face by PostScript name, or nil when it did not register.
    private static func named(_ name: String, _ size: CGFloat) -> CTFont? {
        let font = CTFontCreateWithName(name as CFString, size, nil)
        return (CTFontCopyPostScriptName(font) as String) == name ? font : nil
    }

    /// A variable face with its `wght` axis set.
    private static func weighted(_ font: CTFont, _ size: CGFloat, _ weight: Double) -> CTFont {
        let variation: [NSNumber: NSNumber] = [NSNumber(value: wghtAxis): NSNumber(value: weight)]
        let descriptor = CTFontDescriptorCreateWithAttributes([kCTFontVariationAttribute: variation] as CFDictionary)
        return CTFontCreateCopyWithAttributes(font, size, nil, descriptor)
    }

    /// One family of a stack at the asked weight and slant, or nil when the
    /// system does not have it.
    private static func face(_ family: String, size: CGFloat, weight: Int, italic: Bool) -> Face? {
        let bold = weight >= 600
        switch family {
        case OverlayFontFamily.spaceGrotesk.rawValue:
            // Variable 300…700; no italic file, so an italic is synthesised.
            guard let base = named("SpaceGrotesk-Light", size) else { return nil }
            let w = Double(max(300, min(700, weight)))
            return Face(font: weighted(base, size, w), needsBold: false, needsItalic: italic)
        case OverlayFontFamily.jetBrainsMono.rawValue:
            // Variable 100…800, with a true italic file.
            let upright = named("JetBrainsMono-Regular", size)
            let slanted = italic ? named("JetBrainsMono-Italic", size) : nil
            guard let base = slanted ?? upright else { return nil }
            let w = Double(max(100, min(800, weight)))
            return Face(font: weighted(base, size, w), needsBold: false, needsItalic: italic && slanted == nil)
        case OverlayFontFamily.instrumentSerif.rawValue:
            let slanted = italic ? named("InstrumentSerif-Italic", size) : nil
            guard let base = slanted ?? named("InstrumentSerif-Regular", size) else { return nil }
            return Face(font: base, needsBold: bold, needsItalic: italic && slanted == nil)
        case OverlayFontFamily.vt323.rawValue:
            guard let base = named("VT323-Regular", size) else { return nil }
            return Face(font: base, needsBold: bold, needsItalic: italic)
        case "ui-monospace":
            return Face(font: systemMonospaced(size, weight), needsBold: false, needsItalic: italic)
        default:
            guard let systemFamily = systemName(family) else { return nil }
            return systemFace(systemFamily, size: size, bold: bold, italic: italic)
        }
    }

    /// A family name as the system knows it: the generics mapped, anything
    /// else as written.
    private static func systemName(_ family: String) -> String? {
        switch family {
        case "sans-serif", "system-ui": return "Helvetica"
        case "serif": return "Times New Roman"
        case "monospace": return "Courier"
        case "": return nil
        default: return family
        }
    }

    /// A system family by name with CSS's matching: the bold face from 600,
    /// the italic face when there is one; what the family lacks is synthesised.
    private static func systemFace(_ family: String, size: CGFloat, bold: Bool, italic: Bool) -> Face? {
        var traits: UInt32 = 0
        if bold { traits |= CTFontSymbolicTraits.traitBold.rawValue }
        if italic { traits |= CTFontSymbolicTraits.traitItalic.rawValue }
        let attributes: [CFString: Any] = [
            kCTFontFamilyNameAttribute: family,
            kCTFontTraitsAttribute: [kCTFontSymbolicTrait: NSNumber(value: traits)],
        ]
        let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
        let font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
        guard (CTFontCopyFamilyName(font) as String) == family else { return nil }
        let got = CTFontGetSymbolicTraits(font)
        return Face(font: font,
                    needsBold: bold && !got.contains(.traitBold),
                    needsItalic: italic && !got.contains(.traitItalic))
    }

    /// The system's fixed-pitch face — `ui-monospace` — bold from 600.
    private static func systemMonospaced(_ size: CGFloat, _ weight: Int) -> CTFont {
        let base = CTFontCreateUIFontForLanguage(.userFixedPitch, size, nil)
            ?? CTFontCreateWithName("Menlo" as CFString, size, nil)
        if weight >= 600, let bold = CTFontCreateCopyWithSymbolicTraits(base, size, nil, .traitBold, .traitBold) {
            return bold
        }
        return base
    }

    /// A later family of a stack as a cascade entry, when the system has it.
    private static func cascadeDescriptor(_ family: String, weight: Int, italic: Bool) -> CTFontDescriptor? {
        guard let found = Self.face(family, size: 12, weight: weight, italic: italic) else { return nil }
        return CTFontCopyFontDescriptor(found.font)
    }
}
