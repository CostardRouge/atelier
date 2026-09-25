// Studio Papier, in SwiftUI — the web app's `src/index.css` tokens, one for one.
//
// Ink on warm cream by day, warm ink by night (`Palette.paper`), and a
// hue-less grey DARKROOM wherever a picture is being judged (`Palette.darkroom`):
// the same rule as the web, where a grading screen is neutral under either
// theme because the eye must not adapt to a coloured surround. Every screen
// reads its colours from the environment (`\.palette`), so switching a
// screen to the darkroom is one modifier and never a second set of views.
//
// Type: the brand's faces travel with the app (`Resources/Fonts`, the OFL
// files the web serves from its own origin since 2026-09-24): Space Grotesk
// for the interface, Instrument Serif for a title, JetBrains Mono for
// numerals, VT323 for the Pixel CRT title style. `Brand` is the one place
// that names them; a weight is set on the variable font's own `wght` axis, so
// the web's 600 is exactly 600 and never the nearest named instance. Where a
// file failed to register, the slot falls back to the system face rather
// than to Times.

import SwiftUI
import CoreText

struct Palette: Equatable {
    var paper: Color
    var paper2: Color
    var surface: Color
    var ink: Color
    var inkSoft: Color
    var muted: Color
    var faint: Color
    var line: Color
    var lineStrong: Color
    var accent: Color
    var accentInk: Color
    var accentWash: Color
    /// The near-black behind a picture.
    var frame: Color
    /// Light ink laid ON a picture — fixed, a photograph does not turn dark at night.
    let onMedia = Color(hex: 0xF4F0E7)
    var danger: Color
    var ok: Color
    var warn: Color
    /// True under the neutral greys.
    var isDarkroom: Bool

    /// The page: warm paper by day, Winnow's night palette after dark.
    static let paper = Palette(
        paper: Color(light: 0xF4F0E7, dark: 0x16130E),
        paper2: Color(light: 0xEFE9DD, dark: 0x1D1912),
        surface: Color(light: 0xFBF8F1, dark: 0x2A251C),
        ink: Color(light: 0x1B1813, dark: 0xF2ECE0),
        inkSoft: Color(light: 0x4F4A40, dark: 0xCFC6B5),
        muted: Color(light: 0x938B7C, dark: 0xA49A86),
        faint: Color(light: 0xB6AD9C, dark: 0x6F6656),
        line: Color(light: 0xE2DAC9, dark: 0x3B3429),
        lineStrong: Color(light: 0xD2C8B3, dark: 0x51493B),
        accent: Color(light: 0xD9442A, dark: 0xEF5638),
        accentInk: Color(light: 0xB2331E, dark: 0xF5745A),
        accentWash: Color(light: 0xF6E6DF, dark: 0x3B211B),
        frame: Color(light: 0x100F0D, dark: 0x0A0908),
        danger: Color(light: 0x9A3A23, dark: 0xD85A5A),
        ok: Color(light: 0x3F7A52, dark: 0x57A06A),
        warn: Color(light: 0x8A6A1F, dark: 0xE0A52A),
        isDarkroom: false
    )

    /// The darkroom: the same tokens, neutral, under a grading screen. The
    /// accent stays the accent.
    static let darkroom = Palette(
        paper: Color(hex: 0x262626),
        paper2: Color(hex: 0x2E2E2E),
        surface: Color(hex: 0x303030),
        ink: Color(hex: 0xECECEC),
        inkSoft: Color(hex: 0xC9C9C9),
        muted: Color(hex: 0x9B9B9B),
        faint: Color(hex: 0x6E6E6E),
        line: Color(hex: 0x3B3B3B),
        lineStrong: Color(hex: 0x4B4B4B),
        accent: Color(hex: 0xD9442A),
        accentInk: Color(hex: 0xEF6C52),
        accentWash: Color(hex: 0xD9442A, alpha: 0.16),
        frame: Color(hex: 0x101010),
        danger: Color(hex: 0xF08A80),
        ok: Color(hex: 0x86C79B),
        warn: Color(hex: 0xE2B555),
        isDarkroom: true
    )
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.paper
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

extension View {
    /// Put this screen in the darkroom: neutral greys, and the system's own
    /// controls told to agree with them.
    func darkroom() -> some View {
        environment(\.palette, .darkroom)
            .preferredColorScheme(.dark)
            .tint(Palette.darkroom.accent)
    }
}

/// The type slots. `sans` is the interface (Space Grotesk), `display` the
/// serif of a title (Instrument Serif), `mono` the numerals (JetBrains Mono),
/// `pixel` the CRT title style (VT323), `eyebrow` the small capitals over a
/// section.
enum Brand {
    /// PostScript names of the bundled files' default faces. The two variable
    /// files answer to their default instance's name; the weight is then a
    /// variation, not another name.
    static let sansName = "SpaceGrotesk-Light"
    static let monoName = "JetBrainsMono-Regular"
    static let serifName = "InstrumentSerif-Regular"
    static let serifItalicName = "InstrumentSerif-Italic"
    static let pixelName = "VT323-Regular"

    /// Register every `.ttf` in the bundle for this process. Called once at
    /// launch; a second call is harmless (the manager refuses a duplicate).
    static func registerFonts() {
        guard let urls = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) else { return }
        for url in urls {
            var error: Unmanaged<CFError>?
            _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        }
        registered = Set(urls.compactMap { url in
            (CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor])?
                .compactMap { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String }
        }.flatMap { $0 })
    }

    private static var registered = Set<String>()
    private static let wghtAxis = 0x77676874 // 'wght'

    static func sans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        face(sansName, size: size, weight: axisWeight(weight)) ?? .system(size: size, weight: weight)
    }

    static func display(_ size: CGFloat, italic: Bool = false) -> Font {
        face(italic ? serifItalicName : serifName, size: size)
            ?? .system(size: size, weight: .regular, design: .serif)
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        face(monoName, size: size, weight: axisWeight(weight)) ?? .system(size: size, weight: weight, design: .monospaced)
    }

    static func pixel(_ size: CGFloat) -> Font {
        face(pixelName, size: size) ?? .system(size: size, weight: .regular, design: .monospaced)
    }

    static var eyebrow: Font { mono(11, weight: .medium) }

    /// A bundled face at a size, its `wght` axis set when asked; nil when the
    /// file is not registered, so the caller can fall back to the system.
    private static func face(_ name: String, size: CGFloat, weight: CGFloat? = nil) -> Font? {
        guard registered.contains(name) else { return nil }
        var font = CTFontCreateWithName(name as CFString, size, nil)
        if let weight {
            let variation: [NSNumber: NSNumber] = [NSNumber(value: wghtAxis): NSNumber(value: Double(weight))]
            let descriptor = CTFontDescriptorCreateWithAttributes([kCTFontVariationAttribute: variation] as CFDictionary)
            font = CTFontCreateCopyWithAttributes(font, size, nil, descriptor)
        }
        return Font(font)
    }

    /// The CSS weights the web uses, on the axis.
    private static func axisWeight(_ weight: Font.Weight) -> CGFloat {
        switch weight {
        case .ultraLight: return 200
        case .thin: return 250
        case .light: return 300
        case .regular: return 400
        case .medium: return 500
        case .semibold: return 600
        case .bold: return 700
        case .heavy: return 800
        case .black: return 900
        default: return 400
        }
    }

    /// Winnow's 11px control radius, so a button reads as the same object in both apps.
    static let controlRadius: CGFloat = 11
    static let paperRadius: CGFloat = 14
}

extension Color {
    /// `0xRRGGBB` → an sRGB colour.
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    /// A colour that follows the system appearance, the way a CSS token
    /// redefined under `[data-theme='dark']` does.
    init(light: UInt32, dark: UInt32) {
        #if os(iOS)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
        #else
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light)
        })
        #endif
    }
}

#if os(iOS)
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#else
extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif

// MARK: - the small shared pieces every screen draws

/// A mono eyebrow over a section: `LIGHT`, `COLOUR`, `EXPORT`.
struct Eyebrow: View {
    let text: String
    @Environment(\.palette) private var palette

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(Brand.eyebrow)
            .kerning(1.2)
            .foregroundStyle(palette.muted)
    }
}

/// A hairline, the `line` token.
struct Hairline: View {
    @Environment(\.palette) private var palette
    var body: some View {
        Rectangle().fill(palette.line).frame(height: 1)
    }
}
