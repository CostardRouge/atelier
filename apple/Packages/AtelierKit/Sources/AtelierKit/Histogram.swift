// The develop's one instrument: a luminance histogram of the picture as it will
// be delivered, with how much of it is clipped at either end — and AUTO, what
// the picture itself says its correction should be. Port of
// `src/shared/develop/histogram.ts` and `auto-develop.ts`.

import Foundation

/// How many bins the strip draws.
public let histogramBins = 64
/// The long edge the picture is shrunk to before it is read.
public let histogramSampleEdge = 160

private let whiteCode = 254
private let blackCode = 1

public struct Histogram: Equatable, Sendable {
    /// Pixels per luminance bin, dark to light.
    public var bins: [Int]
    public var total: Int
    /// Share (0..1) of pixels with at least one channel at white.
    public var clippedHighlights: Double
    /// Share (0..1) of pixels with every channel at black.
    public var crushedShadows: Double
}

/// The histogram of RGBA bytes. Luminance is the Rec.709 weighting of the
/// ENCODED values; alpha is ignored.
public func luminanceHistogram(_ rgba: UnsafeBufferPointer<UInt8>, binCount: Int = histogramBins) -> Histogram {
    let count = max(1, binCount)
    var bins = [Int](repeating: 0, count: count)
    let pixels = rgba.count / 4
    var highs = 0, lows = 0
    for i in 0..<pixels {
        let o = i * 4
        let r = Int(rgba[o]), g = Int(rgba[o + 1]), b = Int(rgba[o + 2])
        let y = 0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)
        bins[min(count - 1, max(0, Int((y * Double(count) / 256).rounded(.down))))] += 1
        if r >= whiteCode || g >= whiteCode || b >= whiteCode { highs += 1 }
        else if r <= blackCode && g <= blackCode && b <= blackCode { lows += 1 }
    }
    return Histogram(bins: bins, total: pixels,
                     clippedHighlights: pixels > 0 ? Double(highs) / Double(pixels) : 0,
                     crushedShadows: pixels > 0 ? Double(lows) / Double(pixels) : 0)
}

public func luminanceHistogram(_ rgba: [UInt8], binCount: Int = histogramBins) -> Histogram {
    rgba.withUnsafeBufferPointer { luminanceHistogram($0, binCount: binCount) }
}

/// Bar heights 0..1 for drawing, scaled on the tallest INNER bin; the end bins
/// are capped at the top — their excess is what the clip marks say in words.
public func histogramShape(_ histogram: Histogram) -> [Double] {
    let bins = histogram.bins
    let inner = bins.count > 2 ? Array(bins[1..<(bins.count - 1)]) : bins
    let innerPeak = max(0, inner.max() ?? 0)
    let peak = innerPeak > 0 ? innerPeak : max(0, bins.max() ?? 0)
    if peak <= 0 { return bins.map { _ in 0 } }
    return bins.map { min(1, Double($0) / Double(peak)) }
}

/// "2.1 %", or "<0.1 %" for a sliver still worth saying, or nil for none.
public func clipLabel(_ share: Double) -> String? {
    if !(share > 0) { return nil }
    if share < 0.001 { return "<0.1 %" }
    return share < 0.1 ? String(format: "%.1f %%", share * 100) : String(format: "%.0f %%", share * 100)
}

// MARK: - auto

/// What a picture is, measured once from a small AS-SHOT sample.
public struct SourceStats: Equatable, Sendable {
    public var bins: [Int]
    public var total: Int
    /// Mean of each channel in LINEAR light, over pixels clipped at neither end.
    public var linearMean: (Double, Double, Double)
    public var counted: Int

    public static func == (a: SourceStats, b: SourceStats) -> Bool {
        a.bins == b.bins && a.total == b.total && a.linearMean == b.linearMean && a.counted == b.counted
    }
}

/// The share of pixels allowed to clip at each end when a black/white point is set.
public let toneClip = 0.0025
private let midTarget = 0.5
private let midPull = 0.6
private let minToneSpan = 0.02

@inline(__always) private func clampD(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    v < lo ? lo : (v > hi ? hi : v)
}

/// Measure RGBA bytes of the picture AS SHOT.
public func measureSource(_ rgba: UnsafeBufferPointer<UInt8>, binCount: Int = histogramBins) -> SourceStats {
    let count = max(1, binCount)
    var bins = [Int](repeating: 0, count: count)
    let pixels = rgba.count / 4
    var sr = 0.0, sg = 0.0, sb = 0.0
    var counted = 0
    // The sRGB decode of a byte is one of 256 values: tabled once.
    let table = (0..<256).map { toLinear(Double($0) / 255, .srgb) }
    for i in 0..<pixels {
        let o = i * 4
        let r = Int(rgba[o]), g = Int(rgba[o + 1]), b = Int(rgba[o + 2])
        let y = 0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)
        bins[min(count - 1, max(0, Int((y * Double(count) / 256).rounded(.down))))] += 1
        let clipped = r >= whiteCode || g >= whiteCode || b >= whiteCode
        let crushed = r <= blackCode && g <= blackCode && b <= blackCode
        if !clipped && !crushed {
            sr += table[r]; sg += table[g]; sb += table[b]
            counted += 1
        }
    }
    let n = Double(counted)
    return SourceStats(bins: bins, total: pixels, linearMean: counted > 0 ? (sr / n, sg / n, sb / n) : (0, 0, 0), counted: counted)
}

public func measureSource(_ rgba: [UInt8], binCount: Int = histogramBins) -> SourceStats {
    rgba.withUnsafeBufferPointer { measureSource($0, binCount: binCount) }
}

/// The encoded value (0..1) below which share `p` of the pixels sit,
/// interpolated INSIDE the bin it lands in.
public func percentile(_ bins: [Int], _ total: Int, _ p: Double) -> Double {
    if total <= 0 || bins.isEmpty { return clampD(p, 0, 1) }
    let want = Double(total) * clampD(p, 0, 1)
    var below = 0.0
    for i in 0..<bins.count {
        let n = Double(bins[i])
        if below + n >= want {
            let within = n > 0 ? (want - below) / n : 0
            return clampD((Double(i) + within) / Double(bins.count), 0, 1)
        }
        below += n
    }
    return 1
}

/// Levels that stretch the picture's own range to the full one and put its
/// median near the middle — or nil when there is nothing to stretch.
public func autoTone(_ stats: SourceStats) -> Levels? {
    let lo = percentile(stats.bins, stats.total, toneClip)
    let hi = percentile(stats.bins, stats.total, 1 - toneClip)
    if hi - lo < minToneSpan { return nil }
    let median = percentile(stats.bins, stats.total, 0.5)
    let mapped = (median - lo) / (hi - lo)
    var gamma = 1.0
    if mapped > 0.001 && mapped < 0.999 {
        let target = mapped + (midTarget - mapped) * midPull
        if target > 0.001 && target < 0.999 {
            gamma = clampD(log(mapped) / log(target), minLevelGamma, maxLevelGamma)
        }
    }
    if lo == 0 && hi == 1 && gamma == 1 { return nil }
    return Levels(rgb: LevelChannel(inBlack: lo, inWhite: hi, gamma: gamma, outBlack: 0, outWhite: 1))
}

/// What Auto colour found. `clamped` means the cast is past the sliders' reach.
public struct AutoColour: Equatable, Sendable {
    public var temperature: Double
    public var tint: Double
    public var clamped: Bool
}

/// Temperature and tint that make the AVERAGE of the picture neutral.
public func autoColour(_ stats: SourceStats) -> AutoColour {
    if stats.counted == 0 { return AutoColour(temperature: 0, tint: 0, clamped: false) }
    return whiteBalanceFor(stats.linearMean)
}

/// The temperature and tint that make ONE linear colour neutral — the same
/// solve for the button and the eyedropper.
public func whiteBalanceFor(_ linear: (Double, Double, Double)) -> AutoColour {
    let (mr, mg, mb) = linear
    if !(mr > 0) || !(mg > 0) || !(mb > 0) { return AutoColour(temperature: 0, tint: 0, clamped: false) }
    let t = (mb - mr) / (mb + mr)
    let temperature = clampD((t / temperatureReach) * 100, -100, 100).rounded()
    let applied = (temperature / 100) * temperatureReach
    let balanced = mr * (1 + applied)
    let u = 1 - balanced / mg
    let tint = clampD((u / tintReach) * 100, -100, 100).rounded()
    let wanted = (t / temperatureReach) * 100
    return AutoColour(temperature: temperature, tint: tint, clamped: abs(wanted) > 100.5)
}

/// What Auto tone did, for the line that reports it — or why it did nothing.
public func describeAutoTone(_ levels: Levels?) -> String {
    guard let rgb = levels?.rgb else { return "nothing to stretch" }
    var parts = ["black \(Int((rgb.inBlack * 255).rounded()))", "white \(Int((rgb.inWhite * 255).rounded()))"]
    if rgb.gamma != 1 { parts.append("gamma \(String(format: "%.2f", rgb.gamma))") }
    return parts.joined(separator: " · ")
}
