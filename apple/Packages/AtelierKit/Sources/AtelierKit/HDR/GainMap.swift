// A GAIN MAP — how much brighter an HDR rendition of a picture is than its
// SDR one, per pixel, as a log2 ratio — and the two directions of it: made
// from the two renditions, and applied back to the SDR one at a display's
// headroom. Port of `src/shared/hdr/gain-map.ts`: the arithmetic of
// ISO 21496-1 / Adobe's gain-map spec, which is what Ultra HDR JPEG carries
// (`UltraHDR.swift` is the container).
//
// The rules it keeps (`docs/memory/hdr.md`): the map is MEASURED between two
// renders and never invented — `hdrRendition` takes, per pixel, the larger of
// the SDR value and the darker render lifted back, so where the SDR had room
// the two agree and the map is flat, the midtones never move and an HDR
// display never shows a pixel darker than the SDR file; a negative gain is
// clamped to 0; the range the picture really uses becomes
// `gainMapMin..gainMapMax`, so the 256 codes cover the lifts present; and a
// render with nothing above white is refused the map (`isFlatGainMap`).
//
// A pixel buffer is `[Float]` where the web holds a `Float32Array`, so a value
// STORED rounds exactly as it does in the browser; the arithmetic between two
// stores runs in Double, as JavaScript's does. Pure Foundation.

import Foundation

/// What a decoder needs to apply the map — the `hdrgm:` XMP fields, one value each (all channels alike).
public struct GainMapMeta: Equatable, Sendable {
    /// log2 of the smallest gain the map encodes (code 0).
    public var gainMapMin: Double
    /// log2 of the largest gain (code 255).
    public var gainMapMax: Double
    /// The encoding's gamma: code = ((gain − min) / (max − min))^(1/gamma).
    public var gamma: Double
    /// Added to the SDR value before the ratio, so a black is not a division by zero.
    public var offsetSdr: Double
    public var offsetHdr: Double
    /// log2 of the display headroom below which the map is not applied at all.
    public var hdrCapacityMin: Double
    /// log2 of the display headroom at which the map is applied whole.
    public var hdrCapacityMax: Double

    public init(gainMapMin: Double, gainMapMax: Double, gamma: Double, offsetSdr: Double, offsetHdr: Double,
                hdrCapacityMin: Double, hdrCapacityMax: Double) {
        self.gainMapMin = gainMapMin; self.gainMapMax = gainMapMax; self.gamma = gamma
        self.offsetSdr = offsetSdr; self.offsetHdr = offsetHdr
        self.hdrCapacityMin = hdrCapacityMin; self.hdrCapacityMax = hdrCapacityMax
    }
}

/// A picture in linear light: RGB, top row first, ≥ 0 and unbounded above.
public struct LinearPicture: Equatable, Sendable {
    public var width: Int
    public var height: Int
    /// `width × height × 3` floats.
    public var data: [Float]

    public init(width: Int, height: Int, data: [Float]) {
        self.width = width; self.height = height; self.data = data
    }
}

/// A gain map, ready to be encoded as a grey JPEG.
public struct GainMap: Equatable, Sendable {
    public var width: Int
    public var height: Int
    /// One code per pixel.
    public var codes: [UInt8]
    public var meta: GainMapMeta
    /// The largest lift the map holds, in stops — 0 where the two renditions agree everywhere.
    public var headroom: Double

    public init(width: Int, height: Int, codes: [UInt8], meta: GainMapMeta, headroom: Double) {
        self.width = width; self.height = height; self.codes = codes; self.meta = meta; self.headroom = headroom
    }
}

/// Android's default: 1/64, added to both sides of the ratio.
public let gainMapOffset = 1.0 / 64
public let gainMapGamma = 1.0
/// The most a map is allowed to say, in stops; a RAW rarely keeps more than four above its white.
public let maxGainStops = 4.0
/// Below this the map says nothing a viewer could show: the file is then a plain JPEG, and said.
public let flatGainStops = 0.05

public enum GainMapError: Error, Equatable {
    /// The web's `throw new Error('The two renditions must be the same size.')`.
    case sizeMismatch

    public var message: String { "The two renditions must be the same size." }
}

/// Rec.709 luminance of one pixel, on the kernel's own weights (`lumR/G/B`, `Develop.swift`).
private func luminance(_ data: [Float], _ i: Int) -> Double {
    let r = Double(data[i])
    let g = Double(data[i + 1])
    let b = Double(data[i + 2])
    return lumR * r + lumG * g + lumB * b
}

/// JavaScript's `Math.round`: the nearest integer, a half rounding towards +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// 8-bit sRGB bytes (an RGBA buffer, the web's `ImageData`) → linear light,
/// through a 256-entry table: the export reads whole pictures, and a `pow`
/// per byte is seconds on a large one.
public func linearFromBytes(_ bytes: [UInt8], width: Int, height: Int) -> LinearPicture {
    var table = [Float](repeating: 0, count: 256)
    for i in 0..<256 { table[i] = Float(toLinear(Double(i) / 255, .srgb)) }
    let n = width * height
    var data = [Float](repeating: 0, count: n * 3)
    var s = 0
    var d = 0
    for _ in 0..<n {
        data[d] = table[Int(bytes[s])]
        data[d + 1] = table[Int(bytes[s + 1])]
        data[d + 2] = table[Int(bytes[s + 2])]
        s += 4
        d += 3
    }
    return LinearPicture(width: width, height: height, data: data)
}

/// The HDR rendition from the two renders the export makes: the SDR one, and
/// the same picture developed `stops` darker then lifted back by `2^stops` in
/// light. Where the SDR had room the two agree and the SDR wins (`max`, so an
/// HDR display never shows a pixel DARKER than the SDR file does); where the
/// SDR ran out at white, the darker render still holds what the sensor kept,
/// and that — lifted back — is the highlight the map will carry.
public func hdrRendition(_ sdr: LinearPicture, _ darker: LinearPicture, stops: Double) throws -> LinearPicture {
    if darker.width != sdr.width || darker.height != sdr.height { throw GainMapError.sizeMismatch }
    let lift = pow(2, stops)
    var data = [Float](repeating: 0, count: sdr.data.count)
    for i in 0..<data.count {
        let back = Double(darker.data[i]) * lift
        let base = Double(sdr.data[i])
        data[i] = Float(back > base ? back : base)
    }
    return LinearPicture(width: sdr.width, height: sdr.height, data: data)
}

/// Box-average a single-channel map by an integer factor — a gain map is
/// commonly kept at a fraction of the picture (the decoder scales it back),
/// and a lift varies slowly except at a clipped edge, where a soft ring is
/// kinder than an aliased one. A factor of 1 hands the values back as they are.
public func downscaleMap(_ values: [Float], width: Int, height: Int, factor: Int) -> (width: Int, height: Int, values: [Float]) {
    let f = max(1, factor)
    if f == 1 { return (width, height, values) }
    let w = max(1, width / f)
    let h = max(1, height / f)
    var out = [Float](repeating: 0, count: w * h)
    for y in 0..<h {
        for x in 0..<w {
            var sum = 0.0
            var n = 0
            for dy in 0..<f {
                let sy = y * f + dy
                if sy >= height { break }
                for dx in 0..<f {
                    let sx = x * f + dx
                    if sx >= width { break }
                    sum += Double(values[sy * width + sx])
                    n += 1
                }
            }
            out[y * w + x] = Float(n > 0 ? sum / Double(n) : 0)
        }
    }
    return (w, h, out)
}

/// The map between two renditions, on LUMINANCE (one channel — the common
/// form, and the one every viewer takes). Per pixel the gain is
/// `log2((Yhdr + o) / (Ysdr + o))`; the range the picture really uses is
/// measured and becomes `gainMapMin..gainMapMax`, so the 256 codes cover the
/// lifts present rather than a fixed span. A negative gain (an HDR rendition
/// darker than the SDR) is clamped to 0: `hdrRendition` never makes one, and
/// a map that only lifts is what a viewer expects.
///
/// The parameters are the web's `GainMapOptions`: `scale` is the map's own
/// resolution as a divisor of the picture's (4 → a quarter on each side),
/// `maxStops` the most the map may say.
public func encodeGainMap(_ sdr: LinearPicture, _ hdr: LinearPicture, scale: Int = 1, gamma: Double = gainMapGamma,
                          offset: Double = gainMapOffset, maxStops: Double = maxGainStops) throws -> GainMap {
    if hdr.width != sdr.width || hdr.height != sdr.height { throw GainMapError.sizeMismatch }
    let n = sdr.width * sdr.height
    var gains = [Float](repeating: 0, count: n)
    var maxGain = 0.0
    var i = 0
    for p in 0..<n {
        let ys = luminance(sdr.data, i)
        let yh = luminance(hdr.data, i)
        var g = log2((yh + offset) / (ys + offset))
        if !(g > 0) { g = 0 }
        if g > maxStops { g = maxStops }
        gains[p] = Float(g)
        if g > maxGain { maxGain = g }
        i += 3
    }
    let small = downscaleMap(gains, width: sdr.width, height: sdr.height, factor: scale)
    var codes = [UInt8](repeating: 0, count: small.width * small.height)
    let span = maxGain > 0 ? maxGain : 1
    for p in 0..<codes.count {
        let t = Double(small.values[p]) / span
        let clamped = t < 0 ? 0 : (t > 1 ? 1 : t)
        codes[p] = UInt8(jsRound(pow(clamped, 1 / gamma) * 255))
    }
    let meta = GainMapMeta(
        gainMapMin: 0, gainMapMax: maxGain, gamma: gamma, offsetSdr: offset, offsetHdr: offset,
        hdrCapacityMin: 0, hdrCapacityMax: maxGain
    )
    return GainMap(width: small.width, height: small.height, codes: codes, meta: meta, headroom: maxGain)
}

/// Whether a map would change anything a viewer shows.
public func isFlatGainMap(headroom: Double) -> Bool {
    !(headroom > flatGainStops)
}

public func isFlatGainMap(_ map: GainMap) -> Bool {
    isFlatGainMap(headroom: map.headroom)
}

/// The decoder's side, for the check that the file says what it was meant
/// to: the SDR rendition lifted by the map at a display of `displayStops` of
/// headroom (log2 of its peak over SDR white). The weight interpolates
/// between the two capacities exactly as a viewer does; a map at a fraction
/// of the picture is sampled nearest — a check, not a renderer.
public func applyGainMap(_ sdr: LinearPicture, _ map: GainMap, displayStops: Double) -> LinearPicture {
    let meta = map.meta
    let span = meta.hdrCapacityMax - meta.hdrCapacityMin
    let w: Double
    if span > 0 {
        w = min(1, max(0, (displayStops - meta.hdrCapacityMin) / span))
    } else {
        w = displayStops >= meta.hdrCapacityMax ? 1 : 0
    }
    var data = [Float](repeating: 0, count: sdr.data.count)
    let kx = Double(map.width) / Double(sdr.width)
    let ky = Double(map.height) / Double(sdr.height)
    let gainSpan = meta.gainMapMax - meta.gainMapMin
    for y in 0..<sdr.height {
        let my = min(map.height - 1, Int((Double(y) * ky).rounded(.down)))
        for x in 0..<sdr.width {
            let mx = min(map.width - 1, Int((Double(x) * kx).rounded(.down)))
            let code = Double(map.codes[my * map.width + mx]) / 255
            let gain = meta.gainMapMin + gainSpan * pow(code, meta.gamma)
            let lift = pow(2, gain * w)
            let i = (y * sdr.width + x) * 3
            for c in 0..<3 {
                let v = (Double(sdr.data[i + c]) + meta.offsetSdr) * lift - meta.offsetHdr
                data[i + c] = Float(v < 0 ? 0 : v)
            }
        }
    }
    return LinearPicture(width: sdr.width, height: sdr.height, data: data)
}

/// "up to 2.3 stops above white", or "flat".
public func describeGainMap(headroom: Double) -> String {
    if isFlatGainMap(headroom: headroom) { return "flat — nothing above white" }
    return "up to \(HdrNumberFormat.toFixed(headroom, 1)) stops above white"
}

public func describeGainMap(_ map: GainMap) -> String {
    describeGainMap(headroom: map.headroom)
}

// MARK: - numbers as JavaScript writes them

/// The two number formats the HDR modules write, kept exact against the
/// browser's: a viewer compares the `hdrgm:` numbers of a file written here
/// with those of one written by the web app, and a line in a panel must read
/// the same on both. Internal — the app has no business formatting these.
enum HdrNumberFormat {
    /// JavaScript's `Number.prototype.toFixed(digits)` for |v| < 1e15: the
    /// exact decimal expansion rounded half AWAY from zero. `String(format:)`
    /// is exact too but rounds an exact tie to EVEN, and a tie exists only when
    /// the double is an odd multiple of 2^−(digits+1) (its expansion has exactly
    /// `digits + 1` decimals and ends in 5) — the one case done by hand.
    static func toFixed(_ v: Double, _ digits: Int) -> String {
        guard v.isFinite else { return v.isNaN ? "NaN" : (v < 0 ? "-Infinity" : "Infinity") }
        let magnitude = abs(v)
        let k = magnitude * pow(2, Double(digits + 1))
        if k == k.rounded(), k < 1e12, Int64(k) % 2 == 1 {
            // |v| × 10^digits = k × 5^digits / 2 — an odd number over two, so
            // the half-up integer is (k × 5^digits + 1) / 2.
            var scaled = Int64(k)
            for _ in 0..<digits { scaled *= 5 }
            let n = (scaled + 1) / 2
            var text = String(n)
            if digits > 0 {
                while text.count <= digits { text = "0" + text }
                text.insert(".", at: text.index(text.endIndex, offsetBy: -digits))
            }
            return (v < 0 ? "-" : "") + text
        }
        return String(format: "%.\(digits)f", v)
    }

    /// A number as XMP writes it — the web's `Number(v.toFixed(6)).toString()`:
    /// plain, no exponent, no trailing zeros, a negative zero written as 0.
    static func xmpNumber(_ v: Double) -> String {
        var text = toFixed(v, 6)
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        if text == "-0" { text = "0" }
        return text
    }
}
