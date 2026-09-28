// The overview's two colour scales: a day's RUNG (its colours are the tool's
// one ramp, `Palette.heatmapLevel` in `Trips/HeatmapRamp.swift`, which the
// gallery's rhythm strip draws too — a trip's card and its calendar must not
// disagree about what a day looks like) and a leg's TINT.
//
// The rungs are the question the maintainer asks the calendar, in order:
// nothing here · something drafted but never sent · sent once · twice · more.
//
// The TINTS are the kernel's own CSS strings (`stageTint`), four muted oklch
// colours at one lightness, converted here to sRGB — so a fifth tint added to
// the kernel reaches the calendar with no change in this file. A ribbon mixes
// its tint with the paper the web's way (`color-mix(in oklch, tint 30%,
// paper)`, 55 % for the open leg); here it is the tint at that opacity OVER
// the paper, which reads the same at a ribbon's size.

import SwiftUI
import AtelierKit

/// The five rungs of a day, and how each is drawn.
enum CalendarRungs {
    /// A day's rung — 0 nothing · 1 drafted · 2 published once · 3 twice · 4
    /// more. The web's `levelOf`.
    static func level(of cell: DayCell) -> Int {
        if cell.posts.isEmpty { return 0 }
        if cell.published == 0 { return 1 }
        return min(2 + cell.published - 1, 4)
    }

    /// The day's number on its rung: the paper on the two strong rungs, muted
    /// on bare paper, the soft ink between.
    static func ink(_ level: Int, _ palette: Palette) -> Color {
        if level >= 3 { return palette.paper }
        if level == 0 { return palette.muted }
        return palette.inkSoft
    }
}

/// A leg's tint, by its index in the trip's stages.
enum OverviewLegTint {
    /// The kernel's tint for leg `index`, as a colour. A string this parser
    /// cannot read falls back to the line token's grey, never to a colour
    /// the kernel did not name.
    static func color(_ index: Int) -> Color {
        let n = tints.count
        guard n > 0 else { return fallback }
        return tints[((index % n) + n) % n]
    }

    /// The ribbon's ground: the tint over the paper, darker for the open leg.
    static func ribbon(_ index: Int, open: Bool) -> Color {
        color(index).opacity(open ? 0.55 : 0.30)
    }

    private static let fallback = Color(hex: 0xB6AD9C)

    /// The kernel's tints, converted once — `stageTint` cycles through them.
    private static let tints: [Color] = stageTints.map { css -> Color in
        guard let rgb = OverviewLegTint.oklchToSRGB(css) else { return OverviewLegTint.fallback }
        return Color(.sRGB, red: rgb.r, green: rgb.g, blue: rgb.b, opacity: 1)
    }

    /// `oklch(L% C H)` → sRGB codes in 0…1 (Björn Ottosson's OKLab matrices),
    /// clipped to the gamut. Nil for anything else.
    static func oklchToSRGB(_ css: String) -> (r: Double, g: Double, b: Double)? {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        guard s.hasPrefix("oklch("), s.hasSuffix(")") else { return nil }
        let inner = s.dropFirst(6).dropLast()
        let parts = inner.split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init)
        guard parts.count >= 3 else { return nil }
        let lightness: Double
        if parts[0].hasSuffix("%") {
            guard let v = Double(parts[0].dropLast()) else { return nil }
            lightness = v / 100
        } else {
            guard let v = Double(parts[0]) else { return nil }
            lightness = v
        }
        guard let chroma = Double(parts[1]),
              let hue = Double(parts[2].replacingOccurrences(of: "deg", with: "")) else { return nil }
        let radians = hue * .pi / 180
        let a = chroma * cos(radians)
        let b = chroma * sin(radians)

        let lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
        let mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
        let sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b
        let l = lPrime * lPrime * lPrime
        let m = mPrime * mPrime * mPrime
        let sc = sPrime * sPrime * sPrime

        let rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sc
        let gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sc
        let bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * sc
        return (encode(rLin), encode(gLin), encode(bLin))
    }

    /// Linear light → an sRGB code, clipped.
    private static func encode(_ linear: Double) -> Double {
        let x = min(1, max(0, linear))
        return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
    }
}

#Preview("Rungs and tints") {
    OverviewColorsPreview()
}

private struct OverviewColorsPreview: View {
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 4) {
                ForEach(0..<5, id: \.self) { level in
                    Text("\(level + 11)")
                        .font(Brand.mono(12))
                        .foregroundStyle(CalendarRungs.ink(level, palette))
                        .frame(width: 46, height: 41)
                        .background(RoundedRectangle(cornerRadius: 8).fill(palette.heatmapLevel(level)))
                }
            }
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { index in
                    VStack(spacing: 4) {
                        Circle().fill(OverviewLegTint.color(index)).frame(width: 12, height: 12)
                        Capsule().fill(OverviewLegTint.ribbon(index, open: index == 1)).frame(width: 60, height: 12)
                    }
                }
            }
        }
        .padding(24)
        .background(palette.paper)
    }
}
